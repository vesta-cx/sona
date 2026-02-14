import { desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { resultSnapshots } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform) {
		return { snapshot: null };
	}

	try {
		const db = getDb(platform);

		const snapshot = await db
			.select()
			.from(resultSnapshots)
			.orderBy(desc(resultSnapshots.createdAt))
			.limit(1)
			.get();

		return {
			snapshot: snapshot
				? {
						createdAt: snapshot.createdAt?.toISOString() ?? null,
						totalResponses: snapshot.totalResponses,
						insights: snapshot.insights as Record<string, unknown> | null
					}
				: null
		};
	} catch {
		// Table may not exist yet (no migrations applied), or DB is empty
		return { snapshot: null };
	}
};
