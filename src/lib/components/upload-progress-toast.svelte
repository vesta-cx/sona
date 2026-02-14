<script lang="ts">
	import { uploadProgress } from '$lib/stores/upload-progress';

	const pct = $derived($uploadProgress ?? 0);
	const isProcessing = $derived(pct >= 100);
</script>

<div class="card flex min-w-64 flex-col gap-2">
	<p class="text-sm font-medium">
		{#if isProcessing}
			Processing on server…
		{:else}
			Uploading… {pct}%
		{/if}
	</p>
	<div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
		{#if isProcessing}
			<div
				class="bg-primary h-full rounded-full animate-pulse"
				style="width: 100%"
			></div>
		{:else}
			<div
				class="bg-primary h-full rounded-full transition-[width] duration-150 ease-out"
				style="width: {pct}%"
			></div>
		{/if}
	</div>
</div>
