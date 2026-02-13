import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { getStorage } from '$lib/server/storage';
import { sourceFiles, candidateFiles, CODECS } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const BASENAME_REGEX = /^(.+)_(flac|opus|mp3|aac)_(\d+)\.[a-z0-9]+$/i;

type TrackMeta = {
	basename: string;
	title: string;
	artist: string;
	genre: string;
	licenseUrl: string;
	durationMs: number | null;
};

function extractBasename(path: string): string | null {
	const filename = path.split('/').pop() ?? '';
	const match = filename.match(BASENAME_REGEX);
	return match ? match[1] ?? null : null;
}

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform) return { sources: [] };

	const db = getDb(platform);
	const sources = await db.select().from(sourceFiles).all();

	return { sources };
};

export const actions = {
	approve: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing source ID' });

		const db = getDb(platform);
		await db
			.update(sourceFiles)
			.set({ approvedAt: new Date(), approvedBy: 'admin' })
			.where(eq(sourceFiles.id, id));

		return { success: true };
	},

	reject: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing source ID' });

		const db = getDb(platform);
		await db
			.update(sourceFiles)
			.set({ approvedAt: null, approvedBy: null })
			.where(eq(sourceFiles.id, id));

		return { success: true };
	},

	/**
	 * Upload a pre-transcoded directory with per-track metadata.
	 * Expects files in the structure: {codec}/{name}_{codec}_{bitrate}.{ext}
	 * The FLAC file becomes the source_files entry. Multiple tracks supported.
	 */
	uploadDirectory: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const formData = await request.formData();
		const sharedLicenseUrl = (formData.get('license_url') as string)?.trim() ?? '';
		const tracksRaw = formData.get('tracks') as string | null;
		const files = formData.getAll('files') as File[];

		if (!tracksRaw || files.length === 0) {
			return fail(400, { error: 'Select a directory and fill in track metadata' });
		}

		let trackMetas: TrackMeta[];
		try {
			trackMetas = JSON.parse(tracksRaw) as TrackMeta[];
			if (!Array.isArray(trackMetas) || trackMetas.length === 0) {
				return fail(400, { error: 'No track metadata' });
			}
		} catch {
			return fail(400, { error: 'Invalid track metadata' });
		}

		const db = getDb(platform);
		const storage = getStorage(platform);

		// Group uploaded files by basename
		const byBasename = new Map<string, File[]>();
		for (const file of files) {
			const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
			const basename = extractBasename(path);
			if (!basename) continue;
			const group = byBasename.get(basename) ?? [];
			group.push(file);
			byBasename.set(basename, group);
		}

		let created = 0;

		for (const meta of trackMetas) {
			const { basename, title, artist, genre, licenseUrl, durationMs } = meta;
			if (!title?.trim()) continue;

			const group = byBasename.get(basename);
			if (!group) continue;

			const flacFile = group.find((f) => {
				const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
				return p.includes('/flac/');
			});

			if (!flacFile) continue;

			const effectiveLicense = (licenseUrl?.trim() || sharedLicenseUrl)?.trim();
			if (!effectiveLicense) continue;

			const r2Key = `sources/${crypto.randomUUID()}.flac`;
			const flacBuffer = await flacFile.arrayBuffer();
			await storage.put(r2Key, flacBuffer, 'audio/flac');

			const clientDurationMs = durationMs != null ? Number(durationMs) : NaN;
			const durationMsFinal =
				Number.isFinite(clientDurationMs) && clientDurationMs > 0
					? Math.round(clientDurationMs)
					: Math.round((flacFile.size / (1400 * 1000 / 8)) * 1000);

			const [source] = await db
				.insert(sourceFiles)
				.values({
					r2Key,
					licenseUrl: effectiveLicense,
					title: title.trim(),
					artist: artist?.trim() || null,
					genre: genre?.trim() || null,
					duration: durationMsFinal
				})
				.returning();

			if (!source) continue;

			created++;

			for (const file of group) {
				const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
				const parts = path.split('/');
				const codecDir = parts.find((p) => CODECS.includes(p as (typeof CODECS)[number]));
				if (!codecDir) continue;

				const filename = parts[parts.length - 1];
				if (!filename) continue;

				const match = filename.match(/_([a-z]+)_(\d+)\.[a-z0-9]+$/);
				if (!match) continue;

				const codec = match[1] as (typeof CODECS)[number];
				const bitrate = parseInt(match[2] ?? '0', 10);
				if (!CODECS.includes(codec)) continue;

				const candidateR2Key = `candidates/${source.id}/${codec}_${bitrate}_${crypto.randomUUID()}`;
				const buffer = await file.arrayBuffer();
				await storage.put(candidateR2Key, buffer, file.type || 'application/octet-stream');

				await db.insert(candidateFiles).values({
					r2Key: candidateR2Key,
					codec,
					bitrate,
					sourceFileId: source.id
				});
			}
		}

		if (created === 0) {
			return fail(400, { error: 'No valid tracks to upload. Ensure each track has a FLAC file and required metadata.' });
		}

		return { success: true, count: created };
	}
} satisfies Actions;
