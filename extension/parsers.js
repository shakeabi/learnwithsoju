/**
 * XML parsers for KRDict and OpenDict responses.
 *
 * DOMParser is injected so this module can be unit-tested with @xmldom/xmldom
 * in Node. In the extension itself, the content script passes the global
 * `DOMParser` constructor.
 *
 * The shape of the returned objects is consumed by content.js's popup renderer.
 */

/**
 * @typedef {{ trans_word: string, trans_dfn: string }} KrTranslation
 * @typedef {{ definition: string, translations: KrTranslation[], examples: string[] }} KrSense
 * @typedef {{
 *   word: string,
 *   pronunciation: string,
 *   grade: string,
 *   pos: string,
 *   origin: string,
 *   senses: KrSense[],
 * }} KrEntry
 */

/**
 * @typedef {{ trans_word: string, trans_dfn: string, language_type: string }} OdTranslation
 * @typedef {{ definition: string, translations: OdTranslation[], examples: string[] }} OdSense
 * @typedef {{
 *   word: string,
 *   pos: string,
 *   origin: string,
 *   senses: OdSense[],
 * }} OdEntry
 */

/**
 * Parse a KRDict XML response into a normalized array of entries.
 *
 * @param {string} xml
 * @param {{ new(): { parseFromString(s: string, mime: string): Document } }} DOMParserCtor
 * @returns {KrEntry[]}
 */
export function parseKrdictXml(xml, DOMParserCtor) {
  if (!xml) return [];
  let doc;
  try {
    doc = new DOMParserCtor().parseFromString(xml, 'application/xml');
  } catch {
    return [];
  }
  if (hasParseError(doc)) return [];
  const items = doc.getElementsByTagName('item');
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const word = textOf(item, 'word');
    const pronunciation = textOf(item, 'pronunciation');
    const grade = textOf(item, 'word_grade');
    const pos = textOf(item, 'pos');
    const origin = textOf(item, 'origin');
    const senses = item.getElementsByTagName('sense');
    const senseList = [];
    for (let j = 0; j < senses.length; j++) {
      const sense = senses[j];
      const definition = textOf(sense, 'definition');
      const translations = sense.getElementsByTagName('translation');
      const translationList = [];
      for (let k = 0; k < translations.length; k++) {
        const tr = translations[k];
        translationList.push({
          trans_word: textOf(tr, 'trans_word'),
          trans_dfn: textOf(tr, 'trans_dfn'),
        });
      }
      senseList.push({
        definition,
        translations: translationList,
        examples: extractExamplesFromSense(sense),
      });
    }
    entries.push({ word, pronunciation, grade, pos, origin, senses: senseList });
  }
  return entries;
}

/**
 * Parse an OpenDict (우리말샘) XML response into a normalized array of entries.
 *
 * OpenDict's response shape differs slightly from KRDict's:
 *   - `pos` and `origin` typically live on the <sense>, not on <item> directly,
 *     though we read both levels defensively in case the API surface shifts.
 *   - Translations are in <translation_info> blocks containing <trans_word>,
 *     <trans_dfn>, and <language_type> (e.g. "영어"). We expose all of them
 *     and let the caller filter by language.
 *
 * @param {string} xml
 * @param {{ new(): { parseFromString(s: string, mime: string): Document } }} DOMParserCtor
 * @returns {OdEntry[]}
 */
export function parseOpendictXml(xml, DOMParserCtor) {
  if (!xml) return [];
  let doc;
  try {
    doc = new DOMParserCtor().parseFromString(xml, 'application/xml');
  } catch {
    return [];
  }
  if (hasParseError(doc)) return [];
  const items = doc.getElementsByTagName('item');
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const word = textOf(item, 'word');
    let pos = textOf(item, 'pos');
    let origin = textOf(item, 'origin');
    const senses = item.getElementsByTagName('sense');
    const senseList = [];
    for (let j = 0; j < senses.length; j++) {
      const sense = senses[j];
      const definition = textOf(sense, 'definition');
      // Sense-level pos / origin overrides item-level when present.
      if (!pos) pos = textOf(sense, 'pos');
      if (!origin) origin = textOf(sense, 'origin');
      const trBlocks = sense.getElementsByTagName('translation_info');
      const translations = [];
      for (let k = 0; k < trBlocks.length; k++) {
        const tr = trBlocks[k];
        translations.push({
          trans_word: textOf(tr, 'trans_word'),
          trans_dfn: textOf(tr, 'trans_dfn'),
          language_type: textOf(tr, 'language_type') || textOf(tr, 'trans_lang'),
        });
      }
      senseList.push({
        definition,
        translations,
        examples: extractExamplesFromSense(sense),
      });
    }
    entries.push({ word, pos, origin, senses: senseList });
  }
  return entries;
}

/**
 * Walk a <sense> element and pull out the example sentences/phrases.
 *
 * KRDict and OpenDict differ slightly in how they wrap examples:
 *   - KRDict: <example><type>문장</type><example>밥을 먹었다.</example></example>
 *   - OpenDict: <example_info><example>...</example></example_info>, or just
 *     <example>...</example> on simpler entries.
 *
 * Strategy: collect every <example>/<example_text> element that is a *leaf*
 * (no nested example children of its own). De-duplicate. Preserve order.
 *
 * @param {Element} senseEl
 * @returns {string[]}
 */
function extractExamplesFromSense(senseEl) {
  const seen = new Set();
  const out = [];
  const candidates = [];
  for (const tag of ['example', 'example_text']) {
    const els = senseEl.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) candidates.push(els[i]);
  }
  for (const el of candidates) {
    // Skip wrappers — only take leaves whose text isn't redundantly contained
    // by a child <example>/<example_text>.
    if (el.getElementsByTagName('example').length > 0) continue;
    if (el.getElementsByTagName('example_text').length > 0) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

// CJK Unified Ideographs (U+4E00–U+9FFF) and Extension A (U+3400–U+4DBF).
// Covers the Hanja that appear in Korean dictionary `origin` fields.
const HANJA_CHAR_RE = /^[一-鿿㐀-䶿]$/;

/**
 * Whether a single character is a Hanja (Han ideograph). Use to filter
 * an origin field like `豫約 (예약)` down to just the linkable characters.
 *
 * @param {string} ch  exactly one character (Unicode code point)
 * @returns {boolean}
 */
export function isHanjaChar(ch) {
  return typeof ch === 'string' && HANJA_CHAR_RE.test(ch);
}

/**
 * Build a hangulhanja.com per-character breakdown link.
 *
 *   '豫'  →  'https://hangulhanja.com/en/hanja/%E8%B1%AB'
 *   '약'  →  null  (not a Hanja)
 *
 * @param {string | null | undefined} ch
 * @returns {string | null}
 */
export function hanjaCharUrl(ch) {
  if (!isHanjaChar(ch)) return null;
  return `https://hangulhanja.com/en/hanja/${encodeURIComponent(ch)}`;
}

const VERB_LIKE_POS = new Set([
  '동사', '보조 동사', '보조동사',
  '형용사', '보조 형용사', '보조형용사',
]);

/**
 * Whether a KRDict/OpenDict POS label represents something koreanverb.app
 * can conjugate. Korean adjectives ("descriptive verbs") conjugate the same
 * way as action verbs, so we include them.
 *
 * @param {string | null | undefined} pos
 * @returns {boolean}
 */
export function isVerbLikePos(pos) {
  if (!pos) return false;
  return VERB_LIKE_POS.has(String(pos).trim());
}

/**
 * Build a koreanverb.app conjugation-table link for a verb or adjective.
 *
 * Returns null when the POS isn't verb-like, or when the word doesn't look
 * like a dictionary form (KRDict always ends verbs/adjectives in -다, so
 * anything else means malformed data — don't link out).
 *
 * @param {string | null | undefined} hangulWord
 * @param {string | null | undefined} pos
 * @returns {string | null}
 */
export function koreanVerbUrl(hangulWord, pos) {
  if (!isVerbLikePos(pos)) return null;
  if (!hangulWord) return null;
  const w = String(hangulWord).trim();
  if (!w || !/다$/.test(w)) return null;
  return `https://koreanverb.app/?search=${encodeURIComponent(w)}`;
}

/**
 * Filter OpenDict translations to a single target language.
 *
 * @param {OdTranslation[]} translations
 * @param {'en' | 'ko' | string} target  'en' shortcut for English; otherwise a literal language string
 * @returns {OdTranslation[]}
 */
export function filterTranslations(translations, target) {
  if (!Array.isArray(translations)) return [];
  const matchers = {
    en: /영어|english/i,
    ja: /일본어|japanese/i,
    zh: /중국어|chinese/i,
  };
  const re = matchers[target] || new RegExp(target, 'i');
  return translations.filter((t) => re.test(t.language_type || ''));
}

/**
 * KRDict reports difficulty grade in Korean strings ("초급" / "중급" / "고급").
 * This maps that label onto the popup's three-star scale.
 *
 * @param {string | undefined | null} grade
 * @returns {string}
 */
export function gradeToStars(grade) {
  if (!grade) return '';
  if (/초급|beginner/i.test(grade)) return '★★★';
  if (/중급|intermediate/i.test(grade)) return '★★';
  if (/고급|advanced/i.test(grade)) return '★';
  return '';
}

/**
 * Human-readable tooltip for the star grade. Combines the localized grade
 * and the level mapping so the meaning is obvious on first encounter.
 *
 * @param {string | undefined | null} grade
 * @returns {string}
 */
export function gradeToTooltip(grade) {
  if (!grade) return '';
  if (/초급|beginner/i.test(grade)) return `Beginner level (${grade}) — most common vocabulary`;
  if (/중급|intermediate/i.test(grade)) return `Intermediate level (${grade}) — moderately common`;
  if (/고급|advanced/i.test(grade)) return `Advanced level (${grade}) — less common`;
  return grade;
}

/**
 * KRDict / OpenDict return part-of-speech strings in Korean. When the user is
 * viewing the English definition we want an English POS label.
 *
 * Covers KRDict's full POS vocabulary plus a few OpenDict variants. Returns
 * the original string unchanged if no mapping exists, so unknown values
 * still render rather than disappear.
 *
 * @param {string | undefined | null} pos
 * @returns {string}
 */
export function posToEnglish(pos) {
  if (!pos) return '';
  const trimmed = String(pos).trim();
  return KOREAN_POS_TO_ENGLISH[trimmed] || trimmed;
}

const KOREAN_POS_TO_ENGLISH = {
  '명사': 'Noun',
  '대명사': 'Pronoun',
  '수사': 'Numeral',
  '동사': 'Verb',
  '형용사': 'Adjective',
  '관형사': 'Determiner',
  '부사': 'Adverb',
  '조사': 'Particle',
  '감탄사': 'Interjection',
  '의존 명사': 'Bound Noun',
  '의존명사': 'Bound Noun',
  '보조 동사': 'Auxiliary Verb',
  '보조동사': 'Auxiliary Verb',
  '보조 형용사': 'Auxiliary Adjective',
  '보조형용사': 'Auxiliary Adjective',
  '어미': 'Ending',
  '접사': 'Affix',
  '접두사': 'Prefix',
  '접미사': 'Suffix',
  '어근': 'Root',
  '명사구': 'Noun Phrase',
  '동사구': 'Verb Phrase',
  '형용사구': 'Adjective Phrase',
  '부사구': 'Adverb Phrase',
  '관용구': 'Idiom',
  '속담': 'Proverb',
  '품사 없음': '—',
  '품사없음': '—',
};

/**
 * Per-POS explanation suitable for a tooltip — one short sentence in the
 * user's language explaining what that part of speech means and what it does
 * in a Korean sentence. Returns `''` for unknown POS so callers can omit the
 * tooltip entirely rather than show a meaningless one.
 *
 * @param {string | undefined | null} pos
 * @param {'en' | 'ko'} [lang='en']
 * @returns {string}
 */
export function posExplanation(pos, lang = 'en') {
  if (!pos) return '';
  const trimmed = String(pos).trim();
  const entry = KOREAN_POS_EXPLANATIONS[trimmed]
    || KOREAN_POS_EXPLANATIONS[trimmed.replace(/\s+/g, '')]
    || KOREAN_POS_EXPLANATIONS[trimmed.replace(/\s+/g, ' ')];
  if (!entry) return '';
  return lang === 'ko' ? entry.ko : entry.en;
}

const KOREAN_POS_EXPLANATIONS = {
  '명사': {
    en: 'Noun — names a person, place, thing, or idea.',
    ko: '명사 — 사람, 장소, 사물, 개념의 이름을 나타내는 품사입니다.',
  },
  '대명사': {
    en: 'Pronoun — stands in for a noun (이것, 그것, 저것, …).',
    ko: '대명사 — 명사를 대신하여 가리키는 품사입니다 (이것, 그것, 저것 등).',
  },
  '수사': {
    en: 'Numeral — denotes a quantity or order (하나, 둘, 첫째, …).',
    ko: '수사 — 수량이나 순서를 나타내는 품사입니다 (하나, 둘, 첫째 등).',
  },
  '동사': {
    en: 'Verb — describes an action or process. Conjugates for tense, politeness, and mood.',
    ko: '동사 — 사물의 동작이나 작용을 나타내는 품사입니다. 시제·존대·서법 등에 따라 활용합니다.',
  },
  '형용사': {
    en: 'Adjective (descriptive verb) — describes a quality or state. Conjugates like a verb in Korean.',
    ko: '형용사 — 사물의 성질이나 상태를 나타내는 품사입니다. 한국어에서는 동사처럼 활용합니다.',
  },
  '관형사': {
    en: 'Determiner — modifies a noun directly (이, 그, 저, 새, 헌, …). Cannot stand alone.',
    ko: '관형사 — 명사 앞에서 그것을 꾸며 주는 품사입니다 (이, 그, 저, 새, 헌 등).',
  },
  '부사': {
    en: 'Adverb — modifies a verb, adjective, or another adverb (잘, 매우, 천천히, …).',
    ko: '부사 — 용언이나 다른 부사를 꾸미는 품사입니다 (잘, 매우, 천천히 등).',
  },
  '조사': {
    en: 'Particle — attaches to a noun (or other word) to mark its grammatical role in the sentence.',
    ko: '조사 — 체언 등에 붙어 문장 안에서의 문법적 관계를 나타내는 품사입니다.',
  },
  '감탄사': {
    en: 'Interjection — expresses emotion or reaction independently of the sentence (아, 어머, 야, …).',
    ko: '감탄사 — 놀람, 느낌, 부름 등을 나타내는 품사입니다 (아, 어머, 야 등).',
  },
  '의존 명사': {
    en: 'Bound noun — a noun that cannot stand alone; needs a modifier (것, 수, 적, 줄, …).',
    ko: '의존 명사 — 홀로 쓰이지 못하고 반드시 꾸미는 말을 필요로 하는 명사입니다 (것, 수, 적, 줄 등).',
  },
  '의존명사': {
    en: 'Bound noun — a noun that cannot stand alone; needs a modifier (것, 수, 적, 줄, …).',
    ko: '의존 명사 — 홀로 쓰이지 못하고 반드시 꾸미는 말을 필요로 하는 명사입니다 (것, 수, 적, 줄 등).',
  },
  '보조 동사': {
    en: 'Auxiliary verb — follows a main verb to add aspect or meaning (있다, 보다, 주다 in compound forms).',
    ko: '보조 동사 — 본동사 뒤에 붙어 상이나 의미를 더해 주는 용언입니다 (있다, 보다, 주다 등).',
  },
  '보조동사': {
    en: 'Auxiliary verb — follows a main verb to add aspect or meaning (있다, 보다, 주다 in compound forms).',
    ko: '보조 동사 — 본동사 뒤에 붙어 상이나 의미를 더해 주는 용언입니다 (있다, 보다, 주다 등).',
  },
  '보조 형용사': {
    en: 'Auxiliary adjective — follows a main verb/adjective, adds nuance (싶다, 만하다, 듯하다, …).',
    ko: '보조 형용사 — 본용언 뒤에 붙어 의미를 보태 주는 형용사입니다 (싶다, 만하다, 듯하다 등).',
  },
  '보조형용사': {
    en: 'Auxiliary adjective — follows a main verb/adjective, adds nuance (싶다, 만하다, 듯하다, …).',
    ko: '보조 형용사 — 본용언 뒤에 붙어 의미를 보태 주는 형용사입니다 (싶다, 만하다, 듯하다 등).',
  },
  '어미': {
    en: 'Ending — attaches to a verb/adjective stem to convey tense, mood, or politeness.',
    ko: '어미 — 용언의 어간에 붙어 시제·서법·존대 등 문법적 의미를 나타내는 형태소입니다.',
  },
  '접사': {
    en: 'Affix — attaches to a root to form a new word.',
    ko: '접사 — 어근에 붙어 새로운 단어를 만드는 형태소입니다.',
  },
  '접두사': {
    en: 'Prefix — attaches before a root to form a new word (개-, 맨-, 헛-, …).',
    ko: '접두사 — 어근의 앞에 붙어 새로운 단어를 만드는 형태소입니다 (개-, 맨-, 헛- 등).',
  },
  '접미사': {
    en: 'Suffix — attaches after a root to form a new word (-님, -들, -답다, …).',
    ko: '접미사 — 어근의 뒤에 붙어 새로운 단어를 만드는 형태소입니다 (-님, -들, -답다 등).',
  },
  '어근': {
    en: 'Root — the core meaning-bearing part of a word, before any affixes.',
    ko: '어근 — 단어에서 실질적 의미를 나타내는 부분으로, 접사가 붙기 전 핵심 형태소입니다.',
  },
  '명사구': {
    en: 'Noun phrase — a multi-word unit that functions as a noun.',
    ko: '명사구 — 여러 단어가 모여 명사처럼 기능하는 구입니다.',
  },
  '동사구': {
    en: 'Verb phrase — a multi-word unit that functions as a verb.',
    ko: '동사구 — 여러 단어가 모여 동사처럼 기능하는 구입니다.',
  },
  '형용사구': {
    en: 'Adjective phrase — a multi-word unit that functions as an adjective.',
    ko: '형용사구 — 여러 단어가 모여 형용사처럼 기능하는 구입니다.',
  },
  '부사구': {
    en: 'Adverb phrase — a multi-word unit that functions as an adverb.',
    ko: '부사구 — 여러 단어가 모여 부사처럼 기능하는 구입니다.',
  },
  '관용구': {
    en: 'Idiom — a fixed multi-word expression with a non-literal meaning.',
    ko: '관용구 — 둘 이상의 단어가 합쳐져 본래 뜻과 다른 특별한 의미를 나타내는 표현입니다.',
  },
  '속담': {
    en: 'Proverb — a traditional short saying expressing a generally accepted truth.',
    ko: '속담 — 예로부터 전해 내려오는 짧고 교훈적인 표현입니다.',
  },
};

/**
 * Compact POS label for use in tab strips and other space-constrained spots.
 *
 * In English mode produces grammar-textbook abbreviations ("n.", "v.",
 * "adj.", ...). In Korean mode falls back to the existing single-character
 * Sejong-style abbreviations ("명", "동", "형", ...). Unknown values pass
 * through with no decoration.
 *
 * @param {string | undefined | null} pos
 * @param {'en' | 'ko'} [lang='en']
 * @returns {string}
 */
export function posToShortform(pos, lang = 'en') {
  if (!pos) return '';
  const trimmed = String(pos).trim();
  const table = lang === 'ko' ? KOREAN_POS_SHORT_KO : KOREAN_POS_SHORT_EN;
  return table[trimmed] || trimmed;
}

const KOREAN_POS_SHORT_EN = {
  '명사': 'n.',
  '대명사': 'pron.',
  '수사': 'num.',
  '동사': 'v.',
  '형용사': 'adj.',
  '관형사': 'det.',
  '부사': 'adv.',
  '조사': 'part.',
  '감탄사': 'interj.',
  '의존 명사': 'b. n.',
  '의존명사': 'b. n.',
  '보조 동사': 'aux. v.',
  '보조동사': 'aux. v.',
  '보조 형용사': 'aux. adj.',
  '보조형용사': 'aux. adj.',
  '어미': 'end.',
  '접사': 'aff.',
  '접두사': 'pref.',
  '접미사': 'suff.',
  '어근': 'root',
  '명사구': 'n. phr.',
  '동사구': 'v. phr.',
  '형용사구': 'adj. phr.',
  '부사구': 'adv. phr.',
  '관용구': 'idiom',
  '속담': 'prov.',
};

const KOREAN_POS_SHORT_KO = {
  '명사': '명',
  '대명사': '대명',
  '수사': '수',
  '동사': '동',
  '형용사': '형',
  '관형사': '관',
  '부사': '부',
  '조사': '조',
  '감탄사': '감',
  '의존 명사': '의명',
  '의존명사': '의명',
  '보조 동사': '보동',
  '보조동사': '보동',
  '보조 형용사': '보형',
  '보조형용사': '보형',
  '어미': '어미',
  '접사': '접사',
  '접두사': '접두',
  '접미사': '접미',
  '어근': '어근',
  '명사구': '명구',
  '동사구': '동구',
  '형용사구': '형구',
  '부사구': '부구',
  '관용구': '관용',
  '속담': '속담',
};

function textOf(parent, tag) {
  const els = parent.getElementsByTagName(tag);
  if (!els || els.length === 0) return '';
  const el = els[0];
  return (el.textContent || '').trim();
}

function hasParseError(doc) {
  if (!doc) return true;
  if (typeof doc.querySelector === 'function') {
    if (doc.querySelector('parsererror')) return true;
  }
  if (doc.getElementsByTagName) {
    const errs = doc.getElementsByTagName('parsererror');
    if (errs && errs.length > 0) return true;
  }
  return false;
}
