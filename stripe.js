import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function createCheckoutSession(req, res) {
  try {
    const { priceId, userId, returnUrl } = req.body;
    
    if (!priceId || !userId) {
      logger.error('Missing required fields:', { priceId, userId });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    logger.info('Creating checkout session for user:', { userId, priceId });
    logger.info('Supabase config:', { 
      url: process.env.VITE_SUPABASE_URL,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY
    });

    // Get user details using raw SQL
    logger.info('Fetching user details for:', userId);
    const { data: users, error: userError } = await supabase
      .rpc('get_user_details', { user_id: userId });

    if (userError) {
      logger.error('Error fetching user:', userError);
      return res.status(400).json({ error: 'Error fetching user: ' + userError.message });
    }

    if (!users) {
      logger.error('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users;
    logger.info('User details retrieved:', { 
      hasEmail: !!user.email,
      hasStripeId: !!user.stripe_customer_id,
      subscriptionStatus: user.subscription_status
    });

    let customerId = user.stripe_customer_id;

    if (!customerId) {
      logger.info('Creating new Stripe customer for user:', userId);
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: userId
        }
      });
      customerId = customer.id;
      logger.info('Created Stripe customer:', customerId);

      // Update user with Stripe customer ID using raw SQL
      logger.info('Updating user with Stripe customer ID');
      const { error: updateError } = await supabase
        .rpc('update_user_stripe_customer', {
          user_id: userId,
          customer_id: customerId
        });

      if (updateError) {
        logger.error('Error updating user with Stripe customer ID:', updateError);
        return res.status(500).json({ error: 'Error updating user' });
      }
      logger.info('Successfully updated user with Stripe customer ID');
    }

    // Create checkout session
    logger.info('Creating Stripe checkout session');
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
      success_url: returnUrl || `${process.env.VITE_APP_URL}/company-setup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_APP_URL}/billing-setup`,
    });

    logger.info('Checkout session created:', session.id);
    return res.json({ url: session.url });
  } catch (error) {
    logger.error('Error in createCheckoutSession:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
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
    logger.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        // Get user ID from customer metadata
        const customer = await stripe.customers.retrieve(customerId);
        const userId = customer.metadata.userId;

        if (!userId) {
          logger.error('No userId found in customer metadata:', customerId);
          return res.status(400).json({ error: 'No userId found' });
        }

        // Update subscription status using raw SQL
        const { error: updateError } = await supabase
          .rpc('update_user_subscription', {
            user_id: userId,
            subscription_id: subscription.id,
            status: subscription.status,
            period_end: new Date(subscription.current_period_end * 1000).toISOString()
          });

        if (updateError) {
          logger.error('Error updating subscription status:', updateError);
          return res.status(500).json({ error: 'Error updating subscription status' });
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        const deletedCustomerId = deletedSubscription.customer;
        
        // Get user ID from customer metadata
        const deletedCustomer = await stripe.customers.retrieve(deletedCustomerId);
        const deletedUserId = deletedCustomer.metadata.userId;

        if (!deletedUserId) {
          logger.error('No userId found in customer metadata:', deletedCustomerId);
          return res.status(400).json({ error: 'No userId found' });
        }

        // Update subscription status to inactive using raw SQL
        const { error: deleteError } = await supabase
          .rpc('update_user_subscription', {
            user_id: deletedUserId,
            subscription_id: null,
            status: 'inactive',
            period_end: null
          });

        if (deleteError) {
          logger.error('Error updating subscription status:', deleteError);
          return res.status(500).json({ error: 'Error updating subscription status' });
        }
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
