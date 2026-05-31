// Type definitions for every chrome.runtime.sendMessage contract between
// Svelte UI surfaces and the plain-JS background service worker
// (extension/background.js, message dispatcher around lines 408–500).
//
// The background handlers stay in plain JS — runtime is the actual contract
// boundary. This file documents the shapes we expect and gives the typed
// wrappers in src/lib/messages.ts something to enforce at the call site.

// ---- lookup ----
// Background returns the full parsed lookup payload: tokens (mecab), grouped
// dictionary candidates (per query), raw KRDict + OpenDict XML for lazy
// re-parsing on tab switches, plus error fields when something failed. The
// shape is large and depends on parsed XML — we keep it `unknown` here and
// shape it where consumed (overlay App.svelte) rather than mirroring the
// payload in TS where it would drift.
export interface LookupRequest {
  type: 'lookup';
  surface: string;
}
export type LookupResponse =
  | { error: 'NO_API_KEY' | 'FETCH_FAILED' | 'INTERNAL' | string; message?: string; surface?: string }
  | LookupSuccess;

// LookupSuccess is intentionally permissive — the overlay consumes specific
// fields (`tokens`, `groups`, `unrelated`, `krXmls`, `odXml`, `lemma`, etc.)
// and the precise shape is documented in extension/background.js. We expose
// the fields the overlay reaches into; everything else passes through as
// unknown.
export interface LookupSuccess {
  surface: string;
  lemma?: string;
  tokens?: unknown[];
  groups?: unknown[];
  unrelated?: unknown[];
  krXmls?: unknown[];
  odXml?: unknown;
  error?: undefined;
  // permits the additional fields the parser pipeline attaches
  [k: string]: unknown;
}

// ---- lookupHanja ----
export interface LookupHanjaRequest {
  type: 'lookupHanja';
  chars: string;
}
export type LookupHanjaResponse =
  | { chars: string; error: string; message?: string }
  | { chars: string; hanjas: unknown[]; error?: undefined };

// ---- ping ----
export interface PingRequest { type: 'ping'; }
export interface PingResponse { ok: true; }

// ---- warmup ----
export interface WarmupRequest { type: 'warmup'; }
export interface WarmupResponse { ok: true; }

// ---- openOptions ----
export interface OpenOptionsRequest { type: 'openOptions'; }
export interface OpenOptionsResponse { ok: true; }

// ---- clearCache ----
export type ClearCacheTarget = 'lookup' | 'hanja' | 'dict' | 'all';
export interface ClearCacheRequest {
  type: 'clearCache';
  target: ClearCacheTarget;
}
export interface ClearCacheResponse {
  ok: boolean;
  cleared?: { lookup?: boolean; hanja?: boolean; dict?: boolean };
  error?: string;
}

// ---- cacheCounts ----
export interface CacheCountsRequest { type: 'cacheCounts'; }
export interface CacheCounts {
  lookup: number;
  hanja: number;
  krdict: number;
  opendict: number;
}
export interface CacheCountsResponse {
  ok: boolean;
  counts?: CacheCounts;
  error?: string;
}

// ---- mecab-inspect ----
// Used by morpheme-inspector page. Background returns three sections:
// singlePath (best mecab tokenization), nbestPaths (top-N), candidates
// (lemma candidates derived from n-best). Token shape is the serializeToken
// output in extension/background.js — surface, pos, type, firstPos, lastPos,
// decomp, reading, features.
export interface MecabInspectRequest {
  type: 'mecab-inspect';
  text: string;
  nbest?: number;
}
export interface MecabToken {
  surface: string;
  pos: string;
  type: string;
  firstPos: string;
  lastPos: string;
  decomp: string;
  reading: string;
  features: string;
}
export interface MecabNbestPath {
  cost: number;
  tokens: MecabToken[];
}
export interface MecabInspectResponse {
  singlePath?: MecabToken[];
  nbestPaths?: MecabNbestPath[];
  candidates?: string[];
  error?: string;
}

// Discriminated union for the rare case where a caller needs to match on type.
export type AnyMessageRequest =
  | LookupRequest
  | LookupHanjaRequest
  | PingRequest
  | WarmupRequest
  | OpenOptionsRequest
  | ClearCacheRequest
  | CacheCountsRequest
  | MecabInspectRequest;
