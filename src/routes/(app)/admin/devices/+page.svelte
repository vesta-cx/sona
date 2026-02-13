<script lang="ts">
	import { enhance } from '$app/forms';

	let { data } = $props();

	let filter = $state<'all' | 'approved' | 'pending'>('all');

	const filteredDevices = $derived(
		data.devices.filter((d) => {
			if (filter === 'approved') return d.approvedAt !== null;
			if (filter === 'pending') return d.approvedAt === null;
			return true;
		})
	);
</script>

<svelte:head>
	<title>Devices | Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Listening Devices</h1>
		<div class="flex gap-2">
			{#each ['all', 'approved', 'pending'] as f}
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors {filter === f
						? 'bg-primary text-primary-foreground'
						: 'bg-muted text-muted-foreground hover:bg-muted/80'}"
					onclick={() => (filter = f as typeof filter)}
				>
					{f.charAt(0).toUpperCase() + f.slice(1)}
				</button>
			{/each}
		</div>
	</div>

	{#if filteredDevices.length === 0}
		<p class="text-muted-foreground py-12 text-center text-sm">No devices found.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b">
						<th class="px-4 py-2 text-left font-medium">Brand / Model</th>
						<th class="px-4 py-2 text-left font-medium">Type</th>
						<th class="px-4 py-2 text-left font-medium">Connection</th>
						<th class="px-4 py-2 text-left font-medium">Tier</th>
						<th class="px-4 py-2 text-left font-medium">Status</th>
						<th class="px-4 py-2 text-left font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredDevices as device}
						<tr class="border-b">
							<td class="px-4 py-2">
								<span class="font-medium">{device.brand}</span>
								<span class="text-muted-foreground">{device.model}</span>
							</td>
							<td class="px-4 py-2 capitalize">{device.deviceType}</td>
							<td class="px-4 py-2 capitalize">{device.connectionType}</td>
							<td class="px-4 py-2 capitalize">{device.priceTier}</td>
							<td class="px-4 py-2">
								{#if device.approvedAt}
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
								{#if device.approvedAt}
									<form method="POST" action="?/reject" use:enhance>
										<input type="hidden" name="id" value={device.id} />
										<button type="submit" class="text-xs text-destructive hover:underline">
											Revoke
										</button>
									</form>
								{:else}
									<form method="POST" action="?/approve" use:enhance>
										<input type="hidden" name="id" value={device.id} />
										<button type="submit" class="text-primary text-xs hover:underline">
											Approve
										</button>
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
