import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Require Supabase credentials from environment
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
    throw new Error('Supabase configuration is required');
}

console.log('✅ Supabase configuration loaded from environment');

// Use service role key for server-side operations
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Verify JWT token from request
export async function verifyAuthToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return null;
        }

        return user;
    } catch (error) {
        console.error('Error verifying auth token:', error);
        return null;
    }
}
