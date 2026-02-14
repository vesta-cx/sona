import { getDb } from '$lib/server/db';
import { generateRound } from '$lib/server/game';
import { TRANSITION_MODES } from '$lib/server/db/schema';
import type { TransitionMode } from '$lib/server/db/schema';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const LOG = '[game:play]';
const COOKIE_MODES = 'transition_modes';
const COOKIE_PAIRING = 'pairing_types';

const parseEnabledModes = (val: string | undefined): TransitionMode[] | null => {
	if (!val?.trim()) return null;
	const modes = val.split(',').map((s) => s.trim()) as TransitionMode[];
	const valid = modes.filter((m) => TRANSITION_MODES.includes(m));
	return valid.length > 0 ? valid : null;
};

const parseEnabledPairing = (val: string | undefined): boolean => {
	if (!val?.trim()) return true; // default: allow different_song
	return val.split(',').map((s) => s.trim()).includes('different_song');
};

export const load: PageServerLoad = async ({ cookies, platform }) => {
	console.log(`${LOG} /survey/play load()`);

	const deviceId = cookies.get('device_id');
	if (!deviceId) {
		console.log(`${LOG} No device_id, redirecting to setup`);
		redirect(302, '/survey/setup');
	}
	if (!platform) {
		console.error(`${LOG} Platform not available`);
		return {
			round: null,
			deviceId,
			enabledModes: [...TRANSITION_MODES] as TransitionMode[],
			allowDifferentSong: true,
			error: 'Platform not available'
		};
	}

	const enabledModes = parseEnabledModes(cookies.get(COOKIE_MODES));
	const allowDifferentSong = parseEnabledPairing(cookies.get(COOKIE_PAIRING));
	const enabledPairing: (typeof import('$lib/server/db/schema').PairingType)[] = allowDifferentSong
		? ['same_song', 'different_song', 'placebo']
		: ['same_song', 'placebo'];

	const db = getDb(platform);
	const round = await generateRound(db, enabledModes, enabledPairing);

	if (!round) {
		console.log(`${LOG} No round available`);
		return {
			round: null,
			deviceId,
			enabledModes: enabledModes ?? ([...TRANSITION_MODES] as TransitionMode[]),
			allowDifferentSong,
			error: 'No audio comparisons available yet. Check back soon!'
		};
	}

	console.log(`${LOG} Returning round`, {
		tokenA: round.tokenA.slice(0, 8) + '...',
		tokenB: round.tokenB.slice(0, 8) + '...',
		startTime: round.startTime,
		duration: round.duration,
		transitionMode: round.transitionMode
	});

	return {
		round: {
			tokenA: round.tokenA,
			tokenB: round.tokenB,
			tokenYwltA: round.tokenYwltA,
			tokenYwltB: round.tokenYwltB,
			transitionMode: round.transitionMode,
			startTime: round.startTime,
			duration: round.duration,
			labelA: round.labelA,
			labelB: round.labelB
		},
		deviceId,
		enabledModes: enabledModes ?? ([...TRANSITION_MODES] as TransitionMode[]),
		allowDifferentSong,
		error: null
	};
};
