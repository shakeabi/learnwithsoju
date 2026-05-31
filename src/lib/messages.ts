import type {
  LookupRequest, LookupResponse,
  LookupHanjaRequest, LookupHanjaResponse,
  PingResponse,
  WarmupResponse,
  OpenOptionsResponse,
  ClearCacheRequest, ClearCacheResponse, ClearCacheTarget,
  CacheCountsResponse,
  MecabInspectRequest, MecabInspectResponse,
} from '$types/messages';

/**
 * Typed wrappers around chrome.runtime.sendMessage. The plain-JS background
 * handlers (extension/background.js) are the actual contract boundary; this
 * file is the single source of truth for what the UI promises to send.
 *
 * Each wrapper returns a Promise that resolves to the typed response. We
 * don't reject on background errors — the response object carries an `error`
 * field instead, matching the existing JS contract. Network/transport errors
 * (extension reloading mid-message) reject as usual.
 */

function send<TReq, TRes>(req: TReq): Promise<TRes> {
  return chrome.runtime.sendMessage(req) as Promise<TRes>;
}

export function lookup(surface: string): Promise<LookupResponse> {
  const req: LookupRequest = { type: 'lookup', surface };
  return send<LookupRequest, LookupResponse>(req);
}

export function lookupHanja(chars: string): Promise<LookupHanjaResponse> {
  const req: LookupHanjaRequest = { type: 'lookupHanja', chars };
  return send<LookupHanjaRequest, LookupHanjaResponse>(req);
}

export function ping(): Promise<PingResponse> {
  return send({ type: 'ping' });
}

export function warmup(): Promise<WarmupResponse> {
  return send({ type: 'warmup' });
}

export function openOptions(): Promise<OpenOptionsResponse> {
  return send({ type: 'openOptions' });
}

export function clearCache(target: ClearCacheTarget): Promise<ClearCacheResponse> {
  const req: ClearCacheRequest = { type: 'clearCache', target };
  return send<ClearCacheRequest, ClearCacheResponse>(req);
}

export function cacheCounts(): Promise<CacheCountsResponse> {
  return send({ type: 'cacheCounts' });
}

export function mecabInspect(text: string, nbest = 5): Promise<MecabInspectResponse> {
  const req: MecabInspectRequest = { type: 'mecab-inspect', text, nbest };
  return send<MecabInspectRequest, MecabInspectResponse>(req);
}
