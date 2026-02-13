import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { listeningDevices } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform) return { devices: [] };

	const db = getDb(platform);
	const devices = await db.select().from(listeningDevices).all();

	return { devices };
};

export const actions = {
	approve: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing device ID' });

		const db = getDb(platform);
		await db
			.update(listeningDevices)
			.set({ approvedAt: new Date(), approvedBy: 'admin' })
			.where(eq(listeningDevices.id, id));

		return { success: true };
	},
	reject: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing device ID' });

		const db = getDb(platform);
		await db
			.update(listeningDevices)
			.set({ approvedAt: null, approvedBy: null })
			.where(eq(listeningDevices.id, id));

		return { success: true };
	}
} satisfies Actions;
