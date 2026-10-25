const config = require('../config/env');

// =====================================================================
// WHATSAPP CLOUD API: envío de textos e imágenes y descarga de archivos
//    Si no hay token configurado, solo imprime en consola (modo simulación).
// =====================================================================

const urlGraph = (ruta) => `https://graph.facebook.com/${config.whatsapp.apiVersion}/${ruta}`;
const cabeceras = () => ({ Authorization: `Bearer ${config.whatsapp.token}` });
const whatsappDisponible = () => Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);

async function enviar(telefono, contenido) {
  const respuesta = await fetch(urlGraph(`${config.whatsapp.phoneNumberId}/messages`), {
    method: 'POST',
    headers: { ...cabeceras(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: telefono, ...contenido }),
  });
  if (!respuesta.ok) {
    console.error('Error al enviar a WhatsApp:', respuesta.status, await respuesta.text());
    return false;
  }
  console.log(`📤 Mensaje enviado a ${telefono}`);
  return true;
}

async function enviarTexto(telefono, texto) {
  if (!whatsappDisponible()) {
    console.log(`[SIMULACIÓN] → ${telefono}:\n${texto}\n`);
    return true;
  }
  return enviar(telefono, { type: 'text', text: { body: texto } });
}

// Las plantillas aprobadas por Meta llegan aunque la persona no haya escrito
// en las últimas 24 horas (un texto normal, no). Sus variables no admiten
// saltos de línea, así que se aplanan.
async function enviarPlantilla(telefono, nombre, variables) {
  const parametros = variables.map((v) => ({
    type: 'text',
    text: String(v).replace(/\s*\n+\s*(•\s*)?/g, ' · ').replace(/\s{4,}/g, ' ').slice(0, 900),
  }));
  if (!whatsappDisponible()) {
    console.log(`[SIMULACIÓN] → ${telefono}: [plantilla ${nombre}]`, parametros.map((p) => p.text).join(' | '));
    return true;
  }
  return enviar(telefono, {
    type: 'template',
    template: { name: nombre, language: { code: 'es' }, components: [{ type: 'body', parameters: parametros }] },
  });
}

// Los archivos que llegan (audios, fotos) se piden a Meta con su media_id.
async function descargarMedia(mediaId) {
  const info = await fetch(urlGraph(mediaId), { headers: cabeceras() });
  if (!info.ok) throw new Error(`No se pudo obtener el archivo (${info.status}): ${await info.text()}`);
  const { url, mime_type: tipo } = await info.json();

  const archivo = await fetch(url, { headers: cabeceras() });
  if (!archivo.ok) throw new Error(`No se pudo descargar el archivo (${archivo.status})`);

  return { datos: await archivo.arrayBuffer(), tipo };
}

// Una foto recibida no se puede reenviar con su mismo id: se descarga y se vuelve a subir.
async function reenviarImagen(telefono, mediaId, leyenda) {
  if (!whatsappDisponible()) {
    console.log(`[SIMULACIÓN] → ${telefono}: [imagen ${mediaId}] ${leyenda}`);
    return true;
  }
  const { datos, tipo } = await descargarMedia(mediaId);

  const formulario = new FormData();
  formulario.append('messaging_product', 'whatsapp');
  formulario.append('file', new Blob([datos], { type: tipo }), 'referencia');
  const subida = await fetch(urlGraph(`${config.whatsapp.phoneNumberId}/media`), {
    method: 'POST',
    headers: cabeceras(),
    body: formulario,
  });
  if (!subida.ok) throw new Error(`No se pudo subir la imagen (${subida.status}): ${await subida.text()}`);
  const { id } = await subida.json();

  return enviar(telefono, { type: 'image', image: { id, caption: leyenda } });
}

module.exports = { enviarTexto, enviarPlantilla, reenviarImagen, descargarMedia };
