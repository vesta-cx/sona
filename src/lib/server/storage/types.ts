export interface StorageObject {
	body: ReadableStream;
	contentType: string;
	size: number;
}

export interface StorageProvider {
	put(key: string, body: ReadableStream | ArrayBuffer | string, contentType: string): Promise<void>;
	get(key: string): Promise<StorageObject | null>;
	getSignedUrl(key: string, expiresIn: number): Promise<string>;
	delete(key: string): Promise<void>;
}
