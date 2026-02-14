<script lang="ts">
	import * as CheckboxWithInfo from '@vesta-cx/ui/components/ui/checkbox-with-info';
	import * as Popover from '@vesta-cx/ui/components/ui/popover';
	import { ThemeSwitcher } from '@vesta-cx/ui/components/utils/theme-switcher';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	let {
		enabledModes,
		allowDifferentSong,
		setModeEnabled,
		onAllowDifferentSongChange,
		onSave,
		transitionLabels,
		transitionTooltips,
		modes = ['gapless', 'gap_continue', 'gap_restart']
	}: {
		enabledModes: string[];
		allowDifferentSong: boolean;
		setModeEnabled: (mode: string, checked: boolean) => void;
		onAllowDifferentSongChange: (checked: boolean) => void;
		onSave: () => void;
		transitionLabels: Record<string, string>;
		transitionTooltips: Record<string, string>;
		modes?: string[];
	} = $props();
</script>

<Popover.Root>
	<Popover.Trigger
		class="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring"
		aria-label="Comparison settings"
	>
		<SettingsIcon class="size-5" />
	</Popover.Trigger>
	<Popover.Content class="w-72 p-4" align="start" side="top">
		<div class="mb-4">
			<ThemeSwitcher.Root variant="inline" class="w-full" />
		</div>
		<p class="text-muted-foreground mb-3 text-sm font-medium">
			Comparison modes
		</p>
		<p class="text-muted-foreground mb-3 text-xs">
			Enable or disable transition types. Changes apply to the next round.
		</p>
		<div class="flex flex-col gap-2">
			{#each modes as mode}
				<CheckboxWithInfo.Root
					label={transitionLabels[mode] ?? mode}
					checked={enabledModes.includes(mode)}
					onCheckedChange={(v) => setModeEnabled(mode, v)}
					infoContent={transitionTooltips[mode]}
				/>
			{/each}
		</div>
		<CheckboxWithInfo.Root
			label="Compare different songs"
			checked={allowDifferentSong}
			onCheckedChange={onAllowDifferentSongChange}
			infoContent="When enabled, some comparisons will pit two different tracks against each other. Disable to only compare encodings of the same song."
			class="mt-3"
		/>
		<button
			type="button"
			onclick={onSave}
			class="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 w-full rounded-md px-3 py-2 text-sm font-medium"
		>
			Save
		</button>
	</Popover.Content>
</Popover.Root>
