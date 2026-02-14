import { fail } from '@sveltejs/kit';
import { eq, inArray, isNull } from 'drizzle-orm';
import { parseBlob } from 'music-metadata';
import { getDb } from '$lib/server/db';
import { getStorage } from '$lib/server/storage';
import {
	sourceFiles,
	candidateFiles,
	ephemeralStreamUrls,
	answers,
	CODECS
} from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const DURATION_TOLERANCE_MS = 500; // Allow ±500ms for different codecs

const BASENAME_REGEX = /^(.+)_(flac|opus|mp3|aac)_(\d+)\.[a-z0-9]+$/i;

/** Sanitize a string for use in R2 object keys (filename-safe, no path separators). */
function slugForR2(s: string): string {
	return s
		.replace(/[/\\:*?"<>|\s]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		|| 'unnamed';
}

type TrackMeta = {
	basename: string;
	title: string;
	artist: string;
	genre: string;
	licenseUrl: string;
	streamUrl: string;
	durationMs: number | null;
};

function extractBasename(path: string): string | null {
	const filename = (path.split(/[/\\]/).pop() ?? '').trim();
	const match = filename.match(BASENAME_REGEX);
	return match ? match[1] ?? null : null;
}

export const load: PageServerLoad = async ({ platform }) => {
	if (!platform) return { sources: [], candidatesBySource: {} };

	const db = getDb(platform);
	const sources = await db.select().from(sourceFiles).all();
	const allCandidates = await db
		.select({ sourceFileId: candidateFiles.sourceFileId, codec: candidateFiles.codec, bitrate: candidateFiles.bitrate })
		.from(candidateFiles)
		.all();

	const candidatesBySource: Record<string, { codec: string; bitrate: number }[]> = {};
	for (const c of allCandidates) {
		const list = candidatesBySource[c.sourceFileId] ?? [];
		list.push({ codec: c.codec, bitrate: c.bitrate });
		candidatesBySource[c.sourceFileId] = list;
	}

	return { sources, candidatesBySource };
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

	updateStreamUrl: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		const streamUrl = (data.get('stream_url') as string)?.trim() ?? '';
		if (!id) return fail(400, { error: 'Missing source ID' });

		const db = getDb(platform);
		await db
			.update(sourceFiles)
			.set({ streamUrl: streamUrl || null })
			.where(eq(sourceFiles.id, id));

		return { success: true };
	},

	updateMetadata: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing source ID' });

		const title = (data.get('title') as string)?.trim();
		if (!title) return fail(400, { error: 'Title is required' });

		const licenseUrl = (data.get('license_url') as string)?.trim();
		if (!licenseUrl) return fail(400, { error: 'License URL is required' });

		const durationRaw = data.get('duration') as string;
		const duration = durationRaw ? parseInt(durationRaw, 10) : undefined;
		if (duration !== undefined && (Number.isNaN(duration) || duration < 0)) {
			return fail(400, { error: 'Invalid duration' });
		}

		const db = getDb(platform);
		const updates: Record<string, unknown> = {
			title,
			licenseUrl,
			artist: (data.get('artist') as string)?.trim() || null,
			genre: (data.get('genre') as string)?.trim() || null,
			streamUrl: (data.get('stream_url') as string)?.trim() || null
		};
		if (duration !== undefined) updates.duration = duration;

		await db.update(sourceFiles).set(updates).where(eq(sourceFiles.id, id));

		return { success: true };
	},

	uploadCandidates: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const formData = await request.formData();
		const sourceId = formData.get('source_id') as string;
		const files = formData.getAll('files') as File[];
		if (!sourceId || !files.length) return fail(400, { error: 'Missing source or files' });

		const db = getDb(platform);
		const storage = getStorage(platform);

		const [source] = await db.select().from(sourceFiles).where(eq(sourceFiles.id, sourceId));
		if (!source) return fail(404, { error: 'Source not found' });

		const existingCandidates = await db
			.select({ codec: candidateFiles.codec, bitrate: candidateFiles.bitrate })
			.from(candidateFiles)
			.where(eq(candidateFiles.sourceFileId, sourceId))
			.all();
		const existingKeys = new Set(existingCandidates.map((c) => `${c.codec}_${c.bitrate}`));

		const expectedDurationMs = source.duration;
		const expectedTitle = source.title.trim().toLowerCase();
		const expectedArtist = (source.artist ?? '').trim().toLowerCase();

		let added = 0;
		const errors: string[] = [];

		const sourceBasename = source.basename?.trim().toLowerCase();

		for (const file of files) {
			if (!(file instanceof File) || file.size === 0) continue;

			const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
			const basename = extractBasename(path);
			if (!basename) {
				errors.push(`${file.name}: invalid filename (expected basename_codec_bitrate.ext)`);
				continue;
			}

			if (sourceBasename && basename.toLowerCase() !== sourceBasename) {
				errors.push(`${file.name}: basename "${basename}" doesn't match source "${source.basename}"`);
				continue;
			}

			const filename = path.split('/').pop() ?? path;
			const match = filename.match(/_([a-z]+)_(\d+)\.[a-z0-9]+$/i);
			if (!match) continue;

			const codec = match[1] as (typeof CODECS)[number];
			const bitrate = parseInt(match[2] ?? '0', 10);
			if (!CODECS.includes(codec)) continue;

			if (existingKeys.has(`${codec}_${bitrate}`)) continue;

			let durationMs: number | null = null;
			let fileTitle: string | null = null;
			let fileArtist: string | null = null;
			try {
				const meta = await parseBlob(file);
				if (meta.format.duration) durationMs = Math.round(meta.format.duration * 1000);
				fileTitle = meta.common.title?.trim().toLowerCase() ?? null;
				fileArtist = (meta.common.artist ?? '').trim().toLowerCase() || null;
			} catch {
				errors.push(`${file.name}: could not read metadata`);
				continue;
			}

			if (durationMs != null) {
				const diff = Math.abs(durationMs - expectedDurationMs);
				if (diff > DURATION_TOLERANCE_MS) {
					errors.push(
						`${file.name}: duration ${Math.round(durationMs / 1000)}s doesn't match source ${Math.round(expectedDurationMs / 1000)}s (tolerance ±${DURATION_TOLERANCE_MS}ms)`
					);
					continue;
				}
			}

			if (expectedTitle && fileTitle && fileTitle !== expectedTitle) {
				errors.push(`${file.name}: title "${fileTitle}" doesn't match source "${expectedTitle}"`);
				continue;
			}
			if (expectedArtist && fileArtist && fileArtist !== expectedArtist) {
				errors.push(`${file.name}: artist "${fileArtist}" doesn't match source "${expectedArtist}"`);
				continue;
			}

			const candidateSlug = slugForR2(filename);
			const candidateR2Key = `candidates/${sourceId}/${candidateSlug}`;
			const buffer = await file.arrayBuffer();
			await storage.put(candidateR2Key, buffer, file.type || 'application/octet-stream');

			await db.insert(candidateFiles).values({
				r2Key: candidateR2Key,
				codec,
				bitrate,
				sourceFileId: sourceId
			});
			existingKeys.add(`${codec}_${bitrate}`);
			added++;
		}

		if (added === 0 && errors.length > 0) {
			return fail(400, { error: errors.join('; ') });
		}

		return { success: true, added, errors: errors.length > 0 ? errors : undefined };
	},

	approveBulk: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const ids = data.getAll('ids') as string[];
		if (!ids.length) return fail(400, { error: 'No sources selected' });

		const db = getDb(platform);
		for (const id of ids) {
			await db
				.update(sourceFiles)
				.set({ approvedAt: new Date(), approvedBy: 'admin' })
				.where(eq(sourceFiles.id, id));
		}

		return { success: true, approved: ids.length };
	},

	remove: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'Missing source ID' });

		const db = getDb(platform);
		const storage = getStorage(platform);

		const candidates = await db
			.select({ id: candidateFiles.id, r2Key: candidateFiles.r2Key })
			.from(candidateFiles)
			.where(eq(candidateFiles.sourceFileId, id));

		const candidateIds = candidates.map((c) => c.id);

		if (candidateIds.length > 0) {
			const usedA = await db
				.select({ id: answers.id })
				.from(answers)
				.where(inArray(answers.candidateAId, candidateIds))
				.limit(1);
			const usedB = await db
				.select({ id: answers.id })
				.from(answers)
				.where(inArray(answers.candidateBId, candidateIds))
				.limit(1);

			if (usedA.length > 0 || usedB.length > 0) {
				return fail(400, {
					error: 'Cannot remove source: it has been used in survey responses.'
				});
			}
		}

		const [source] = await db.select().from(sourceFiles).where(eq(sourceFiles.id, id));
		if (!source) return fail(404, { error: 'Source not found' });

		if (candidateIds.length > 0) {
			await db
				.delete(ephemeralStreamUrls)
				.where(inArray(ephemeralStreamUrls.candidateFileId, candidateIds));
			for (const c of candidates) {
				try {
					await storage.delete(c.r2Key);
				} catch {
					// Ignore R2 delete errors (key may not exist)
				}
			}
			await db.delete(candidateFiles).where(eq(candidateFiles.sourceFileId, id));
		}

		try {
			await storage.delete(source.r2Key);
		} catch {
			// Ignore R2 delete errors
		}
		await db.delete(sourceFiles).where(eq(sourceFiles.id, id));

		return { success: true, removed: true };
	},

	removeBulk: async ({ request, platform }) => {
		if (!platform) return fail(500, { error: 'Platform not available' });

		const data = await request.formData();
		const ids = data.getAll('ids') as string[];
		if (!ids.length) return fail(400, { error: 'No sources selected' });

		const db = getDb(platform);
		const storage = getStorage(platform);
		let removed = 0;
		const errors: string[] = [];

		for (const id of ids) {
			const candidates = await db
				.select({ id: candidateFiles.id, r2Key: candidateFiles.r2Key })
				.from(candidateFiles)
				.where(eq(candidateFiles.sourceFileId, id));

			const candidateIds = candidates.map((c) => c.id);

			if (candidateIds.length > 0) {
				const [usedA] = await db
					.select({ id: answers.id })
					.from(answers)
					.where(inArray(answers.candidateAId, candidateIds))
					.limit(1);
				const [usedB] = await db
					.select({ id: answers.id })
					.from(answers)
					.where(inArray(answers.candidateBId, candidateIds))
					.limit(1);

				if (usedA || usedB) {
					errors.push(id);
					continue;
				}
			}

			const [source] = await db.select().from(sourceFiles).where(eq(sourceFiles.id, id));
			if (!source) continue;

			if (candidateIds.length > 0) {
				await db
					.delete(ephemeralStreamUrls)
					.where(inArray(ephemeralStreamUrls.candidateFileId, candidateIds));
				for (const c of candidates) {
					try {
						await storage.delete(c.r2Key);
					} catch {
						// ignore
					}
				}
				await db.delete(candidateFiles).where(eq(candidateFiles.sourceFileId, id));
			}

			try {
				await storage.delete(source.r2Key);
			} catch {
				// ignore
			}
			await db.delete(sourceFiles).where(eq(sourceFiles.id, id));
			removed++;
		}

		if (removed === 0 && errors.length > 0) {
			return fail(400, {
				error: 'Cannot remove selected sources: they have been used in survey responses.'
			});
		}

		return { success: true, removed, partial: errors.length > 0 };
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
		const sharedStreamUrl = (formData.get('stream_url') as string)?.trim() ?? '';
		const tracksRaw = formData.get('tracks') as string | null;
		const files = formData.getAll('files') as File[];

		console.log('[uploadDirectory] received', {
			fileCount: files.length,
			files: files.map((f) => ({
				name: f.name,
				webkitRelativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '(none)',
				size: f.size,
				type: f.type
			}))
		});

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
			const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
			const basename = extractBasename(path);
			if (!basename) {
				console.log('[uploadDirectory] skip file (no basename)', { path });
				continue;
			}
			const group = byBasename.get(basename) ?? [];
			group.push(file);
			byBasename.set(basename, group);
		}

		console.log('[uploadDirectory] byBasename', {
			keys: [...byBasename.keys()],
			groups: Object.fromEntries(
				[...byBasename.entries()].map(([k, v]) => [
					k,
					v.map((f) => {
						const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
						return { path: p, name: f.name };
					})
				])
			)
		});

		let created = 0;
		let merged = 0;

		for (const meta of trackMetas) {
			const { basename, title, artist, genre, licenseUrl, streamUrl = '', durationMs } = meta;
			if (!title?.trim()) continue;

			const group = byBasename.get(basename);
			if (!group) {
				console.log('[uploadDirectory] track skipped (no group)', { basename, title });
				continue;
			}

			const flacFile = group.find((f) => {
				const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
				return p.includes('/flac/') || f.name.endsWith('.flac');
			});

			console.log('[uploadDirectory] track', {
				basename,
				title,
				groupSize: group.length,
				groupPaths: group.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name),
				flacFound: Boolean(flacFile),
				flacPath: flacFile ? ((flacFile as File & { webkitRelativePath?: string }).webkitRelativePath || flacFile.name) : null
			});

			const effectiveLicense = (licenseUrl?.trim() || sharedLicenseUrl)?.trim();
			if (!effectiveLicense) {
				console.log('[uploadDirectory] track skipped: no license', { basename });
				continue;
			}

			// Look up existing source by basename (or title for legacy rows without basename)
			// Use limit(1).all() instead of .get() — D1 can throw "Failed query" with .get() on certain params
			let existing = basename
				? (
						await db
							.select()
							.from(sourceFiles)
							.where(eq(sourceFiles.basename, basename))
							.limit(1)
							.all()
					)[0] ?? null
				: null;
			if (!existing && basename) {
				// Fallback: match by normalized title for legacy sources (no basename set)
				const normalizedTitle = title.trim().toLowerCase();
				const legacySources = await db
					.select()
					.from(sourceFiles)
					.where(isNull(sourceFiles.basename))
					.all();
				const matches = legacySources.filter(
					(s) => s.title.trim().toLowerCase() === normalizedTitle
				);
				if (matches.length === 1) {
					existing = matches[0];
					await db
						.update(sourceFiles)
						.set({ basename })
						.where(eq(sourceFiles.id, existing.id));
				}
			}

			let source: { id: string; r2Key: string } | null = null;

			if (existing) {
				// Replace: overwrite FLAC, replace all candidates with upload
				// Skip if source has been used in survey responses (FK: answers → candidate_files)
				const existingCandidateIds = (
					await db
						.select({ id: candidateFiles.id })
						.from(candidateFiles)
						.where(eq(candidateFiles.sourceFileId, existing.id))
						.all()
				).map((c) => c.id);
				if (existingCandidateIds.length > 0) {
					const [usedA] = await db
						.select({ id: answers.id })
						.from(answers)
						.where(inArray(answers.candidateAId, existingCandidateIds))
						.limit(1)
						.all();
					const [usedB] = await db
						.select({ id: answers.id })
						.from(answers)
						.where(inArray(answers.candidateBId, existingCandidateIds))
						.limit(1)
						.all();
					if (usedA ?? usedB) {
						console.log('[uploadDirectory] track skipped: source has answers (FK)', { basename });
						continue;
					}
				}

				source = existing;
				merged++;

				const updateFields: Record<string, unknown> = {
					title: title.trim(),
					artist: artist?.trim() || null,
					genre: genre?.trim() || null,
					licenseUrl: effectiveLicense
				};
				const effectiveStreamUrl = (streamUrl?.trim() || sharedStreamUrl)?.trim();
				if (effectiveStreamUrl) updateFields.streamUrl = effectiveStreamUrl;

				if (flacFile) {
					const flacBuffer = await flacFile.arrayBuffer();
					await storage.put(existing.r2Key, flacBuffer, 'audio/flac');
					const clientDurationMs = durationMs != null ? Number(durationMs) : NaN;
					updateFields.duration =
						Number.isFinite(clientDurationMs) && clientDurationMs > 0
							? Math.round(clientDurationMs)
							: Math.round((flacFile.size / (1400 * 1000 / 8)) * 1000);
				}

				await db.update(sourceFiles).set(updateFields).where(eq(sourceFiles.id, existing.id));

				// Delete existing candidates (replace, not merge)
				const oldCandidates = await db
					.select({ id: candidateFiles.id, r2Key: candidateFiles.r2Key })
					.from(candidateFiles)
					.where(eq(candidateFiles.sourceFileId, existing.id))
					.all();
				const oldIds = oldCandidates.map((c) => c.id);
				if (oldIds.length > 0) {
					await db
						.delete(ephemeralStreamUrls)
						.where(inArray(ephemeralStreamUrls.candidateFileId, oldIds));
					for (const c of oldCandidates) {
						try {
							await storage.delete(c.r2Key);
						} catch {
							// ignore
						}
					}
					await db
						.delete(candidateFiles)
						.where(eq(candidateFiles.sourceFileId, existing.id));
				}
				// existingKeys stays empty so we add all from upload
			} else {
				// Create new source — requires FLAC
				if (!flacFile) {
					console.log('[uploadDirectory] track skipped: new source but no FLAC', { basename });
					continue;
				}

				const sourceSlug = slugForR2(basename);
				const r2Key = `sources/${sourceSlug}_${crypto.randomUUID().slice(0, 8)}.flac`;
				const flacBuffer = await flacFile.arrayBuffer();
				await storage.put(r2Key, flacBuffer, 'audio/flac');

				const clientDurationMs = durationMs != null ? Number(durationMs) : NaN;
				const durationMsFinal =
					Number.isFinite(clientDurationMs) && clientDurationMs > 0
						? Math.round(clientDurationMs)
						: Math.round((flacFile.size / (1400 * 1000 / 8)) * 1000);

				const effectiveStreamUrl = (streamUrl?.trim() || sharedStreamUrl)?.trim() || null;
				const [inserted] = await db
					.insert(sourceFiles)
					.values({
						basename: basename || null,
						r2Key,
						licenseUrl: effectiveLicense,
						streamUrl: effectiveStreamUrl,
						title: title.trim(),
						artist: artist?.trim() || null,
						genre: genre?.trim() || null,
						duration: durationMsFinal
					})
					.returning();

				source = inserted ?? null;
				if (source) created++;
			}

			if (!source) continue;

			// Get existing candidates for this source (to avoid duplicates when merging)
			const existingCandidates = await db
				.select({ codec: candidateFiles.codec, bitrate: candidateFiles.bitrate })
				.from(candidateFiles)
				.where(eq(candidateFiles.sourceFileId, source.id))
				.all();
			const existingKeys = new Set(
				existingCandidates.map((c) => `${c.codec}_${c.bitrate}`)
			);

			for (const file of group) {
				const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
				const parts = path.split(/[/\\]/);
				const filename = parts[parts.length - 1] ?? '';
				if (!filename) {
					console.log('[uploadDirectory] candidate skip: no filename', { path });
					continue;
				}

				const match = filename.match(/_(opus|flac|mp3|aac)_(\d+)\.[a-z0-9]+$/i);
				if (!match) {
					console.log('[uploadDirectory] candidate skip: regex no match', { basename, filename });
					continue;
				}

				const codec = match[1]?.toLowerCase() as (typeof CODECS)[number];
				const bitrate = parseInt(match[2] ?? '0', 10);
				const inCodecs = CODECS.includes(codec);
				const isDup = existingKeys.has(`${codec}_${bitrate}`);

				if (!inCodecs) {
					console.log('[uploadDirectory] candidate skip: codec not in CODECS', { basename, filename, codec });
					continue;
				}
				if (isDup) {
					console.log('[uploadDirectory] candidate skip: duplicate', { basename, codec, bitrate });
					continue;
				}

				const candidateSlug = slugForR2(filename);
				const candidateR2Key = `candidates/${source.id}/${candidateSlug}`;
				const buffer = await file.arrayBuffer();
				await storage.put(candidateR2Key, buffer, file.type || 'application/octet-stream');

				await db.insert(candidateFiles).values({
					r2Key: candidateR2Key,
					codec,
					bitrate,
					sourceFileId: source.id
				});

				console.log('[uploadDirectory] candidate uploaded', { basename, codec, bitrate, filename });
				existingKeys.add(`${codec}_${bitrate}`);
			}
		}

		if (created === 0 && merged === 0) {
			return fail(400, {
				error:
					'No valid tracks to upload. New tracks require a FLAC file. For merging, ensure basename matches existing and metadata is complete.'
			});
		}

		console.log('[uploadDirectory] done', { created, merged });
		return { success: true, count: created, merged };
	}
} satisfies Actions;
