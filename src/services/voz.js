const config = require('../config/env');
const { descargarMedia } = require('./whatsapp');

// =====================================================================
// NOTAS DE VOZ: WhatsApp → Groq (Whisper) → texto
//    1. Pedimos a Meta la URL temporal del audio (con su media_id).
//    2. Descargamos el audio (también requiere el token de WhatsApp).
//    3. Lo enviamos a Groq para transcribirlo a texto en español.
// =====================================================================

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

const vozDisponible = () => Boolean(config.groq.apiKey && config.whatsapp.token);

async function transcribir({ datos, tipo = 'audio/ogg' }) {
  const formulario = new FormData();
  // WhatsApp envía las notas de voz en OGG/Opus; Groq lo acepta directamente.
  formulario.append('file', new Blob([datos], { type: tipo }), 'nota-de-voz.ogg');
  formulario.append('model', config.groq.model);
  formulario.append('language', 'es');
  formulario.append('response_format', 'json');

  const respuesta = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groq.apiKey}` },
    body: formulario,
  });
  if (!respuesta.ok) throw new Error(`Groq respondió ${respuesta.status}: ${await respuesta.text()}`);

  const { text } = await respuesta.json();
  return (text || '').trim();
}

// Devuelve el texto de la nota de voz, o null si no se pudo transcribir.
async function notaDeVozATexto(mediaId) {
  if (!vozDisponible()) return null;
  try {
    const texto = await transcribir(await descargarMedia(mediaId));
    console.log(`🎙️ Transcripción: "${texto}"`);
    return texto || null;
  } catch (error) {
    console.error('Error transcribiendo nota de voz:', error.message);
    return null;
  }
}

module.exports = { notaDeVozATexto, vozDisponible };
