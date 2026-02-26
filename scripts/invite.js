#!/usr/bin/env node

/**
 * Invite a colleague to RasenBürosport.
 * Usage: node scripts/invite.js anna@redbulls.com
 *
 * Only @redbulls.com emails are allowed.
 * Sends a Supabase invite email with a magic link.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_DOMAIN = "redbulls.com";
const REDIRECT_TO = process.env.CORS_ORIGIN
	? `${process.env.CORS_ORIGIN}/auth/callback`
	: "http://localhost:5173/auth/callback";

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const email = process.argv[2];

if (!email) {
	console.error("Usage: node scripts/invite.js <email@redbulls.com>");
	process.exit(1);
}

const domain = email.split("@")[1]?.toLowerCase();
if (domain !== ALLOWED_DOMAIN) {
	console.error(`❌ Nur @${ALLOWED_DOMAIN} E-Mail-Adressen sind erlaubt.`);
	console.error(`   Eingabe: ${email}`);
	process.exit(1);
}

console.log(`📧 Lade ${email} ein...`);
console.log(`   Redirect: ${REDIRECT_TO}\n`);

const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
	redirectTo: REDIRECT_TO,
});

if (error) {
	console.error(`❌ Einladung fehlgeschlagen: ${error.message}`);
	process.exit(1);
}

console.log(`✅ Einladung gesendet an ${email}`);
console.log(`   User ID: ${data.user.id}`);
console.log(`\n   Der Kollege bekommt eine E-Mail mit einem Einladungslink.`);
