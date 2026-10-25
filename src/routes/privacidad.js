const { Router } = require('express');
const negocio = require('../negocio/negocio');

// Política de privacidad pública: Meta pide su URL para publicar la app de WhatsApp.
const router = Router();

const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de privacidad — ${negocio.nombre}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 16px; line-height: 1.6; color: #222; background: #fff; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 1.8rem; }
  small { color: #666; }
</style>
</head>
<body>
<h1>Política de privacidad</h1>
<p><small>Última actualización: 25 de octubre de 2026</small></p>

<p><strong>${negocio.nombre}</strong> (${negocio.ubicacion}), que ofrece ${negocio.descripcion}, atiende a sus clientes por WhatsApp mediante un asistente automático.
Esta política explica qué datos recibimos por ese canal y cómo los usamos.</p>

<h2>1. Datos que recibimos</h2>
<ul>
  <li>Tu número de WhatsApp y el nombre de tu perfil.</li>
  <li>Los mensajes, notas de voz y fotos que nos envías.</li>
  <li>Los datos que nos das para un pedido o asesoría: ${negocio.privacidad.datosPedido}.</li>
</ul>

<h2>2. Para qué los usamos</h2>
<ul>
  <li>Responder tus consultas y recomendarte productos.</li>
  <li>Registrar tu pedido y que ${negocio.contacto} te contacte para completarlo.</li>
</ul>
<p>No vendemos tus datos ni los usamos para publicidad de terceros.</p>

<h2>3. Con quién los compartimos</h2>
<ul>
  <li><strong>${negocio.contacto[0].toUpperCase() + negocio.contacto.slice(1)}</strong>, que recibe el resumen de tu pedido o consulta para atenderte.</li>
  <li><strong>Proveedores tecnológicos</strong> que procesan los mensajes solo para darte el servicio:
    Meta (WhatsApp), Anthropic (inteligencia artificial que redacta las respuestas),
    Groq (transcripción de notas de voz) y Render (servidor donde funciona el asistente).</li>
</ul>

<h2>4. Cuánto tiempo los guardamos</h2>
<p>El asistente recuerda tu conversación solo mientras está activa (se borra tras 30 minutos sin mensajes).
Los registros técnicos del servidor se conservan por un tiempo limitado para resolver errores.
Los datos de tu pedido los conserva ${negocio.contacto} solo mientras sean necesarios para atenderte.</p>

<h2>5. Tus derechos y eliminación de datos</h2>
<p>Puedes pedirnos en cualquier momento acceder, corregir o eliminar tus datos, conforme a la
Ley N.° 29733 de Protección de Datos Personales del Perú. Escríbenos por el mismo WhatsApp
con el mensaje <strong>"eliminar mis datos"</strong> y ${negocio.contacto} lo atenderá.</p>

${negocio.privacidad.salud ? `<h2>6. Salud</h2>
<p>${negocio.privacidad.salud}</p>` : ""}

<h2>7. Cambios</h2>
<p>Si actualizamos esta política, publicaremos la nueva versión en esta misma página.</p>
</body>
</html>`;

router.get('/', (_req, res) => res.type('html').send(PAGINA));

module.exports = router;
