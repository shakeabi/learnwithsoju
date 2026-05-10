/**
 * Hand-curated short glosses for the most common Korean particles, endings,
 * and grammatical morphemes. Used to annotate the morpheme-decomposition
 * chips in the popup.
 *
 * Coverage is intentionally narrow — the 50-or-so morphemes a learner sees
 * over and over in real text. Anything not in the table falls back to the
 * POS label alone (which is still informative).
 *
 * Two-tier lookup:
 *   1. Exact form match (e.g. surface "에서" → "from / at (action location)")
 *   2. POS-only fallback (e.g. tag "JKS" → "subject particle")
 *
 * Both surface and POS are passed because some morphemes only make sense
 * in context of their tag (e.g. "이" can be a subject particle or part of
 * a copula).
 *
 * @typedef {{ form: string, pos: string }} Morpheme
 */

// Forms that mean different things depending on their POS tag.
// Keyed as `${form}|${leadPos}` → gloss. Looked up before FORM_GLOSSES below.
const FORM_POS_GLOSSES = {
  '을|JKO': 'object marker',
  '을|ETM': 'future-tense modifier',
  '를|JKO': 'object marker',
  '은|JX': 'topic marker',
  '은|ETM': 'past-tense modifier',
  '는|JX': 'topic marker',
  '는|ETM': 'present-tense modifier',
  '이|JKS': 'subject marker',
  '이|VCP': 'copula 이다',
  'ㄴ|ETM': 'past-tense modifier',
  'ㄹ|ETM': 'future-tense modifier',
};

const FORM_GLOSSES = {
  // Subject particles (JKS) — 이 disambiguated above
  '가': 'subject marker',
  // Possessive (JKG)
  '의': 'of (possessive)',
  // Locative / directional (JKB)
  '에': 'at / to / in',
  '에서': 'from / at (action)',
  '에게': 'to (person)',
  '한테': 'to (person, casual)',
  '께': 'to (honorific)',
  '으로': 'by means of / toward',
  '로': 'by means of / toward',
  '와': 'and / with',
  '과': 'and / with',
  '랑': 'and / with (casual)',
  '이랑': 'and / with (casual)',
  '하고': 'and / with (casual)',
  // Auxiliary particles (JX)
  '은': 'topic marker',
  '는': 'topic marker',
  '도': 'also / too',
  '만': 'only',
  '까지': 'until / up to',
  '부터': 'from (starting)',
  '보다': 'more than',
  '처럼': 'like',
  '같이': 'like',
  '마다': 'every',
  '마저': 'even',
  '조차': 'even',
  '이나': 'or / about',
  '나': 'or / about',
  '이라도': 'even / at least',
  '라도': 'even / at least',
  // Quotative (JKQ)
  '이라고': 'called / quoted as',
  '라고': 'called / quoted as',
  '고': 'and / quoted',

  // Pre-final endings (EP)
  '었': 'past tense',
  '았': 'past tense',
  '였': 'past tense (after 하)',
  '겠': 'will / probably',
  '시': 'honorific',
  '으시': 'honorific',

  // Final endings (EF)
  '어요': 'polite present',
  '아요': 'polite present',
  '여요': 'polite present (after 하)',
  '습니다': 'formal present',
  'ㅂ니다': 'formal present',
  '습니까': 'formal question',
  '어': 'plain / informal',
  '아': 'plain / informal',
  '여': 'plain (after 하)',
  '다': 'dictionary form / plain statement',
  '죠': '... right? (confirming)',
  '지요': '... right? (confirming)',
  '네요': 'noticed (mild surprise)',
  '군요': 'realization',
  '나요': 'wondering',
  '으세요': 'honorific polite',
  '세요': 'honorific polite',
  '으십시오': 'honorific formal command',
  '십시오': 'honorific formal command',

  // Connecting endings (EC)
  '어서': 'and so / because',
  '아서': 'and so / because',
  '으니까': 'because',
  '니까': 'because',
  '으면': 'if',
  '면': 'if',
  '으면서': 'while',
  '면서': 'while',
  '어도': 'even though',
  '아도': 'even though',
  '으려고': 'in order to',
  '려고': 'in order to',
  '으려면': 'if you intend to',
  '려면': 'if you intend to',
  '아야': 'must / have to',
  '어야': 'must / have to',
  '여야': 'must (after 하)',
  '거든': 'since / if (familiar)',
  '으면서도': 'while yet',
  '지만': 'but',

  // Modifier endings (ETM): 은 / 는 / 을 / ㄴ / ㄹ are homographs
  // that share form with particles — disambiguated via FORM_POS_GLOSSES above.
  '던': 'recalled / habitual past',

  // Nominal-forming (ETN)
  '음': 'nominalizer (-ing / fact of)',
  '기': 'nominalizer (-ing)',

  // Suffixes
  '들': 'plural marker',
  '하': 'verb-forming suffix',
  '되': 'become / passive suffix',
  '적': 'adjectival -ic / -al',
  '님': 'honorific suffix',

  // Common auxiliary verb stems
  '있': 'to be / to exist',
  '없': 'to not be',
  '있다': 'to be / exist',
  '없다': 'to not be',
};

const POS_GLOSSES = {
  // Particles
  JKS: 'subject particle',
  JKC: 'complement particle',
  JKO: 'object particle',
  JKG: 'possessive particle',
  JKB: 'adverbial particle',
  JKV: 'vocative particle',
  JKQ: 'quotative particle',
  JX: 'auxiliary particle',
  JC: 'connective particle',
  // Endings
  EP: 'pre-final ending',
  EF: 'final ending',
  EC: 'connecting ending',
  ETN: 'nominalizing ending',
  ETM: 'modifier ending',
  // Suffixes
  XSN: 'noun-forming suffix',
  XSV: 'verb-forming suffix',
  XSA: 'adjective-forming suffix',
  XPN: 'noun-prefixing suffix',
  XR: 'root',
  // Marks
  SF: 'sentence-final punctuation',
  SE: 'ellipsis',
  SS: 'opening/closing punctuation',
  SP: 'punctuation',
  SO: 'punctuation',
  SW: 'punctuation',
  SH: 'Hanja',
  SL: 'foreign / Latin',
  SN: 'numeral',
  // Content (rarely needs a gloss but useful as fallback)
  NNG: 'noun',
  NNP: 'proper noun',
  NNB: 'bound noun',
  NR: 'numeral',
  NP: 'pronoun',
  VV: 'verb',
  VA: 'adjective',
  VX: 'auxiliary verb/adjective',
  VCP: 'copula 이다',
  VCN: 'copula 아니다',
  MM: 'determiner',
  MAG: 'adverb',
  MAJ: 'conjunctive adverb',
  IC: 'interjection',
};

/**
 * Look up a short gloss for a single morpheme.
 *
 * @param {string} form  the morpheme's surface text
 * @param {string} pos   its Sejong POS tag (possibly merged with `+`)
 * @returns {string} a short English gloss, or `''` if nothing useful is known
 */
export function morphemeGloss(form, pos) {
  const lead = pos ? pos.split('+')[0] : '';
  // 1. POS-disambiguated form lookup (handles homographs like 을/은/는)
  if (form && lead) {
    const key = `${form}|${lead}`;
    if (Object.prototype.hasOwnProperty.call(FORM_POS_GLOSSES, key)) {
      return FORM_POS_GLOSSES[key];
    }
  }
  // 2. Form-only lookup
  if (form && Object.prototype.hasOwnProperty.call(FORM_GLOSSES, form)) {
    return FORM_GLOSSES[form];
  }
  // 3. POS-only fallback
  if (lead && Object.prototype.hasOwnProperty.call(POS_GLOSSES, lead)) {
    return POS_GLOSSES[lead];
  }
  return '';
}

/**
 * Decide whether a morpheme is "interesting enough" to render as a chip.
 * For now: skip pure punctuation and standalone whitespace markers — they
 * just add noise to the decomposition row.
 *
 * @param {Morpheme} m
 * @returns {boolean}
 */
export function isContentMorpheme(m) {
  if (!m || !m.form) return false;
  const lead = (m.pos || '').split('+')[0];
  if (!lead) return false;
  // Drop punctuation / structural marks but keep SH (Hanja), SL (Latin),
  // SN (numerals) — those are content morphemes, not punctuation.
  if (/^(SF|SE|SS|SP|SO|SW|SY)$/.test(lead)) return false;
  return true;
}
