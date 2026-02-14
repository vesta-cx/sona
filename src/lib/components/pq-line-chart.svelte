<script lang="ts">
	/**
	 * Perceptual Quality (PQ) line chart from Bradley-Terry scores.
	 * X-axis: bitrate (kbps), Y-axis: normalized PQ score (0–100%).
	 * One line per codec; shows diminishing returns and cross-codec equivalence.
	 */
	interface DataPoint {
		bitrate: number;
		pq: number;
	}

	let {
		scores,
		codecColors = {},
		class: className = ''
	}: {
		scores: Record<string, number>;
		codecColors?: Record<string, string>;
		class?: string;
	} = $props();

	const DEFAULT_COLORS: Record<string, string> = {
		flac: 'oklch(0.55 0.2 250)',
		opus: 'oklch(0.55 0.18 150)',
		aac: 'oklch(0.55 0.2 30)',
		mp3: 'oklch(0.55 0.2 0)'
	};

	const series = $derived.by(() => {
		const pointsByCodec: Record<string, DataPoint[]> = {};
		const allScores = Object.values(scores);
		const maxScore = Math.max(...allScores, 1);

		for (const [key, score] of Object.entries(scores)) {
			const [codec, bitrateStr] = key.split('_');
			const bitrate = parseInt(bitrateStr ?? '0', 10);
			if (Number.isNaN(bitrate)) continue;

			const pq = maxScore > 0 ? (score / maxScore) * 100 : 0;
			pointsByCodec[codec] = pointsByCodec[codec] ?? [];
			pointsByCodec[codec].push({ bitrate, pq });
		}

		for (const arr of Object.values(pointsByCodec)) {
			arr.sort((a, b) => a.bitrate - b.bitrate);
		}

		return Object.entries(pointsByCodec)
			.filter(([, pts]) => pts.length > 0)
			.map(([codec, pts]) => ({ codec, points: pts }));
	});

	const width = 400;
	const height = 240;
	const padding = { top: 20, right: 20, bottom: 36, left: 44 };

	const xDomain = $derived.by(() => {
		const allBitrates = series.flatMap((s) => s.points.map((p) => p.bitrate));
		const min = Math.min(0, ...allBitrates);
		const max = Math.max(320, ...allBitrates);
		return [min, max];
	});

	const xScale = (v: number) =>
		padding.left +
		((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * (width - padding.left - padding.right);
	const yScale = (v: number) =>
		padding.top +
		height -
		padding.top -
		padding.bottom -
		(v / 100) * (height - padding.top - padding.bottom);

	const pathForSeries = (points: DataPoint[]) => {
		if (points.length === 0) return '';
		const first = points[0];
		let d = `M ${xScale(first.bitrate)} ${yScale(first.pq)}`;
		for (let i = 1; i < points.length; i++) {
			d += ` L ${xScale(points[i].bitrate)} ${yScale(points[i].pq)}`;
		}
		return d;
	};

	const xTicks = [0, 64, 128, 192, 256, 320].filter((t) => t >= xDomain[0] && t <= xDomain[1]);
	const yTicks = [0, 25, 50, 75, 100];
</script>

<div class={className}>
	<h3 class="text-muted-foreground text-sm font-medium">Perceptual Quality by Bitrate</h3>
	<p class="text-muted-foreground mt-0.5 text-xs">
		Bradley-Terry scores (normalized). Higher = more preferred. Where curves flatten ≈ diminishing returns.
	</p>
	<svg
		viewBox="0 0 {width} {height}"
		class="mt-4 w-full max-w-full"
		aria-label="Perceptual quality curves by codec and bitrate"
	>
		<!-- Grid -->
		{#each yTicks.slice(1, -1) as tick}
			<line
				x1={padding.left}
				y1={yScale(tick)}
				x2={width - padding.right}
				y2={yScale(tick)}
				class="stroke-border"
				stroke-width="0.5"
				stroke-dasharray="4"
			/>
		{/each}
		{#each xTicks.slice(1, -1) as tick}
			<line
				x1={xScale(tick)}
				y1={padding.top}
				x2={xScale(tick)}
				y2={height - padding.bottom}
				class="stroke-border"
				stroke-width="0.5"
				stroke-dasharray="4"
			/>
		{/each}

		<!-- 50% reference -->
		<line
			x1={padding.left}
			y1={yScale(50)}
			x2={width - padding.right}
			y2={yScale(50)}
			class="stroke-muted-foreground/40"
			stroke-width="1"
			stroke-dasharray="6"
		/>

		<!-- Lines -->
		{#each series as { codec, points } (codec)}
			{@const color = codecColors[codec] ?? DEFAULT_COLORS[codec] ?? 'currentColor'}
			<path
				d={pathForSeries(points)}
				fill="none"
				stroke={color}
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/each}

		<!-- Axes -->
		<line
			x1={padding.left}
			y1={height - padding.bottom}
			x2={width - padding.right}
			y2={height - padding.bottom}
			class="stroke-foreground"
			stroke-width="1"
		/>
		<line
			x1={padding.left}
			y1={padding.top}
			x2={padding.left}
			y2={height - padding.bottom}
			class="stroke-foreground"
			stroke-width="1"
		/>

		<!-- X labels -->
		{#each xTicks as tick}
			<text
				x={xScale(tick)}
				y={height - 8}
				class="fill-muted-foreground text-[10px]"
				text-anchor="middle"
			>
				{tick === 0 ? 'FLAC' : tick}
			</text>
		{/each}

		<!-- Y labels -->
		{#each yTicks as tick}
			<text
				x={padding.left - 6}
				y={yScale(tick) + 3}
				class="fill-muted-foreground text-[10px]"
				text-anchor="end"
			>
				{tick}%
			</text>
		{/each}
	</svg>

	<!-- Legend -->
	<div class="mt-2 flex flex-wrap gap-3 text-xs">
		{#each series as { codec } (codec)}
			{@const color = codecColors[codec] ?? DEFAULT_COLORS[codec] ?? 'currentColor'}
			<div class="flex items-center gap-1.5">
				<span
					class="inline-block size-2.5 rounded-full"
					style="background-color: {color}"
				></span>
				<span class="capitalize">{codec}</span>
			</div>
		{/each}
	</div>
</div>
