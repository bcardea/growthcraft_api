import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

async function testRPC() {
  try {
    logger.info('Testing RPC call...');
    
    // Create a fresh Supabase client
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    logger.info('Supabase config:', { 
      url: process.env.VITE_SUPABASE_URL,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY
    });

    const { data, error } = await supabase.rpc('public.get_user_details', {
      user_id: '29762657-13ef-40cc-8915-60a7d72c71f2'
    });

    if (error) {
      logger.error('RPC Error:', error);
      return;
    }

    logger.info('RPC Result:', data);
  } catch (err) {
    logger.error('Test Error:', err);
  }
}

testRPC();
