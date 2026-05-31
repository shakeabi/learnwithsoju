<script lang="ts">
  import type { MecabToken } from '$types/messages';

  let { tokens }: { tokens: MecabToken[] } = $props();

  const COLUMNS: Array<{ label: string; key: keyof MecabToken; cls?: string }> = [
    { label: 'Surface', key: 'surface', cls: 'col-surface' },
    { label: 'POS', key: 'pos' },
    { label: 'Type', key: 'type' },
    { label: 'First pos', key: 'firstPos' },
    { label: 'Last pos', key: 'lastPos' },
    { label: 'Decomp', key: 'decomp', cls: 'col-decomp' },
    { label: 'Reading', key: 'reading' },
    { label: 'Full features', key: 'features', cls: 'col-features' },
  ];
</script>

<table class="token-table">
  <thead>
    <tr>
      {#each COLUMNS as col (col.key)}
        <th>{col.label}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each tokens as tok, i (i)}
      <tr>
        {#each COLUMNS as col (col.key)}
          <td class={col.cls || ''} title={col.key === 'features' ? (tok.features || '') : ''}>{tok[col.key] || ''}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
