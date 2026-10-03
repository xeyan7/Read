/* Unit tests for popup and options UI functionality. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, readSource, settle } from './helpers/env.mjs';

test('popup loads and renders quick intensity dock in active state', async () => {
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

  // Host status card was removed — no per-site badge UI should remain.
  assert.equal(page.document.getElementById('hostCard'), null);
  assert.equal(page.document.getElementById('hostName'), null);
  assert.equal(page.document.getElementById('hostBadge'), null);

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

test('popup defaults to always-active when tab is unreachable and no prefs exist', async () => {
  const html = readSource('popup.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'popup.js'],
    tabs: [{ id: 2, url: 'https://example.com/article' }],
    storage: {},
    onTabMessage: () => undefined,
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const toggleBtn = page.document.getElementById('toggleButton');
  assert.ok(toggleBtn.classList.contains('is-active'));
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
});

test('popup theme toggle cycles dark and light', async () => {
  const html = readSource('popup.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'popup.js'],
    tabs: [{ id: 3, url: 'https://example.com' }],
    storage: {},
    onTabMessage: () => undefined,
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const themeToggle = page.document.getElementById('themeToggle');
  assert.ok(themeToggle);
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');

  themeToggle.click();
  await settle();
  assert.equal(page.window.document.documentElement.dataset.theme, 'light');
  assert.equal(page.mock.storage.theme, 'light');

  themeToggle.click();
  await settle();
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.mock.storage.theme, 'dark');
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

test('popup self-heals tabs missing the content script', async () => {
  const html = readSource('popup.html');
  let tabCalls = 0;
  const page = createPage({
    html,
    scripts: ['shared.js', 'popup.js'],
    tabs: [{ id: 7, url: 'https://example.com/article' }],
    onTabMessage: () => {
      tabCalls += 1;
      // First message hits a stale tab: no receiving end (the reported bug).
      if (tabCalls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return true;
    },
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  // Popup injected the scripts and retried instead of surfacing the error.
  assert.equal(page.mock.injections.length, 1);
  assert.equal(page.mock.injections[0].files.length, 2);
  assert.equal(page.mock.injections[0].files[0], 'shared.js');
  assert.equal(page.mock.injections[0].files[1], 'content.js');
  assert.equal(page.mock.injections[0].target.tabId, 7);

  const toggleBtn = page.document.getElementById('toggleButton');
  assert.ok(toggleBtn.classList.contains('is-active'));
  assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
});

test('options page defaults to automatic mode and manages reading studio', async () => {
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

test('options page defaults to automatic mode when nothing is stored', async () => {
  const html = readSource('options.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'options.js'],
    storage: {},
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const modeAuto = page.document.getElementById('modeAutomatic');
  assert.ok(modeAuto.classList.contains('is-selected'));
});

test('options appearance picker switches between dark and light themes', async () => {
  const html = readSource('options.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'options.js'],
    storage: {},
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const darkBtn = page.document.querySelector('[data-theme-option="dark"]');
  const lightBtn = page.document.querySelector('[data-theme-option="light"]');
  assert.ok(darkBtn);
  assert.ok(lightBtn);
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
  assert.ok(darkBtn.classList.contains('is-selected'));

  lightBtn.click();
  await settle();

  assert.equal(page.window.document.documentElement.dataset.theme, 'light');
  assert.equal(page.mock.storage.theme, 'light');
  assert.ok(lightBtn.classList.contains('is-selected'));
  assert.ok(!darkBtn.classList.contains('is-selected'));
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

test('options page manages fixation anchor density presets', async () => {
  const html = readSource('options.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'options.js'],
    storage: { fixation: 'optimal' },
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const optBtn = page.document.querySelector('[data-fixation="optimal"]');
  const classicBtn = page.document.querySelector('[data-fixation="classic"]');
  const metricAnchor = page.document.getElementById('metricAnchor');
  assert.ok(optBtn);
  assert.ok(optBtn.classList.contains('is-selected'));
  assert.equal(metricAnchor.textContent, '~45%');

  classicBtn.click();
  await settle();

  assert.equal(page.mock.storage.fixation, 'classic');
  assert.ok(classicBtn.classList.contains('is-selected'));
  assert.equal(metricAnchor.textContent, '33%');
});

test('popup settings gear opens preferences within extension and allows adjustments', async () => {
  const html = readSource('popup.html');
  const page = createPage({
    html,
    scripts: ['shared.js', 'popup.js'],
    tabs: [{ id: 10, url: 'https://news.ycombinator.com/item?id=42' }],
    storage: { mode: 'automatic', fixation: 'optimal' },
    onTabMessage: (_tabId, msg) => {
      if (msg.greeting === 'isActive') return true;
      return undefined;
    },
  });

  page.window.document.dispatchEvent(new page.window.Event('DOMContentLoaded'));
  await settle();

  const viewMain = page.document.getElementById('viewMain');
  const viewSettings = page.document.getElementById('viewSettings');
  const settingsWheel = page.document.getElementById('settingsWheel');
  const settingsBackBtn = page.document.getElementById('settingsBackBtn');

  assert.ok(viewMain);
  assert.ok(viewSettings);
  assert.ok(settingsWheel);
  assert.ok(settingsBackBtn);

  // Initially main view is visible and settings is hidden
  assert.notEqual(viewMain.style.display, 'none');
  assert.equal(viewSettings.style.display, 'none');

  // Click settings wheel: opens settings within the extension
  settingsWheel.click();
  await settle();

  assert.equal(viewMain.style.display, 'none');
  assert.equal(viewSettings.style.display, 'flex');
  assert.ok(settingsWheel.classList.contains('is-active'));

  // Test mode change within in-extension settings
  const manualBtn = page.document.querySelector('#popupModeGroup .dock-seg-btn[data-mode="manual"]');
  const modeVal = page.document.getElementById('settingsModeVal');
  assert.ok(manualBtn);
  manualBtn.click();
  await settle();

  assert.equal(page.mock.storage.mode, 'manual');
  assert.equal(modeVal.textContent, 'Manual');

  // Test fixation anchor change within in-extension settings
  const highFixBtn = page.document.querySelector('#popupFixationGroup .dock-seg-btn[data-fixation="high"]');
  const fixationVal = page.document.getElementById('popupFixationVal');
  assert.ok(highFixBtn);
  highFixBtn.click();
  await settle();

  assert.equal(page.mock.storage.fixation, 'high');
  assert.equal(fixationVal.textContent, 'High 55%');

  // Verify active tab host is displayed
  const hostTag = page.document.getElementById('settingsHostTag');
  assert.ok(hostTag);
  assert.equal(hostTag.textContent, 'news.ycombinator.com');

  // Click back button: returns to main reader view within the popup
  settingsBackBtn.click();
  await settle();

  assert.equal(viewMain.style.display, 'flex');
  assert.equal(viewSettings.style.display, 'none');
  assert.ok(!settingsWheel.classList.contains('is-active'));
});

