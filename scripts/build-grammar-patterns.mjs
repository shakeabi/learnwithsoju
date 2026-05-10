#!/usr/bin/env node
/**
 * One-shot build step: walks Alaanor/kimchi-grammar's `point/*.yaml` files
 * and produces a compact JSON dataset for the extension to ship at runtime.
 *
 *   $ node scripts/build-grammar-patterns.mjs ../kimchi-grammar > extension/vendor/kimchi-grammar/patterns.json
 *
 * Each output entry is:
 *   {
 *     id: "ㄹ_수_있다",        // filename without extension
 *     name: "(으)ㄹ 수 있다/없다",  // display label from the YAML
 *     defs: [
 *       {
 *         slug: "ability-or-possibility",
 *         name: "Ability or possibility",
 *         alt: "can",                   // english_alternatives
 *         meaning: "..."
 *       }
 *     ],
 *     re: "(으|을|을)?\\s*ㄹ\\s*수\\s*(있|없)다?", // regex source string
 *     // examples are NOT shipped — they bloat the file ~20x and we don't
 *     // need them for matching, only for kimchi-reader's own UI.
 *   }
 *
 * The regex is derived heuristically from the pattern's `name` field:
 *   - parentheses around a Korean fragment → optional group
 *   - `/` between Korean fragments → alternation
 *   - whitespace becomes flexible `\s*`
 * It's a best-effort match; false positives possible. The matcher uses
 * this as a coarse filter, then the popup renders the pattern only when
 * the match overlaps the hovered word.
 *
 * License: kimchi-grammar is CC-BY 4.0. Output JSON includes attribution.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import yaml from 'js-yaml';

const root = process.argv[2];
if (!root) {
  console.error('usage: build-grammar-patterns.mjs <kimchi-grammar root>');
  process.exit(2);
}

const pointDir = join(root, 'point');
const files = readdirSync(pointDir).filter((f) => f.endsWith('.yaml'));

/**
 * Hangul ranges:
 *   - Syllables: 가-힣
 *   - Compatibility Jamo: ㄱ-ㆎ (ㄱ-ㆎ)
 *   - Conjoining Jamo (rare in plain text): ᄀ-ᇿ
 */
const HANGUL_CHAR = '[\\uAC00-\\uD7A3\\u3131-\\u318E\\u1100-\\u11FF]';

/**
 * Convert a kimchi `name` like "(으)ㄹ 수 있다/없다" to a regex source string.
 * Rules:
 *   1. `( ... )` around Korean fragments → make the fragment optional.
 *   2. `A/B` slashes → alternation `(?:A|B)` (only adjacent Korean tokens).
 *   3. Whitespace → `\s*` (flexible).
 *   4. Korean characters → kept verbatim (each contributes one literal codepoint).
 *   5. Non-Hangul leftover (English, parens, slashes already handled) → trimmed.
 */
function nameToRegex(name) {
  let s = name;

  // Step 1: Alternations like `A/B/C` (optionally paren-wrapped):
  //   `있다/없다`         → `(?:있다|없다)`           (same length, full arms)
  //   `아/어`             → `(?:아|어)`              (same length, char-level)
  //   `아/어야`           → `(?:아|어)야`            (mixed length, shared suffix `야`)
  //   `아/어/여라`        → `(?:아|어|여)라`         (mixed length, shared suffix `라`)
  //   `(은/는)`           → `(?:은|는)`             (paren-wrapped alternation)
  //   `(은/는)커녕`       → `(?:은|는)커녕`         (paren-wrapped alternation + literal)
  s = s.replace(
    new RegExp(`\\(?(${HANGUL_CHAR}+(?:/${HANGUL_CHAR}+)+)\\)?`, 'g'),
    (_full, body) => convertAlternation(body),
  );

  // Step 2: Remaining `(A)` on Korean = optional fragment.
  s = s.replace(new RegExp(`\\((${HANGUL_CHAR}+)\\)`, 'g'), (_m, h) => `(?:${escape(h)})?`);

  // Step 3: Flexible whitespace.
  s = s.replace(/\s+/g, '\\s*');

  return s.trim();
}

// Korean vowel-harmony triggers — when an alternation's first chars are one
// of these, kimchi's `A/B...X` notation means "(A|B)X" (char-level alt with
// shared suffix), not "A or BX".
const HARMONY_HEAD_SETS = [
  ['아', '어'],
  ['아', '어', '여'],
  ['았', '었'],
  ['았', '었', '였'],
];

function isHarmonyHeads(heads) {
  return HARMONY_HEAD_SETS.some(
    (set) =>
      set.length === heads.length &&
      set.every((h, i) => heads[i] === h),
  );
}

function convertAlternation(body) {
  const arms = body.split('/');
  const armChars = arms.map((a) => [...a]);
  const lens = armChars.map((a) => a.length);
  const minLen = Math.min(...lens);
  const maxLen = Math.max(...lens);

  // Same-length arms: char-by-char alt + (empty) shared suffix.
  if (minLen === maxLen) {
    return `(?:${arms.map(escape).join('|')})`;
  }

  // Mixed-length: only factor out a shared suffix when first chars form a
  // known vowel-harmony set. Otherwise the kimchi convention is ambiguous
  // (e.g. 랑/이랑 = particle-pair, not harmony) so we keep full-arm alt.
  const heads1 = armChars.map((a) => a[0]);
  if (isHarmonyHeads(heads1)) {
    // Use the longest arm's tail-beyond-min as the literal shared suffix.
    const longest = armChars[lens.indexOf(maxLen)];
    const sharedTail = longest.slice(minLen).join('');
    const headsAtMinLen = armChars.map((a) => a.slice(0, minLen).join(''));
    return `(?:${headsAtMinLen.map(escape).join('|')})${escape(sharedTail)}`;
  }

  return `(?:${arms.map(escape).join('|')})`;
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const patterns = [];
for (const file of files) {
  const id = basename(file, extname(file));
  const text = readFileSync(join(pointDir, file), 'utf8');
  let doc;
  try {
    doc = yaml.load(text);
  } catch (err) {
    console.error(`skip ${file}: yaml error ${err.message}`);
    continue;
  }
  if (!doc || !doc.name) continue;

  const defs = (doc.definitions || [])
    .map((d) => ({
      slug: d.slug || '',
      name: d.name || '',
      alt: d.english_alternatives || '',
      meaning: d.meaning || '',
    }))
    .filter((d) => d.name && d.meaning);

  // Patterns with no learner-facing definitions (e.g. irregular_verb.yaml,
  // which is structural reference) aren't useful for in-popup hints.
  if (defs.length === 0) continue;

  let re = nameToRegex(doc.name);
  if (!re || !/[가-힣]/.test(re)) {
    // No Korean content survived → skip.
    continue;
  }

  patterns.push({
    id,
    name: doc.name,
    type: doc.metadata?.type || 'other',
    defs,
    re,
  });
}

const out = {
  source: 'https://github.com/Alaanor/kimchi-grammar',
  license: 'CC-BY-4.0',
  generated_at: new Date().toISOString().replace(/\.\d{3}/, ''),
  patterns,
};

process.stdout.write(JSON.stringify(out, null, 0));
process.stderr.write(`built ${patterns.length} patterns from ${files.length} files\n`);
