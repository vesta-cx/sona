import { error } from '@sveltejs/kit';
import { eq, lt } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { getStorage } from '$lib/server/storage';
import { ephemeralStreamUrls, candidateFiles } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
	if (!platform) return error(500, 'Platform not available');

	const { token } = params;
	const db = getDb(platform);

	// Look up the stream token
	const streamUrl = await db
		.select()
		.from(ephemeralStreamUrls)
		.where(eq(ephemeralStreamUrls.token, token))
		.get();

	if (!streamUrl) return error(404, 'Stream not found');

	// Check expiry
	if (streamUrl.expiresAt < new Date()) {
		// Delete expired token
		await db.delete(ephemeralStreamUrls).where(eq(ephemeralStreamUrls.token, token));
		return error(410, 'Stream expired');
	}

	// Get the candidate file info
	const candidate = await db
		.select()
		.from(candidateFiles)
		.where(eq(candidateFiles.id, streamUrl.candidateFileId))
		.get();

	if (!candidate) return error(404, 'Audio file not found');

	// Fetch from storage
	const storage = getStorage(platform);
	const object = await storage.get(candidate.r2Key);

	if (!object) return error(404, 'Audio file not in storage');

	// Determine content type without revealing codec
	// Use generic audio content type
	const contentType = object.contentType || 'audio/mpeg';

	return new Response(object.body, {
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(object.size),
			'Cache-Control': 'no-store',
			'Accept-Ranges': 'bytes'
		}
	});
};
