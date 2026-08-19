import { redirect, type RequestHandler } from '@sveltejs/kit';

/** Solo POST: un logout via GET è invocabile da un `<img>` altrui. */
export const POST: RequestHandler = async ({ locals }) => {
	await locals.supabase.auth.signOut();
	redirect(303, '/login');
};
