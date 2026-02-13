// Use ESM import to ensure the library is loaded and scoped properly within the module
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://vrlggkcrbedppeziwlcc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZybGdna2NyYmVkcHBleml3bGNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3ODc1MDEsImV4cCI6MjA4NTM2MzUwMX0.ups2Hbus9sIYJBSFrZe1khrkmXEnZC8bODQ6f5esS68';

// Initialize the connection with explicit session persistence
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
