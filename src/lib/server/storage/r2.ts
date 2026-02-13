import type { StorageObject, StorageProvider } from './types';

export class R2StorageProvider implements StorageProvider {
	constructor(private bucket: R2Bucket) {}

	async put(
		key: string,
		body: ReadableStream | ArrayBuffer | string,
		contentType: string
	): Promise<void> {
		await this.bucket.put(key, body, {
			httpMetadata: { contentType }
		});
	}

	async get(key: string): Promise<StorageObject | null> {
		const object = await this.bucket.get(key);
		if (!object) return null;

		return {
			body: object.body,
			contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
			size: object.size
		};
	}

	async getSignedUrl(_key: string, _expiresIn: number): Promise<string> {
		// R2 doesn't support pre-signed URLs natively from Workers.
		// Use the ephemeral stream endpoint pattern instead.
		throw new Error(
			'R2 does not support signed URLs from Workers. Use ephemeral stream tokens instead.'
		);
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}
}
