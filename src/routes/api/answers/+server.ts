import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	answers,
	ephemeralStreamUrls,
	SELECTED_OPTIONS,
	TRANSITION_MODES
} from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) return error(500, 'Platform not available');

	const body = await request.json();
	const { tokenA, tokenB, selected, transitionMode, startTime, segmentDuration, responseTime, deviceId } = body;

	// Validate required fields
	if (!tokenA || !tokenB || !selected || !transitionMode || !deviceId) {
		return error(400, 'Missing required fields');
	}

	if (!SELECTED_OPTIONS.includes(selected)) {
		return error(400, 'Invalid selection');
	}

	if (!TRANSITION_MODES.includes(transitionMode)) {
		return error(400, 'Invalid transition mode');
	}

	const db = getDb(platform);

	// Resolve tokens to candidate IDs
	const streamA = await db
		.select()
		.from(ephemeralStreamUrls)
		.where(eq(ephemeralStreamUrls.token, tokenA))
		.get();

	const streamB = await db
		.select()
		.from(ephemeralStreamUrls)
		.where(eq(ephemeralStreamUrls.token, tokenB))
		.get();

	if (!streamA || !streamB) {
		return error(410, 'Stream tokens expired or invalid');
	}

	// Determine pairing type from candidate IDs
	const candidateAId = streamA.candidateFileId;
	const candidateBId = streamB.candidateFileId;

	// We determine pairing type server-side based on the candidates
	// For now, infer from whether they're the same candidate
	let pairingType: 'same_song' | 'different_song' | 'placebo' = 'same_song';
	if (candidateAId === candidateBId) {
		pairingType = 'placebo';
	}
	// Note: full pairing type detection (same_song vs different_song) would
	// require joining to candidate_files.source_file_id -- kept simple for now

	const [answer] = await db
		.insert(answers)
		.values({
			deviceId,
			candidateAId,
			candidateBId,
			selected,
			pairingType,
			transitionMode,
			startTime: startTime ?? 0,
			segmentDuration: segmentDuration ?? 12000,
			responseTime: responseTime ?? null
		})
		.returning();

	// Clean up used tokens
	await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, tokenA));
	await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, tokenB));

	return json({ id: answer?.id, success: true });
};
