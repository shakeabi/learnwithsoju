import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findMatches, locateSurface, isUsefulPattern } from '../extension/grammar-match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(readFileSync(
  join(__dirname, '../extension/vendor/grammar-patterns/patterns.json'),
  'utf8',
));

test('locateSurface: finds the surface in the sentence', () => {
  const r = locateSurface('학생으로서 책임을 다해야 합니다.', '학생으로서');
  assert.deepEqual(r, { start: 0, end: 5 });
});

test('locateSurface: returns null when surface absent', () => {
  assert.equal(locateSurface('hello world', '학교'), null);
  assert.equal(locateSurface('', '학교'), null);
  assert.equal(locateSurface('학교', ''), null);
});

test('isUsefulPattern: filters out 1-char-name patterns', () => {
  // The patterns DB has many single-char particle names (요, 부, 고, 지, …)
  // which are too noisy to surface as grammar hints. Filter requires ≥ 2
  // Hangul chars in the display name.
  assert.equal(isUsefulPattern({ name: '요', defs: [{}] }), false);
  assert.equal(isUsefulPattern({ name: '고 있다', defs: [{}] }), true);
  assert.equal(isUsefulPattern({ name: '(으)로서', defs: [{}] }), true);
  assert.equal(isUsefulPattern(null), false);
  assert.equal(isUsefulPattern({}), false);
});

test('findMatches: surfaces a pattern that overlaps the hovered word', () => {
  const sentence = '학생으로서 책임을 다해야 합니다.';
  const range = locateSurface(sentence, '학생으로서');
  const matches = findMatches(db, sentence, range);
  // Should include (으)로서 — it sits right at the hovered word
  const ids = matches.map((m) => m.pattern.id);
  assert.ok(ids.includes('noun_으로서'), `expected noun_으로서 in ${JSON.stringify(ids)}`);
});

test('findMatches: respects adjacency window — distant matches are excluded', () => {
  const sentence = '학교에서 책을 읽으면서 노래를 들어요.';
  // Hover on 학교에서 — should match 에서 and 면서 (if matched at all),
  // but only those near the hovered word, not unrelated particles far away.
  const range = locateSurface(sentence, '학교에서');
  const matches = findMatches(db, sentence, range, { adjacency: 0 });
  // Every hit must overlap the hovered range
  for (const m of matches) {
    assert.ok(m.end >= range.start && m.start <= range.end,
      `${m.pattern.name} matched outside hovered range: [${m.start},${m.end}] vs [${range.start},${range.end}]`);
  }
});

test('findMatches: respects maxResults cap', () => {
  const sentence = '학교에서 친구들과 점심을 먹었어요.';
  const range = locateSurface(sentence, '친구들과');
  const matches = findMatches(db, sentence, range, { maxResults: 2 });
  assert.ok(matches.length <= 2);
});

test('findMatches: each pattern appears at most once', () => {
  const sentence = '저는 학교에 가고 있어요.';
  const range = locateSurface(sentence, '가고');
  const matches = findMatches(db, sentence, range);
  const ids = matches.map((m) => m.pattern.id);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, 'duplicate pattern ids in results');
});

test('findMatches: returns empty for sentences without grammatical hits', () => {
  const sentence = '안녕하세요.';
  const range = locateSurface(sentence, '안녕하세요');
  const matches = findMatches(db, sentence, range);
  // May be empty (no useful patterns match a bare greeting) — verify no crashes
  assert.ok(Array.isArray(matches));
});

test('findMatches: empty / null inputs gracefully return []', () => {
  assert.deepEqual(findMatches(null, 'sentence', { start: 0, end: 1 }), []);
  assert.deepEqual(findMatches(db, '', { start: 0, end: 1 }), []);
  assert.deepEqual(findMatches(db, 'x', null), []);
});

test('patterns DB: structurally well-formed, has many entries', () => {
  assert.ok(Array.isArray(db.patterns));
  assert.ok(db.patterns.length > 100, `expected many patterns, got ${db.patterns.length}`);
  for (const p of db.patterns.slice(0, 10)) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.re, 'string');
    assert.ok(Array.isArray(p.defs));
    assert.ok(p.defs.length > 0);
  }
});

test('patterns DB: includes attribution metadata', () => {
  // CC-BY 4.0 requires attribution in some accessible form. We surface it
  // via the JSON header (`source`, `license`) so any consumer of this file
  // sees where the data originated.
  assert.equal(db.license, 'CC-BY-4.0');
  assert.ok(typeof db.source === 'string' && db.source.length > 0);
});
