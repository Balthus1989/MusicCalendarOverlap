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
		/**
		 * Per i campi che un altro campo può riempire — la città che segue il
		 * locale scelto, per esempio. In quei casi il valore arriva da fuori e
		 * `bind:value` non basta.
		 */
		onInput?: (valore: string) => void;
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
		options,
		onInput
	}: Props = $props();

	const base =
		'border-input bg-background ring-ring/40 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none';

	/**
	 * Il valore di partenza, letto una volta sola. Svelte scrive `value` come
	 * proprietà del nodo e non come attributo: senza `defaultValue` il campo
	 * nasce senza valore predefinito, e il `reset()` che `use:enhance` fa da sé
	 * dopo un invio riuscito lo svuota invece di riportarlo com'era. Resta una
	 * fotografia dell'inizio: se seguisse `value`, il reset riporterebbe
	 * l'ultima cosa digitata invece dell'originale.
	 */
	const valoreIniziale = String(value ?? '');
</script>

<div class="space-y-1.5">
	<label class="text-sm font-medium" for={name}>
		{label}
		{#if !required}<span class="text-muted-foreground font-normal"> · facoltativo</span>{/if}
	</label>

	{#if options}
		<!-- `onchange` e non `oninput`: su un `<select>` i due coincidono nei
		     browser attuali, ma `change` è quello che il menù a tendina
		     garantisce da sempre. Senza questo, `onInput` esisteva come prop e
		     non veniva mai chiamato per i select — cioè proprio dove serve di
		     più, perché un menù è il campo che più spesso ne comanda un altro. -->
		<select
			id={name}
			{name}
			{required}
			class={base}
			onchange={(e) => {
				value = e.currentTarget.value;
				onInput?.(e.currentTarget.value);
			}}
		>
			{#each options as opt (opt.value)}
				<option value={opt.value} selected={String(value) === opt.value}>{opt.label}</option>
			{/each}
		</select>
	{:else if rows}
		<textarea
			id={name}
			{name}
			{required}
			{rows}
			{placeholder}
			class={base}
			value={value ?? ''}
			defaultValue={valoreIniziale}
			oninput={(e) => {
				value = e.currentTarget.value;
				onInput?.(e.currentTarget.value);
			}}></textarea>
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
			defaultValue={valoreIniziale}
			oninput={(e) => {
				value = e.currentTarget.value;
				onInput?.(e.currentTarget.value);
			}}
			class={base}
		/>
	{/if}

	{#if hint}
		<p class="text-muted-foreground text-xs">{hint}</p>
	{/if}
</div>
