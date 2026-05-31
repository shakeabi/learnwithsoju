// Types shared between content.js (the bridge) and the overlay Svelte
// component tree. The bridge stays in plain JS and treats these as `any` at
// runtime; this file documents what overlay components expect.

import type { LookupSuccess } from './messages';

/** What content.js extracts from the page around the hovered word. */
export interface SentenceContext {
  before: string;
  word: string;
  after: string;
}

/** The full payload the bridge passes to window.__lwsOverlay.show(). */
export interface OverlayPayload {
  /** Lookup result from background.js (parsed payload, unknown XML shape). */
  lookup: LookupSuccess;
  /** Sentence extracted from the DOM (or null on hover-without-block). */
  sentence: SentenceContext | null;
  /** Anchor rect in document coordinates for positioning. */
  anchor: { top: number; left: number; bottom: number; right: number; width: number; height: number };
  /** User's secondary language code from chrome.storage.sync. */
  secondaryLang: string;
  /** Default-lang preference ('en' or 'ko'). */
  defLang: 'en' | 'ko';
  /** Ask-AI provider key and (effective) prompt template. */
  askAiProvider: string;
  askAiPromptTemplate: string;
  askAiChatGptTemporary: boolean;
  /** When true, repositions the popup at the anchor. False = keep current
   *  position (sentence-word click case). */
  reposition: boolean;
}

/** Loading / error overlay frames that content.js can show instead of a full lookup. */
export type OverlayFrame =
  | { kind: 'loading'; surface: string; anchor: OverlayPayload['anchor']; reposition: boolean }
  | { kind: 'error'; message: string; details?: string; action?: { label: string; onClick: () => void }; anchor: OverlayPayload['anchor']; reposition: boolean }
  | { kind: 'payload'; payload: OverlayPayload };

/** Partial state patch the bridge can push at any time (e.g. when a setting
 *  changes and we want the active popup to reflect it without a re-fetch). */
export interface OverlayUpdatePatch {
  lookupStatus?: string;
  defLang?: 'en' | 'ko';
  secondaryLang?: string;
  askAiPromptTemplate?: string;
  askAiProvider?: string;
  askAiChatGptTemporary?: boolean;
}

/** The window global content.js calls. */
export interface OverlayApi {
  show(frame: OverlayFrame): void;
  hide(): void;
  /** Partial state update — lookup-status text while loading, or
   *  setting-driven patches (defLang / secondaryLang / askAi*). */
  update(patch: OverlayUpdatePatch): void;
}

declare global {
  interface Window {
    __lwsOverlay?: OverlayApi;
  }
}
