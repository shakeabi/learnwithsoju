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
