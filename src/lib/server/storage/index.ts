import { R2StorageProvider } from './r2';
import type { StorageProvider } from './types';

export type { StorageObject, StorageProvider } from './types';

export const getStorage = (platform: App.Platform): StorageProvider =>
	new R2StorageProvider(platform.env.AUDIO_BUCKET);
