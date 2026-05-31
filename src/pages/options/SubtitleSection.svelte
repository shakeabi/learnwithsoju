<script lang="ts">
  import { settings, setSetting } from '$lib/storage.svelte';

  const SECONDARY_LANG_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'ja', label: 'Japanese' },
    { value: 'zh', label: 'Chinese (Simplified)' },
    { value: 'zh-TW', label: 'Chinese (Traditional)' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'ru', label: 'Russian' },
    { value: 'ar', label: 'Arabic' },
    { value: 'hi', label: 'Hindi' },
    { value: 'id', label: 'Indonesian' },
    { value: 'vi', label: 'Vietnamese' },
    { value: 'th', label: 'Thai' },
    { value: 'tr', label: 'Turkish' },
    { value: 'nl', label: 'Dutch' },
    { value: 'pl', label: 'Polish' },
    { value: 'off', label: 'Off (Korean only)' },
  ];

  async function onYouTubeToggle(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    await setSetting('dualSubsYouTube', v);
  }

  async function onNetflixToggle(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).checked;
    await setSetting('dualSubsNetflix', v);
  }

  async function onSecondaryLangChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    await setSetting('secondaryLang', v);
  }
</script>

<section class="card">
  <h2>Behaviour</h2>
  <label class="checkbox">
    <input type="checkbox" checked={settings.value.dualSubsYouTube} onchange={onYouTubeToggle} />
    <span>Dual subtitles on YouTube
      <em class="note">replaces YouTube's captions with a Korean + secondary-language overlay</em>
    </span>
  </label>

  <label class="checkbox">
    <input type="checkbox" checked={settings.value.dualSubsNetflix} onchange={onNetflixToggle} />
    <span>Dual subtitles on Netflix
      <em class="note">replaces Netflix's captions with a Korean + secondary-language overlay</em>
    </span>
  </label>

  <label class="field">
    <span class="label">Default secondary subtitle language</span>
    <select value={settings.value.secondaryLang} onchange={onSecondaryLangChange}>
      {#each SECONDARY_LANG_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="field-note">
      The toolbar popup lets you override this per-video (YouTube) or per-title (Netflix) when more than one secondary track is available.
    </p>
  </label>
</section>
