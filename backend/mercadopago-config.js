// backend/mercadopago-config.js
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// Configurar el cliente de Mercado Pago
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

// Crear instancias
const preference = new Preference(client);
const payment = new Payment(client);

module.exports = { client, preference, payment };