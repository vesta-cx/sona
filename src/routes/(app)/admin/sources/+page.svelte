<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Checkbox } from '@vesta-cx/ui/components/ui/checkbox';
	import UploadProgressToast from '$lib/components/upload-progress-toast.svelte';
	import { uploadProgress } from '$lib/stores/upload-progress';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import { parseBlob } from 'music-metadata';
	import { toast } from 'svelte-sonner';

	let { data, form } = $props();

	let selectedIds = $state<Set<string>>(new Set());
	let expandedIds = $state<Set<string>>(new Set());
	let uploadingSourceId = $state<string | null>(null);
	const allSourceIds = $derived(data.sources.map((s) => s.id));
	const allSelected = $derived(
		data.sources.length > 0 && data.sources.every((s) => selectedIds.has(s.id))
	);
	const someSelected = $derived(selectedIds.size > 0);
	const isIndeterminate = $derived(someSelected && !allSelected);

	const handleSelectAllChange = (checked: boolean | 'indeterminate') => {
		if (checked === true || checked === 'indeterminate') {
			selectedIds = new Set(allSourceIds);
		} else {
			selectedIds = new Set();
		}
	};

	const handleSelectChange = (id: string, checked: boolean | 'indeterminate') => {
		const next = new Set(selectedIds);
		if (checked === true) next.add(id);
		else next.delete(id);
		selectedIds = next;
	};

	const handleToggleExpanded = (id: string) => {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedIds = next;
	};

	const handleRemoveResult = (opts: { result?: { type?: string; data?: { removed?: number } }; update?: () => Promise<void> }) => {
		if (opts?.result?.type === 'success' && opts.result?.data?.removed != null) {
			toast.success(
				opts.result.data.removed === 1
					? 'Source deleted'
					: `${opts.result.data.removed} sources deleted`
			);
			selectedIds = new Set();
		}
		opts?.update?.();
	};

	const handleApproveResult = (opts: { result?: { type?: string; data?: { approved?: number } }; update?: () => Promise<void> }) => {
		if (opts?.result?.type === 'success' && opts.result?.data?.approved != null) {
			toast.success(
				opts.result.data.approved === 1
					? 'Source approved'
					: `${opts.result.data.approved} sources approved`
			);
			selectedIds = new Set();
		}
		opts?.update?.();
	};

	type TrackEntry = {
		basename: string;
		title: string;
		artist: string;
		genre: string;
		licenseUrl: string;
		streamUrl: string;
		durationMs: number | null;
		metadataSource: string | null;
		files: File[];
		flacFile: File | null;
		expanded: boolean;
	};

	const BASENAME_REGEX = /^(.+)_(flac|opus|mp3|aac)_(\d+)\.[a-z0-9]+$/i;
	const BASENAME_FALLBACK = /^(.+)_(?:flac|opus|mp3|aac)(?:_\d+)?\.[a-z0-9]+$/i;

	let showUploadDialog = $state(false);
	let fileSelectError = $state('');
	let sharedLicenseUrl = $state('');
	let sharedStreamUrl = $state('');
	let tracks = $state<TrackEntry[]>([]);
	let directoryInputRef = $state<HTMLInputElement | null>(null);
	let filesInputRef = $state<HTMLInputElement | null>(null);
	let isUploading = $state(false);

	const isComplete = (t: TrackEntry) => Boolean(t.title?.trim() && (t.licenseUrl?.trim() || sharedLicenseUrl?.trim()));
	const allComplete = $derived(sharedLicenseUrl?.trim() && tracks.length > 0 && tracks.every(isComplete));

	const completeCount = $derived(tracks.filter(isComplete).length);
	const incompleteCount = $derived(tracks.length - completeCount);

	const formatDuration = (ms: number | null) => {
		if (ms == null) return '—';
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};

	const extractBasename = (path: string): string | null => {
		const filename = (path.split(/[/\\]/).pop() ?? '').trim();
		const match = filename.match(BASENAME_REGEX) ?? filename.match(BASENAME_FALLBACK);
		console.log('[extractBasename]', {
			path,
			filename,
			filenameLength: filename.length,
			filenameBytes: [...filename].map((c) => c.codePointAt(0)),
			match: match ? match[0] : null,
			basename: match ? match[1] ?? null : null
		});
		if (match) return match[1] ?? null;
		// Ultimate fallback: use filename stem for any audio file
		const stem = filename.replace(/\.[a-z0-9]+$/i, '');
		return stem ? stem : null;
	};

	const handleFileSelect = async (e: Event) => {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) {
			// Don't wipe tracks when this is triggered by clearing the other input
			return;
		}
		fileSelectError = '';
		// Clear the other input after we've processed (defer to avoid its onchange wiping tracks)
		const otherInput = input.hasAttribute('webkitdirectory') ? filesInputRef : directoryInputRef;
		queueMicrotask(() => {
			if (otherInput) otherInput.value = '';
		});

		const fileList = Array.from(files) as (File & { webkitRelativePath?: string })[];
		const byBasename = new Map<string, File[]>();

		console.log('[handleFileSelect]', {
			inputType: input.hasAttribute('webkitdirectory') ? 'directory' : 'files',
			fileCount: fileList.length,
			files: fileList.map((f) => ({
				name: f.name,
				webkitRelativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '(none)'
			}))
		});

		for (const file of fileList) {
			const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
			const basename = extractBasename(path);
			if (!basename) continue;

			const existing = byBasename.get(basename) ?? [];
			existing.push(file);
			byBasename.set(basename, existing);
		}

		const entries: TrackEntry[] = [];

		for (const [basename, group] of byBasename) {
			const flacFile =
				group.find((f) => {
					const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
					return p.includes('/flac/') || f.name.endsWith('.flac');
				}) ?? null;

			// Prefer MP3 for metadata, then FLAC
			const mp3File = group.find((f) => f.name.endsWith('.mp3'));
			const metaCandidate = mp3File ?? flacFile ?? group.find((f) => /\.(flac|ogg|m4a|wav)$/i.test(f.name));

			let title = basename.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
			let artist = '';
			let genre = '';
			let durationMs: number | null = null;
			let metadataSource: string | null = null;

			if (metaCandidate) {
				try {
					const metadata = await parseBlob(metaCandidate);
					const { common, format } = metadata;
					if (common.title) title = common.title;
					if (common.artist) artist = common.artist;
					if (common.genre?.[0]) genre = common.genre[0];
					if (format.duration) durationMs = Math.round(format.duration * 1000);
					metadataSource = metaCandidate.name;
				} catch {
					// Leave defaults
				}
			}

			entries.push({
				basename,
				title,
				artist,
				genre,
				licenseUrl: sharedLicenseUrl,
				streamUrl: sharedStreamUrl,
				durationMs,
				metadataSource,
				files: group,
				flacFile,
				expanded: true
			});
		}

		// Sort by basename
		entries.sort((a, b) => a.basename.localeCompare(b.basename));
		tracks = entries;

		// Auto-hydrate license/stream from matching existing sources when shared fields are empty
		if (!sharedLicenseUrl.trim() && !sharedStreamUrl.trim() && data.sources.length > 0) {
			const sourceByBasename = new Map(data.sources.map((s) => [s.basename ?? '', s]));
			const match = entries.find((e) => sourceByBasename.has(e.basename));
			if (match) {
				const src = sourceByBasename.get(match.basename);
				if (src?.licenseUrl) sharedLicenseUrl = src.licenseUrl;
				if (src?.streamUrl != null) sharedStreamUrl = src.streamUrl;
			}
		}

		console.log('[handleFileSelect] result', { entriesCount: entries.length, basenames: entries.map((e) => e.basename) });
		if (entries.length === 0) {
			fileSelectError =
				'No files matched the expected format. Use basename_codec_bitrate.ext (e.g. song_mp3_128.mp3, song_flac_0.flac). Or try the Directory option.';
		}
	};

	const tracksJson = $derived(
		JSON.stringify(
			tracks.map((t) => ({
				basename: t.basename,
				title: t.title,
				artist: t.artist,
				genre: t.genre,
				licenseUrl: t.licenseUrl || sharedLicenseUrl,
				streamUrl: t.streamUrl || sharedStreamUrl,
				durationMs: t.durationMs
			}))
		)
	);

	const UPLOAD_TOAST_ID = 'source-upload';

	type UploadItem = {
		file: File;
		track: TrackEntry;
		isFlac: boolean;
	};

	const buildUploadQueue = (): UploadItem[] => {
		const queue: UploadItem[] = [];
		for (const track of tracks) {
			const effectiveLicense = track.licenseUrl?.trim() || sharedLicenseUrl?.trim();
			const effectiveStream = track.streamUrl?.trim() || sharedStreamUrl?.trim();
			if (!effectiveLicense || !track.title?.trim()) continue;

			if (track.flacFile) {
				queue.push({ file: track.flacFile, track, isFlac: true });
			}
			for (const file of track.files) {
				if (file === track.flacFile) continue;
				queue.push({ file, track, isFlac: false });
			}
		}
		return queue;
	};

	const handleUploadSubmit = async (e: SubmitEvent) => {
		e.preventDefault();
		const formEl = e.target as HTMLFormElement;
		if (!allComplete || isUploading) return;

		const queue = buildUploadQueue();
		if (queue.length === 0) {
			toast.error('No files to upload');
			return;
		}

		isUploading = true;
		const actionUrl = formEl.action.replace('uploadDirectory', 'uploadSingleFile');

		uploadProgress.set(0);
		toast.custom(UploadProgressToast, {
			id: UPLOAD_TOAST_ID,
			duration: Number.POSITIVE_INFINITY
		});

		const done = () => {
			isUploading = false;
			uploadProgress.set(null);
		};

		let totalCreated = 0;
		let totalMerged = 0;
		let lastError: string | null = null;

		try {
			for (let i = 0; i < queue.length; i++) {
				const { file, track, isFlac } = queue[i];
				const fd = new FormData();
				fd.set('file', file);
				fd.set('license_url', track.licenseUrl?.trim() || sharedLicenseUrl || '');
				fd.set('stream_url', track.streamUrl?.trim() || sharedStreamUrl || '');
				fd.set('basename', track.basename);
				fd.set('title', track.title);
				fd.set('artist', track.artist || '');
				fd.set('genre', track.genre || '');
				fd.set('duration_ms', track.durationMs != null ? String(track.durationMs) : '');
				fd.set('is_flac', String(isFlac));

				const res = await new Promise<{ ok: boolean; status: number; text: () => Promise<string> }>(
					(resolve, reject) => {
						const xhr = new XMLHttpRequest();
						const startMs = Date.now();
						xhr.open('POST', actionUrl);
						xhr.setRequestHeader('Accept', 'application/json');
						xhr.upload.onprogress = (ev) => {
							if (ev.lengthComputable && ev.total > 0) {
								const fileProgress = ev.loaded / ev.total;
								const overall = (i + fileProgress) / queue.length;
								uploadProgress.set(Math.round(overall * 100));
							} else {
								const elapsed = Date.now() - startMs;
								const fileContribution = Math.min(80, Math.round((elapsed / 2000) * 80));
								const base = (i / queue.length) * 100;
								uploadProgress.set(Math.round(base + (fileContribution / 100) * (100 / queue.length)));
							}
						};
						xhr.upload.onload = () => {
							uploadProgress.set(Math.round(((i + 1) / queue.length) * 100));
						};
						xhr.onload = () =>
							resolve({
								ok: xhr.status >= 200 && xhr.status < 300,
								status: xhr.status,
								text: async () => xhr.responseText
							});
						xhr.onerror = () => reject(new Error('Upload failed'));
						xhr.send(fd);
					}
				);

				let result: { type?: string; data?: { created?: number; merged?: number; error?: string } };
				try {
					result = deserialize(await res.text()) as typeof result;
				} catch {
					result = {};
				}

				if (res.ok || res.status === 303 || res.status === 302) {
					totalCreated += result?.data?.created ?? 0;
					totalMerged += result?.data?.merged ?? 0;
				} else {
					lastError = result?.data?.error ?? 'Upload failed';
					toast.error(`${file.name}: ${lastError}`, { id: `upload-err-${i}` });
				}
			}

			done();
			uploadProgress.set(100);

			if (totalCreated > 0 || totalMerged > 0) {
				const parts: string[] = [];
				if (totalCreated > 0) parts.push(`${totalCreated} added`);
				if (totalMerged > 0) parts.push(`${totalMerged} merged`);
				toast.success('Upload complete', {
					id: UPLOAD_TOAST_ID,
					description: `${parts.join(', ')}. It may take a moment for sources and candidates to appear.`
				});
				showUploadDialog = false;
				tracks = [];
				sharedLicenseUrl = '';
				sharedStreamUrl = '';
				fileSelectError = '';
				if (directoryInputRef) directoryInputRef.value = '';
				if (filesInputRef) filesInputRef.value = '';
				invalidateAll();
			} else if (lastError) {
				toast.error('Upload failed', { id: UPLOAD_TOAST_ID, description: lastError });
			}
		} catch {
			done();
			toast.error('Upload failed', { id: UPLOAD_TOAST_ID });
		}
	};
</script>

<svelte:head>
	<title>Sources | Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Source Files</h1>
		<button
			type="button"
			class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium"
			onclick={() => (showUploadDialog = !showUploadDialog)}
		>
			Upload Directory
		</button>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
			{form.error}
		</div>
	{/if}

	{#if form?.success && ((form?.count ?? 0) > 0 || (form?.merged ?? 0) > 0)}
		{@const count = form?.count ?? 0}
		{@const merged = form?.merged ?? 0}
		<div class="rounded-lg border border-green-500 bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200">
			Upload complete!
			{#if count > 0}
				{count} source(s) added.
			{/if}
			{#if merged > 0}
				{merged} source(s) merged (new codecs added).
			{/if}
		</div>
	{/if}

	<!-- Upload Dialog -->
	{#if showUploadDialog}
		<div class="bg-card rounded-xl border p-6">
			<h2 class="mb-4 text-lg font-medium">Upload Pre-Transcoded Directory</h2>
			<p class="text-muted-foreground mb-4 text-sm">
				Select a directory or multi-select files from output by <code>generate-permutations.sh</code>.
				Expects subdirectories like <code>flac/</code>, <code>opus/</code>, <code>mp3/</code>,
				<code>aac/</code>.
			</p>
			<form
				method="POST"
				action="?/uploadDirectory"
				enctype="multipart/form-data"
				class="space-y-4"
				onsubmit={handleUploadSubmit}
			>
				<div class="flex flex-wrap gap-4">
					<div class="space-y-2">
						<label for="upload-dir" class="text-sm font-medium">Directory</label>
						<!-- @ts-expect-error webkitdirectory is non-standard but widely supported -->
						<input
							id="upload-dir"
							bind:this={directoryInputRef}
							name="files"
							type="file"
							multiple
							webkitdirectory
							accept=".flac,.opus,.ogg,.mp3,.m4a,.aac"
							onchange={handleFileSelect}
							class="border-input bg-background flex rounded-md border px-3 py-2 text-sm"
						/>
					</div>
					<div class="space-y-2">
						<label for="upload-files" class="text-sm font-medium">Files</label>
						<input
							id="upload-files"
							bind:this={filesInputRef}
							name="files"
							type="file"
							multiple
							accept=".flac,.opus,.ogg,.mp3,.m4a,.aac"
							onchange={handleFileSelect}
							class="border-input bg-background flex rounded-md border px-3 py-2 text-sm"
						/>
					</div>
				</div>

				{#if fileSelectError}
					<div class="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
						{fileSelectError}
					</div>
				{/if}

				{#if tracks.length > 0}
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<label for="license_url" class="text-sm font-medium">License URL (shared default)</label>
							<input
								id="license_url"
								name="license_url"
								type="url"
								required
								bind:value={sharedLicenseUrl}
								class="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm"
							/>
							<p class="text-muted-foreground text-xs">Applied to all tracks. Override per-track below.</p>
						</div>
						<div class="space-y-2">
							<label for="stream_url" class="text-sm font-medium">Stream URL (shared default)</label>
							<input
								id="stream_url"
								name="stream_url"
								type="url"
								placeholder="https://…"
								bind:value={sharedStreamUrl}
								class="border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm"
							/>
							<p class="text-muted-foreground text-xs">Optional. Shown after survey submission. Override per-track below.</p>
						</div>
					</div>

					<div class="space-y-2">
						<p class="text-sm font-medium">Tracks ({tracks.length})</p>
						<div class="space-y-2 max-h-96 overflow-y-auto pr-2">
							{#each tracks as track, i}
								{@const complete = isComplete(track)}
								<div
									class="rounded-lg border p-3 transition-colors {complete
										? 'border-border bg-muted/20'
										: 'border-destructive bg-destructive/5'}"
								>
									<button
										type="button"
										class="flex w-full items-center justify-between gap-2 text-left"
										onclick={() => (track.expanded = !track.expanded)}
									>
										<div class="flex min-w-0 flex-1 items-center gap-2">
											<span
												class="size-2 shrink-0 rounded-full {complete ? 'bg-green-500' : 'bg-destructive'}"
												aria-hidden="true"
											></span>
											<span class="truncate font-medium" title={track.basename}>{track.title || track.basename}</span>
											<span class="text-muted-foreground shrink-0 text-xs">
												({track.files.length} files)
											</span>
										</div>
										<span class="text-muted-foreground shrink-0" aria-hidden="true">
											{track.expanded ? '−' : '+'}
										</span>
									</button>
									<p class="text-muted-foreground mt-1 truncate text-xs">
										{#if complete}
											{track.title}
											{#if track.artist} — {track.artist}{/if}
											{#if track.durationMs != null} — {formatDuration(track.durationMs)}{/if}
										{:else}
											<span class="text-destructive">Incomplete</span> — add title
											{#if !(track.licenseUrl?.trim() || sharedLicenseUrl?.trim())}
												and license URL
											{/if}
										{/if}
									</p>
									{#if track.expanded}
									<div class="mt-3 grid gap-3 sm:grid-cols-2">
										<div class="space-y-1">
											<label for="title-{i}" class="text-xs font-medium">Title</label>
											<input
												id="title-{i}"
												type="text"
												bind:value={track.title}
												placeholder="Track title"
												class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
											/>
										</div>
										<div class="space-y-1">
											<label for="artist-{i}" class="text-xs font-medium">Artist</label>
											<input
												id="artist-{i}"
												type="text"
												bind:value={track.artist}
												placeholder="Artist"
												class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
											/>
										</div>
										<div class="space-y-1">
											<label for="genre-{i}" class="text-xs font-medium">Genre</label>
											<input
												id="genre-{i}"
												type="text"
												bind:value={track.genre}
												placeholder="Genre"
												class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
											/>
										</div>
										<div class="space-y-1">
											<label for="license-{i}" class="text-xs font-medium">License URL (override)</label>
											<input
												id="license-{i}"
												type="url"
												bind:value={track.licenseUrl}
												placeholder={sharedLicenseUrl || 'Uses shared default'}
												class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
											/>
										</div>
										<div class="space-y-1">
											<label for="stream-{i}" class="text-xs font-medium">Stream URL (override)</label>
											<input
												id="stream-{i}"
												type="url"
												bind:value={track.streamUrl}
												placeholder={sharedStreamUrl || 'Optional—where to listen'}
												class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
											/>
										</div>
									</div>
									{#if track.metadataSource}
										<p class="text-muted-foreground mt-1 text-xs">
											Metadata from <code>{track.metadataSource}</code>
										</p>
									{/if}
									{#if track.durationMs != null}
										<p class="text-muted-foreground mt-0.5 text-xs">Duration: {formatDuration(track.durationMs)}</p>
									{/if}
									{/if}
								</div>
							{/each}
						</div>
					</div>

					<input type="hidden" name="tracks" value={tracksJson} />

					<div class="flex items-center justify-between gap-4 border-t pt-4">
						<p class="text-muted-foreground text-sm">
							{completeCount} track(s) ready
							{#if incompleteCount > 0}
								— <span class="text-destructive">{incompleteCount} incomplete</span>
							{/if}
						</p>
						<div class="flex gap-2">
							<button
								type="submit"
								disabled={!allComplete || isUploading}
								class="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed"
							>
								{#if isUploading}
									<Loader2 class="size-4 animate-spin" aria-hidden="true" />
								{/if}
								{isUploading ? 'Uploading…' : 'Upload'}
							</button>
							<button
								type="button"
								class="bg-muted text-muted-foreground rounded-lg px-4 py-2 text-sm font-medium"
								onclick={() => (showUploadDialog = false)}
							>
								Cancel
							</button>
						</div>
					</div>
				{/if}
			</form>
		</div>
	{/if}

	<!-- Sources list -->
	{#if data.sources.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">No source files yet.</p>
	{:else}
		<div class="space-y-4">
			<div
				class="bg-muted/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-2"
			>
				<span class="text-muted-foreground text-sm">
					{someSelected
						? `${selectedIds.size} source${selectedIds.size === 1 ? '' : 's'} selected`
						: 'Select sources to approve or delete'}
				</span>
				<div class="flex gap-2">
					<form
						method="POST"
						action="?/approveBulk"
						use:enhance={() => (opts) => handleApproveResult(opts)}
						class="inline"
					>
						{#each [...selectedIds] as id}
							<input type="hidden" name="ids" value={id} />
						{/each}
						<button
							type="submit"
							disabled={!someSelected}
							class="text-primary hover:bg-primary/10 flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
						>
							<CircleCheck class="size-4" aria-hidden="true" />
							Approve
						</button>
					</form>
					<form
						method="POST"
						action="?/removeBulk"
						use:enhance={() => (opts) => handleRemoveResult(opts)}
						class="inline"
					>
						{#each [...selectedIds] as id}
							<input type="hidden" name="ids" value={id} />
						{/each}
						<button
							type="submit"
							disabled={!someSelected}
							class="text-destructive hover:bg-destructive/10 flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
							onclick={(e) => {
								if (
									!someSelected ||
									!confirm(
										`Delete ${selectedIds.size} source${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`
									)
								) {
									e.preventDefault();
								}
							}}
						>
							<Trash2 class="size-4" aria-hidden="true" />
							Delete
						</button>
					</form>
				</div>
			</div>

			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b">
							<th class="w-8 px-2 py-2 pr-0"></th>
							<th class="w-10 px-2 py-2 pr-0">
								<Checkbox
									checked={allSelected}
									indeterminate={isIndeterminate}
									onCheckedChange={handleSelectAllChange}
									aria-label="Select all sources"
								/>
							</th>
							<th class="px-4 py-2 text-left font-medium">Title</th>
							<th class="px-4 py-2 text-left font-medium">Artist</th>
							<th class="px-4 py-2 text-left font-medium">Genre</th>
							<th class="px-4 py-2 text-left font-medium">Duration</th>
							<th class="px-4 py-2 text-left font-medium">Candidates</th>
							<th class="px-4 py-2 text-left font-medium">Status</th>
							<th class="px-4 py-2 text-left font-medium">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.sources as source}
							{@const candidates = data.candidatesBySource?.[source.id] ?? []}
							{@const isExpanded = expandedIds.has(source.id)}
							<tr class="border-b">
								<td class="w-8 px-2 py-2 pr-0">
									<button
										type="button"
										class="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center rounded transition-colors"
										aria-expanded={isExpanded}
										aria-label={isExpanded ? 'Collapse' : 'Expand'}
										onclick={() => handleToggleExpanded(source.id)}
									>
										<span
											class="size-4 transition-transform"
											class:-rotate-90={!isExpanded}
											aria-hidden="true"
										>
											<ChevronDown class="size-4" aria-hidden="true" />
										</span>
									</button>
								</td>
								<td class="w-10 px-2 py-2 pr-0">
									<Checkbox
										checked={selectedIds.has(source.id)}
										onCheckedChange={(v) => handleSelectChange(source.id, v)}
										aria-label="Select {source.title}"
									/>
								</td>
								<td class="px-4 py-2 font-medium">{source.title}</td>
								<td class="text-muted-foreground px-4 py-2">{source.artist ?? '—'}</td>
								<td class="text-muted-foreground px-4 py-2">{source.genre ?? '—'}</td>
								<td class="text-muted-foreground px-4 py-2">
									{Math.round(source.duration / 1000)}s
								</td>
								<td class="text-muted-foreground px-4 py-2">
									{candidates.length > 0
										? candidates.map((c) => `${c.codec}@${c.bitrate}`).join(', ')
										: '—'}
								</td>
								<td class="px-4 py-2">
									{#if source.approvedAt}
										<span
											class="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200"
										>
											Approved
										</span>
									{:else}
										<span
											class="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
										>
											Pending
										</span>
									{/if}
								</td>
								<td class="px-4 py-2">
									<div class="flex items-center gap-2">
										{#if source.approvedAt}
											<form method="POST" action="?/reject" use:enhance class="inline">
												<input type="hidden" name="id" value={source.id} />
												<button
													type="submit"
													class="text-xs text-destructive hover:underline"
												>
													Revoke
												</button>
											</form>
										{:else}
											<form method="POST" action="?/approve" use:enhance class="inline">
												<input type="hidden" name="id" value={source.id} />
												<button type="submit" class="text-primary text-xs hover:underline">
													Approve
												</button>
											</form>
										{/if}
										<form
											method="POST"
											action="?/remove"
											use:enhance={() => (opts) => handleRemoveResult(opts)}
											class="inline"
										>
											<input type="hidden" name="id" value={source.id} />
											<button
												type="submit"
												class="text-muted-foreground hover:text-destructive text-xs hover:underline"
												onclick={(e) => {
													if (
														!confirm(
															'Remove this source and all its files? This cannot be undone.'
														)
													) {
														e.preventDefault();
													}
												}}
											>
												Remove
											</button>
										</form>
									</div>
								</td>
							</tr>
							{#if isExpanded}
								<tr class="border-b bg-muted/20">
									<td colspan="9" class="p-4">
										<div class="space-y-6">
											<!-- Candidates table: codec (x), bitrate (y) -->
											<div>
												<h3 class="mb-3 text-sm font-medium">Candidates ({candidates.length})</h3>
												{#if candidates.length > 0}
													{@const codecs = ['flac', 'opus', 'mp3', 'aac']}
													{@const bitrates = [...new Set(candidates.map((c) => c.bitrate))].sort(
														(a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b)
													)}
													{@const hasCandidate = (codec: string, bitrate: number) =>
														candidates.some((c) => c.codec === codec && c.bitrate === bitrate)}
													<div class="border-input overflow-x-auto rounded-md border">
														<table class="w-full min-w-[200px] text-xs">
															<thead>
																<tr class="border-b bg-muted/50">
																	<th class="px-2 py-1.5 text-left font-medium">bitrate ↓</th>
																	{#each codecs as codec}
																		<th class="px-2 py-1.5 text-center font-medium">{codec}</th>
																	{/each}
																</tr>
															</thead>
															<tbody>
																{#each bitrates as bitrate}
																	<tr class="border-b last:border-b-0">
																		<td class="text-muted-foreground px-2 py-1 font-mono">{bitrate}</td>
																		{#each codecs as codec}
																			<td class="px-2 py-1 text-center">
																				{#if hasCandidate(codec, bitrate)}
																					<span class="text-primary" aria-hidden="true">✓</span>
																				{:else}
																					<span class="text-muted-foreground/40" aria-hidden="true">—</span>
																				{/if}
																			</td>
																		{/each}
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												{:else}
													<p class="text-muted-foreground text-sm">No candidates yet. Upload transcodes below.</p>
												{/if}
											</div>

											<!-- Metadata form -->
											<div>
												<h3 class="mb-3 text-sm font-medium">Edit Metadata</h3>
												<form
													method="POST"
													action="?/updateMetadata"
													use:enhance={() => {
														return ({ result, update }) => {
															if (result.type === 'failure' && result.data?.error) {
																toast.error(result.data.error as string);
															} else if (result.type === 'success') {
																toast.success('Metadata saved');
															}
															update();
														};
													}}
													class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
												>
													<input type="hidden" name="id" value={source.id} />
													<div class="space-y-1">
														<label for="meta-title-{source.id}" class="text-xs font-medium">Title</label>
														<input
															id="meta-title-{source.id}"
															name="title"
															type="text"
															value={source.title}
															required
															class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
														/>
													</div>
													<div class="space-y-1">
														<label for="meta-artist-{source.id}" class="text-xs font-medium">Artist</label>
														<input
															id="meta-artist-{source.id}"
															name="artist"
															type="text"
															value={source.artist ?? ''}
															class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
														/>
													</div>
													<div class="space-y-1">
														<label for="meta-genre-{source.id}" class="text-xs font-medium">Genre</label>
														<input
															id="meta-genre-{source.id}"
															name="genre"
															type="text"
															value={source.genre ?? ''}
															class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
														/>
													</div>
													<div class="space-y-1">
														<label for="meta-license-{source.id}" class="text-xs font-medium">License URL</label>
														<input
															id="meta-license-{source.id}"
															name="license_url"
															type="url"
															value={source.licenseUrl}
															required
															class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
														/>
													</div>
													<div class="space-y-1">
														<label for="meta-stream-{source.id}" class="text-xs font-medium">Stream URL</label>
														<input
															id="meta-stream-{source.id}"
															name="stream_url"
															type="url"
															value={source.streamUrl ?? ''}
															placeholder="https://…"
															class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
														/>
													</div>
													<div class="space-y-1">
														<label for="meta-duration-{source.id}" class="text-xs font-medium">Duration (ms)</label>
														<input
															id="meta-duration-{source.id}"
															name="duration"
															type="number"
															value={source.duration}
															min="0"
															class="border-input bg-background flex h-9 w-full rounded-md border px-2 py-1.5 text-sm"
														/>
													</div>
													<div class="flex items-end sm:col-span-2 lg:col-span-3">
														<button
															type="submit"
															class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm font-medium"
														>
															Save Metadata
														</button>
													</div>
												</form>
											</div>

											<!-- Upload candidates -->
											<div>
												<h3 class="mb-3 text-sm font-medium">Upload New Candidates</h3>
												<p class="text-muted-foreground mb-2 text-xs">
													Select transcoded files matching this source. Same duration (±500ms) and
													metadata are required. Filename format: <code
														class="rounded bg-muted px-1">basename_codec_bitrate.ext</code>
												</p>
												<form
													method="POST"
													action="?/uploadCandidates"
													enctype="multipart/form-data"
													use:enhance={() => {
														uploadingSourceId = source.id;
														return ({ result, update }) => {
															uploadingSourceId = null;
															if (result.type === 'failure' && result.data?.error) {
																toast.error(result.data.error as string);
															} else if (result.type === 'success' && result.data) {
																const d = result.data as { added?: number; errors?: string[] };
																if ((d.added ?? 0) > 0) toast.success(`Added ${d.added} candidate(s)`);
																if (d.errors?.length) d.errors.forEach((e) => toast.warning(e));
															}
															update();
														};
													}}
													class="flex flex-wrap items-end gap-3"
												>
													<input type="hidden" name="source_id" value={source.id} />
													<div class="flex min-w-0 flex-1 flex-col gap-1">
														<label for="candidates-{source.id}" class="text-xs font-medium"
															>Files (multiple)</label
														>
														<input
															id="candidates-{source.id}"
															name="files"
															type="file"
															multiple
															accept=".flac,.opus,.ogg,.mp3,.m4a,.aac"
															class="border-input bg-background flex w-full max-w-xs rounded-md border px-2 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-sm file:text-primary-foreground"
														/>
													</div>
													<button
														type="submit"
														disabled={uploadingSourceId === source.id}
														class="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed"
													>
														{#if uploadingSourceId === source.id}
															<Loader2 class="size-4 animate-spin" aria-hidden="true" />
														{:else}
															<Upload class="size-4" aria-hidden="true" />
														{/if}
														Upload
													</button>
												</form>
											</div>
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
