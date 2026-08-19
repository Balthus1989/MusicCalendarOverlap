<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		label: string;
		name: string;
		value?: string | number | null;
		type?: string;
		required?: boolean;
		hint?: string;
		placeholder?: string;
		min?: number;
		max?: number;
		rows?: number;
		options?: ReadonlyArray<{ value: string; label: string }>;
		children?: Snippet;
	};

	let {
		label,
		name,
		value = $bindable(''),
		type = 'text',
		required = false,
		hint,
		placeholder,
		min,
		max,
		rows,
		options
	}: Props = $props();

	const base =
		'border-input bg-background ring-ring/40 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none';
</script>

<div class="space-y-1.5">
	<label class="text-sm font-medium" for={name}>
		{label}
		{#if !required}<span class="text-muted-foreground font-normal"> · facoltativo</span>{/if}
	</label>

	{#if options}
		<select id={name} {name} {required} class={base}>
			{#each options as opt (opt.value)}
				<option value={opt.value} selected={String(value) === opt.value}>{opt.label}</option>
			{/each}
		</select>
	{:else if rows}
		<textarea id={name} {name} {required} {rows} {placeholder} class={base} bind:value></textarea>
	{:else}
		<!-- `bind:value` non è ammesso su un input con `type` dinamico: la
		     scrittura esplicita fa la stessa cosa senza vincolare il tipo. -->
		<input
			id={name}
			{name}
			{type}
			{required}
			{placeholder}
			{min}
			{max}
			value={value ?? ''}
			oninput={(e) => (value = e.currentTarget.value)}
			class={base}
		/>
	{/if}

	{#if hint}
		<p class="text-muted-foreground text-xs">{hint}</p>
	{/if}
</div>
