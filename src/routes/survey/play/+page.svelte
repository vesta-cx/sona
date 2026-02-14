<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import * as AlertDialog from '@vesta-cx/ui/components/ui/alert-dialog';
	import * as Empty from '@vesta-cx/ui/components/ui/empty';
	import * as Popover from '@vesta-cx/ui/components/ui/popover';
	import * as Tooltip from '@vesta-cx/ui/components/ui/tooltip';
	import ComparisonSettingsPopover from '$lib/components/comparison-settings-popover.svelte';
	import { Anchor } from '@vesta-cx/ui/components/utils/anchor';
	import TrackLabel from '$lib/components/track-label.svelte';
	import InfoIcon from '@lucide/svelte/icons/info';
	import HomeIcon from '@lucide/svelte/icons/home';
	let { data } = $props();

	let submitting = $state(false);
	let responseStartTime = $state(0);
	let exitDialogOpen = $state(false);
	/** Client-side round counter (resets on exit; not persisted) */
	let roundNumber = $state(1);
	type RoundHistoryEntry = {
		round: number;
		labelA: string;
		labelB: string;
		streamUrlA: string | null;
		streamUrlB: string | null;
	};
	/** Completed rounds this session (for round recap popover) */
	let roundHistory = $state<RoundHistoryEntry[]>([]);

	const TRANSITION_LABELS: Record<string, string> = {
		gapless: 'Gapless',
		gap_continue: 'Gap (continue)',
		gap_restart: 'Gap (restart)',
		gap_pause_resume: 'Gap (pause/resume)'
	};

	const TRANSITION_TOOLTIPS: Record<string, string> = {
		gapless:
			'No pause between switching—A and B play seamlessly. Any tiny lag you notice is normal.',
		gap_continue:
			'Brief pause when switching; playback continues from where the other stopped. The lag is expected.',
		gap_restart:
			'Brief pause when switching; playback restarts from the segment start. The lag is expected.',
		gap_pause_resume:
			'Brief pause when switching; each track resumes from where you left it. No syncing between A and B.'
	};

	const formatLabel = (l: { title: string; artist: string | null }) =>
		l.artist ? `${l.title} — ${l.artist}` : l.title;

	type SubmittedPayload = {
		selected: 'a' | 'b' | 'neither';
		labelA: string;
		labelB: string;
		streamUrlA: string | null;
		streamUrlB: string | null;
		isDifferentSong: boolean;
	};
	let submitted = $state<SubmittedPayload | null>(null);

	$effect(() => {
		if (data.round && !submitted) {
			responseStartTime = Date.now();
		}
	});

	const handleConfirm = async (
		selected: 'a' | 'b' | 'neither',
		playbackPositionSeconds?: number
	) => {
		if (submitting || !data.round) return;
		submitting = true;

		const responseTime = Date.now() - responseStartTime;
		const playbackPositionMs =
			typeof playbackPositionSeconds === 'number'
				? Math.round(playbackPositionSeconds * 1000)
				: undefined;

		try {
			const res = await fetch('/api/answers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tokenA: data.round.tokenA,
					tokenB: data.round.tokenB,
					tokenYwltA: data.round.tokenYwltA ?? undefined,
					tokenYwltB: data.round.tokenYwltB ?? undefined,
					selected,
					transitionMode: data.round.transitionMode,
					startTime: data.round.startTime,
					segmentDuration: data.round.duration,
					responseTime,
					deviceId: data.deviceId,
					playbackPositionMs
				})
			});

			if (!res.ok) {
				console.error('Failed to submit answer');
				submitting = false;
				return;
			}

			const labelAStr = formatLabel(data.round.labelA);
			const labelBStr = formatLabel(data.round.labelB);
			submitted = {
				selected,
				labelA: labelAStr,
				labelB: labelBStr,
				streamUrlA: data.round.labelA?.streamUrl ?? null,
				streamUrlB: data.round.labelB?.streamUrl ?? null,
				isDifferentSong: labelAStr !== labelBStr
			};
			roundHistory = [
				...roundHistory,
				{
					round: roundNumber,
					labelA: labelAStr,
					labelB: labelBStr,
					streamUrlA: data.round.labelA?.streamUrl ?? null,
					streamUrlB: data.round.labelB?.streamUrl ?? null
				}
			];
		} catch (e) {
			console.error('Error submitting answer:', e);
		} finally {
			submitting = false;
		}
	};

	let playbackRef: { fadeOut: () => Promise<void> } | undefined;

	const handleNext = async () => {
		if (submitting) return;
		submitting = true;
		roundNumber += 1;
		if (playbackRef) {
			await playbackRef.fadeOut();
		}
		submitted = null;
		await invalidateAll();
		submitting = false;
	};

	const handleExitConfirm = () => {
		exitDialogOpen = false;
		goto('/');
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (exitDialogOpen) {
			if (e.key === 'Escape') {
				e.preventDefault();
				exitDialogOpen = false;
			} else if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				handleExitConfirm();
			}
			return;
		}
		if ((e.key === ' ' || e.key === 'Enter') && submitted && !submitting) {
			e.preventDefault();
			handleNext();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			exitDialogOpen = true;
		}
	};

	let enabledModes = $state<string[]>([]);
	let allowDifferentSong = $state(true);

	$effect(() => {
		enabledModes = [...(data.enabledModes ?? [])];
		allowDifferentSong = data.allowDifferentSong ?? true;
	});

	const handleSaveModes = async () => {
		try {
			const res = await fetch('/api/settings/transition-modes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					modes: enabledModes,
					allowDifferentSong
				})
			});
			if (res.ok) {
				await invalidateAll();
			}
		} catch (e) {
			console.error('Failed to save settings:', e);
		}
	};

	const setModeEnabled = (mode: string, checked: boolean) => {
		if (checked) {
			if (!enabledModes.includes(mode)) {
				enabledModes = [...enabledModes, mode];
			}
		} else if (enabledModes.length > 1) {
			enabledModes = enabledModes.filter((m) => m !== mode);
		}
	};
</script>

<svelte:window onkeydown={handleKeyDown} />

<svelte:head>
	<title>Play | Quality Survey</title>
</svelte:head>

<div class="relative min-h-screen">
	<!-- Exit confirmation dialog -->
	<AlertDialog.Root
		open={exitDialogOpen}
		onOpenChange={(v) => (exitDialogOpen = v)}
	>
		<AlertDialog.Portal>
			<AlertDialog.Overlay />
			<AlertDialog.Content
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						e.preventDefault();
						e.stopPropagation();
						exitDialogOpen = false;
					}
				}}
			>
				<AlertDialog.Header>
					<AlertDialog.Title>Exit game?</AlertDialog.Title>
					<AlertDialog.Description>
						Are you sure you wish to exit the game? Your progress will not be saved.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
					<AlertDialog.Action onclick={handleExitConfirm}>
						Exit
					</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>

	{#if data.error}
		<div class="flex min-h-screen flex-col items-center justify-center px-4 py-8">
			<Empty.Root class="container border-0 text-center">
				<Empty.Title class="text-2xl font-bold">No comparisons available</Empty.Title>
				<Empty.Description class="mt-2">{data.error}</Empty.Description>
				<Empty.Content class="mt-4">
					<a
						href="/"
						class="bg-primary text-primary-foreground hover:bg-primary/90 inline-block rounded-lg px-4 py-2 text-sm font-medium"
					>
						Back to Home
					</a>
				</Empty.Content>
			</Empty.Root>
		</div>
	{:else if submitting && !data.round}
		<div class="text-muted-foreground flex h-48 items-center justify-center text-sm">
			Loading next round...
		</div>
	{:else if data.round}
		<div class="relative">
			{#await import('$lib/components/audio-player')}
				<div class="flex min-h-screen items-center justify-center">
					<p class="text-muted-foreground">Loading player...</p>
				</div>
			{:then { AudioPlayer }}
				{#key data.round.tokenA}
					<AudioPlayer
						bind:this={playbackRef}
						srcA="/api/stream/{data.round.tokenA}"
						srcB="/api/stream/{data.round.tokenB}"
						srcYwltA={data.round.tokenYwltA ? `/api/stream/${data.round.tokenYwltA}` : null}
						srcYwltB={data.round.tokenYwltB ? `/api/stream/${data.round.tokenYwltB}` : null}
						transitionMode={data.round.transitionMode}
						startTime={data.round.startTime}
						duration={data.round.duration}
						onConfirm={handleConfirm}
					>
						{#snippet header()}
							<!-- Home: top-left on mobile -->
							<button
								type="button"
								onclick={() => (exitDialogOpen = true)}
								class="col-start-1 row-start-1 self-start justify-self-start text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring"
								aria-label="Return to home"
							>
								<HomeIcon class="size-4" />
								<span class="hidden sm:inline">Home</span>
							</button>
							<!-- Title + Tooltip: top-center (row 1) -->
							<div class="col-start-2 row-start-1 flex flex-col items-center gap-1 self-start justify-self-center">
								<h1 class="text-center text-2xl font-bold tracking-tight">
									Which sounds better?
								</h1>
								<div class="flex items-center justify-center">
								<Popover.Root>
									<Popover.Trigger
										class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors"
										aria-label="Transition mode"
									>
										<span class="capitalize">{TRANSITION_LABELS[data.round.transitionMode] ?? data.round.transitionMode}</span>
										<InfoIcon class="size-3.5" />
									</Popover.Trigger>
									<Popover.Content
										class="w-fit max-w-[16rem] p-3 text-xs"
										align="center"
										side="bottom"
									>
										{TRANSITION_TOOLTIPS[data.round.transitionMode] ?? 'Switching behavior for this comparison.'}
									</Popover.Content>
								</Popover.Root>
								</div>
							</div>
							<!-- Round: top-right (row 1) -->
							<Popover.Root>
								<Popover.Trigger
									class="col-start-3 row-start-1 flex items-center justify-end gap-2 self-start justify-self-end rounded-lg transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
									aria-label="Round {roundNumber} - click to view previous rounds"
								>
									<span class="hidden sm:inline text-muted-foreground text-sm font-medium">Round</span>
									<span
										class="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 text-muted-foreground text-sm font-semibold"
									>
										{roundNumber}
									</span>
								</Popover.Trigger>
								<Popover.Content class="w-72 max-h-80 overflow-y-auto p-3" align="end" side="bottom">
									<p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">Rounds this session</p>
									{#if roundHistory.length === 0}
										<p class="text-muted-foreground text-sm">No rounds completed yet.</p>
									{:else}
										<ul class="flex flex-col gap-2 text-sm">
											{#each roundHistory as entry}
												<li class="border-border flex flex-col gap-1 border-b pb-2 last:border-0 last:pb-0">
													<span class="font-medium">Round {entry.round}</span>
													{#if entry.labelA === entry.labelB}
														{#if entry.streamUrlA}
															<Anchor href={entry.streamUrlA} class="text-primary text-xs hover:underline">
																{entry.labelA}
															</Anchor>
														{:else}
															<span class="text-muted-foreground text-xs">{entry.labelA}</span>
														{/if}
													{:else}
														{#if entry.streamUrlA}
															<Anchor href={entry.streamUrlA} class="text-primary text-xs hover:underline">
																{entry.labelA}
															</Anchor>
														{:else}
															<span class="text-muted-foreground text-xs">{entry.labelA}</span>
														{/if}
														{#if entry.streamUrlB}
															<Anchor href={entry.streamUrlB} class="text-primary text-xs hover:underline">
																{entry.labelB}
															</Anchor>
														{:else}
															<span class="text-muted-foreground text-xs">{entry.labelB}</span>
														{/if}
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</Popover.Content>
							</Popover.Root>
							<!-- Settings: bottom-left (row 3) -->
							<div class="col-start-1 row-start-3 self-end justify-self-start">
								<ComparisonSettingsPopover
									enabledModes={enabledModes}
									allowDifferentSong={allowDifferentSong}
									setModeEnabled={setModeEnabled}
									onAllowDifferentSongChange={(v) => (allowDifferentSong = v)}
									onSave={handleSaveModes}
									transitionLabels={TRANSITION_LABELS}
									transitionTooltips={TRANSITION_TOOLTIPS}
								/>
							</div>
						{/snippet}
					</AudioPlayer>
				{/key}
			{/await}

			{#if submitted}
			<!-- roundSummary: post-comparison overlay -->
			<div class="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm">
				<div
					class="grid min-h-screen w-full grid-cols-[0.5fr_2fr_0.5fr] grid-rows-[repeat(3,minmax(0,1fr))] gap-x-4 gap-y-2 px-6 py-6 md:min-h-[min(95vh,720px)] md:grid-rows-[auto_auto_auto] md:container md:items-center md:justify-items-center [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_[role='button']]:pointer-events-auto"
				>
					<!-- Home: top-left (row 1) -->
					<button
						type="button"
						onclick={() => (exitDialogOpen = true)}
						class="col-start-1 row-start-1 self-start justify-self-start text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring"
						aria-label="Return to home"
					>
						<HomeIcon class="size-4" />
						<span class="hidden sm:inline">Home</span>
					</button>
					<!-- Round: top-right (row 1) -->
					<Popover.Root>
						<Popover.Trigger
							class="col-start-3 row-start-1 flex items-center justify-end gap-2 self-start justify-self-end rounded-lg transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
							aria-label="Round {roundNumber} - click to view previous rounds"
						>
							<span class="hidden sm:inline text-muted-foreground text-sm font-medium">Round</span>
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 text-muted-foreground text-sm font-semibold"
							>
								{roundNumber}
							</span>
						</Popover.Trigger>
						<Popover.Content class="w-72 max-h-80 overflow-y-auto p-3" align="end" side="bottom">
							<p class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">Rounds this session</p>
							{#if roundHistory.length === 0}
								<p class="text-muted-foreground text-sm">No rounds completed yet.</p>
							{:else}
								<ul class="flex flex-col gap-2 text-sm">
									{#each roundHistory as entry}
										<li class="border-border flex flex-col gap-1 border-b pb-2 last:border-0 last:pb-0">
											<span class="font-medium">Round {entry.round}</span>
											{#if entry.labelA === entry.labelB}
												{#if entry.streamUrlA}
													<Anchor href={entry.streamUrlA} class="text-primary text-xs hover:underline">
														{entry.labelA}
													</Anchor>
												{:else}
													<span class="text-muted-foreground text-xs">{entry.labelA}</span>
												{/if}
											{:else}
												{#if entry.streamUrlA}
													<Anchor href={entry.streamUrlA} class="text-primary text-xs hover:underline">
														{entry.labelA}
													</Anchor>
												{:else}
													<span class="text-muted-foreground text-xs">{entry.labelA}</span>
												{/if}
												{#if entry.streamUrlB}
													<Anchor href={entry.streamUrlB} class="text-primary text-xs hover:underline">
														{entry.labelB}
													</Anchor>
												{:else}
													<span class="text-muted-foreground text-xs">{entry.labelB}</span>
												{/if}
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						</Popover.Content>
					</Popover.Root>
					<!-- Center: Round summary title + You submitted / You were listening to (row 2) -->
					<div
						class="col-start-2 row-start-2 flex flex-col items-center justify-center gap-4 text-center self-center justify-self-center md:place-self-center"
					>
						<h2 class="text-xl font-bold tracking-tight">Round summary</h2>
						<p class="text-muted-foreground text-sm">
							You submitted
							{submitted.selected === 'neither' ? 'neither' : submitted.selected.toUpperCase()}.
						</p>
						<TrackLabel
							labelA={submitted.labelA}
							labelB={submitted.labelB}
							selected={submitted.selected}
							streamUrlA={submitted.streamUrlA}
							streamUrlB={submitted.streamUrlB}
							isDifferentSong={submitted.isDifferentSong}
						/>
					</div>
					<!-- Settings: bottom-left (row 3) -->
					<div class="col-start-1 row-start-3 self-end justify-self-start">
						<ComparisonSettingsPopover
							enabledModes={enabledModes}
							allowDifferentSong={allowDifferentSong}
							setModeEnabled={setModeEnabled}
							onAllowDifferentSongChange={(v) => (allowDifferentSong = v)}
							onSave={handleSaveModes}
							transitionLabels={TRANSITION_LABELS}
							transitionTooltips={TRANSITION_TOOLTIPS}
						/>
					</div>
					<!-- Next + shortcuts tooltip (hover): bottom-center (row 3, same position as Confirm) -->
					<div
						class="col-start-2 row-start-3 flex flex-col items-center gap-2 self-end justify-self-center w-full max-w-xs"
					>
						<div class="hidden md:block">
							<Tooltip.Provider delayDuration={0}>
								<Tooltip.Root>
									<Tooltip.Trigger
										class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
										aria-label="Keyboard shortcuts"
									>
										Shortcuts
										<InfoIcon class="size-3.5" />
									</Tooltip.Trigger>
								<Tooltip.Portal>
									<Tooltip.Content
									arrowClasses="bg-popover"
									class="border-border bg-popover text-popover-foreground max-w-xs border shadow-md [&_kbd]:rounded-sm [&_kbd]:border [&_kbd]:border-border [&_kbd]:bg-muted [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-mono [&_kbd]:text-[0.65rem] [&_kbd]:font-medium [&_kbd]:text-foreground"
								>
										Press <kbd>Space</kbd> or <kbd>Enter</kbd> to continue
									</Tooltip.Content>
								</Tooltip.Portal>
							</Tooltip.Root>
						</Tooltip.Provider>
						</div>
						<button
							type="button"
							onclick={handleNext}
							disabled={submitting}
							class="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-6 py-3 text-sm font-medium transition-all disabled:opacity-50"
							aria-label="Next comparison"
						>
							{submitting ? 'Loading...' : 'Next'}
						</button>
					</div>
				</div>
			</div>
			{/if}
		</div>
	{/if}
</div>
