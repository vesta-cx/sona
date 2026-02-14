import { eq } from 'drizzle-orm';
import type { Database } from './db';
import { surveyConfig } from './db/schema';
import type { PairingType } from './db/schema';
import { PAIRING_TYPES } from './db/schema';

export const PAIRING_WEIGHTS_KEY = 'pairing_weights';
export const SEGMENT_DURATION_KEY = 'segment_duration_ms';

export const DEFAULT_SEGMENT_DURATION_MS = 12_000;

const DEFAULT_WEIGHTS: Record<PairingType, number> = {
	same_song: 0.7,
	different_song: 0.2,
	placebo: 0.1
};

export type PairingWeights = Record<PairingType, number>;

export const getPairingWeights = async (db: Database): Promise<PairingWeights> => {
	const row = await db
		.select({ value: surveyConfig.value })
		.from(surveyConfig)
		.where(eq(surveyConfig.key, PAIRING_WEIGHTS_KEY))
		.get();

	if (!row?.value) return { ...DEFAULT_WEIGHTS };

	try {
		const parsed = JSON.parse(row.value) as Record<string, number>;
		const weights: PairingWeights = { ...DEFAULT_WEIGHTS };
		for (const p of PAIRING_TYPES) {
			if (typeof parsed[p] === 'number' && parsed[p] >= 0) {
				weights[p] = parsed[p];
			}
		}
		return weights;
	} catch {
		return { ...DEFAULT_WEIGHTS };
	}
};

export const setPairingWeights = async (
	db: Database,
	weights: PairingWeights
): Promise<void> => {
	await db
		.insert(surveyConfig)
		.values({
			key: PAIRING_WEIGHTS_KEY,
			value: JSON.stringify(weights)
		})
		.onConflictDoUpdate({
			target: surveyConfig.key,
			set: { value: JSON.stringify(weights) }
		});
};

export const getSegmentDuration = async (db: Database): Promise<number> => {
	const row = await db
		.select({ value: surveyConfig.value })
		.from(surveyConfig)
		.where(eq(surveyConfig.key, SEGMENT_DURATION_KEY))
		.get();

	if (!row?.value) return DEFAULT_SEGMENT_DURATION_MS;

	const parsed = parseInt(row.value, 10);
	if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120_000) {
		return DEFAULT_SEGMENT_DURATION_MS;
	}
	return parsed;
};

export const setSegmentDuration = async (
	db: Database,
	ms: number
): Promise<void> => {
	const clamped = Math.max(1000, Math.min(120_000, Math.round(ms)));
	await db
		.insert(surveyConfig)
		.values({
			key: SEGMENT_DURATION_KEY,
			value: String(clamped)
		})
		.onConflictDoUpdate({
			target: surveyConfig.key,
			set: { value: String(clamped) }
		});
};
