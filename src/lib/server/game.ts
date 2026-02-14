import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from './db';
import {
	sourceFiles,
	candidateFiles,
	ephemeralStreamUrls,
	qualityOptions,
	type PairingType,
	type TransitionMode,
	PAIRING_TYPES,
	TRANSITION_MODES
} from './db/schema';
import {
	getPairingWeights,
	getSegmentDuration,
	DEFAULT_SEGMENT_DURATION_MS
} from './survey-config';

/** Default segment duration in ms; used when config is unavailable (e.g. tests) */
export const SEGMENT_DURATION_MS = DEFAULT_SEGMENT_DURATION_MS;

const weightedRandom = <T extends string>(weights: Record<T, number>): T => {
	const rand = Math.random();
	let cumulative = 0;
	for (const [key, weight] of Object.entries(weights) as [T, number][]) {
		cumulative += weight;
		if (rand <= cumulative) return key;
	}
	// Fallback
	return Object.keys(weights)[0] as T;
};

const randomElement = <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];

const LOG = '[game]';

export interface ComparisonRound {
	tokenA: string;
	tokenB: string;
	/** Ephemeral tokens for opus_256 of each source (YWLT preload). Null if opus_256 not available. */
	tokenYwltA: string | null;
	tokenYwltB: string | null;
	transitionMode: TransitionMode;
	startTime: number;
	duration: number;
	/** Song metadata for "you were listening to" display. Same for same_song/placebo. */
	labelA: { title: string; artist: string | null; streamUrl: string | null };
	labelB: { title: string; artist: string | null; streamUrl: string | null };
}

export type EnabledTransitionModes = TransitionMode[] | null;
export type EnabledPairingTypes = PairingType[] | null;

export const generateRound = async (
	db: Database,
	enabledModes: EnabledTransitionModes = null,
	enabledPairing: EnabledPairingTypes = null
): Promise<ComparisonRound | null> => {
	console.log(`${LOG} generateRound() called`);

	// Get all approved source files
	const approvedSources = await db
		.select()
		.from(sourceFiles)
		.where(isNotNull(sourceFiles.approvedAt))
		.all();

	if (approvedSources.length === 0) {
		console.log(`${LOG} No approved sources`);
		return null;
	}

	// Get enabled quality options (used to filter candidates)
	const enabledOptions = await db
		.select()
		.from(qualityOptions)
		.where(eq(qualityOptions.enabled, true))
		.all();

	if (enabledOptions.length === 0) {
		console.log(`${LOG} No enabled quality options`);
		return null;
	}

	const enabledKeys = new Set(enabledOptions.map((o) => `${o.codec}_${o.bitrate}`));

	const filterByEnabled = <T extends { codec: string; bitrate: number }>(arr: T[]): T[] =>
		arr.filter((c) => enabledKeys.has(`${c.codec}_${c.bitrate}`));

	// Filter pairing types by user preference; fallback to all if none enabled
	let pairingPool = [...PAIRING_TYPES];
	if (enabledPairing && enabledPairing.length > 0) {
		pairingPool = PAIRING_TYPES.filter((p) => enabledPairing.includes(p));
	}
	if (pairingPool.length === 0) {
		pairingPool = [...PAIRING_TYPES];
	}
	const dbWeights = await getPairingWeights(db);
	const totalWeight = pairingPool.reduce((sum, p) => sum + (dbWeights[p] ?? 1), 0);
	const pairingWeights = Object.fromEntries(
		pairingPool.map((p) => [p, (dbWeights[p] ?? 1) / totalWeight])
	) as Record<PairingType, number>;
	const pairingType = weightedRandom(pairingWeights);
	console.log(`${LOG} Pairing type: ${pairingType}`);

	const segmentDurationMs = await getSegmentDuration(db);

	// different_song: use gap_pause_resume (pause when switching; each track resumes where left off)
	let transitionPool: readonly TransitionMode[] =
		pairingType === 'different_song' ? (['gap_pause_resume'] as const) : [...TRANSITION_MODES];
	if (enabledModes && enabledModes.length > 0) {
		transitionPool = transitionPool.filter((m) => enabledModes.includes(m));
	}
	if (transitionPool.length === 0) {
		transitionPool = pairingType === 'different_song' ? ['gap_pause_resume'] : [...TRANSITION_MODES];
	}
	const transitionMode = randomElement([...transitionPool]) ?? 'gapless';

	let candidateA: { id: string; sourceFileId: string } | undefined;
	let candidateB: { id: string; sourceFileId: string } | undefined;
	let sourceDuration: number;

	if (pairingType === 'same_song') {
		const source = randomElement(approvedSources);
		if (!source) return null;
		sourceDuration = source.duration;

		const rawCandidates = await db
			.select({
				id: candidateFiles.id,
				sourceFileId: candidateFiles.sourceFileId,
				codec: candidateFiles.codec,
				bitrate: candidateFiles.bitrate
			})
			.from(candidateFiles)
			.where(eq(candidateFiles.sourceFileId, source.id))
			.all();

		const candidates = filterByEnabled(rawCandidates);
		if (candidates.length < 2) return null;

		// Pick two different candidates
		candidateA = randomElement(candidates);
		candidateB = randomElement(candidates.filter((c) => c.id !== candidateA?.id));
	} else if (pairingType === 'different_song') {
		if (approvedSources.length < 2) return null;

		const sourceA = randomElement(approvedSources);
		const sourceB = randomElement(approvedSources.filter((s) => s.id !== sourceA?.id));
		if (!sourceA || !sourceB) return null;

		sourceDuration = Math.min(sourceA.duration, sourceB.duration);

		const [rawA, rawB] = await Promise.all([
			db
				.select({
					id: candidateFiles.id,
					sourceFileId: candidateFiles.sourceFileId,
					codec: candidateFiles.codec,
					bitrate: candidateFiles.bitrate
				})
				.from(candidateFiles)
				.where(eq(candidateFiles.sourceFileId, sourceA.id))
				.all(),
			db
				.select({
					id: candidateFiles.id,
					sourceFileId: candidateFiles.sourceFileId,
					codec: candidateFiles.codec,
					bitrate: candidateFiles.bitrate
				})
				.from(candidateFiles)
				.where(eq(candidateFiles.sourceFileId, sourceB.id))
				.all()
		]);

		const candidatesA = filterByEnabled(rawA);
		const candidatesB = filterByEnabled(rawB);
		if (candidatesA.length === 0 || candidatesB.length === 0) return null;

		candidateA = randomElement(candidatesA);
		candidateB = randomElement(candidatesB);
	} else {
		// placebo
		const source = randomElement(approvedSources);
		if (!source) return null;
		sourceDuration = source.duration;

		const rawCandidates = await db
			.select({
				id: candidateFiles.id,
				sourceFileId: candidateFiles.sourceFileId,
				codec: candidateFiles.codec,
				bitrate: candidateFiles.bitrate
			})
			.from(candidateFiles)
			.where(eq(candidateFiles.sourceFileId, source.id))
			.all();

		const candidates = filterByEnabled(rawCandidates);
		if (candidates.length === 0) return null;

		const picked = randomElement(candidates);
		candidateA = picked;
		candidateB = picked; // Same candidate for placebo
	}

	if (!candidateA || !candidateB) return null;

	// Randomize which candidate is A vs B to avoid position bias
	if (candidateA.id !== candidateB.id && Math.random() < 0.5) {
		[candidateA, candidateB] = [candidateB, candidateA];
	}

	// Generate start time clamped to valid range
	const maxStart = Math.max(0, sourceDuration - segmentDurationMs);
	const startTime = Math.floor(Math.random() * maxStart);

	// Create ephemeral stream URLs (10-min expiry)
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

	console.log(`${LOG} Creating 2 ephemeral stream URLs`, {
		candidateAId: candidateA.id,
		candidateBId: candidateB.id,
		startTime,
		duration: segmentDurationMs,
		transitionMode,
		expiresAt: expiresAt.toISOString()
	});

	const [tokenARow] = await db
		.insert(ephemeralStreamUrls)
		.values({ candidateFileId: candidateA.id, expiresAt })
		.returning();

	const [tokenBRow] = await db
		.insert(ephemeralStreamUrls)
		.values({ candidateFileId: candidateB.id, expiresAt })
		.returning();

	if (!tokenARow || !tokenBRow) {
		console.error(`${LOG} Failed to create ephemeral stream URLs`);
		return null;
	}

	// Create opus_256 tokens for YWLT preload (2-min expiry, same as answers API)
	const ywltExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
	const [opus256A, opus256B] = await Promise.all([
		db
			.select({ id: candidateFiles.id })
			.from(candidateFiles)
			.where(
				and(
					eq(candidateFiles.sourceFileId, candidateA.sourceFileId),
					eq(candidateFiles.codec, 'opus'),
					eq(candidateFiles.bitrate, 256)
				)
			)
			.get(),
		db
			.select({ id: candidateFiles.id })
			.from(candidateFiles)
			.where(
				and(
					eq(candidateFiles.sourceFileId, candidateB.sourceFileId),
					eq(candidateFiles.codec, 'opus'),
					eq(candidateFiles.bitrate, 256)
				)
			)
			.get()
	]);

	let tokenYwltA: string | null = null;
	let tokenYwltB: string | null = null;
	if (opus256A) {
		const [row] = await db
			.insert(ephemeralStreamUrls)
			.values({ candidateFileId: opus256A.id, expiresAt: ywltExpiresAt })
			.returning();
		tokenYwltA = row?.token ?? null;
	}
	if (opus256B) {
		const [row] = await db
			.insert(ephemeralStreamUrls)
			.values({ candidateFileId: opus256B.id, expiresAt: ywltExpiresAt })
			.returning();
		tokenYwltB = row?.token ?? null;
	}

	// Fetch source metadata for "you were listening to" display
	const [sourceA, sourceB] = await Promise.all([
		db
			.select({ title: sourceFiles.title, artist: sourceFiles.artist, streamUrl: sourceFiles.streamUrl })
			.from(sourceFiles)
			.innerJoin(candidateFiles, eq(candidateFiles.sourceFileId, sourceFiles.id))
			.where(eq(candidateFiles.id, candidateA.id))
			.get(),
		db
			.select({ title: sourceFiles.title, artist: sourceFiles.artist, streamUrl: sourceFiles.streamUrl })
			.from(sourceFiles)
			.innerJoin(candidateFiles, eq(candidateFiles.sourceFileId, sourceFiles.id))
			.where(eq(candidateFiles.id, candidateB.id))
			.get()
	]);

	console.log(`${LOG} Round created`, {
		tokenA: tokenARow.token.slice(0, 8) + '...',
		tokenB: tokenBRow.token.slice(0, 8) + '...'
	});

	return {
		tokenA: tokenARow.token,
		tokenB: tokenBRow.token,
		tokenYwltA,
		tokenYwltB,
		transitionMode,
		startTime,
		duration: segmentDurationMs,
		labelA: {
			title: sourceA?.title ?? 'Unknown',
			artist: sourceA?.artist ?? null,
			streamUrl: sourceA?.streamUrl ?? null
		},
		labelB: {
			title: sourceB?.title ?? 'Unknown',
			artist: sourceB?.artist ?? null,
			streamUrl: sourceB?.streamUrl ?? null
		}
	};
};
