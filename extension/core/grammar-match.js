/**
 * Experimental grammar resolution — match mecab token tails against composed
 * patterns (fundamentals like 어 + 요 merged into ~아/어요).
 *
 * Patterns are tried longest-first, left-to-right over the suffix tail after
 * the content stem. Each hit consumes those tokens so atomics don't duplicate
 * a composed match.
 *
 * @typedef {{ surface?: string, form?: string, pos?: string }} GrammarToken
 * @typedef {{ label: string, gloss: string }} GrammarFundamental
 * @typedef {{
 *   id: string,
 *   display: string,
 *   gloss: string,
 *   fundamentals?: GrammarFundamental[],
 *   lesson?: number,
 *   link?: string,
 *   variants: string[][],
 * }} GrammarPatternDef
 * @typedef {GrammarPatternDef & {
 *   surface: string,
 *   start: number,
 *   end: number,
 * }} GrammarMatch
 */

/** @type {GrammarPatternDef[]} */
export const GRAMMAR_PATTERNS = [
  // Multi-morpheme expressions (HTSK catalog seeds)
  {
    id: 'gi-tteumune',
    display: '~기 때문에',
    gloss: 'because (allows past/future in the reason clause)',
    lesson: 38,
    link: 'https://www.howtostudykorean.com/unit-2-lower-intermediate-korean-grammar/unit-2-lessons-34-41/lesson-38/',
    fundamentals: [
      { label: '~기', gloss: 'nominalizer (-ing)' },
      { label: '때문(에)', gloss: 'because of' },
    ],
    variants: [['기', '때문', '에'], ['기', '때문']],
  },
  {
    id: 'eoseo-because',
    display: '~아/어서',
    gloss: 'because / and so (cause → result)',
    lesson: 37,
    fundamentals: [
      { label: '아/어', gloss: 'connective vowel harmony' },
      { label: '서', gloss: 'because / and so' },
    ],
    variants: [['어서'], ['아서'], ['여서'], ['어', '서'], ['아', '서'], ['여', '서']],
  },
  {
    id: 'myeon',
    display: '~(으)면',
    gloss: 'if / when (conditional)',
    lesson: 43,
    fundamentals: [
      { label: '(으)', gloss: 'after consonant stem' },
      { label: '면', gloss: 'if / when' },
    ],
    variants: [['으면'], ['면'], ['으', '면']],
  },
  {
    id: 'eoya-hada',
    display: '~아/어야 하다',
    gloss: 'must / have to',
    lesson: 46,
    fundamentals: [
      { label: '아/어', gloss: 'connective' },
      { label: '야', gloss: 'must' },
      { label: '하다', gloss: 'to do ( obligation )' },
    ],
    variants: [['어야', '하'], ['아야', '하'], ['여야', '하'], ['어야', '하다'], ['아야', '하다']],
  },
  {
    id: 'eoboda',
    display: '~아/어 보다',
    gloss: 'to try / attempt',
    lesson: 32,
    fundamentals: [
      { label: '아/어', gloss: 'connective' },
      { label: '보다', gloss: 'to see → try' },
    ],
    variants: [['어', '보'], ['아', '보'], ['여', '보'], ['어봐'], ['아봐'], ['어봤'], ['아봤']],
  },
  // Composed speech-level / tense stacks (fundamentals → one learner-facing pattern)
  {
    id: 'past-polite',
    display: '~았/었어요',
    gloss: 'past tense, polite speech level',
    lesson: 6,
    fundamentals: [
      { label: '았/었/였', gloss: 'past tense' },
      { label: '아/어', gloss: 'connective' },
      { label: '요', gloss: 'polite ending' },
    ],
    variants: [
      ['았어요'], ['었어요'], ['였어요'],
      ['았', '어요'], ['었', '어요'], ['였', '어요'],
      ['았', '어', '요'], ['었', '어', '요'], ['였', '어', '요'],
    ],
  },
  {
    id: 'future-polite',
    display: '~겠어요',
    gloss: 'future / conjecture, polite',
    lesson: 5,
    fundamentals: [
      { label: '겠', gloss: 'future / probably' },
      { label: '어', gloss: 'connective' },
      { label: '요', gloss: 'polite ending' },
    ],
    variants: [
      ['겠어요'], ['겠', '어요'], ['겠', '어', '요'],
    ],
  },
  {
    id: 'polite-present',
    display: '~아/어요',
    gloss: 'present tense, polite speech level',
    lesson: 6,
    fundamentals: [
      { label: '아/어/여', gloss: 'present connective' },
      { label: '요', gloss: 'polite ending' },
    ],
    variants: [
      ['어요'], ['아요'], ['여요'],
      ['어', '요'], ['아', '요'], ['여', '요'],
    ],
  },
  {
    id: 'formal-present',
    display: '~ㅂ니다/습니다',
    gloss: 'present tense, formal speech level',
    lesson: 6,
    fundamentals: [
      { label: 'ㅂ/습', gloss: 'formal connective' },
      { label: '니다', gloss: 'formal ending' },
    ],
    variants: [['습니다'], ['ㅂ니다'], ['습', '니다'], ['ㅂ', '니다']],
  },
  {
    id: 'confirming-polite',
    display: '~죠 / ~지요',
    gloss: 'confirming / soft assertion (... right?)',
    lesson: 6,
    fundamentals: [
      { label: '죠 / 지', gloss: 'confirming nuance' },
      { label: '요', gloss: 'polite ending' },
    ],
    variants: [['죠'], ['지요'], ['지', '요']],
  },
  {
    id: 'noticed-polite',
    display: '~네요',
    gloss: 'noticed surprise / mild realization',
    lesson: 6,
    fundamentals: [
      { label: '네', gloss: 'discovery nuance' },
      { label: '요', gloss: 'polite ending' },
    ],
    variants: [['네요'], ['네', '요']],
  },
  {
    id: 'realization-polite',
    display: '~군요',
    gloss: 'realization (... I see / so that is how it is)',
    lesson: 6,
    fundamentals: [
      { label: '군', gloss: 'realization nuance' },
      { label: '요', gloss: 'polite ending' },
    ],
    variants: [['군요'], ['군', '요']],
  },
  {
    id: 'honorific-polite',
    display: '~(으)세요',
    gloss: 'honorific + polite (request or statement about respected person)',
    lesson: 40,
    fundamentals: [
      { label: '(으)시', gloss: 'honorific' },
      { label: '어요 → 세요', gloss: 'polite honorific ending' },
    ],
    variants: [['세요'], ['으세요'], ['시', '어요'], ['으', '시', '어요']],
  },
  {
    id: 'plain-present',
    display: '~아/어',
    gloss: 'plain / informal present',
    lesson: 6,
    variants: [['어'], ['아'], ['여']],
  },
  {
    id: 'past-plain',
    display: '~았/었',
    gloss: 'past tense (plain pre-final)',
    lesson: 5,
    variants: [['았'], ['었'], ['였']],
  },
  {
    id: 'e-particle',
    display: '~에',
    gloss: 'at / to / in (location or time)',
    lesson: 2,
    variants: [['에']],
  },
  {
    id: 'eseo',
    display: '~에서',
    gloss: 'from / at (action location)',
    lesson: 2,
    variants: [['에서']],
  },
  {
    id: 'gido',
    display: '~기 (nominalizer)',
    gloss: 'nominalizer: turns a verb into a noun (-ing)',
    lesson: 29,
    variants: [['기']],
  },
];

const STEM_POS = /^(VV|VA|VX|VCP|VCN|NNG|NNP|XR)$/;

/**
 * @param {GrammarToken} t
 * @returns {string}
 */
function tokenForm(t) {
  return String(t?.surface ?? t?.form ?? '').trim();
}

/**
 * Suffix forms after the lexical stem (verb root, noun head, etc.).
 *
 * @param {GrammarToken[]} tokens
 * @returns {string[]}
 */
export function grammarTailForms(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];

  let stemEnd = 0;
  for (let i = 0; i < tokens.length; i++) {
    const lead = (tokens[i].pos || '').split('+')[0];
    if (STEM_POS.test(lead)) {
      stemEnd = i + 1;
      if (lead === 'NNG' && i + 1 < tokens.length) {
        const nextLead = (tokens[i + 1].pos || '').split('+')[0];
        if (nextLead === 'XSV' || nextLead === 'XSA') stemEnd = i + 2;
      }
    } else {
      break;
    }
  }
  if (stemEnd === 0) stemEnd = 1;

  return tokens.slice(stemEnd).map(tokenForm).filter(Boolean);
}

/**
 * @param {string[]} tail
 * @param {string[]} variant
 * @param {number} at
 * @returns {boolean}
 */
function variantMatchesAt(tail, variant, at) {
  if (at + variant.length > tail.length) return false;
  for (let i = 0; i < variant.length; i++) {
    if (tail[at + i] !== variant[i]) return false;
  }
  return true;
}

/**
 * Longest-match-first, left-to-right over the suffix tail.
 *
 * @param {GrammarToken[]} tokens  mecab tokens for one 어절
 * @returns {GrammarMatch[]}
 */
export function resolveGrammar(tokens) {
  const tail = grammarTailForms(tokens);
  if (tail.length === 0) return [];

  /** @type {GrammarMatch[]} */
  const matches = [];
  const consumed = new Array(tail.length).fill(false);

  const patterns = [...GRAMMAR_PATTERNS].sort((a, b) => {
    const aMax = Math.max(...a.variants.map((v) => v.length));
    const bMax = Math.max(...b.variants.map((v) => v.length));
    return bMax - aMax;
  });

  let pos = 0;
  while (pos < tail.length) {
    if (consumed[pos]) {
      pos += 1;
      continue;
    }

    /** @type {GrammarMatch | null} */
    let best = null;

    for (const pattern of patterns) {
      for (const variant of pattern.variants) {
        if (!variantMatchesAt(tail, variant, pos)) continue;
        let blocked = false;
        for (let i = pos; i < pos + variant.length; i++) {
          if (consumed[i]) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const candidate = {
          ...pattern,
          surface: tail.slice(pos, pos + variant.length).join(''),
          start: pos,
          end: pos + variant.length,
        };
        if (!best || variant.length > (best.end - best.start)) {
          best = candidate;
        }
      }
    }

    if (!best) {
      pos += 1;
      continue;
    }

    for (let i = best.start; i < best.end; i++) consumed[i] = true;
    matches.push(best);
    pos = best.end;
  }

  return matches;
}
