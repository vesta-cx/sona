<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const isSegmentDurationSaved = $derived(
		form && 'segmentDurationSaved' in form && form.segmentDurationSaved === true
	);
</script>

<svelte:head>
	<title>Pairing Weights | Admin</title>
</svelte:head>

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-bold">Pairing Weights</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Control how often each pairing type appears in the survey. Weights are relative (e.g. 7:2:1 →
			70% same song, 20% different, 10% placebo).
		</p>
	</div>

	{#if form?.success}
		<div
			class="rounded-lg border bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200"
		>
			{isSegmentDurationSaved ? 'Segment duration saved.' : 'Weights saved.'}
		</div>
	{/if}
	{#if form?.error}
		<div
			class="rounded-lg border bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200"
		>
			{form.error}
		</div>
	{/if}

	{#if data.weights}
		<form method="POST" action="?/save" use:enhance class="space-y-4">
			<div class="bg-card max-w-md rounded-xl border p-4 space-y-4">
				{#each data.pairingTypes as p (p)}
					{@const label = data.labels[p]}
					{@const weight = data.weights[p]}
					<div class="flex items-center justify-between gap-4">
						<label for={`weight_${p}`} class="text-sm font-medium">{label}</label>
						<input
							id={`weight_${p}`}
							name={`weight_${p}`}
							type="number"
							min="0"
							max="100"
							step="0.1"
							value={weight}
							class="bg-background border-input w-24 rounded-md border px-2 py-1.5 text-sm"
						/>
					</div>
				{/each}
			</div>
			<button
				type="submit"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium"
			>
				Save weights
			</button>
		</form>

		<div class="border-t pt-8">
			<h2 class="text-lg font-semibold">Segment duration</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				Length of each comparison segment in seconds. Applies to new rounds. Range: 1–120 s.
			</p>
			{#if data.segmentDurationMs != null}
				<form
					method="POST"
					action="?/saveSegmentDuration"
					use:enhance
					class="mt-4 flex flex-wrap items-end gap-4"
				>
					<div class="flex items-center gap-2">
						<label for="segment_duration_ms" class="text-sm font-medium">Duration (ms)</label>
						<input
							id="segment_duration_ms"
							name="segment_duration_ms"
							type="number"
							min="1000"
							max="120000"
							step="1000"
							value={data.segmentDurationMs}
							class="bg-background border-input w-28 rounded-md border px-2 py-1.5 text-sm"
						/>
					</div>
					<span class="text-muted-foreground text-sm">
						({(data.segmentDurationMs / 1000).toFixed(1)} s)
					</span>
					<button
						type="submit"
						class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium"
					>
						Save duration
					</button>
				</form>
			{/if}
		</div>
	{:else}
		<p class="text-muted-foreground py-8 text-sm">
			No database connection (e.g. running outside Workers).
		</p>
	{/if}
</div>
