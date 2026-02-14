import { sql, eq, lt, count } from 'drizzle-orm';
import type { Database } from './db';
import { answers, candidateFiles, resultSnapshots, listeningDevices } from './db/schema';

/**
 * Bradley-Terry model: iterative MLE to compute strength parameters
 * from pairwise comparison data.
 *
 * Given pairs (i wins over j), estimate strength[i] for each item.
 * Higher strength = more preferred.
 */
const computeBradleyTerry = (
	comparisons: Array<{ winner: string; loser: string }>,
	items: string[],
	iterations = 50
): Record<string, number> => {
	// Initialize all strengths to 1
	const strength: Record<string, number> = {};
	for (const item of items) {
		strength[item] = 1.0;
	}

	if (comparisons.length === 0) return strength;

	// Count wins and appearances
	const wins: Record<string, number> = {};
	const pairCounts: Record<string, Record<string, number>> = {};

	for (const item of items) {
		wins[item] = 0;
		pairCounts[item] = {};
	}

	for (const { winner, loser } of comparisons) {
		wins[winner] = (wins[winner] ?? 0) + 1;
		pairCounts[winner] = pairCounts[winner] ?? {};
		pairCounts[winner][loser] = (pairCounts[winner][loser] ?? 0) + 1;
		pairCounts[loser] = pairCounts[loser] ?? {};
		pairCounts[loser][winner] = (pairCounts[loser][winner] ?? 0) + 1;
	}

	// Iterative update
	for (let iter = 0; iter < iterations; iter++) {
		const newStrength: Record<string, number> = {};

		for (const item of items) {
			const w = wins[item] ?? 0;
			if (w === 0) {
				newStrength[item] = 0.001; // Avoid zero
				continue;
			}

			let denominator = 0;
			const pairs = pairCounts[item] ?? {};
			for (const [opponent, pairCount] of Object.entries(pairs)) {
				const si = strength[item] ?? 1;
				const sj = strength[opponent] ?? 1;
				denominator += pairCount / (si + sj);
			}

			newStrength[item] = denominator > 0 ? w / denominator : 0.001;
		}

		// Normalize so strengths sum to items.length
		const total = Object.values(newStrength).reduce((a, b) => a + b, 0);
		const scale = items.length / total;
		for (const item of items) {
			strength[item] = (newStrength[item] ?? 0) * scale;
		}
	}

	return strength;
};

export const generateSnapshot = async (db: Database): Promise<void> => {
	// Get all answers
	const allAnswers = await db.select().from(answers).all();

	if (allAnswers.length === 0) {
		await db.insert(resultSnapshots).values({
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			totalResponses: 0,
			insights: {}
		});
		return;
	}

	// Build comparisons for Bradley-Terry
	const comparisons: Array<{ winner: string; loser: string }> = [];
	const codecWins: Record<string, number> = {};
	const codecTotal: Record<string, number> = {};

	// We need candidate details to know codec+bitrate
	const candidateCache = new Map<string, { codec: string; bitrate: number; sourceFileId: string }>();

	const loadCandidate = async (id: string) => {
		if (candidateCache.has(id)) return candidateCache.get(id)!;
		const c = await db
			.select({
				codec: candidateFiles.codec,
				bitrate: candidateFiles.bitrate,
				sourceFileId: candidateFiles.sourceFileId
			})
			.from(candidateFiles)
			.where(eq(candidateFiles.id, id))
			.get();
		if (c) candidateCache.set(id, c);
		return c;
	};

	let neitherCount = 0;

	for (const answer of allAnswers) {
		const candA = await loadCandidate(answer.candidateAId);
		const candB = await loadCandidate(answer.candidateBId);
		if (!candA || !candB) continue;

		const keyA = `${candA.codec}_${candA.bitrate}`;
		const keyB = `${candB.codec}_${candB.bitrate}`;

		if (answer.selected === 'a') {
			comparisons.push({ winner: keyA, loser: keyB });
			codecWins[candA.codec] = (codecWins[candA.codec] ?? 0) + 1;
		} else if (answer.selected === 'b') {
			comparisons.push({ winner: keyB, loser: keyA });
			codecWins[candB.codec] = (codecWins[candB.codec] ?? 0) + 1;
		} else {
			neitherCount += 1;
		}

		codecTotal[candA.codec] = (codecTotal[candA.codec] ?? 0) + 1;
		codecTotal[candB.codec] = (codecTotal[candB.codec] ?? 0) + 1;
	}

	const neitherRate = allAnswers.length > 0 ? neitherCount / allAnswers.length : 0;

	// Codec win rates
	const codecWinRates: Record<string, number> = {};
	for (const [codec, total] of Object.entries(codecTotal)) {
		codecWinRates[codec] = total > 0 ? (codecWins[codec] ?? 0) / total : 0;
	}

	// Bradley-Terry scores
	const allItems = [...new Set(comparisons.flatMap((c) => [c.winner, c.loser]))];
	const bradleyTerryScores = computeBradleyTerry(comparisons, allItems);

	// Device breakdown
	const deviceBreakdown: Record<string, number> = {};
	for (const answer of allAnswers) {
		const device = await db
			.select({ deviceType: listeningDevices.deviceType })
			.from(listeningDevices)
			.where(eq(listeningDevices.id, answer.deviceId))
			.get();
		if (device) {
			deviceBreakdown[device.deviceType] = (deviceBreakdown[device.deviceType] ?? 0) + 1;
		}
	}

	// Heatmap data: codec x bitrate win rates
	const heatmapWins: Record<string, Record<string, number>> = {};
	const heatmapTotal: Record<string, Record<string, number>> = {};

	for (const answer of allAnswers) {
		const candA = await loadCandidate(answer.candidateAId);
		const candB = await loadCandidate(answer.candidateBId);
		if (!candA || !candB) continue;

		for (const cand of [candA, candB]) {
			heatmapTotal[cand.codec] = heatmapTotal[cand.codec] ?? {};
			heatmapTotal[cand.codec][String(cand.bitrate)] =
				(heatmapTotal[cand.codec][String(cand.bitrate)] ?? 0) + 1;
		}

		if (answer.selected === 'a') {
			heatmapWins[candA.codec] = heatmapWins[candA.codec] ?? {};
			heatmapWins[candA.codec][String(candA.bitrate)] =
				(heatmapWins[candA.codec][String(candA.bitrate)] ?? 0) + 1;
		} else if (answer.selected === 'b') {
			heatmapWins[candB.codec] = heatmapWins[candB.codec] ?? {};
			heatmapWins[candB.codec][String(candB.bitrate)] =
				(heatmapWins[candB.codec][String(candB.bitrate)] ?? 0) + 1;
		}
	}

	const heatmap: Array<{ row: string; col: string; value: number }> = [];
	for (const [codec, bitrateMap] of Object.entries(heatmapTotal)) {
		for (const [bitrate, total] of Object.entries(bitrateMap)) {
			const wins = heatmapWins[codec]?.[bitrate] ?? 0;
			heatmap.push({
				row: codec,
				col: bitrate === '0' ? 'lossless' : `${bitrate}`,
				value: total > 0 ? wins / total : 0
			});
		}
	}

	// FLAC vs lossy: for each lossy (codec, bitrate), win rate of FLAC when compared
	const flacVsLossyWins: Record<string, Record<string, number>> = {};
	const flacVsLossyTotal: Record<string, Record<string, number>> = {};

	for (const answer of allAnswers) {
		const candA = await loadCandidate(answer.candidateAId);
		const candB = await loadCandidate(answer.candidateBId);
		if (!candA || !candB) continue;

		const isAFlac = candA.codec === 'flac';
		const isBFlac = candB.codec === 'flac';
		if (!isAFlac && !isBFlac) continue; // both lossy
		if (isAFlac && isBFlac) continue; // both flac

		const lossy = isAFlac ? candB : candA;
		if (lossy.codec === 'flac') continue;

		const brKey = String(lossy.bitrate);
		flacVsLossyTotal[lossy.codec] = flacVsLossyTotal[lossy.codec] ?? {};
		flacVsLossyTotal[lossy.codec][brKey] =
			(flacVsLossyTotal[lossy.codec][brKey] ?? 0) + 1;

		if (answer.selected === 'a' && isAFlac) {
			flacVsLossyWins[lossy.codec] = flacVsLossyWins[lossy.codec] ?? {};
			flacVsLossyWins[lossy.codec][brKey] =
				(flacVsLossyWins[lossy.codec][brKey] ?? 0) + 1;
		} else if (answer.selected === 'b' && isBFlac) {
			flacVsLossyWins[lossy.codec] = flacVsLossyWins[lossy.codec] ?? {};
			flacVsLossyWins[lossy.codec][brKey] =
				(flacVsLossyWins[lossy.codec][brKey] ?? 0) + 1;
		}
	}

	const flacVsLossy: Record<string, Record<string, number>> = {};
	for (const [codec, bitrateMap] of Object.entries(flacVsLossyTotal)) {
		flacVsLossy[codec] = {};
		for (const [br, total] of Object.entries(bitrateMap)) {
			const wins = flacVsLossyWins[codec]?.[br] ?? 0;
			flacVsLossy[codec][br] = total > 0 ? wins / total : 0;
		}
	}

	// Neither rate by bitrate difference
	const neitherByDiff: Record<string, { neither: number; total: number }> = {};
	const getDiffBucket = (diff: number): string => {
		if (diff <= 32) return '0-32';
		if (diff <= 64) return '32-64';
		if (diff <= 128) return '64-128';
		return '128+';
	};

	for (const answer of allAnswers) {
		const candA = await loadCandidate(answer.candidateAId);
		const candB = await loadCandidate(answer.candidateBId);
		if (!candA || !candB) continue;

		const diff = Math.abs(candA.bitrate - candB.bitrate);
		const bucket = getDiffBucket(diff);
		neitherByDiff[bucket] = neitherByDiff[bucket] ?? { neither: 0, total: 0 };
		neitherByDiff[bucket].total += 1;
		if (answer.selected === 'neither') neitherByDiff[bucket].neither += 1;
	}

	const neitherByBitrateDiff: Record<string, number> = {};
	for (const [bucket, { neither, total }] of Object.entries(neitherByDiff)) {
		neitherByBitrateDiff[bucket] = total > 0 ? neither / total : 0;
	}

	const insights = {
		codecWinRates,
		bradleyTerryScores,
		deviceBreakdown,
		heatmap,
		neitherRate,
		flacVsLossy,
		neitherByBitrateDiff
	};

	// Insert snapshot
	await db.insert(resultSnapshots).values({
		expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		totalResponses: allAnswers.length,
		insights
	});

	// Clean up old expired snapshots (keep last 100)
	const oldSnapshots = await db
		.select({ createdAt: resultSnapshots.createdAt })
		.from(resultSnapshots)
		.where(lt(resultSnapshots.expiresAt, new Date()))
		.all();

	if (oldSnapshots.length > 100) {
		const toDelete = oldSnapshots.slice(100);
		for (const s of toDelete) {
			if (s.createdAt) {
				await db
					.delete(resultSnapshots)
					.where(eq(resultSnapshots.createdAt, s.createdAt));
			}
		}
	}
};
