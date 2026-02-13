<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Snapshots | Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Result Snapshots</h1>
		<form method="POST" action="?/trigger" use:enhance>
			<button
				type="submit"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium"
			>
				Trigger Snapshot
			</button>
		</form>
	</div>

	{#if form?.success}
		<div class="rounded-lg border bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200">
			Snapshot generated successfully!
		</div>
	{/if}

	{#if data.snapshots.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">
			No snapshots yet. Trigger one manually or wait for the cron job.
		</p>
	{:else}
		<div class="space-y-4">
			{#each data.snapshots as snapshot}
				<div class="bg-card rounded-xl border p-4">
					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">
								{snapshot.createdAt?.toLocaleString() ?? 'Unknown'}
							</p>
							<p class="text-muted-foreground text-xs">
								{snapshot.totalResponses} responses
							</p>
						</div>
						<div>
							{#if snapshot.expiresAt && snapshot.expiresAt > new Date()}
								<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">
									Active
								</span>
							{:else}
								<span class="text-muted-foreground rounded-full bg-muted px-2 py-0.5 text-xs">
									Expired
								</span>
							{/if}
						</div>
					</div>
					{#if snapshot.insights}
						<details class="mt-2">
							<summary class="text-muted-foreground cursor-pointer text-xs">
								View insights JSON
							</summary>
							<pre class="bg-muted mt-2 overflow-x-auto rounded-md p-2 text-xs">
								{JSON.stringify(snapshot.insights, null, 2)}
							</pre>
						</details>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
