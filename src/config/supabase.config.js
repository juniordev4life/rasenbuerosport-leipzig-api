import { createClient } from "@supabase/supabase-js";

let supabase = null;
let supabaseAdmin = null;

/**
 * Returns the Supabase client (anon key) singleton
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getSupabase() {
	if (!supabase) {
		supabase = createClient(
			process.env.SUPABASE_URL,
			process.env.SUPABASE_ANON_KEY,
		);
	}
	return supabase;
}

/**
 * Returns the Supabase admin client (service role key) singleton
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getSupabaseAdmin() {
	if (!supabaseAdmin) {
		supabaseAdmin = createClient(
			process.env.SUPABASE_URL,
			process.env.SUPABASE_SERVICE_ROLE_KEY,
		);
	}
	return supabaseAdmin;
}
