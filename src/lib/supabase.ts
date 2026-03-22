import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ifvpisvnvxppfiotzjmf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_e92tZuP_SRgCavVnKlsQlw_E625MTcw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
