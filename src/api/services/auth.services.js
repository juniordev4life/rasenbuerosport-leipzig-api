import { getSupabase, getSupabaseAdmin } from "../../config/supabase.config.js";

/**
 * Registers a new user via Supabase Auth and creates a profile
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} params.username
 * @returns {Promise<{user: object, session: object}>}
 */
export async function registerUser({ email, password, username }) {
	const supabaseAdmin = getSupabaseAdmin();

	const { data: existingProfile } = await supabaseAdmin
		.from("profiles")
		.select("id")
		.eq("username", username)
		.single();

	if (existingProfile) {
		const error = new Error("Username already taken");
		error.statusCode = 409;
		throw error;
	}

	const supabase = getSupabase();
	const { data, error } = await supabase.auth.signUp({
		email,
		password,
		options: {
			data: { username },
		},
	});

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 400;
		throw err;
	}

	return { user: data.user, session: data.session };
}

/**
 * Logs in a user via Supabase Auth
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<{user: object, session: object}>}
 */
export async function loginUser({ email, password }) {
	const supabase = getSupabase();
	const { data, error } = await supabase.auth.signInWithPassword({
		email,
		password,
	});

	if (error) {
		const err = new Error(error.message);
		err.statusCode = 401;
		throw err;
	}

	return { user: data.user, session: data.session };
}

/**
 * Gets the current user's profile
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getUserProfile(userId) {
	const supabaseAdmin = getSupabaseAdmin();
	const { data, error } = await supabaseAdmin
		.from("profiles")
		.select("*")
		.eq("id", userId)
		.single();

	if (error) {
		const err = new Error("Profile not found");
		err.statusCode = 404;
		throw err;
	}

	return data;
}
