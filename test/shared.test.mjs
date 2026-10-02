/* Unit tests for shared.js — the pure bionic-reading engine + host prefs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, textOf } from './helpers/env.mjs';

function loadEngine(storage = {}) {
  const page = createPage({ scripts: ['shared.js'], storage });
  return { ...page, FR: page.window.FocusReader };
}

test('boldifyWord leaves numeric and short words as plain text', () => {
  const { window, FR } = loadEngine();
  for (const w of ['42', '3.14', '7th', 'a', 'to', '']) {
    const node = FR.boldifyWord(w);
    assert.equal(node.nodeName, '#text', `"${w}" should stay a text node`);
    assert.equal(node.textContent, w);
  }
});

test('boldifyWord bolds floor(len/3) leading characters', () => {
  const { FR } = loadEngine();
  const node = FR.boldifyWord('reading'); // len 7 -> 2 bold chars
  assert.equal(node.className, FR.CONTAINER_CLASS);
  const bold = node.querySelector(`.${FR.BOLD_CLASS}`);
  assert.equal(bold.textContent, 're');
  assert.equal(node.textContent, 'reading');
});

test('boldifyParagraph is idempotent and preserves spacing', () => {
  const { document, FR } = loadEngine();
  document.body.innerHTML = '<p>  Focus reader  guides   you </p>';
  const p = document.querySelector('p');
  FR.boldifyParagraph(p);
  const after = p.innerHTML;
  FR.boldifyParagraph(p); // second pass must be a no-op
  assert.equal(p.innerHTML, after);
  assert.equal(textOf(p), 'Focus reader guides you');
  assert.ok(p.classList.contains(FR.PARAGRAPH_CLASS));
});

test('boldifyParagraph ignores non-paragraph nodes', () => {
  const { document, FR } = loadEngine();
  document.body.innerHTML = '<div>Hello there world</div>';
  const div = document.querySelector('div');
  FR.boldifyParagraph(div);
  assert.ok(!div.querySelector(`.${FR.BOLD_CLASS}`));
});

test('getChildTextNodes skips links and italics, and already-processed containers', () => {
  const { document, FR } = loadEngine();
  document.body.innerHTML =
    '<p>Plain <a>link text</a> <i>italic text</i> more</p>';
  const p = document.querySelector('p');
  const texts = Array.from(FR.getChildTextNodes(p), (n) => `${n.nodeValue}`);
  // The link/italic subtrees are skipped; surrounding whitespace nodes remain.
  // Array.from re-roots the array + strings into this realm (jsdom arrays
  // carry the jsdom Array prototype, which assert.deepEqual treats as unequal).
  assert.deepEqual(texts, ['Plain ', ' ', ' more']);
});

test('shouldBeActiveForUrl maps host preferences to true / false / undefined', async () => {
  const url = 'https://news.example.com/article';
  assert.equal(await loadEngine({ 'news.example.com': true }).FR.shouldBeActiveForUrl(url), true);
  assert.equal(await loadEngine({ 'news.example.com': false }).FR.shouldBeActiveForUrl(url), false);
  assert.equal(await loadEngine({}).FR.shouldBeActiveForUrl(url), undefined);
});

test('shouldBeActiveForUrl tolerates empty and malformed urls', async () => {
  const { FR } = loadEngine();
  assert.equal(await FR.shouldBeActiveForUrl(''), undefined);
  assert.equal(await FR.shouldBeActiveForUrl('not a url'), undefined);
  assert.equal(await FR.shouldBeActiveForUrl(undefined), undefined);
});
