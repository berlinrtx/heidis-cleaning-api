const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { amount, email, name, phone, cleaningType, frequency } = req.body;

    if (!amount || !email || !name || !phone) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: 'usd',
      metadata: {
        email: email,
        name: name,
        phone: phone,
        cleaningType: cleaningType || 'regular',
        frequency: frequency || 'weekly'
      },
      receipt_email: email,
      description: `Cleaning Service - ${cleaningType || 'regular'} (${frequency || 'weekly'})`
    });

    res.status(200).json({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(400).json({ 
      error: error.message || 'Error al procesar el pago'
    });
  }
}
