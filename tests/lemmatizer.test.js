import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lemmaCandidates } from '../extension/lemmatizer.js';

test('returns the surface form as the first candidate', () => {
  assert.equal(lemmaCandidates('사람')[0], '사람');
  assert.equal(lemmaCandidates('학교에서')[0], '학교에서');
  assert.equal(lemmaCandidates('먹었어요')[0], '먹었어요');
});

test('plain noun: surface IS the dictionary form', () => {
  for (const noun of ['사람', '학교', '한국말', '컴퓨터']) {
    assert.ok(lemmaCandidates(noun).includes(noun), `expected ${noun} to be a candidate`);
  }
});

test('strips common particles to recover noun stem', () => {
  const cases = [
    ['학교에서', '학교'],
    ['친구에게', '친구'],
    ['책을', '책'],
    ['집에', '집'],
    ['우리는', '우리'],
    ['도서관까지', '도서관'],
  ];
  for (const [surface, expectedStem] of cases) {
    const candidates = lemmaCandidates(surface);
    assert.ok(
      candidates.includes(expectedStem),
      `expected ${surface} candidates ${JSON.stringify(candidates)} to include ${expectedStem}`,
    );
  }
});

test('strips verb endings and proposes stem + 다', () => {
  // For each surface, at least one of the listed candidates should appear.
  // The list is "any of these dictionary forms is good enough to land a hit
  // when tried against KRDict in order"; not all are linguistically the
  // canonical lemma, but they cover the realistic suffix-strip output.
  const cases = [
    { surface: '먹었어요', expectAny: ['먹다'] },
    { surface: '읽어요', expectAny: ['읽다'] },
    { surface: '웃었다', expectAny: ['웃다'] },
    // 가다 (irregular: 가+았=갔) — suffix strip can only reach 갔다, which
    // KRDict won't match. Documents the V1 limitation; V2 morph analyzer
    // should resolve 가다.
    { surface: '갔습니다', expectAny: ['갔다'] },
    // 공부하다 compound — our stripper can't reconstruct 하 from 했, but
    // it does isolate the 공부 noun root, which KRDict has.
    { surface: '공부했어요', expectAny: ['공부', '공부하다'] },
  ];
  for (const { surface, expectAny } of cases) {
    const candidates = lemmaCandidates(surface);
    const matched = expectAny.some((e) => candidates.includes(e));
    assert.ok(
      matched,
      `${surface} → ${JSON.stringify(candidates)} should include one of ${JSON.stringify(expectAny)}`,
    );
  }
});

test('returns empty array for empty/null input', () => {
  assert.deepEqual(lemmaCandidates(''), []);
  assert.deepEqual(lemmaCandidates(null), []);
  assert.deepEqual(lemmaCandidates(undefined), []);
});

test('does not produce duplicate candidates', () => {
  const candidates = lemmaCandidates('학교');
  const set = new Set(candidates);
  assert.equal(candidates.length, set.size, `duplicates found in ${JSON.stringify(candidates)}`);
});

test('does not produce empty-string candidates', () => {
  for (const word of ['사람', '먹었어요', '학교에서', '가', '을']) {
    const candidates = lemmaCandidates(word);
    assert.ok(candidates.every((c) => c.length > 0), `empty candidate in ${JSON.stringify(candidates)}`);
  }
});

test('handles single-character input gracefully', () => {
  const candidates = lemmaCandidates('가');
  assert.ok(Array.isArray(candidates));
  assert.equal(candidates[0], '가');
});

test('priority ordering: surface > particle/verb stem > char-trim fallback', () => {
  const candidates = lemmaCandidates('먹었어요');
  const surfaceIdx = candidates.indexOf('먹었어요');
  const lemmaIdx = candidates.indexOf('먹다');
  const trimIdx = candidates.indexOf('먹');
  assert.equal(surfaceIdx, 0);
  assert.ok(lemmaIdx > 0 && lemmaIdx < trimIdx, `expected lemma 먹다 before bare-trim 먹: ${JSON.stringify(candidates)}`);
});
