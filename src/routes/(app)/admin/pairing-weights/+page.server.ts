import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import {
	getPairingWeights,
	setPairingWeights,
	getSegmentDuration,
	setSegmentDuration,
	type PairingWeights
} from '$lib/server/survey-config';
import { PAIRING_TYPES, type PairingType } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform) {
		return {
			weights: null,
			pairingTypes: PAIRING_TYPES,
			labels: null,
			segmentDurationMs: null
		};
	}

	const db = getDb(platform);
	const [weights, segmentDurationMs] = await Promise.all([
		getPairingWeights(db),
		getSegmentDuration(db)
	]);

	return {
		weights,
		pairingTypes: PAIRING_TYPES,
		labels: {
			same_song: 'Same song (A vs B)',
			different_song: 'Different songs',
			placebo: 'Placebo (identical)'
		} as Record<PairingType, string>,
		segmentDurationMs
	};
};

export const actions = {
	save: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const weights: PairingWeights = {} as PairingWeights;

		for (const p of PAIRING_TYPES) {
			const v = parseFloat(data.get(`weight_${p}`) as string);
			if (Number.isNaN(v) || v < 0) {
				return fail(400, { error: `Invalid weight for ${p}` });
			}
			weights[p] = v;
		}

		const total = Object.values(weights).reduce((a, b) => a + b, 0);
		if (total <= 0) {
			return fail(400, { error: 'At least one weight must be positive' });
		}

		const db = getDb(platform);
		await setPairingWeights(db, weights);

		return { success: true };
	},
	saveSegmentDuration: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const raw = data.get('segment_duration_ms');
		const v = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
		if (!Number.isInteger(v) || v < 1000 || v > 120_000) {
			return fail(400, { error: 'Segment duration must be 1000–120000 ms (1–120 s)' });
		}

		const db = getDb(platform);
		await setSegmentDuration(db, v);

		return { success: true, segmentDurationSaved: true };
	}
} satisfies Actions;
