<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Admin Dashboard | Quality Survey</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Admin Dashboard</h1>
	<p class="text-muted-foreground">
		Welcome back, {data.session?.email}. Use the sidebar to manage the survey.
	</p>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<a
			href="/admin/devices"
			class="bg-card hover:bg-muted/50 rounded-xl border p-6 transition-colors"
		>
			<h3 class="font-medium">Devices</h3>
			<p class="text-muted-foreground mt-1 text-sm">Manage listening devices</p>
		</a>
		<a
			href="/admin/sources"
			class="bg-card hover:bg-muted/50 rounded-xl border p-6 transition-colors"
		>
			<h3 class="font-medium">Sources</h3>
			<p class="text-muted-foreground mt-1 text-sm">Upload and manage audio files</p>
		</a>
		<a
			href="/admin/quality-options"
			class="bg-card hover:bg-muted/50 rounded-xl border p-6 transition-colors"
		>
			<h3 class="font-medium">Quality Options</h3>
			<p class="text-muted-foreground mt-1 text-sm">Toggle codec+bitrate permutations</p>
		</a>
		<a
			href="/admin/snapshots"
			class="bg-card hover:bg-muted/50 rounded-xl border p-6 transition-colors"
		>
			<h3 class="font-medium">Snapshots</h3>
			<p class="text-muted-foreground mt-1 text-sm">View results and trigger snapshots</p>
		</a>
		<a
			href="/admin/storage"
			class="bg-card hover:bg-muted/50 rounded-xl border p-6 transition-colors"
		>
			<h3 class="font-medium">R2 Storage</h3>
			<p class="text-muted-foreground mt-1 text-sm">Inspect object keys in the audio bucket</p>
		</a>
	</div>
</div>
