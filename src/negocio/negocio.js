const fs = require('fs');
const path = require('path');

// =====================================================================
// CONFIGURACIÓN DEL NEGOCIO: Casa Luna (negocio ficticio de ejemplo)
//    Todo lo propio de un negocio vive en esta carpeta (src/negocio):
//    los textos del bot, qué datos pide el pedido, cómo es la asesoría,
//    el catálogo, las fichas y la información que lee la IA.
//    Para atender a otro negocio se cambia esta carpeta; el código no.
// =====================================================================

const ENLACE_TIENDA = 'https://example.com/casa-luna/tienda';
const catalogo = require('./catalogo.json');
const fichas = require('./fichas.json');

// Lo escribe el dueño a mano; quitamos los comentarios <!-- --> y las líneas vacías de más.
const contexto = fs
  .readFileSync(path.join(__dirname, 'contexto.md'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

module.exports = {
  nombre: 'Casa Luna',
  ubicacion: 'Trujillo, Perú',
  descripcion: 'tortas personalizadas (Dulce Luna) y bebidas funcionales Vida Verde',
  contacto: 'el asesor', // quién atiende a los clientes que deriva el bot
  enlaceTienda: ENLACE_TIENDA,
  contexto,

  menu: {
    bienvenida: '🌙 ¡Bienvenido a *Casa Luna*! ¿En qué podemos ayudarte hoy?',
    opcionPedido: '🎂 Tortas personalizadas (Dulce Luna)',
    opcionAsesoria: '🌱 Bebidas funcionales Vida Verde',
  },

  // Nunca damos precios: el bot deriva al contacto.
  respuestaPrecio: 'Con gusto 😊 Un asesor te escribirá en breve con los precios y las promociones del mes.',

  // -------------------------------------------------------------------
  // Opción 1: pedido por cuestionario (tortas)
  // -------------------------------------------------------------------
  pedido: {
    palabrasClave: ['torta', 'tortas', 'pastel', 'pasteles', 'queque', 'keke', 'cake', 'cumpleanos'],
    bienvenida: '¡Qué emoción! Bienvenido a *Dulce Luna* 🎂, preparemos la torta perfecta para tu celebración.',
    descripcionIA: 'un pedido de torta',
    campos: [
      { clave: 'fecha', icono: '📅', nombre: 'Fecha de entrega', descripcion: 'fecha en que necesita la torta' },
      { clave: 'porciones', icono: '🍰', nombre: 'Número de porciones', descripcion: 'número de porciones', numero: true, minimo: 15 },
      { clave: 'tematica', icono: '🎨', nombre: 'Temática o diseño', descripcion: 'temática o diseño' },
      { clave: 'sabor', icono: '😋', nombre: 'Sabor y relleno', descripcion: 'sabor del bizcocho y relleno' },
      { clave: 'dedicatoria', icono: '✍️', nombre: 'Dedicatoria', descripcion: 'texto que va escrito en la torta (o "sin dedicatoria")' },
    ],
    pideFoto: true,
    notas: '_Sabores: vainilla, chocolate o zanahoria._\n_Rellenos: manjar, crema de lúcuma o mermelada de fresa._',
    cierre: '🌙 Cada torta se hace a mano y a tu medida.',
    gracias: '🎉 ¡Listo! Un asesor te escribirá en breve para confirmar el diseño y el adelanto.',
    bajoMinimo: (minimo) =>
      `Nuestras tortas personalizadas empiezan en *${minimo} porciones*, pero un asesor te escribirá para ver otras opciones. 😊`,
    sobrePrecio: '💬 El precio depende del diseño: te lo dará nuestro asesor apenas completes tu pedido.',
    tituloAviso: '🎂 NUEVO PEDIDO DE TORTA',
  },

  // -------------------------------------------------------------------
  // Opción 2: asesoría con IA (bebidas funcionales Vida Verde)
  // -------------------------------------------------------------------
  asesoria: {
    catalogo: catalogo.bebidas,
    fichas,
    palabrasClave: ['vida', 'verde', 'bebida', 'bebidas', 'funcional', 'funcionales', 'batido', 'batidos', 'suplemento'],
    frasesClave: ['bajar de peso'],
    // Primer tramo de las claves de producto que también son palabras comunes.
    noSonProducto: ['pack', 'te'],
    presentacion:
      '¡Hola! 🌱 Soy el asesor de *Vida Verde*. Te ayudo a elegir las bebidas funcionales que mejor van con tus objetivos.',
    preguntaTipo: '¿Cómo te gustaría empezar?',
    tiposCliente: [
      { clave: 'nuevo', opcion: '💚 Es mi primera vez', nombre: 'cliente nuevo', palabras: ['primera', 'nuevo', 'nueva'] },
      {
        clave: 'club',
        opcion: '⭐ Unirme al *Club Vida Verde* (promos y regalos)',
        nombre: 'socio del Club Vida Verde',
        palabras: ['club', 'socio'],
        mensaje:
          '⭐ ¡Bienvenido al *Club Vida Verde*! Por cada 3 bebidas te regalamos un *Shot Verde* ' +
          '(según disponibilidad), y recibes las promociones antes que nadie.',
        notaIA: 'Es socio del Club Vida Verde: al recomendar, recuérdale que por cada 3 bebidas se le regala un Shot Verde (según disponibilidad).',
      },
      {
        clave: 'revendedor',
        opcion: '🏪 Quiero *revender* Vida Verde',
        nombre: 'revendedor/a',
        palabras: ['revend', 'distribu', 'mayor'],
        // No pasa por la asesoría: se le comparte la página y lo contacta el asesor.
        derivar:
          '🏪 ¡Genial! Tenemos precios especiales para revendedores.\n\n' +
          `Aquí puedes ver el catálogo:\n${ENLACE_TIENDA}\n\n` +
          'Un asesor te escribirá en breve con las condiciones. 😊',
      },
    ],
    pregunta:
      'Para recomendarte bien, cuéntame: ¿qué *objetivo* tienes o qué *molestias* quieres mejorar? 💬\n\n' +
      '_Por ejemplo: bajar de peso, más energía, digestión, dormir mejor... Puedes contarme varios._',
    etiquetaRespuesta: 'Objetivo o molestias',
    sinIA:
      '🙌 ¡Gracias por contarnos! Un asesor te escribirá en breve con una recomendación para ti.\n\n' +
      `Mientras tanto, puedes ver las bebidas aquí:\n${ENLACE_TIENDA}`,
  },

  // -------------------------------------------------------------------
  // Instrucciones para la IA
  // -------------------------------------------------------------------
  ia: {
    presentacion: `Eres el asistente de WhatsApp de *Casa Luna*, un negocio en Trujillo (Perú) con dos líneas:
1. *Dulce Luna*: tortas personalizadas, desde 15 porciones.
2. *Vida Verde*: bebidas funcionales elaboradas con ingredientes peruanos.`,
    reglas: [
      'Llama a los productos Vida Verde "bebidas funcionales"; nunca "medicinas" ni "tratamientos".',
      'Nunca des precios ni montos. Si el cliente pide precios, dile con amabilidad que un asesor le escribirá en breve con los precios y promociones.',
      'Las bebidas no son medicamentos: no prometas curar enfermedades ni bajar una cantidad exacta de kilos. Recomienda consultar a un médico solo cuando el cliente mencione una enfermedad diagnosticada, embarazo, lactancia o medicamentos.',
    ],
    asesoria: [
      'Ya le preguntamos su objetivo o molestias; sus mensajes son la respuesta. Habla como el asesor, en primera persona.',
      'Si quiere bajar de peso y todavía no sabes cuánto pesa y cuánto quiere bajar, pregúntale ambos datos en un solo mensaje antes de recomendar.',
      'Para bajar de peso elige entre el Pack 7 días (pack_7_dias) o bebidas por separado, explicando por qué.',
      'Si tiene varios objetivos, arma un pack de dos o más bebidas: di para qué es cada una y cuándo tomarla, respetando lo que no se toma junto.',
      'Si su mensaje no es claro, haz una sola pregunta para entender mejor.',
      'Nunca menciones precios.',
      `Cuando des tu recomendación, termina con: "Puedes ver y comprar tus bebidas aquí: ${ENLACE_TIENDA}" y que un asesor le escribirá en breve.`,
    ],
  },

  // Textos propios de la política de privacidad pública (/privacidad).
  privacidad: {
    datosPedido: 'fecha y detalles de la torta, objetivos de bienestar, peso y meta de peso',
    salud: 'Las recomendaciones sobre bebidas funcionales son orientativas y no reemplazan la consulta con un médico.',
  },
};
