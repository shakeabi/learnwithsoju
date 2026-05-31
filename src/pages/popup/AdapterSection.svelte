<script lang="ts">
  // Looks up SITE_CONFIGS for the active tab's hostname; if it declares
  // a `popupModule`, dynamic-imports that module and hands it the section
  // container via the same renderSection({tab, href, container}) API the
  // original popup.js used. Adapters render their own DOM into the
  // container imperatively — keeping the adapter contract identical means
  // youtube/popup.js and netflix/popup.js need no migration changes.

  let { host, tab, href }: { host: string; tab: any; href: string } = $props();

  let containerEl: HTMLElement | undefined;
  let visible = $state(false);

  $effect(() => {
    if (!host || !tab || !containerEl) return;
    let cancelled = false;
    (async () => {
      let findSiteConfig: (h: string) => any;
      try {
        const mod = await import(/* @vite-ignore */ chrome.runtime.getURL('core/site-configs.js'));
        findSiteConfig = mod.findSiteConfig;
      } catch (err) {
        console.warn('[lws] popup AdapterSection: site-configs import failed', err);
        return;
      }
      const cfg = findSiteConfig(host);
      if (!cfg || !cfg.popupModule) return;
      let popupMod;
      try {
        popupMod = await import(/* @vite-ignore */ chrome.runtime.getURL(cfg.popupModule));
      } catch (err) {
        console.warn('[lws] popup AdapterSection: adapter popup module import failed', err);
        return;
      }
      if (!popupMod || typeof popupMod.renderSection !== 'function') return;
      if (cancelled || !containerEl) return;
      visible = true;
      try {
        await popupMod.renderSection({ tab, href, container: containerEl });
      } catch (err) {
        console.warn('[learnwithsoju] popupModule failed:', err);
      }
    })();
    return () => { cancelled = true; };
  });
</script>

<section class="adapter-section" hidden={!visible} bind:this={containerEl}></section>
