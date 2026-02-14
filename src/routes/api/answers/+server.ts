import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	answers,
	candidateFiles,
	ephemeralStreamUrls,
	SELECTED_OPTIONS,
	TRANSITION_MODES
} from '$lib/server/db/schema';
import { DEFAULT_SEGMENT_DURATION_MS } from '$lib/server/survey-config';
import type { RequestHandler } from './$types';

const LOG = '[game:answers]';
/** Short expiry for "you were listening to" playback token */
const PLAYBACK_TOKEN_EXPIRY_MIN = 2;

export const POST: RequestHandler = async ({ request, platform }) => {
	console.log(`${LOG} POST /api/answers`);

	if (!platform) {
		console.error(`${LOG} Platform not available`);
		return error(500, 'Platform not available');
	}

	const body = await request.json();
	const {
		tokenA,
		tokenB,
		tokenYwltA,
		tokenYwltB,
		selected,
		transitionMode,
		startTime,
		segmentDuration,
		responseTime,
		deviceId,
		playbackPositionMs
	} = body;

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

	console.log(`${LOG} Resolving tokens`, {
		tokenA: body.tokenA?.slice(0, 8) + '...',
		tokenB: body.tokenB?.slice(0, 8) + '...',
		selected: body.selected,
		deviceId: body.deviceId?.slice(0, 8) + '...'
	});

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
		console.warn(`${LOG} Tokens expired or invalid`, {
			tokenAFound: !!streamA,
			tokenBFound: !!streamB
		});
		return error(410, 'Stream tokens expired or invalid');
	}

	console.log(`${LOG} Resolved → candidates`, {
		candidateAId: streamA.candidateFileId,
		candidateBId: streamB.candidateFileId,
		pairingType: streamA.candidateFileId === streamB.candidateFileId ? 'placebo' : 'same/different'
	});

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
			segmentDuration: segmentDuration ?? DEFAULT_SEGMENT_DURATION_MS,
			responseTime: responseTime ?? null
		})
		.returning();

	// Clean up used tokens (comparison + YWLT opus_256)
	await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, tokenA));
	await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, tokenB));
	if (tokenYwltA) {
		await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, tokenYwltA));
	}
	if (tokenYwltB) {
		await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, tokenYwltB));
	}

	// Create playback token for opus_256 of selected source (for "you were listening to")
	let playbackToken: string | null = null;
	const positionMs =
		typeof playbackPositionMs === 'number' && playbackPositionMs >= 0 ? playbackPositionMs : null;

	const selectedCandidateId = selected === 'a' ? candidateAId : candidateBId;
	const selectedCandidate = await db
		.select({ sourceFileId: candidateFiles.sourceFileId })
		.from(candidateFiles)
		.where(eq(candidateFiles.id, selectedCandidateId))
		.get();

	if (selectedCandidate) {
		const opus256 = await db
			.select({ id: candidateFiles.id })
			.from(candidateFiles)
			.where(
				and(
					eq(candidateFiles.sourceFileId, selectedCandidate.sourceFileId),
					eq(candidateFiles.codec, 'opus'),
					eq(candidateFiles.bitrate, 256)
				)
			)
			.get();

		if (opus256) {
			const expiresAt = new Date(Date.now() + PLAYBACK_TOKEN_EXPIRY_MIN * 60 * 1000);
			const [row] = await db
				.insert(ephemeralStreamUrls)
				.values({ candidateFileId: opus256.id, expiresAt })
				.returning();
			playbackToken = row?.token ?? null;
		}
	}

	console.log(`${LOG} Answer saved, tokens deleted`, {
		answerId: answer?.id,
		playbackToken: playbackToken ? 'created' : 'none'
	});

	return json({
		id: answer?.id,
		success: true,
		playbackToken,
		playbackPositionMs: positionMs ?? 0
	});
};
