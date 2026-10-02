/* Unit tests for popup and options UI functionality. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, readSource, settle } from './helpers/env.mjs';

test('popup loads and renders tab host and quick intensity dock', async () => {
  const html = readSource('popup.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'popup.js'],
    tabs: [{ id: 1, url: 'https://news.ycombinator.com/item?id=123' }],
    storage: { intensity: 'strong' },
    onTabMessage: (_tabId, msg) => {
      if (msg.greeting === 'isActive') return true;
      return undefined;
    },
  });

  // Trigger DOMContentLoaded
  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const hostName = page.document.getElementById('hostName');
  assert.equal(hostName.textContent, 'news.ycombinator.com');

  const hostBadge = page.document.getElementById('hostBadge');
  assert.equal(hostBadge.textContent, 'ACTIVE');

  const toggleBtn = page.document.getElementById('toggleButton');
  assert.ok(toggleBtn.classList.contains('is-active'));
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');

  const dockVal = page.document.getElementById('dockVal');
  assert.equal(dockVal.textContent, 'Strong (900)');

  // Verify clicking Light intensity button updates storage and UI
  const lightBtn = page.document.querySelector('.dock-seg-btn[data-intensity="light"]');
  assert.ok(lightBtn);
  lightBtn.click();
  await settle();

  assert.equal(page.mock.storage.intensity, 'light');
  assert.equal(dockVal.textContent, 'Light (500)');
});

test('popup cycles sample sentences', async () => {
  const html = readSource('popup.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'popup.js'],
    tabs: [{ id: 1, url: 'https://example.com' }],
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const preview = page.document.getElementById('previewSample');
  const initialText = preview.textContent;

  const cycleBtn = page.document.getElementById('cycleSampleBtn');
  assert.ok(cycleBtn);
  cycleBtn.click();
  await settle();

  const updatedText = preview.textContent;
  assert.notEqual(initialText, updatedText);
  assert.ok(updatedText.length > 10);
});

test('options page manages activation modes and reading studio', async () => {
  const html = readSource('options.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'options.js'],
    storage: { mode: 'manual', intensity: 'medium' },
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const modeManual = page.document.getElementById('modeManual');
  const modeAuto = page.document.getElementById('modeAutomatic');
  assert.ok(modeManual.classList.contains('is-selected'));
  assert.ok(!modeAuto.classList.contains('is-selected'));

  // Switch mode to automatic
  modeAuto.click();
  await settle();
  assert.equal(page.mock.storage.mode, 'automatic');
  assert.ok(modeAuto.classList.contains('is-selected'));

  // Verify studio paragraph initialized
  const studioParagraph = page.document.getElementById('studioParagraph');
  assert.ok(studioParagraph);
  assert.ok(studioParagraph.textContent.includes('visual cortex'));

  // Toggle studio bionic mode
  const toggleBtn = page.document.getElementById('studioToggleBtn');
  const toggleLabel = page.document.getElementById('studioToggleLabel');
  assert.equal(toggleLabel.textContent, 'Bionic Mode ON');

  toggleBtn.click();
  await settle();
  assert.equal(toggleLabel.textContent, 'Standard Text');
  assert.equal(studioParagraph.querySelectorAll(`.${page.window.FocusReader.BOLD_CLASS}`).length, 0);
});

test('options page manages custom site rules', async () => {
  const html = readSource('options.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'options.js'],
    storage: {
      mode: 'manual',
      intensity: 'medium',
      'wikipedia.org': true,
      'reddit.com': false,
    },
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const rulesList = page.document.getElementById('siteRulesList');
  assert.ok(rulesList);
  assert.equal(rulesList.children.length, 2);

  // Add a new rule via form
  const newRuleHost = page.document.getElementById('newRuleHost');
  const newRuleAction = page.document.getElementById('newRuleAction');
  const addForm = page.document.getElementById('addRuleForm');

  newRuleHost.value = 'https://news.ycombinator.com/path';
  newRuleAction.value = 'true';
  addForm.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  assert.equal(page.mock.storage['news.ycombinator.com'], true);
  assert.equal(rulesList.children.length, 3);

  // Delete a rule
  const firstDelBtn = rulesList.querySelector('.rule-del-btn');
  assert.ok(firstDelBtn);
  firstDelBtn.click();
  await settle();

  assert.equal(rulesList.children.length, 2);
});
