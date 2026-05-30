import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure replica of synthesizeProperNounEntry from background.js.
// background.js cannot be imported in Node (chrome.* globals at module scope),
// so we test the pure logic here. Keep this in sync with the background
// implementation.
function synthesizeProperNounEntry(surface, tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const nnpToken = tokens.find((t) => {
    const tag = (t.pos || '').split('+')[0];
    return tag === 'NNP';
  });
  if (!nnpToken) return [];
  const word = surface;
  return [{
    word,
    sections: [{
      source: 'synthetic-nnp',
      word,
      pos: '고유명사',
      definition: `${word} — Proper noun (name of a person, place, or thing). No dictionary entry found.`,
      pronunciation: word,
      isSynthetic: true,
    }],
  }];
}

const tok = (surface, pos) => ({ surface, pos });

test('synthesizeProperNounEntry: returns a tab when 1-best path has an NNP token', () => {
  const tokens = [tok('민수', 'NNP')];
  const result = synthesizeProperNounEntry('민수', tokens);
  assert.equal(result.length, 1, 'should produce exactly one tab');
  const tab = result[0];
  assert.equal(tab.word, '민수');
  assert.equal(tab.sections.length, 1);
  const section = tab.sections[0];
  assert.equal(section.source, 'synthetic-nnp');
  assert.equal(section.pos, '고유명사');
  assert.equal(section.isSynthetic, true);
  assert.ok(section.definition.includes('Proper noun'), 'definition should mention Proper noun');
  assert.equal(section.pronunciation, '민수');
});

test('synthesizeProperNounEntry: uses the WHOLE surface as the entry word', () => {
  // 김민수가 → 김민수/NNP + 가/JKS; surface is the full eojeol
  const tokens = [tok('김민수', 'NNP'), tok('가', 'JKS')];
  const result = synthesizeProperNounEntry('김민수가', tokens);
  assert.equal(result.length, 1);
  assert.equal(result[0].word, '김민수가', 'word should be the full surface, not just the NNP token');
  assert.equal(result[0].sections[0].pronunciation, '김민수가');
});

test('synthesizeProperNounEntry: prefix-matches NNP even when pos is compound like NNP+JX', () => {
  const tokens = [tok('강남구', 'NNP+JX')];
  const result = synthesizeProperNounEntry('강남구', tokens);
  assert.equal(result.length, 1);
  assert.equal(result[0].sections[0].source, 'synthetic-nnp');
});

test('synthesizeProperNounEntry: returns empty array when no NNP token present', () => {
  // 먹다 → NNG + VV — no NNP, dict just had no entry; no synthesis
  const tokens = [tok('먹', 'VV'), tok('었', 'EP'), tok('어요', 'EF')];
  const result = synthesizeProperNounEntry('먹었어요', tokens);
  assert.deepEqual(result, []);
});

test('synthesizeProperNounEntry: returns empty array for empty token list', () => {
  assert.deepEqual(synthesizeProperNounEntry('민수', []), []);
});

test('synthesizeProperNounEntry: returns empty array when tokens is not an array', () => {
  assert.deepEqual(synthesizeProperNounEntry('민수', null), []);
  assert.deepEqual(synthesizeProperNounEntry('민수', undefined), []);
});
