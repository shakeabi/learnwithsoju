/**
 * Lemmatizer interface — given a Korean surface form (어절), return one or more
 * candidate dictionary forms (lemmas) to try against KRDict, in priority order.
 *
 * V1 implementation: heuristic suffix stripping. Handles all nouns correctly
 * (nouns are their own lemma) and many common verb/adjective conjugations.
 * Misses irregular verbs and complex inflection.
 *
 * V2 plan: replace with a real morphological analyzer. Two viable swaps:
 *   - mecab-ko-wasm rebuilt from source with dict embedded (upstream npm
 *     release is currently broken — only ships the engine, not the dict).
 *   - Kiwi (kiwi-nlp) loaded inside a sandboxed iframe (~84 MB model + offscreen
 *     doc + postMessage broker, since kiwi's wasm-bindgen output uses
 *     `new Function()` which MV3 CSP forbids in extension pages).
 *
 * The single export is `lemmaCandidates(surface) => string[]`. Callers should
 * try each candidate against the dictionary in order; first hit wins.
 */

const PARTICLES = [
  '으로부터', '으로서', '으로써',
  '에서부터', '으로',
  '이라고', '라고',
  '에서', '에게', '한테', '께',
  '까지', '부터', '마다', '조차', '마저',
  '이나', '이라', '이며', '이든', '이야', '이오', '이지', '이고',
  '들', '도', '은', '는', '이', '가', '을', '를', '와', '과',
  '의', '에', '나', '랑', '보다', '처럼', '같이', '하고',
];

const VERB_ENDINGS = [
  '었습니다', '았습니다', '했습니다',
  '었어요', '았어요', '였어요', '했어요',
  '으세요', '으셔요', '으십시오', '으십니다',
  '습니까', '습니다',
  '으면서', '으니까', '으니라', '으려고', '으려면',
  '으면', '으나', '으며', '으시',
  '겠습니다', '겠어요', '겠다',
  '었다', '았다', '였다', '했다',
  '어요', '아요', '여요',
  '세요', '셔요', '시오', '시다',
  '네요', '군요', '나요', '죠', '지요',
  '는다', '느냐', '는데', '는다고',
  '는', '은', '을', '던',
  '면서', '니까', '려고', '려면', '면',
  '아', '어', '여', '서',
  '죠', '죵',
  '다', '다고', '다는',
];

function stripSuffix(word, suffixes) {
  for (const s of suffixes) {
    if (word.length > s.length && word.endsWith(s)) {
      return word.slice(0, -s.length);
    }
  }
  return null;
}

export function lemmaCandidates(surface) {
  if (!surface) return [];
  const seen = new Set();
  const out = [];
  const push = (w) => {
    if (w && w.length > 0 && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  };

  push(surface);

  const nounStem = stripSuffix(surface, PARTICLES);
  if (nounStem) push(nounStem);

  const verbStem = stripSuffix(surface, VERB_ENDINGS);
  if (verbStem) {
    push(verbStem + '다');
    push(verbStem);
  }

  if (surface.length > 2) push(surface.slice(0, -1) + '다');
  if (surface.length > 1) push(surface.slice(0, -1));
  if (surface.length > 2) push(surface.slice(0, -2));

  return out;
}
