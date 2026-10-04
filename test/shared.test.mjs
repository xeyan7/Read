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

test('resolveActive defaults to always-active unless manual or host-disabled', async () => {
  const { FR } = loadEngine({});
  assert.equal(await FR.resolveActive('https://example.com/page', undefined), true);
  assert.equal(await FR.resolveActive('https://example.com/page', 'automatic'), true);
  assert.equal(await FR.resolveActive('https://example.com/page', 'manual'), false);
  assert.equal(await loadEngine({ 'example.com': false }).FR.resolveActive('https://example.com/page', 'automatic'), false);
});

test('normalizeTheme keeps dark and light, defaulting to dark', () => {
  const { FR } = loadEngine();
  assert.equal(FR.normalizeTheme('dark'), 'dark');
  assert.equal(FR.normalizeTheme('light'), 'light');
  assert.equal(FR.normalizeTheme('solar'), 'dark');
  assert.equal(FR.normalizeTheme('unknown'), 'dark');
  assert.equal(FR.normalizeMode('manual'), 'manual');
  assert.equal(FR.normalizeMode('automatic'), 'automatic');
  assert.equal(FR.normalizeMode(undefined), 'automatic');
});

test('calculateBoldLength adheres to research-backed OVP and classic formulas', () => {
  const { FR } = loadEngine();
  // Classic 1/3
  assert.equal(FR.calculateBoldLength('reading', 'classic'), 2); // 7 / 3 = 2
  assert.equal(FR.calculateBoldLength('to', 'classic'), 0);
  assert.equal(FR.calculateBoldLength('that', 'classic'), 1);

  // Optimal OVP
  assert.equal(FR.calculateBoldLength('a', 'optimal'), 0);
  assert.equal(FR.calculateBoldLength('to', 'optimal'), 1);
  assert.equal(FR.calculateBoldLength('the', 'optimal'), 1);
  assert.equal(FR.calculateBoldLength('that', 'optimal'), 2);
  assert.equal(FR.calculateBoldLength('focus', 'optimal'), 2);
  assert.equal(FR.calculateBoldLength('reader', 'optimal'), 3);
  assert.equal(FR.calculateBoldLength('reading', 'optimal'), 3);
  assert.equal(FR.calculateBoldLength('research', 'optimal'), 4);
  assert.equal(FR.calculateBoldLength('attention', 'optimal'), 5);
  assert.equal(FR.calculateBoldLength('comprehension', 'optimal'), 6);
  assert.equal(FR.calculateBoldLength('a', 'optimal'), 0);
  assert.equal(FR.calculateBoldLength('internationalization', 'optimal'), 10);

  // High Focus: 4-letter words stay 2 bold 2 simple
  assert.equal(FR.calculateBoldLength('that', 'high'), 2);
  assert.equal(FR.calculateBoldLength('reading', 'high'), 4);
});

test('adheres strictly to user-specified 10-tier word-length bolding rules and OVP constraints', () => {
  const { FR } = loadEngine();

  // Tier 1: 1-letter words (a, I) -> 0 letters bolded
  assert.equal(FR.calculateBoldLength('a', 'optimal'), 0);
  assert.equal(FR.calculateBoldLength('I', 'optimal'), 0);
  assert.equal(FR.shouldBoldWord('a'), false);
  assert.equal(FR.shouldBoldWord('I'), false);

  // Tier 2: 2-letter words (to, in, on) -> 1 letter bolded when anchored, plain when function word
  assert.equal(FR.calculateBoldLength('to', 'optimal'), 1);
  assert.equal(FR.calculateBoldLength('in', 'optimal'), 1);
  assert.equal(FR.calculateBoldLength('on', 'optimal'), 1);
  assert.equal(FR.shouldBoldWord('to', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('in', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('on', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('to', { saccade: 'all' }), true);

  // Tier 3: 3-letter words (the, and, cat) -> 1 letter bolded (~33%)
  assert.equal(FR.calculateBoldLength('the', 'optimal'), 1);
  assert.equal(FR.calculateBoldLength('and', 'optimal'), 1);
  assert.equal(FR.calculateBoldLength('cat', 'optimal'), 1);
  assert.equal(FR.shouldBoldWord('the', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('and', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('cat', { saccade: 'optimal' }), true);

  // Tier 4: 4-letter words (read, fast, word) -> 2 letters (50% - OVP)
  assert.equal(FR.calculateBoldLength('read', 'optimal'), 2);
  assert.equal(FR.calculateBoldLength('fast', 'optimal'), 2);
  assert.equal(FR.calculateBoldLength('word', 'optimal'), 2);

  // Tier 5: 5-letter words (focus, brain, speed) -> 2 letters (40% - OVP)
  assert.equal(FR.calculateBoldLength('focus', 'optimal'), 2);
  assert.equal(FR.calculateBoldLength('brain', 'optimal'), 2);
  assert.equal(FR.calculateBoldLength('speed', 'optimal'), 2);

  // Tier 6: 6-letter words (reader, visual, cortex) -> 3 letters (50% - syllable onset)
  assert.equal(FR.calculateBoldLength('reader', 'optimal'), 3);
  assert.equal(FR.calculateBoldLength('visual', 'optimal'), 3);
  assert.equal(FR.calculateBoldLength('cortex', 'optimal'), 3);

  // Tier 7: 7-letter words (reading, letters, optimal) -> 3 letters (42.8% - OVP)
  assert.equal(FR.calculateBoldLength('reading', 'optimal'), 3);
  assert.equal(FR.calculateBoldLength('letters', 'optimal'), 3);
  assert.equal(FR.calculateBoldLength('optimal', 'optimal'), 3);

  // Tier 8: 8-letter words (research, sentence) -> 3 to 4 letters (37.5% - 50%)
  const boldResearch = FR.calculateBoldLength('research', 'optimal');
  const boldSentence = FR.calculateBoldLength('sentence', 'optimal');
  assert.ok(boldResearch >= 3 && boldResearch <= 4);
  assert.ok(boldSentence >= 3 && boldSentence <= 4);

  // Tier 9: 9-10 letter words (attention, extension) -> 5 letters
  assert.equal(FR.calculateBoldLength('attention', 'optimal'), 5);
  assert.equal(FR.calculateBoldLength('extension', 'optimal'), 5);

  // Tier 10: 11+ letter words handled individually (12 -- x, 13 -- y, etc.):
  assert.equal(FR.calculateBoldLength('information', 'optimal'), 5); // 11 letters -> 5
  assert.equal(FR.calculateBoldLength('development', 'optimal'), 5); // 11 letters -> 5
  assert.equal(FR.calculateBoldLength('relationship', 'optimal'), 6); // 12 letters -> 6
  assert.equal(FR.calculateBoldLength('significance', 'optimal'), 6); // 12 letters -> 6
  assert.equal(FR.calculateBoldLength('comprehension', 'optimal'), 6); // 13 letters -> 6
  assert.equal(FR.calculateBoldLength('transformation', 'optimal'), 7); // 14 letters -> 7
  assert.equal(FR.calculateBoldLength('characteristics', 'optimal'), 7); // 15 letters -> 7
  assert.equal(FR.calculateBoldLength('responsibilities', 'optimal'), 8); // 16 letters -> 8
  assert.equal(FR.calculateBoldLength('telecommunication', 'optimal'), 8); // 17 letters -> 8
  assert.equal(FR.calculateBoldLength('interchangeability', 'optimal'), 9); // 18 letters -> 9
  assert.equal(FR.calculateBoldLength('characteristically', 'optimal'), 9); // 19 letters -> 9
  assert.equal(FR.calculateBoldLength('internationalization', 'optimal'), 10); // 20 letters -> 10
});

test('boldifyWord isolates punctuation around words', () => {
  const { FR } = loadEngine();
  const node = FR.boldifyWord('“reading”');
  assert.equal(node.textContent, '“reading”');
  const bold = node.querySelector(`.${FR.BOLD_CLASS}`);
  assert.equal(bold.textContent, 're');

  const parenNode = FR.boldifyWord('(focus)', 'optimal');
  assert.equal(parenNode.textContent, '(focus)');
  const parenBold = parenNode.querySelector(`.${FR.BOLD_CLASS}`);
  assert.equal(parenBold.textContent, 'fo');
});

test('shouldBeActiveForUrl resolves subdomains with www fallback', async () => {
  const baseStored = loadEngine({ 'example.com': true });
  assert.equal(await baseStored.FR.shouldBeActiveForUrl('https://www.example.com/article'), true);

  const wwwStored = loadEngine({ 'www.nyt.com': false });
  assert.equal(await wwwStored.FR.shouldBeActiveForUrl('https://nyt.com/story'), false);
});

test('isSkippable protects contenteditable containers', () => {
  const { document, FR } = loadEngine();
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const p = document.createElement('p');
  p.textContent = 'Do not touch editable content';
  editable.appendChild(p);
  document.body.appendChild(editable);

  FR.boldifyParagraph(p);
  assert.equal(p.querySelectorAll(`.${FR.BOLD_CLASS}`).length, 0);
});

test('shouldBoldWord adheres to research-backed Keith Rayner fixation cadence', () => {
  const { FR } = loadEngine();

  // 1-letter words always plain
  assert.equal(FR.shouldBoldWord('a'), false);
  assert.equal(FR.shouldBoldWord('I'), false);

  // Short function words bypassed in optimal mode
  assert.equal(FR.shouldBoldWord('the', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('to', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('in', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('of', { saccade: 'optimal' }), false);
  assert.equal(FR.shouldBoldWord('and', { saccade: 'optimal' }), false);

  // Content words bolded in optimal mode
  assert.equal(FR.shouldBoldWord('reading', { saccade: 'optimal' }), true);
  assert.equal(FR.shouldBoldWord('focus', { saccade: 'optimal' }), true);
  assert.equal(FR.shouldBoldWord('brain', { saccade: 'optimal' }), true);

  // 'all' mode bolds everything eligible
  assert.equal(FR.shouldBoldWord('the', { saccade: 'all' }), true);
  assert.equal(FR.shouldBoldWord('to', { saccade: 'all' }), true);
  assert.equal(FR.shouldBoldWord('reading', { saccade: 'all' }), true);

  // 'alternating' mode anchors every 2nd word
  assert.equal(FR.shouldBoldWord('focus', { saccade: 'alternating', index: 0 }), true);
  assert.equal(FR.shouldBoldWord('reader', { saccade: 'alternating', index: 1 }), false);
  assert.equal(FR.shouldBoldWord('guides', { saccade: 'alternating', index: 2 }), true);
  assert.equal(FR.shouldBoldWord('eyes', { saccade: 'alternating', index: 3 }), false);
});

test('boldifyParagraph applies research-optimal word fixation cadence', () => {
  const { document, FR } = loadEngine();
  document.body.innerHTML = '<p>In the act of reading, consciousness projects frameworks</p>';
  const p = document.querySelector('p');

  FR.boldifyParagraph(p, { saccade: 'optimal', fixation: 'optimal' });

  // "In", "the", "of" should be unbolded plain text nodes (skipped per Rayner research)
  // "act", "reading", "consciousness", "projects", "frameworks" should be bolded
  const boldSpans = Array.from(p.querySelectorAll(`.${FR.BOLD_CLASS}`)).map(s => s.textContent);
  assert.deepEqual(boldSpans, ['a', 'rea', 'consci', 'proj', 'frame']);

  // Second pass with 'all' mode on fresh paragraph bolds all words including function words
  const pAll = document.createElement('p');
  pAll.textContent = 'In the act of reading';
  document.body.appendChild(pAll);
  FR.boldifyParagraph(pAll, { saccade: 'all', fixation: 'optimal' });
  const allBoldSpans = Array.from(pAll.querySelectorAll(`.${FR.BOLD_CLASS}`)).map(s => s.textContent);
  assert.deepEqual(allBoldSpans, ['I', 't', 'a', 'o', 'rea']);
});

test('intensity weights and faux-bold channels are calibrated to prevent visual fatigue', () => {
  const { FR } = loadEngine();
  // Calibrated weights: Light = 600, Medium = 750, Strong = 825
  assert.equal(FR.INTENSITY_WEIGHTS.light, 600);
  assert.equal(FR.INTENSITY_WEIGHTS.medium, 750);
  assert.equal(FR.INTENSITY_WEIGHTS.strong, 825);

  // Display numbers match applied weights
  assert.equal(FR.displayWeightFor('light'), 600);
  assert.equal(FR.displayWeightFor('medium'), 750);
  assert.equal(FR.displayWeightFor('strong'), 825);

  // Label helper returns UI strings without numbers
  assert.equal(FR.labelFor('light'), 'Light');
  assert.equal(FR.labelFor('medium'), 'Medium');
  assert.equal(FR.labelFor('strong'), 'Strong');

  // Stroke width and text-shadow boosts provide clear separation
  assert.equal(FR.strokeFor('light'), 0);
  assert.equal(FR.strokeFor('medium'), 0.05);
  assert.equal(FR.strokeFor('strong'), 0.12);

  assert.equal(FR.boostFor('light'), 0);
  assert.equal(FR.boostFor('medium'), 0.08);
  assert.equal(FR.boostFor('strong'), 0.18);

  // normalizeSaccade
  assert.equal(FR.normalizeSaccade('optimal'), 'optimal');
  assert.equal(FR.normalizeSaccade('all'), 'all');
  assert.equal(FR.normalizeSaccade('alternating'), 'alternating');
  assert.equal(FR.normalizeSaccade('unknown'), 'optimal');
});

