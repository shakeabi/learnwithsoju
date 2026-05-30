import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KRDICT_ENDPOINT,
  OPENDICT_ENDPOINT,
  MIN_NUM,
  buildKrdictUrl,
  buildOpendictUrl,
  looksEmpty,
  extractApiError,
  extractItemWords,
  groupByWord,
  pickTabsAndUnrelated,
} from '../extension/api.js';

test('buildKrdictUrl: includes required params', () => {
  const url = new URL(buildKrdictUrl('먹다', 'TEST_KEY'));
  assert.equal(url.origin + url.pathname, KRDICT_ENDPOINT);
  assert.equal(url.searchParams.get('key'), 'TEST_KEY');
  assert.equal(url.searchParams.get('q'), '먹다');
  assert.equal(url.searchParams.get('part'), 'word');
  assert.equal(url.searchParams.get('translated'), 'y');
  assert.equal(url.searchParams.get('trans_lang'), '1');
  assert.equal(url.searchParams.get('sort'), 'dict');
});

test('buildKrdictUrl: defaults num to the API minimum (10)', () => {
  const url = new URL(buildKrdictUrl('학교', 'KEY'));
  assert.equal(url.searchParams.get('num'), '10');
});

test('buildKrdictUrl: clamps num to the [10, 100] range', () => {
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: 5 })).searchParams.get('num'), '10');
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: 9 })).searchParams.get('num'), '10');
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: 10 })).searchParams.get('num'), '10');
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: 50 })).searchParams.get('num'), '50');
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: 200 })).searchParams.get('num'), '100');
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: NaN })).searchParams.get('num'), '10');
  assert.equal(new URL(buildKrdictUrl('a', 'k', { num: undefined })).searchParams.get('num'), '10');
});

test('buildKrdictUrl: trans_lang override', () => {
  const url = new URL(buildKrdictUrl('a', 'k', { transLang: '2' }));
  assert.equal(url.searchParams.get('trans_lang'), '2');
});

test('buildKrdictUrl: throws when query or key is missing', () => {
  assert.throws(() => buildKrdictUrl('', 'k'), /query required/);
  assert.throws(() => buildKrdictUrl('a', ''), /apiKey required/);
});

test('buildOpendictUrl: includes required params, defaults num=10', () => {
  const url = new URL(buildOpendictUrl('나무', 'KEY'));
  assert.equal(url.origin + url.pathname, OPENDICT_ENDPOINT);
  assert.equal(url.searchParams.get('key'), 'KEY');
  assert.equal(url.searchParams.get('q'), '나무');
  assert.equal(url.searchParams.get('req_type'), 'xml');
  assert.equal(url.searchParams.get('num'), '10');
  assert.equal(url.searchParams.get('part'), 'word');
  assert.equal(url.searchParams.get('sort'), 'dict');
});

test('buildOpendictUrl: respects reqType=json', () => {
  const url = new URL(buildOpendictUrl('a', 'k', { reqType: 'json' }));
  assert.equal(url.searchParams.get('req_type'), 'json');
});

test('buildOpendictUrl: clamps num like KRDict', () => {
  assert.equal(new URL(buildOpendictUrl('a', 'k', { num: 1 })).searchParams.get('num'), '10');
  assert.equal(new URL(buildOpendictUrl('a', 'k', { num: 200 })).searchParams.get('num'), '100');
});

test('buildOpendictUrl: throws when query or key is missing', () => {
  assert.throws(() => buildOpendictUrl('', 'k'), /query required/);
  assert.throws(() => buildOpendictUrl('a', ''), /apiKey required/);
});

test('MIN_NUM is 10', () => {
  assert.equal(MIN_NUM, 10);
});

test('looksEmpty: handles falsy / null / empty', () => {
  assert.equal(looksEmpty(null), true);
  assert.equal(looksEmpty(undefined), true);
  assert.equal(looksEmpty(''), true);
});

test('looksEmpty: detects <error> wrapper responses', () => {
  assert.equal(looksEmpty('<error><error_code>020</error_code></error>'), true);
  assert.equal(looksEmpty('<error >text</error>'), true);
});

test('looksEmpty: <error_code> alone is still treated as empty (no <item>)', () => {
  // The function has multiple ways to declare "empty"; absence of <item>
  // is sufficient regardless of whether it parses as a real <error> envelope.
  assert.equal(looksEmpty('<error_code>020</error_code>'), true);
});

test('looksEmpty: detects total=0', () => {
  const xml = '<channel><total>0</total><start>1</start></channel>';
  assert.equal(looksEmpty(xml), true);
});

test('looksEmpty: detects responses without <item>', () => {
  const xml = '<channel><total>5</total></channel>';
  assert.equal(looksEmpty(xml), true);
});

test('looksEmpty: returns false on populated responses', () => {
  const xml = '<channel><total>1</total><item><word>x</word></item></channel>';
  assert.equal(looksEmpty(xml), false);
});

test('looksEmpty: handles total=1 but treats <item> presence as authoritative', () => {
  const xml = '<channel><total>1</total><item /></channel>';
  assert.equal(looksEmpty(xml), false);
});

test('extractApiError: returns null for non-error', () => {
  assert.equal(extractApiError('<channel><total>1</total></channel>'), null);
  assert.equal(extractApiError(''), null);
});

test('extractApiError: extracts code and message', () => {
  const err = extractApiError('<error><error_code>020</error_code><message>Unregistered key</message></error>');
  assert.deepEqual(err, { code: '020', message: 'Unregistered key' });
});

test('extractApiError: tolerates missing message', () => {
  const err = extractApiError('<error><error_code>050</error_code></error>');
  assert.deepEqual(err, { code: '050', message: '' });
});

test('extractItemWords: reads <word> per <item> in document order', () => {
  const xml = `<channel>
    <total>3</total>
    <item><target_code>1</target_code><word>살</word><pos>명사</pos></item>
    <item><target_code>2</target_code><word>살다</word><pos>동사</pos></item>
    <item><target_code>3</target_code><word>살-</word><pos>접사</pos></item>
  </channel>`;
  assert.deepEqual(extractItemWords(xml), ['살', '살다', '살-']);
});

test('extractItemWords: empty / null xml yields []', () => {
  assert.deepEqual(extractItemWords(null), []);
  assert.deepEqual(extractItemWords(''), []);
  assert.deepEqual(extractItemWords('<channel><total>0</total></channel>'), []);
});

test('extractItemWords: item without <word> contributes empty string (idx alignment)', () => {
  const xml = `<channel>
    <item><word>가</word></item>
    <item><pos>X</pos></item>
    <item><word>다</word></item>
  </channel>`;
  assert.deepEqual(extractItemWords(xml), ['가', '', '다']);
});

test('groupByWord: groups by word preserving first-occurrence order, drops empties', () => {
  const groups = groupByWord(['살', '살', '살다', '', '살', '살-']);
  assert.deepEqual(groups, [
    { word: '살', indices: [0, 1, 4] },
    { word: '살다', indices: [2] },
    { word: '살-', indices: [5] },
  ]);
});

test('pickTabsAndUnrelated: 살이었지 worked example (3 tabs + 1 unrelated)', () => {
  // Query order: [살, 살다, 살이, 살이었지, 사다]
  const result = pickTabsAndUnrelated({
    krQueries: ['살', '살다', '살이', '살이었지', '사다'],
    krWordsPerQuery: [
      ['살', '살', '살', '살-', '살다'],
      ['살다'],
      [],
      [],
      ['사다'],
    ],
  });
  assert.deepEqual(result.tabs.map((t) => t.word), ['살', '살다', '사다']);
  // Tab 살 holds sections for the three 살 items from query 0.
  assert.deepEqual(
    result.tabs[0].sections,
    [
      { source: 'kr', queryIdx: 0, itemIdx: 0 },
      { source: 'kr', queryIdx: 0, itemIdx: 1 },
      { source: 'kr', queryIdx: 0, itemIdx: 2 },
    ],
  );
  // Tab 살다 picks query 1 first, then folds query 0's 살다 item via step 4.
  assert.deepEqual(
    result.tabs[1].sections,
    [
      { source: 'kr', queryIdx: 1, itemIdx: 0 },
      { source: 'kr', queryIdx: 0, itemIdx: 4 },
    ],
  );
  assert.deepEqual(
    result.tabs[2].sections,
    [{ source: 'kr', queryIdx: 4, itemIdx: 0 }],
  );
  // 살- is the leftover from query 0.
  assert.deepEqual(result.unrelated.map((u) => u.word), ['살-']);
  assert.deepEqual(
    result.unrelated[0].sections,
    [{ source: 'kr', queryIdx: 0, itemIdx: 3 }],
  );
});

test('pickTabsAndUnrelated: all five first-groups the same word collapse to one tab', () => {
  // Edge case from spec: every query's first group is the same word, and the
  // other four queries have no further groups → 1 tab with 5 sections.
  const result = pickTabsAndUnrelated({
    krQueries: ['가', '가다', '가요', '가서', '간'],
    krWordsPerQuery: [
      ['가다'],
      ['가다'],
      ['가다'],
      ['가다'],
      ['가다'],
    ],
  });
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabs[0].word, '가다');
  assert.equal(result.tabs[0].sections.length, 5);
  assert.equal(result.unrelated.length, 0);
});

test('pickTabsAndUnrelated: query whose first group is already tabbed advances to next group', () => {
  // Per spec step 3: "Dedupe: if that group\'s word was already picked from
  // an earlier query, skip and pick the NEXT group from the current query."
  const result = pickTabsAndUnrelated({
    krQueries: ['a', 'b'],
    krWordsPerQuery: [
      ['먹다'],
      ['먹다', '먹이'],
    ],
  });
  assert.deepEqual(result.tabs.map((t) => t.word), ['먹다', '먹이']);
  // Query 1's 먹다 still folds into the existing tab via cross-query consolidation.
  assert.equal(result.tabs[0].sections.length, 2);
  assert.equal(result.unrelated.length, 0);
});

test('pickTabsAndUnrelated: all queries empty yields empty plan', () => {
  const result = pickTabsAndUnrelated({
    krQueries: ['a', 'b'],
    krWordsPerQuery: [[], []],
  });
  assert.deepEqual(result, { tabs: [], unrelated: [] });
});

test('pickTabsAndUnrelated: OpenDict fallback contributes as a tail query with source=od', () => {
  const result = pickTabsAndUnrelated({
    krQueries: ['x', 'y'],
    krWordsPerQuery: [[], []],
    odQuery: '먹다',
    odWords: ['먹다'],
  });
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabs[0].word, '먹다');
  assert.equal(result.tabs[0].sections[0].source, 'od');
  assert.equal(result.tabs[0].sections[0].queryIdx, 2);
});

test('pickTabsAndUnrelated: query with no new word skips, picks no tab', () => {
  // Query 1's only word duplicates the tab picked from query 0.
  const result = pickTabsAndUnrelated({
    krQueries: ['a', 'b', 'c'],
    krWordsPerQuery: [
      ['먹다', '먹이'],
      ['먹다'],
      ['살다'],
    ],
  });
  assert.deepEqual(result.tabs.map((t) => t.word), ['먹다', '살다']);
  // Query 1's 먹다 folds into the existing 먹다 tab (cross-query consolidation).
  assert.equal(result.tabs[0].sections.length, 2);
  assert.deepEqual(result.unrelated.map((u) => u.word), ['먹이']);
});
