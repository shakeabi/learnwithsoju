import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupHanjaLevel,
  formatHanjaLevel,
  hanjaLevelClass,
  hanjaLevelTooltip,
  hanjaLevelEntries,
  hanjaLevelSummary,
  hanjaLevelSummaryTooltip,
} from '../extension/core/hanja-levels.js';
import { HANJA_LEVEL_BY_CHAR } from '../extension/core/hanja-levels-data.js';

test('lookupHanjaLevel: known exam hanja', () => {
  assert.equal(lookupHanjaLevel('家'), 7);
  assert.equal(lookupHanjaLevel('豫'), 4);
  assert.equal(lookupHanjaLevel('約'), 5);
});

test('lookupHanjaLevel: null for hangul, multi-char, empty', () => {
  assert.equal(lookupHanjaLevel('예'), null);
  assert.equal(lookupHanjaLevel('豫約'), null);
  assert.equal(lookupHanjaLevel(''), null);
  assert.equal(lookupHanjaLevel(null), null);
});

test('formatHanjaLevel: numeric 8–1 and 特 for 특급', () => {
  assert.equal(formatHanjaLevel(8), '8');
  assert.equal(formatHanjaLevel(4), '4');
  assert.equal(formatHanjaLevel(1), '1');
  assert.equal(formatHanjaLevel(0), '特');
  assert.equal(formatHanjaLevel(null), '');
});

test('hanjaLevelTooltip: explains Hanja exam level', () => {
  assert.match(hanjaLevelTooltip(5), /^Hanja level 5 \(5급, intermediate\)$/);
  assert.match(hanjaLevelTooltip(0), /^Hanja level 特 \(특급, advanced\)$/);
  assert.equal(hanjaLevelTooltip(5, '約'), '約 — Hanja level 5 (5급, intermediate)');
});

test('hanjaLevelSummary: one label per character joined by middle dot', () => {
  assert.equal(hanjaLevelSummary('豫約'), '4·5');
  assert.equal(hanjaLevelSummary('家'), '7');
  assert.equal(hanjaLevelSummary('예약'), '');
});

test('hanjaLevelSummaryTooltip: lists each character', () => {
  assert.equal(
    hanjaLevelSummaryTooltip('豫約'),
    '豫 4급, 約 5급',
  );
});

test('hanjaLevelEntries: skips unknown characters', () => {
  const entries = hanjaLevelEntries('豫X約');
  assert.deepEqual(
    entries.map((e) => e.label),
    ['4', '5'],
  );
});

test('hanjaLevelClass: maps digit to CSS class', () => {
  assert.equal(hanjaLevelClass(8), 'lws-hanja-level-8');
  assert.equal(hanjaLevelClass(0), 'lws-hanja-level-0');
  assert.equal(hanjaLevelClass(null), '');
});

test('lookupHanjaLevel: full map has 5978 entries', () => {
  assert.equal(Object.keys(HANJA_LEVEL_BY_CHAR).length, 5978);
});
