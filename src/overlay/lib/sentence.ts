import type { SentenceContext } from '$types/overlay';

/**
 * When a user clicks a word inside the sentence band, rebuild the sentence
 * with that word as the focus. fullText = before + word + after; the new
 * sentence keeps the same text but moves the focus.
 */
export function sentenceFromWordClick(
  fullText: string,
  surface: string,
  offset: number
): SentenceContext {
  return {
    before: fullText.slice(0, offset),
    word: surface,
    after: fullText.slice(offset + surface.length),
  };
}
