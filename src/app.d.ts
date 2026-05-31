// Ambient declarations for the Chrome extension API and Svelte/CSS imports.
//
// We intentionally don't pull in @types/chrome — only a tiny surface of the
// extension API is reached from Svelte components (chrome.runtime.sendMessage,
// chrome.storage.sync, chrome.storage.onChanged, chrome.runtime.getURL,
// chrome.runtime.getManifest, chrome.runtime.openOptionsPage, chrome.tabs.query,
// chrome.tabs.sendMessage). Declaring it as `any` here keeps the boundary
// narrow and avoids type drift against a published @types package.

declare const chrome: any;

declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
