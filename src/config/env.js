require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
  },
  // WhatsApp de la asesora, con código de país y sin "+" (ej. 51987654321).
  // Recibe un aviso por cada pedido o cliente interesado.
  asesora: {
    telefono: (process.env.ASESORA_TELEFONO || '').replace(/\D/g, ''),
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
  },
};
