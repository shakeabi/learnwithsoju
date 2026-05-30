/**
 * Chrome Built-in AI (Prompt API / Gemini Nano) lemmatizer.
 *
 * Opt-in replacement for mecab in the lookup pipeline. When enabled in
 * settings, `handleLookup` calls `aiLemmatize(surface)` instead of going
 * through `tokenizeSurfaceNbest` + `lemmaCandidatesFromNbest`. On any
 * failure (model unavailable, JSON parse error, network/permission) the
 * caller falls back to the mecab path.
 *
 * Two API shapes are detected. Older Chromium (~Chrome 127–137) exposes
 * `self.ai.languageModel`; newer Chromium (~Chrome 138+) exposes
 * `self.LanguageModel` directly. Both have the same `availability()` /
 * `create()` / session.prompt(...) surface.
 *
 *   availability() → 'unavailable' | 'downloadable' | 'downloading' | 'available'
 *   create({ temperature, topK }) → session
 *   session.prompt(text, { responseConstraint }) → string (JSON when constrained)
 *
 * We add a fifth virtual state — `'unsupported'` — for when neither global
 * is present at all (no Built-in AI in this browser).
 */

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['lemma', 'morphemes'],
  properties: {
    lemma: { type: 'string' },
    morphemes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['surface', 'lemma', 'pos', 'meaning'],
        properties: {
          surface: { type: 'string' },
          lemma: { type: 'string' },
          pos: { type: 'string' },
          meaning: { type: 'string', maxLength: 50 },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = 'You are a Korean morphological analyzer. Given a Korean word (surface form, may include particles / endings), return the dictionary lemma of the whole word plus a morpheme-by-morpheme breakdown. Output JSON only — no prose, no markdown.';

function api() {
  if (typeof self !== 'undefined') {
    if (self.LanguageModel && typeof self.LanguageModel.availability === 'function') {
      return { shape: 'languageModel', root: self.LanguageModel };
    }
    if (self.ai && self.ai.languageModel && typeof self.ai.languageModel.availability === 'function') {
      return { shape: 'ai.languageModel', root: self.ai.languageModel };
    }
  }
  return null;
}

export async function detectAvailability() {
  try {
    const handle = api();
    if (!handle) return 'unsupported';
    const state = await handle.root.availability();
    return state || 'unavailable';
  } catch (err) {
    console.warn('[lws] ai availability check failed:', err);
    return 'unsupported';
  }
}

export async function ensureSession(opts = {}) {
  const handle = api();
  if (!handle) throw new Error('ai-lemmatizer: no LanguageModel API present');
  return handle.root.create({
    temperature: 0.3,
    topK: 3,
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    ...opts,
  });
}

function userPromptFor(surface) {
  return `Analyze this Korean word: ${surface}\n\nReturn the dictionary lemma and morpheme breakdown as JSON. For each morpheme, provide its surface form, dictionary lemma, part of speech (Sejong tag like NNG/VV/JKO/EF/EC or English label), and a concise English meaning (3-5 words).`;
}

function sanitizeMorphemes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const surface = typeof m.surface === 'string' ? m.surface.trim() : '';
    if (!surface) continue;
    out.push({
      surface,
      lemma: typeof m.lemma === 'string' ? m.lemma.trim() : '',
      pos: typeof m.pos === 'string' ? m.pos.trim() : '',
      meaning: typeof m.meaning === 'string' ? m.meaning.trim() : '',
    });
  }
  return out;
}

export async function aiLemmatize(surface) {
  const word = typeof surface === 'string' ? surface.trim() : '';
  if (!word) return null;
  let session = null;
  try {
    session = await ensureSession();
    const text = await session.prompt(userPromptFor(word), { responseConstraint: RESPONSE_SCHEMA });
    if (typeof text !== 'string' || !text.trim()) {
      console.warn('[lws] ai-lemmatize: empty response for', word);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.warn('[lws] ai-lemmatize: JSON parse failed for', word, '— raw:', text.slice(0, 200), err);
      return null;
    }
    const lemma = typeof parsed.lemma === 'string' ? parsed.lemma.trim() : '';
    const morphemes = sanitizeMorphemes(parsed.morphemes);
    if (!lemma && morphemes.length === 0) {
      console.warn('[lws] ai-lemmatize: response had neither lemma nor morphemes for', word);
      return null;
    }
    return { lemma: lemma || word, morphemes };
  } catch (err) {
    console.warn('[lws] ai-lemmatize failed for', surface, err);
    return null;
  } finally {
    if (session && typeof session.destroy === 'function') {
      try { session.destroy(); } catch (err) { console.warn('[lws] ai-lemmatize: session.destroy failed:', err); }
    }
  }
}

export { RESPONSE_SCHEMA };
