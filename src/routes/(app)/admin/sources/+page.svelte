<script lang="ts">
	import { enhance } from '$app/forms';
	import { parseBlob } from 'music-metadata';

	let { data, form } = $props();

	type TrackEntry = {
		basename: string;
		title: string;
		artist: string;
		genre: string;
		licenseUrl: string;
		durationMs: number | null;
		metadataSource: string | null;
		files: File[];
		flacFile: File | null;
		expanded: boolean;
	};

	const BASENAME_REGEX = /^(.+)_(flac|opus|mp3|aac)_(\d+)\.[a-z0-9]+$/i;

	let showUploadDialog = $state(false);
	let sharedLicenseUrl = $state('');
	let tracks = $state<TrackEntry[]>([]);
	let fileInputRef = $state<HTMLInputElement | null>(null);

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
		const filename = path.split('/').pop() ?? '';
		const match = filename.match(BASENAME_REGEX);
		return match ? match[1] ?? null : null;
	};

	const handleDirectorySelect = async (e: Event) => {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) {
			tracks = [];
			return;
		}

		const fileList = Array.from(files) as (File & { webkitRelativePath?: string })[];
		const byBasename = new Map<string, File[]>();

		for (const file of fileList) {
			const path = file.webkitRelativePath ?? file.name;
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
					const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
					return p.includes('/flac/');
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
	};

	const tracksJson = $derived(
		JSON.stringify(
			tracks.map((t) => ({
				basename: t.basename,
				title: t.title,
				artist: t.artist,
				genre: t.genre,
				licenseUrl: t.licenseUrl || sharedLicenseUrl,
				durationMs: t.durationMs
			}))
		)
	);
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

	{#if form?.success}
		<div class="rounded-lg border border-green-500 bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200">
			{form?.count != null ? `Upload complete! ${form.count} source(s) added.` : 'Upload complete!'}
		</div>
	{/if}

	<!-- Upload Dialog -->
	{#if showUploadDialog}
		<div class="bg-card rounded-xl border p-6">
			<h2 class="mb-4 text-lg font-medium">Upload Pre-Transcoded Directory</h2>
			<p class="text-muted-foreground mb-4 text-sm">
				Select a directory output by <code>generate-permutations.sh</code>. It should contain
				subdirectories like <code>flac/</code>, <code>opus/</code>, <code>mp3/</code>,
				<code>aac/</code>.
			</p>
			<form method="POST" action="?/uploadDirectory" use:enhance enctype="multipart/form-data" class="space-y-4">
				<div class="space-y-2">
					<label for="upload-dir" class="text-sm font-medium">Directory</label>
					<!-- @ts-ignore webkitdirectory is non-standard but supported -->
					<input
						id="upload-dir"
						bind:this={fileInputRef}
						name="files"
						type="file"
						multiple
						webkitdirectory
						onchange={handleDirectorySelect}
						class="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm"
					/>
				</div>

				{#if tracks.length > 0}
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
								disabled={!allComplete}
								class="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed"
							>
								Upload
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
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b">
						<th class="px-4 py-2 text-left font-medium">Title</th>
						<th class="px-4 py-2 text-left font-medium">Artist</th>
						<th class="px-4 py-2 text-left font-medium">Genre</th>
						<th class="px-4 py-2 text-left font-medium">Duration</th>
						<th class="px-4 py-2 text-left font-medium">Status</th>
						<th class="px-4 py-2 text-left font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sources as source}
						<tr class="border-b">
							<td class="px-4 py-2 font-medium">{source.title}</td>
							<td class="text-muted-foreground px-4 py-2">{source.artist ?? '—'}</td>
							<td class="text-muted-foreground px-4 py-2">{source.genre ?? '—'}</td>
							<td class="text-muted-foreground px-4 py-2">
								{Math.round(source.duration / 1000)}s
							</td>
							<td class="px-4 py-2">
								{#if source.approvedAt}
									<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">
										Approved
									</span>
								{:else}
									<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
										Pending
									</span>
								{/if}
							</td>
							<td class="px-4 py-2">
								{#if source.approvedAt}
									<form method="POST" action="?/reject" use:enhance>
										<input type="hidden" name="id" value={source.id} />
										<button type="submit" class="text-xs text-destructive hover:underline">Revoke</button>
									</form>
								{:else}
									<form method="POST" action="?/approve" use:enhance>
										<input type="hidden" name="id" value={source.id} />
										<button type="submit" class="text-primary text-xs hover:underline">Approve</button>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
