<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// Unique brands from approved devices
	const uniqueBrands = $derived(
		[...new Set(data.approvedDevices.map((d) => d.brand))].filter(Boolean).sort((a, b) => a.localeCompare(b))
	);

	let brand = $state('');
	let model = $state('');
	let deviceType = $state('');
	let connectionType = $state('');
	let priceTier = $state('');

	/** When brand exactly matches a known one, filter models to that brand only */
	const brandIsExactMatch = $derived(
		uniqueBrands.some((b) => b.toLowerCase() === brand.trim().toLowerCase())
	);
	const modelsForBrand = $derived(
		brand.trim() && brandIsExactMatch
			? [...new Set(data.approvedDevices.filter((d) => d.brand.toLowerCase() === brand.trim().toLowerCase()).map((d) => d.model))].filter(Boolean).sort((a, b) => a.localeCompare(b))
			: brand.trim()
				? [...new Set(data.approvedDevices.filter((d) => d.brand.toLowerCase().includes(brand.trim().toLowerCase())).map((d) => d.model))].filter(Boolean).sort((a, b) => a.localeCompare(b))
				: [...new Set(data.approvedDevices.map((d) => d.model))].filter(Boolean).sort((a, b) => a.localeCompare(b))
	);

	/** Devices matching model exactly (case-insensitive) */
	const devicesMatchingModel = $derived(
		model.trim()
			? data.approvedDevices.filter((d) => d.model.toLowerCase() === model.trim().toLowerCase())
			: []
	);
	/** Devices matching brand+model exactly */
	const devicesMatchingBrandModel = $derived(
		brand.trim() && model.trim()
			? data.approvedDevices.filter(
					(d) =>
						d.brand.toLowerCase() === brand.trim().toLowerCase() &&
						d.model.toLowerCase() === model.trim().toLowerCase()
				)
			: []
	);
	/** Uniquely resolved device: model alone or brand+model identifies exactly one */
	const resolvedDevice = $derived(
		devicesMatchingBrandModel.length === 1
			? devicesMatchingBrandModel[0]!
			: devicesMatchingModel.length === 1
				? devicesMatchingModel[0]!
				: null
	);

	// Fuzzy filter brands as user types
	const brandSuggestions = $derived.by(() => {
		if (brand.trim().length < 2) return [];
		const matches = uniqueBrands.filter((b) => b.toLowerCase().includes(brand.trim().toLowerCase())).slice(0, 8);
		const exact = matches.some((b) => b.toLowerCase() === brand.trim().toLowerCase());
		return exact ? [] : matches;
	});

	// Fuzzy filter models as user types
	const modelSuggestions = $derived.by(() => {
		if (model.trim().length < 2) return [];
		const matches = modelsForBrand.filter((m) => m.toLowerCase().includes(model.trim().toLowerCase())).slice(0, 8);
		const exact = matches.some((m) => m.toLowerCase() === model.trim().toLowerCase());
		return exact ? [] : matches;
	});

	// Auto-fill all fields when device is uniquely resolved
	$effect(() => {
		if (resolvedDevice) {
			brand = resolvedDevice.brand;
			model = resolvedDevice.model;
			deviceType = resolvedDevice.deviceType;
			connectionType = resolvedDevice.connectionType;
			priceTier = resolvedDevice.priceTier;
		}
	});
</script>

<svelte:head>
	<title>Setup Your Device | Quality Survey</title>
</svelte:head>

<div class="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-12">
	<div class="w-full space-y-6">
		<div class="text-center">
			<h1 class="text-3xl font-bold tracking-tight">Set Up Your Device</h1>
			<p class="text-muted-foreground mt-2">
				Tell us about your listening setup so we can group results accurately.
			</p>
		</div>

		{#if form?.error}
			<div class="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
				{form.error}
			</div>
		{/if}

		{#if data.existingDevice && !resolvedDevice}
			<!-- Summary view: device from cookie, confirm to start or change -->
			<form method="POST" use:enhance class="space-y-4">
				<input type="hidden" name="device_id" value={data.existingDevice.id} />
				<div class="border-input rounded-lg border bg-muted/30 p-4 space-y-1">
					<p class="font-medium">{data.existingDevice.brand} {data.existingDevice.model}</p>
					<p class="text-muted-foreground text-sm">
						{data.existingDevice.subtitle}
					</p>
					<p class="text-muted-foreground text-xs mt-2">Device matched from your selection. Click below to start.</p>
					<a
						href="/survey/setup?change=1"
						class="text-muted-foreground hover:text-foreground mt-2 inline-block text-xs underline"
					>
						Change device
					</a>
				</div>
				<button
					type="submit"
					class="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-4 py-3 text-sm font-medium shadow-sm transition-colors"
				>
					Start the Survey
				</button>
			</form>
		{:else}
		<form method="POST" use:enhance class="space-y-4">
			{#if resolvedDevice}
				<input type="hidden" name="device_id" value={resolvedDevice.id} />
				<input type="hidden" name="device_type" value={resolvedDevice.deviceType} />
				<input type="hidden" name="connection_type" value={resolvedDevice.connectionType} />
				<input type="hidden" name="brand" value={resolvedDevice.brand} />
				<input type="hidden" name="model" value={resolvedDevice.model} />
				<input type="hidden" name="price_tier" value={resolvedDevice.priceTier} />
				<div class="border-input rounded-lg border bg-muted/30 p-4 space-y-1">
					<p class="font-medium">{resolvedDevice.brand} {resolvedDevice.model}</p>
					<p class="text-muted-foreground text-sm capitalize">
						{resolvedDevice.deviceType} · {resolvedDevice.connectionType} · {resolvedDevice.priceTier}
					</p>
					<p class="text-muted-foreground text-xs mt-2">Device matched from your selection. Click below to start.</p>
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground mt-2 text-xs underline"
						onclick={() => {
							brand = '';
							model = '';
							deviceType = '';
							connectionType = '';
							priceTier = '';
						}}
					>
						Change device
					</button>
				</div>
			{:else}
			<div class="space-y-2">
				<label for="device_type" class="text-sm font-medium">Device Type</label>
				<select
					id="device_type"
					name="device_type"
					required
					bind:value={deviceType}
					class="border-input bg-background ring-offset-background focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2"
				>
					<option value="">Select...</option>
					{#each data.deviceTypes as type}
						<option value={type}>{type === 'speaker' ? 'Speaker(s)' : 'Headphones'}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-2">
				<label for="connection_type" class="text-sm font-medium">Connection Type</label>
				<select
					id="connection_type"
					name="connection_type"
					required
					bind:value={connectionType}
					class="border-input bg-background ring-offset-background focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2"
				>
					<option value="">Select...</option>
					{#each data.connectionTypes as type}
						<option value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
					{/each}
				</select>
			</div>

			<div class="space-y-2">
				<label for="brand" class="text-sm font-medium">Brand</label>
				<div class="relative">
					<input
						id="brand"
						name="brand"
						type="text"
						required
						bind:value={brand}
						list="brand-list"
						autocomplete="off"
						placeholder="e.g. Sony, Sennheiser, Apple"
						class="border-input bg-background ring-offset-background focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2"
					/>
					<datalist id="brand-list">
						{#each uniqueBrands as b}
							<option value={b}></option>
						{/each}
					</datalist>
					{#if brandSuggestions.length > 0}
						<ul
							class="border-input bg-popover text-popover-foreground absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border py-1 shadow-md"
							role="listbox"
						>
							{#each brandSuggestions as b}
								<li
									role="option"
									aria-selected="false"
									tabindex="-1"
									class="cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
									onclick={() => (brand = b)}
									onkeydown={(e) => e.key === 'Enter' && (brand = b)}
								>
									{b}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				{#if uniqueBrands.length > 0}
					<p class="text-muted-foreground text-xs">Start typing to match existing approved devices</p>
				{/if}
			</div>

			<div class="space-y-2">
				<label for="model" class="text-sm font-medium">Model</label>
				<div class="relative">
					<input
						id="model"
						name="model"
						type="text"
						required
						bind:value={model}
						list="model-list"
						autocomplete="off"
						placeholder="e.g. WH-1000XM5, HD 600"
						class="border-input bg-background ring-offset-background focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2"
					/>
					<datalist id="model-list">
						{#each modelsForBrand as m}
							<option value={m}></option>
						{/each}
					</datalist>
					{#if modelSuggestions.length > 0}
						<ul
							class="border-input bg-popover text-popover-foreground absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border py-1 shadow-md"
							role="listbox"
						>
							{#each modelSuggestions as m}
								<li
									role="option"
									aria-selected="false"
									tabindex="-1"
									class="cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
									onclick={() => (model = m)}
									onkeydown={(e) => e.key === 'Enter' && (model = m)}
								>
									{m}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>

			<div class="space-y-2">
				<label for="price_tier" class="text-sm font-medium">Price Tier</label>
				<select
					id="price_tier"
					name="price_tier"
					required
					bind:value={priceTier}
					class="border-input bg-background ring-offset-background focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2"
				>
					<option value="">Select...</option>
					{#each data.priceTiers as tier}
						<option value={tier}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</option>
					{/each}
				</select>
			</div>
			{/if}

			<button
				type="submit"
				class="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-4 py-3 text-sm font-medium shadow-sm transition-colors"
			>
				Start the Survey
			</button>
		</form>
		{/if}
	</div>
</div>
