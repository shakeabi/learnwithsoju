import { mount } from 'svelte';
import './styles/tokens.css';
import App from './App.svelte';
import type { OverlayFrame, OverlayApi } from '$types/overlay';

/**
 * Mount the overlay Svelte component into the shadow root that content.js
 * has already prepared (it created `#lws-overlay-root` inside the
 * extension's shadow host). Then register the imperative API on
 * window.__lwsOverlay so content.js can drive show/hide/update from the
 * bridge realm.
 *
 * Realm note: in MV3, content scripts share an isolated `window` per
 * extension id. content.js (a content_script) and this bundle (loaded
 * via dynamic import of a web_accessible_resource) both run in that
 * isolated world, so this `window` is the same `window` content.js sees.
 */

// Look up the mount point. content.js attached the shadow root to the
// host element and put `<div id="lws-overlay-root">` inside it. We find
// it by traversing every `.lws-host` element on the page — the overlay
// host is the one with our specific id inside its shadow root.
function findMountPoint(): HTMLElement | null {
  const hosts = document.documentElement.querySelectorAll('.lws-host');
  for (const host of hosts) {
    const root = (host as HTMLElement).shadowRoot;
    if (root) {
      const target = root.getElementById('lws-overlay-root');
      if (target) return target;
    }
  }
  return null;
}

const target = findMountPoint();
if (!target) {
  console.warn('[lws] overlay/main.ts: mount point not found');
} else {
  // App.svelte exposes its imperative API by writing to window.__lwsOverlay
  // during mount via $effect. We just mount and let it self-register.
  mount(App, { target });
}

// Defensive: if for any reason App.svelte didn't manage to register the
// global, install a no-op fallback so content.js's `if (window.__lwsOverlay)`
// guard treats the overlay as available but every call is a silent no-op.
setTimeout(() => {
  if (!window.__lwsOverlay) {
    const noop: OverlayApi = {
      show(_f: OverlayFrame) { /* no-op */ },
      hide() { /* no-op */ },
      update(_p) { /* no-op */ },
    };
    window.__lwsOverlay = noop;
    console.warn('[lws] overlay/main.ts: App.svelte did not register window.__lwsOverlay; installed no-op fallback');
  }
}, 0);
