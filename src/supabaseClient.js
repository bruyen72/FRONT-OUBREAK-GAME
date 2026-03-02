import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qswdglejrxoagzrytewo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd2RnbGVqcnhvYWd6cnl0ZXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0Mjg3NTUsImV4cCI6MjA4ODAwNDc1NX0.DO_5UDUoQmip8jk-ykwmOsasBhaP7TP5o6Fy3Vetm1o';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
