const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/env');
const negocio = require('../negocio/negocio');

const { asesoria, pedido } = negocio;

// La IA no recibe precios: solo qué productos hay en cada categoría.
const productosPorCategoria = Object.fromEntries(
  Object.entries(asesoria.catalogo).map(([categoria, productos]) => [categoria, Object.keys(productos)]),
);

// Solo enviamos a la IA los campos con contenido (los vacíos se omiten).
const fichasConInfo = Object.fromEntries(
  Object.entries(asesoria.fichas)
    .filter(([clave]) => !clave.startsWith('_'))
    .map(([clave, ficha]) => [clave, Object.fromEntries(Object.entries(ficha).filter(([, v]) => v))])
    .filter(([, ficha]) => Object.keys(ficha).length > 0),
);

const lista = (reglas) => reglas.map((regla) => `- ${regla}`).join('\n');

// =====================================================================
// IA CONVERSACIONAL (Claude)
//    Responde los mensajes libres que no encajan en el menú y hace la
//    asesoría. Sin ANTHROPIC_API_KEY, el bot sigue funcionando solo con
//    el menú.
// =====================================================================

const iaDisponible = () => Boolean(config.anthropic.apiKey);
const cliente = iaDisponible() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

// Cuántos mensajes recientes (cliente + bot) recordamos por conversación.
const MAX_HISTORIAL = 10;

// El prompt no cambia entre mensajes, así que se cachea (más barato y rápido).
const INSTRUCCIONES = `${negocio.ia.presentacion}

Productos por categoría (las claves coinciden con las fichas):
${JSON.stringify(productosPorCategoria)}

Fichas de productos (qué es, ingredientes y modo de uso según el fabricante):
${JSON.stringify(fichasConInfo)}

Información del negocio escrita por la dueña. Los títulos sin texto debajo significan que ese dato aún no está disponible:
${negocio.contexto}

Página donde se compran los productos: ${negocio.enlaceTienda}

Cómo responder:
- Español neutro y cercano, como en WhatsApp: mensajes cortos (máximo 6-8 líneas), sin títulos ni tablas. Usa *negritas* de WhatsApp (un asterisco) y algún emoji con moderación.
${lista(negocio.ia.reglas)}
- Cuando pregunten por un producto, explícalo con su ficha: qué es, para qué se usa, ingredientes principales y modo de uso.
- Si la ficha no tiene un dato, da lo que sí sabes y di que ${negocio.contacto} le confirmará ese detalle.
- Usa solo los datos de las fichas y de la información del negocio; nunca inventes productos, ingredientes, dosis, promociones, horarios ni resultados.
- Las advertencias de las fichas (embarazo, lactancia, edad mínima, "no tomar junto con") siempre se respetan, aunque otra parte de la información diga que no hay contraindicaciones.
- Para "${negocio.menu.opcionPedido}" el cliente escribe *1*; para "${negocio.menu.opcionAsesoria}", escribe *2*.
- Si el mensaje no tiene relación con el negocio, responde con amabilidad y en una línea redirige a lo que ofrecemos.`;

// Instrucciones extra durante la asesoría (no se cachean: cambian por cliente).
function instruccionesAsesoria(tipoCliente) {
  const reglas = [...negocio.ia.asesoria];
  if (tipoCliente?.notaIA) reglas.push(tipoCliente.notaIA);
  const quien = tipoCliente ? ` El cliente eligió ser *${tipoCliente.nombre}*.` : '';
  return `AHORA ESTÁS EN LA ASESORÍA.${quien}\n${lista(reglas)}`;
}

// enAsesoria: { tipoCliente } cuando el cliente está en la asesoría.
async function responderConIA(sesion, textoCliente, enAsesoria) {
  if (!iaDisponible()) return null;

  sesion.historial ??= [];
  const mensajes = [...sesion.historial, { role: 'user', content: textoCliente }];

  const system = [{ type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } }];
  if (enAsesoria) system.push({ type: 'text', text: instruccionesAsesoria(enAsesoria.tipoCliente) });

  try {
    const respuesta = await cliente.messages.create({
      model: config.anthropic.model,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system,
      messages: mensajes,
    });

    if (respuesta.stop_reason === 'refusal') {
      console.warn('IA rechazó responder:', respuesta.stop_details?.category);
      return null;
    }

    const texto = respuesta.content
      .filter((bloque) => bloque.type === 'text')
      .map((bloque) => bloque.text)
      .join('\n')
      .trim();
    if (!texto) return null;

    // Guardamos solo el texto para mantener el historial corto.
    sesion.historial = [...mensajes, { role: 'assistant', content: texto }].slice(-MAX_HISTORIAL);
    return texto;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('IA: ANTHROPIC_API_KEY inválida.');
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error('IA: límite de uso alcanzado, intenta más tarde.');
    } else if (error instanceof Anthropic.APIError) {
      console.error(`IA: error ${error.status}:`, error.message);
    } else {
      console.error('IA: error inesperado:', error);
    }
    return null;
  }
}

// =====================================================================
// LECTURA DEL CUESTIONARIO DEL PEDIDO
//    El cliente responde como quiera (todo junto, por partes, copiando la
//    plantilla); la IA saca cada dato. Lo que no dijo queda en null.
//    El esquema sale de los campos definidos en negocio.js.
// =====================================================================

const ESQUEMA_PEDIDO = {
  type: 'object',
  properties: Object.fromEntries(
    pedido.campos.map((campo) => [campo.clave, { type: [campo.numero ? 'integer' : 'string', 'null'] }]),
  ),
  required: pedido.campos.map((campo) => campo.clave),
  additionalProperties: false,
};

const INSTRUCCIONES_PEDIDO =
  `Extraes los datos de ${pedido.descripcionIA} a partir de los mensajes de WhatsApp de un cliente. ` +
  pedido.campos.map((campo) => `${campo.clave}: ${campo.descripcion}`).join('; ') +
  '. Copia lo que dijo el cliente con sus palabras, sin inventar ni completar. ' +
  'Si un dato no aparece en los mensajes, devuélvelo como null.';

async function extraerPedido(respuestasCliente) {
  if (!iaDisponible()) return null;

  try {
    const respuesta = await cliente.messages.create({
      model: config.anthropic.model,
      max_tokens: 1000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_PEDIDO } },
      system: INSTRUCCIONES_PEDIDO,
      messages: [{ role: 'user', content: respuestasCliente }],
    });

    const texto = respuesta.content.find((bloque) => bloque.type === 'text')?.text;
    return texto ? JSON.parse(texto) : null;
  } catch (error) {
    console.error('IA: no se pudo leer el pedido:', error.message);
    return null;
  }
}

module.exports = { responderConIA, extraerPedido, iaDisponible };
