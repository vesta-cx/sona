import { writable } from 'svelte/store';

export const uploadProgress = writable<number | null>(null);
