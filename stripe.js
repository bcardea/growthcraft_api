import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function createCheckoutSession(req, res) {
  try {
    const { priceId, userId, customerEmail } = req.body;

    // Create or retrieve Stripe customer
    let { data: user } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        metadata: {
          userId: userId
        }
      });
      customerId = customer.id;

      // Save Stripe customer ID
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.VITE_APP_URL}/company-setup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_APP_URL}/billing-setup`,
    });

    res.json({ url: session.url });
  } catch (error) {
    logger.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

export async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        // Get user by Stripe customer ID
        const { data: users, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId);

        if (userError || !users.length) {
          throw new Error('User not found');
        }

        const userId = users[0].id;
        
        // Update user's subscription status
        await supabase
          .from('users')
          .update({
            subscription_status: subscription.status,
            subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            subscription_id: subscription.id,
            subscription_plan: subscription.items.data[0].price.id
          })
          .eq('id', userId);
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        const deletedCustomerId = deletedSubscription.customer;

        // Get user by Stripe customer ID
        const { data: deletedUsers, error: deletedUserError } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', deletedCustomerId);

        if (deletedUserError || !deletedUsers.length) {
          throw new Error('User not found');
        }

        // Update user's subscription status
        await supabase
          .from('users')
          .update({
            subscription_status: 'inactive',
            subscription_period_end: null,
            subscription_id: null
          })
          .eq('id', deletedUsers[0].id);
        break;
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
