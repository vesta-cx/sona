<script lang="ts">
	import {
		Section,
		SectionBackground,
		SectionContent
	} from '@vesta-cx/ui/components/layout/section';
	import * as StatCard from '@vesta-cx/ui/components/ui/stat-card';
	import * as Empty from '@vesta-cx/ui/components/ui/empty';
	import HeroCanvas from '$lib/components/hero-canvas.svelte';
	import PqLineChart from '$lib/components/pq-line-chart.svelte';
	import FlacVsLossyChart from '$lib/components/flac-vs-lossy-chart.svelte';
	import NeitherByDiffChart from '$lib/components/neither-by-diff-chart.svelte';
	import CodecDescriptions from '$lib/components/codec-descriptions.svelte';

	let { data } = $props();

	const snapshot = $derived(data.snapshot);
	const insights = $derived(snapshot?.insights as Record<string, unknown> | null);

	// Extract chart data from insights
	const codecWinRates = $derived(
		(insights?.codecWinRates as Record<string, number> | undefined) ?? {}
	);
	const btScores = $derived(
		(insights?.bradleyTerryScores as Record<string, number> | undefined) ?? {}
	);
	const deviceBreakdown = $derived(
		(insights?.deviceBreakdown as Record<string, number> | undefined) ?? {}
	);
	const heatmapData = $derived(
		(insights?.heatmap as Array<{ row: string; col: string; value: number }> | undefined) ?? []
	);
	const neitherRate = $derived((insights?.neitherRate as number | undefined) ?? 0);
	const flacVsLossy = $derived(
		(insights?.flacVsLossy as Record<string, Record<string, number>> | undefined) ?? {}
	);
	const neitherByBitrateDiff = $derived(
		(insights?.neitherByBitrateDiff as Record<string, number> | undefined) ?? {}
	);

	const codecs = ['FLAC', 'Opus', 'MP3', 'AAC'];
	const codecDescriptions: Record<string, string> = {
		FLAC: 'Lossless compression — bit-perfect reproduction of the original audio',
		Opus: 'Modern lossy codec — excellent quality at low bitrates, open standard',
		MP3: 'Legacy lossy codec — universal compatibility, less efficient than modern codecs',
		AAC: 'Lossy codec — default for Apple devices, better than MP3 at equivalent bitrates'
	};
</script>

<svelte:head>
	<title>Quality Survey — Which audio codec sounds best?</title>
	<meta
		name="description"
		content="Help us determine which audio codecs and bitrates sound best through blind A/B comparisons."
	/>
</svelte:head>

<!-- Hero Section -->
<Section data-section="hero" class="min-h-[max(calc(100svh-20rem),40rem)] justify-center items-center">
	<SectionBackground>
		<div
			class="from-primary/5 via-background to-primary/5 absolute inset-0 bg-linear-to-br"
		></div>
		<HeroCanvas waves={4} particles={96} />
		<div class="from-background absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t"></div>
	</SectionBackground>
	<SectionContent class="flex flex-col items-center text-center">
		<div class="mx-auto max-w-3xl">
			<h1 class="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
				Which audio codec
				<span class="text-primary">sounds best?</span>
			</h1>
			<p class="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg">
				Help us answer the age-old audiophile question through science. Listen to blind A/B
				comparisons and pick the one that sounds better to you. Your ears, your verdict.
			</p>
			<div class="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
				<a
					href="/survey/setup"
					class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-lg px-6 py-3 text-sm font-medium shadow-sm transition-colors"
				>
					Take the Survey
				</a>
				<a
					href="#results"
					class="text-muted-foreground hover:text-foreground inline-flex items-center rounded-lg px-6 py-3 text-sm font-medium transition-colors"
				>
					View Results ↓
				</a>
			</div>
		</div>
	</SectionContent>
</Section>

<!-- Stats Dashboard -->
<Section id="results">
	<SectionContent class="py-16">
		{#if snapshot}
			<div class="mb-12 text-center">
				<h2 class="text-3xl font-bold tracking-tight">Results So Far</h2>
				<p class="text-muted-foreground mt-2">
					Based on {snapshot.totalResponses.toLocaleString()} blind comparisons
				</p>
			</div>

			<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				<StatCard.StatCard label="Total Responses" value={snapshot.totalResponses} />

				{#if neitherRate > 0}
					<StatCard.StatCard
						label={'"Can\'t tell" rate'}
						value={`${(neitherRate * 100).toFixed(1)}%`}
						helper="Responses where listeners couldn't pick a winner"
					/>
				{/if}

				{#if Object.keys(codecWinRates).length > 0}
					<StatCard.StatCard label="Codec Preference" colSpan="md:col-span-2">
						<div class="space-y-3">
							{#each Object.entries(codecWinRates).sort(([, a], [, b]) => b - a) as [codec, rate]}
								<div class="flex items-center gap-3">
									<span class="w-12 text-sm font-medium">{codec.toUpperCase()}</span>
									<div class="bg-muted h-4 flex-1 overflow-hidden rounded-full">
										<div
											class="bg-primary h-full rounded-full transition-all"
											style="width: {Math.round(rate * 100)}%"
										></div>
									</div>
									<span class="text-muted-foreground w-12 text-right text-sm">
										{Math.round(rate * 100)}%
									</span>
								</div>
							{/each}
						</div>
					</StatCard.StatCard>
				{/if}

				{#if Object.keys(btScores).length > 0}
					<StatCard.StatCard
						label="Quality Rankings"
						helper="Bradley-Terry model scores"
					>
						<div class="space-y-2">
							{#each Object.entries(btScores).sort(([, a], [, b]) => b - a) as [key, score], i}
								<div class="flex items-center justify-between text-sm">
									<div class="flex items-center gap-2">
										<span class="text-muted-foreground w-5 text-xs">#{i + 1}</span>
										<span class="font-medium">{key}</span>
									</div>
									<span class="text-muted-foreground">{score.toFixed(2)}</span>
								</div>
							{/each}
						</div>
					</StatCard.StatCard>
				{/if}

				{#if heatmapData.length > 0}
					{#await import('@vesta-cx/ui/components/ui/heatmap') then { Heatmap }}
						<StatCard.StatCard
							label="Codec × Bitrate Win Rates"
							colSpan="md:col-span-2 lg:col-span-3"
						>
							<Heatmap
								data={heatmapData}
								rows={[...new Set(heatmapData.map((d) => d.row))]}
								cols={[...new Set(heatmapData.map((d) => d.col))]}
								rowLabel="Codec"
								colLabel="Bitrate (kbps)"
							/>
						</StatCard.StatCard>
					{/await}
				{/if}

				{#if Object.keys(deviceBreakdown).length > 0}
					<StatCard.StatCard label="Device Breakdown">
						<div class="space-y-2">
							{#each Object.entries(deviceBreakdown).sort(([, a], [, b]) => b - a) as [device, count]}
								<div class="flex items-center justify-between text-sm">
									<span>{device}</span>
									<span class="text-muted-foreground">{count}</span>
								</div>
							{/each}
						</div>
					</StatCard.StatCard>
				{/if}

				<!-- PQ (Perceptual Quality) Line Chart -->
				{#if Object.keys(btScores).length > 0}
					<div class="bg-card rounded-xl border p-6 md:col-span-2 lg:col-span-3">
						<PqLineChart scores={btScores} />
					</div>
				{/if}

				<!-- FLAC vs Lossy Transparency -->
				{#if Object.keys(flacVsLossy).length > 0}
					<div class="bg-card rounded-xl border p-6 md:col-span-2">
						<FlacVsLossyChart data={flacVsLossy} />
					</div>
				{/if}

				<!-- Neither by Bitrate Difference -->
				{#if Object.keys(neitherByBitrateDiff).length > 0}
					<div class="bg-card rounded-xl border p-6">
						<NeitherByDiffChart data={neitherByBitrateDiff} />
					</div>
				{/if}
			</div>

			<CodecDescriptions
				codecs={codecs}
				descriptions={codecDescriptions}
				class="mt-12"
			/>
		{:else}
			<div class="mx-auto max-w-md py-20">
				<Empty.Empty>
					<Empty.Media variant="icon">
						<span class="text-2xl">🎧</span>
					</Empty.Media>
					<Empty.Header>
						<Empty.Title>Not enough data yet</Empty.Title>
						<Empty.Description>
							We need more listening data before we can show meaningful visualizations.
							Every comparison you complete helps us build a clearer picture of how audio
							codecs are perceived.
						</Empty.Description>
					</Empty.Header>
					<Empty.Content>
						<a
							href="/survey/setup"
							class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center rounded-lg px-6 py-3 text-sm font-medium shadow-sm transition-colors"
						>
							Be one of the first to contribute
						</a>
					</Empty.Content>
				</Empty.Empty>
			</div>

			<CodecDescriptions
				codecs={codecs}
				descriptions={codecDescriptions}
				class="mt-8"
			/>
		{/if}
	</SectionContent>
</Section>
