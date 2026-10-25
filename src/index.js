const express = require('express');
const config = require('./config/env');
const negocio = require('./negocio/negocio');
const healthRouter = require('./routes/health');
const privacidadRouter = require('./routes/privacidad');
const { responderConIA, extraerPedido, iaDisponible } = require('./services/ia');
const { notaDeVozATexto, vozDisponible } = require('./services/voz');
const { enviarTexto, enviarPlantilla, reenviarImagen } = require('./services/whatsapp');

const app = express();
app.use(express.json());
app.use('/health', healthRouter);
app.use('/privacidad', privacidadRouter);

// =====================================================================
// 1. DETECCIÓN DE INTENCIÓN
//    Los textos, campos y reglas de cada negocio están en src/negocio.
//    Aquí solo decidimos a qué opción va un mensaje libre.
// =====================================================================

const { pedido, asesoria } = negocio;

// Además de las palabras clave, el primer tramo del nombre de cada producto
// ("prunex_28" → "prunex") lleva a la asesoría.
const PALABRAS_ASESORIA = [
  ...asesoria.palabrasClave,
  ...Object.keys(asesoria.fichas)
    .filter((k) => !k.startsWith('_'))
    .map((k) => k.split('_')[0].replace(/\W/g, ''))
    .filter((p) => !asesoria.noSonProducto.includes(p)),
];

// "¿cuánto cuesta?", "precio", "cuánto sale"... ("vale" solo no: también significa "ok").
const PREGUNTA_PRECIO = /\b(precio|precios|cuesta|cuestan|costo|costos|valen)\b|\bcuanto (sale|salen|seria|vale)\b/;

// =====================================================================
// 2. SESIONES
//    Guardamos en memoria en qué parte de la conversación está cada
//    cliente. Si el servidor se reinicia, las sesiones se pierden
//    (más adelante se puede pasar a una base de datos).
// =====================================================================

const sesiones = new Map();
const MINUTOS_EXPIRACION = 30;

function obtenerSesion(telefono) {
  const sesion = sesiones.get(telefono);
  const expirada = sesion && Date.now() - sesion.ultimaActividad > MINUTOS_EXPIRACION * 60 * 1000;

  if (!sesion || expirada) {
    const nueva = { telefono, contexto: 'inicio', paso: null, datos: {}, ultimaActividad: Date.now() };
    sesiones.set(telefono, nueva);
    return nueva;
  }

  sesion.ultimaActividad = Date.now();
  return sesion;
}

function cambiarContexto(sesion, contexto, paso = null) {
  sesion.contexto = contexto;
  sesion.paso = paso;
  sesion.datos = {};
}

// =====================================================================
// 3. UTILIDADES DE TEXTO
// =====================================================================

// Pasa a minúsculas y quita tildes para comparar "Menú", "menu", "MENU"...
function normalizar(texto) {
  return texto.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

const palabras = (texto) => texto.split(/[^a-z0-9]+/).filter(Boolean);

// 'pedido', 'asesoria' o null según las palabras del mensaje.
function detectarOpcion(texto) {
  const lista = palabras(texto);
  if (lista.some((p) => pedido.palabrasClave.includes(p))) return 'pedido';
  if (lista.some((p) => PALABRAS_ASESORIA.includes(p)) || asesoria.frasesClave.some((f) => texto.includes(f))) {
    return 'asesoria';
  }
  return null;
}

const PIE_MENU = '\n\nEscribe *0* para volver al menú principal.';
const PIE_FINAL = '\n\nEscribe *0* si necesitas algo más.';
const ERROR_OPCION = 'Por favor elige un número de la lista.';

// =====================================================================
// 3b. AVISOS AL CONTACTO DEL NEGOCIO (la asesora)
//     Cada pedido o cliente interesado le llega por WhatsApp, con un
//     enlace para escribirle al cliente. No frenan la respuesta al
//     cliente: si el aviso falla, solo queda en el log.
//     Si la asesora no le escribió al bot en las últimas 24 horas, WhatsApp
//     rechaza el texto normal: entonces va la plantilla aprobada, y las
//     fotos esperan hasta que ella le escriba al bot.
// =====================================================================

const PLANTILLA_AVISO = 'aviso_asesora';
const fotosPendientes = [];

function avisarAsesora(sesion, texto, imagenId) {
  const enlace = `https://wa.me/${sesion.telefono}`;
  const aviso = `${texto}\n\n📲 Escríbele: ${enlace}`;
  console.log('🔔 AVISO A LA ASESORA:', aviso.replace(/\n+/g, ' | '));
  const { telefono } = config.asesora;
  if (!telefono) return;

  (async () => {
    if (await enviarTexto(telefono, aviso)) {
      if (imagenId) await reenviarImagen(telefono, imagenId, '📸 Foto de referencia del pedido');
      return;
    }
    const detalle = imagenId ? `${texto}\n📸 Hay una foto: escríbele "hola" al bot para recibirla.` : texto;
    await enviarPlantilla(telefono, PLANTILLA_AVISO, [detalle.replace(/[*_]/g, ''), enlace]);
    if (imagenId) fotosPendientes.push({ imagenId, leyenda: `📸 Foto de referencia del pedido de ${enlace}` });
  })().catch((error) => console.error('No se pudo avisar a la asesora:', error.message));
}

// Cuando la asesora le escribe al bot se abre su ventana de 24 h: le mandamos las fotos que esperaban.
function entregarFotosPendientes(telefono) {
  if (telefono !== config.asesora.telefono || fotosPendientes.length === 0) return;
  const fotos = fotosPendientes.splice(0);
  (async () => {
    for (const { imagenId, leyenda } of fotos) await reenviarImagen(telefono, imagenId, leyenda);
  })().catch((error) => console.error('No se pudieron entregar las fotos pendientes:', error.message));
}

// =====================================================================
// 4. MENÚ PRINCIPAL
// =====================================================================

function textoMenuPrincipal() {
  return (
    `${negocio.menu.bienvenida}\n\n` +
    `1. ${negocio.menu.opcionPedido}\n` +
    `2. ${negocio.menu.opcionAsesoria}\n\n` +
    'Responde con el número de tu opción.'
  );
}

function iniciarOpcion(sesion, opcion) {
  return opcion === 'pedido' ? iniciarPedido(sesion) : iniciarAsesoria(sesion);
}

// =====================================================================
// 5. OPCIÓN 1: PEDIDO POR CUESTIONARIO
//    Un solo mensaje con todo el cuestionario. El cliente responde como
//    prefiera (todo junto o por partes) y la IA va anotando cada dato;
//    el bot solo pide lo que falta. No se cotiza: al completar el pedido,
//    un asesor contacta al cliente para el pago.
// =====================================================================

const SIN_FOTO = ['no', 'no tengo', 'no tengo foto', 'ninguna', 'sin foto'];
const CAMPO_MINIMO = pedido.campos.find((campo) => campo.minimo);

// "Número de porciones (desde 20)": el mínimo se muestra junto al nombre del campo.
const etiquetaCampo = (campo) => `${campo.icono} ${campo.nombre}${campo.minimo ? ` (desde ${campo.minimo})` : ''}`;

function iniciarPedido(sesion) {
  cambiarContexto(sesion, 'pedido', 'cuestionario');
  sesion.datos.respuestas = [];
  return [
    `${pedido.bienvenida}\n\n` +
      'Para organizar tu pedido, coméntanos:\n\n' +
      pedido.campos.map((campo) => `${etiquetaCampo(campo)}:`).join('\n') +
      (pedido.pideFoto ? '\n📸 Foto de referencia: (envíala como imagen)' : '') +
      (pedido.notas ? `\n\n${pedido.notas}` : '') +
      '\n\nPuedes responder todo en un solo mensaje o por partes, como prefieras. 😊' +
      (pedido.cierre ? `\n\n${pedido.cierre}` : '') +
      PIE_MENU,
  ];
}

function faltantesPedido(datos) {
  const faltan = pedido.campos.filter((campo) => !datos.pedido?.[campo.clave]).map(etiquetaCampo);
  if (pedido.pideFoto && !datos.foto && !datos.sinFoto) faltan.push('📸 Foto de referencia (o escribe *no tengo*)');
  return faltan;
}

// Con todo completo cierra el pedido; si no, dice qué falta.
function siguientePasoPedido(sesion, prefijo = '✍️ ¡Anotado!') {
  const faltan = faltantesPedido(sesion.datos);
  if (faltan.length === 0) return cerrarPedido(sesion);
  return [`${prefijo} Para completar tu pedido nos falta:\n\n${faltan.join('\n')}`];
}

function cerrarPedido(sesion) {
  const { pedido: leido, foto } = sesion.datos;
  const detalle =
    pedido.campos.map((campo) => `• ${campo.nombre}: ${leido[campo.clave]}`).join('\n') +
    (pedido.pideFoto ? `\n• Foto de referencia: ${foto ? 'recibida ✅' : 'sin foto'}` : '');

  avisarAsesora(sesion, `*${pedido.tituloAviso}*\n\n${detalle}`, foto);
  cambiarContexto(sesion, 'menu');
  return [`🧾 *Resumen de tu pedido*\n\n${detalle}`, pedido.gracias + PIE_FINAL];
}

async function manejarPedido(sesion, texto, textoOriginal) {
  const { datos } = sesion;
  if (sesion.paso !== 'cuestionario') return iniciarPedido(sesion);

  if (pedido.pideFoto && SIN_FOTO.includes(texto)) {
    datos.sinFoto = true;
  } else {
    datos.respuestas.push(textoOriginal.trim());
    const leido = await extraerPedido(datos.respuestas.join('\n'));

    if (!leido) {
      // Sin IA no podemos separar los datos: la asesora lee el mensaje tal cual.
      avisarAsesora(sesion, `*${pedido.tituloAviso}*\n\n${datos.respuestas.join('\n')}`, datos.foto);
      cambiarContexto(sesion, 'menu');
      return [pedido.gracias + PIE_FINAL];
    }
    datos.pedido = leido;
  }

  const cantidad = CAMPO_MINIMO && datos.pedido?.[CAMPO_MINIMO.clave];
  if (cantidad && cantidad < CAMPO_MINIMO.minimo) {
    avisarAsesora(
      sesion,
      `⚠️ Pedido por debajo del mínimo: *${CAMPO_MINIMO.nombre}: ${cantidad}* (mínimo ${CAMPO_MINIMO.minimo}).\n\n` +
        `Lo que escribió:\n${datos.respuestas.join('\n')}`,
      datos.foto,
    );
    cambiarContexto(sesion, 'menu');
    return [pedido.bajoMinimo(CAMPO_MINIMO.minimo) + PIE_FINAL];
  }

  const respuesta = siguientePasoPedido(sesion);
  // Si preguntó el precio, se lo aclaramos sin perder lo que respondió.
  if (PREGUNTA_PRECIO.test(texto)) respuesta.unshift(pedido.sobrePrecio);
  return respuesta;
}

// La foto puede llegar antes, en medio o después de las respuestas.
function recibirFotoPedido(sesion, imagenId) {
  sesion.datos.foto = imagenId;
  if (!sesion.datos.pedido) return ['📸 ¡Foto recibida! Ahora cuéntanos los demás datos de tu pedido.'];
  return siguientePasoPedido(sesion, '📸 ¡Foto recibida!');
}

// =====================================================================
// 6. OPCIÓN 2: ASESORÍA CON IA
//    Pasos: tipo de cliente (si el negocio los define) → conversación
//    con la IA. Un tipo con "derivar" no pasa por la IA: recibe su
//    mensaje y lo contacta la asesora.
// =====================================================================

function preguntarTipoCliente() {
  return (
    `${asesoria.preguntaTipo}\n\n` +
    asesoria.tiposCliente.map((tipo, i) => `${i + 1}. ${tipo.opcion}`).join('\n') +
    PIE_MENU
  );
}

function iniciarAsesoria(sesion) {
  if (asesoria.tiposCliente.length === 0) {
    cambiarContexto(sesion, 'asesoria', 'conversacion');
    sesion.historial = [];
    return [asesoria.presentacion, asesoria.pregunta];
  }
  cambiarContexto(sesion, 'asesoria', 'tipo_cliente');
  return [asesoria.presentacion, preguntarTipoCliente()];
}

// Acepta el número de la opción o una palabra ("quiero ser vip").
function elegirTipoCliente(texto) {
  const numero = parseInt(texto, 10);
  if (String(numero) === texto) return asesoria.tiposCliente[numero - 1] ?? null;
  return asesoria.tiposCliente.find((tipo) => tipo.palabras.some((p) => texto.includes(p))) ?? null;
}

async function manejarAsesoria(sesion, texto, textoOriginal) {
  switch (sesion.paso) {
    case 'tipo_cliente': {
      const tipo = elegirTipoCliente(texto);
      if (!tipo) return [ERROR_OPCION, preguntarTipoCliente()];

      if (tipo.derivar) {
        avisarAsesora(sesion, `💼 Nueva persona interesada en ser *${tipo.nombre}*.`);
        cambiarContexto(sesion, 'menu');
        return [tipo.derivar + PIE_FINAL];
      }

      sesion.paso = 'conversacion';
      sesion.datos.tipo = tipo.clave;
      sesion.historial = []; // la asesoría empieza con una conversación limpia
      return tipo.mensaje ? [tipo.mensaje, asesoria.pregunta] : [asesoria.pregunta];
    }

    case 'conversacion': {
      const tipo = asesoria.tiposCliente.find((t) => t.clave === sesion.datos.tipo);
      // La asesora recibe la primera respuesta del cliente.
      if (!sesion.datos.avisado) {
        sesion.datos.avisado = true;
        avisarAsesora(
          sesion,
          `🌿 Nuevo *${tipo?.nombre ?? 'cliente'}* en asesoría.\n\n${asesoria.etiquetaRespuesta}:\n${textoOriginal.trim()}`,
        );
      }
      const respuestaIA = await responderConIA(sesion, textoOriginal.trim(), { tipoCliente: tipo });
      return [respuestaIA || asesoria.sinIA];
    }

    default:
      return iniciarAsesoria(sesion);
  }
}

// =====================================================================
// 7. CEREBRO DEL BOT
//    Recibe el texto del cliente y decide qué responder según su contexto.
//    Devuelve una lista de mensajes (se envían en orden).
// =====================================================================

// Un saludo corto ("hola", "buenas tardes") muestra el menú; una pregunta
// más larga ("¿hacen tortas sin azúcar?") la responde la IA.
const PALABRAS_PREGUNTA_LIBRE = 4;

function responderPrecio(sesion, textoOriginal) {
  avisarAsesora(sesion, `💰 Cliente pide *precios*:\n"${textoOriginal.trim()}"`);
  return [negocio.respuestaPrecio];
}

async function procesarMensaje(telefono, textoOriginal) {
  const sesion = obtenerSesion(telefono);
  const texto = normalizar(textoOriginal);

  // Comandos globales: funcionan desde cualquier punto de la conversación.
  if (['0', 'menu', 'inicio', 'hola'].includes(texto)) {
    cambiarContexto(sesion, 'menu');
    return [textoMenuPrincipal()];
  }

  // Derecho de eliminación (lo promete la política de privacidad en /privacidad).
  if (texto.includes('eliminar mis datos')) {
    avisarAsesora(sesion, '🗑️ Cliente pide *eliminar sus datos*. Borra su información de pedidos y contactos.');
    cambiarContexto(sesion, 'menu');
    sesion.historial = [];
    return [`✅ Recibimos tu pedido. Eliminaremos tus datos y ${negocio.contacto} te confirmará cuando esté listo.`];
  }

  switch (sesion.contexto) {
    case 'pedido':
      // En el pedido, la pregunta de precio se responde dentro del cuestionario.
      return manejarPedido(sesion, texto, textoOriginal);
    case 'asesoria':
      // Nunca damos precios: se deriva a la asesora (sin perder el paso actual).
      if (PREGUNTA_PRECIO.test(texto)) return responderPrecio(sesion, textoOriginal);
      return manejarAsesoria(sesion, texto, textoOriginal);
    default: {
      // 'inicio' (primer mensaje) o 'menu' (esperando 1 o 2).
      if (texto === '1') return iniciarPedido(sesion);
      if (texto === '2') return iniciarAsesoria(sesion);

      const opcion = detectarOpcion(texto);
      if (opcion) return iniciarOpcion(sesion, opcion);
      if (PREGUNTA_PRECIO.test(texto)) return responderPrecio(sesion, textoOriginal);

      const esPreguntaLibre =
        sesion.contexto === 'menu' || texto.split(/\s+/).length >= PALABRAS_PREGUNTA_LIBRE;
      if (esPreguntaLibre) {
        const respuestaIA = await responderConIA(sesion, textoOriginal.trim());
        if (respuestaIA) {
          sesion.contexto = 'menu';
          return [respuestaIA];
        }
      }

      // Primer mensaje o respuesta no válida: mostramos el menú.
      cambiarContexto(sesion, 'menu');
      return [textoMenuPrincipal()];
    }
  }
}

function procesarImagen(telefono, imagenId) {
  const sesion = obtenerSesion(telefono);
  if (sesion.contexto === 'pedido' && pedido.pideFoto) return recibirFotoPedido(sesion, imagenId);
  return ['📸 ¡Gracias por la imagen! Para ayudarte mejor, escríbenos tu consulta en texto o escribe *menu*.'];
}

// =====================================================================
// 8. WEBHOOK DE WHATSAPP
// =====================================================================

// GET: Meta lo llama una sola vez para verificar que el webhook es tuyo.
app.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const tokenRecibido = req.query['hub.verify_token'];
  const reto = req.query['hub.challenge'];

  if (modo === 'subscribe' && tokenRecibido && tokenRecibido === config.whatsapp.verifyToken) {
    console.log('✅ Webhook verificado por Meta');
    return res.status(200).send(reto);
  }
  return res.sendStatus(403);
});

// POST: Meta envía aquí cada mensaje que recibe tu número de WhatsApp.
app.post('/webhook', async (req, res) => {
  // Respondemos 200 de inmediato; si tardamos, Meta reenvía el mensaje.
  res.sendStatus(200);

  const valor = req.body?.entry?.[0]?.changes?.[0]?.value;
  const mensaje = valor?.messages?.[0];
  if (!mensaje) {
    const estado = valor?.statuses?.[0];
    if (estado) {
      // Notificaciones de estado (enviado, entregado, leído...): una línea basta.
      console.log(`📬 ${estado.recipient_id}: ${estado.status}`);
    } else {
      // Body con otro formato: lo mostramos completo para poder depurarlo.
      console.log('📥 POST /webhook sin mensaje. Body:', JSON.stringify(req.body));
    }
    return;
  }

  const telefono = mensaje.from;
  console.log(`📥 POST /webhook de ${telefono} [${mensaje.type}]:`, mensaje.text?.body ?? '(sin texto)');

  entregarFotosPendientes(telefono);

  try {
    let respuestas;

    if (mensaje.type === 'text') {
      respuestas = await procesarMensaje(telefono, mensaje.text.body);
    } else if (mensaje.type === 'audio') {
      // Parte "voz" del bot híbrido: transcribimos y la tratamos como texto.
      const transcripcion = await notaDeVozATexto(mensaje.audio.id);
      respuestas = transcripcion
        ? await procesarMensaje(telefono, transcripcion)
        : ['🎙️ No pudimos escuchar tu nota de voz. Por favor escríbenos tu mensaje en texto.'];
    } else if (mensaje.type === 'image') {
      // Fotos de referencia del pedido.
      respuestas = procesarImagen(telefono, mensaje.image.id);
    } else {
      respuestas = ['Por ahora solo puedo leer mensajes de texto. Escribe *menu* para comenzar.'];
    }

    for (const texto of respuestas) {
      await enviarTexto(telefono, texto);
    }
  } catch (error) {
    console.error('Error procesando mensaje:', error);
  }
});

// =====================================================================
// 9. SIMULADOR LOCAL (solo en desarrollo)
//     Permite probar el bot sin WhatsApp:
//     POST /simular  { "telefono": "521...", "texto": "1" }
//     Para simular una foto: { "telefono": "521...", "imagen": "id-de-prueba" }
// =====================================================================

if (config.nodeEnv === 'development') {
  app.post('/simular', async (req, res) => {
    const { telefono = 'prueba', texto = '', imagen } = req.body || {};
    console.log(`🧪 POST /simular de ${telefono}:`, imagen ? `[imagen ${imagen}]` : JSON.stringify(texto));
    const respuestas = imagen
      ? procesarImagen(String(telefono), String(imagen))
      : await procesarMensaje(String(telefono), String(texto));
    console.log(`🧪 ${respuestas.length} respuesta(s):\n${respuestas.join('\n---\n')}\n`);
    res.json({ respuestas });
  });
}

// =====================================================================
// 10. ARRANQUE DEL SERVIDOR
// =====================================================================

app.listen(config.port, () => {
  console.log(`Servidor escuchando en http://localhost:${config.port} (${config.nodeEnv})`);
  if (!config.whatsapp.token) {
    console.log('⚠️  WHATSAPP_TOKEN vacío: modo simulación activo (las respuestas se imprimen aquí).');
  }
  if (!iaDisponible()) {
    console.log('⚠️  ANTHROPIC_API_KEY vacía: la IA está apagada (el bot solo usa el menú).');
  }
  if (!config.asesora.telefono) {
    console.log('⚠️  ASESORA_TELEFONO vacío: los avisos de pedidos solo quedan en este log.');
  }
  if (!vozDisponible()) {
    console.log('⚠️  GROQ_API_KEY o WHATSAPP_TOKEN vacíos: las notas de voz no se transcriben.');
  }
});
