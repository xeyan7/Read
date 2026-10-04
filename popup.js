/* popup.js — Read Fast - ADHD toolbar popup.
 * Binds the tactile popup UI to the live bionic-reading state of the active tab,
 * provides instant intensity adjustment, enables sample text exploration,
 * and opens the settings panel right inside the popup itself.
 */
'use strict';

let isPopupInitialized = false;

async function initPopup() {
  if (isPopupInitialized) return;
  isPopupInitialized = true;
  const $ = (id) => document.getElementById(id);
  const toggleBtn = $('toggleButton') || $('makeContentMoreReadable');
  const ctaText = $('ctaText');
  const ctaSub = $('ctaSub');
  const spinner = $('spinner');
  const wheel = $('settingsWheel');
  const previewSample = $('previewSample');
  const previewState = $('previewState');
  const pageNote = $('pageNote');
  const dockVal = $('dockVal');
  const intensityButtons = Array.from(document.querySelectorAll('#popupIntensityGroup .dock-seg-btn'));
  const cycleBtn = $('cycleSampleBtn');

  // In-extension view panels & settings controls
  const viewMain = $('viewMain');
  const viewSettings = $('viewSettings');
  const settingsBackBtn = $('settingsBackBtn');
  const popupModeGroup = $('popupModeGroup');
  const settingsModeVal = $('settingsModeVal');
  const siteRulesList = $('siteRulesList');
  const siteRulesEmpty = $('siteRulesEmpty');
  const siteRulesCount = $('siteRulesCount');
  const siteRulesTitle = $('siteRulesTitle');
  const siteRulesHint = $('siteRulesHint');
  const addRuleForm = $('addRuleForm');
  const newRuleHost = $('newRuleHost');
  const addRuleBtn = $('addRuleBtn');

  let tab = null;

  const state = {
    active: false,
    host: '',
    reachable: false,
    override: false,
    intensity: FocusReader ? FocusReader.DEFAULT_INTENSITY : 'medium',
    fixation: FocusReader ? FocusReader.DEFAULT_FIXATION : 'optimal',
    mode: FocusReader ? FocusReader.DEFAULT_MODE : 'automatic',
  };

  // Each sample is a fixed [line1, line2] pair: the break is locked with
  // an explicit <br> so words-per-line stay identical on every strength.
  // (Bolder text runs wider, which otherwise drags words across lines.)
  const SAMPLE_SENTENCES = [
    ['Focus reader guides your eyes', 'smoothly through long articles.'],
    ['Bionic reading anchors each word', 'for faster, calmer scanning.'],
    ['Dense pages turn clear and calm', 'for focused, faster reading.'],
    ['Your visual cortex follows', 'guided words with ease.'],
  ];
  let sampleIndex = 0;

  const setNote = (text) => {
    if (pageNote) {
      if (text) {
        pageNote.textContent = text;
        pageNote.style.display = 'block';
      } else {
        pageNote.style.display = 'none';
      }
    }
  };

  // Switch between reader interface (#viewMain) and settings panel (#viewSettings)
  function setSettingsView(show) {
    if (viewMain) viewMain.style.display = show ? 'none' : 'flex';
    if (viewSettings) viewSettings.style.display = show ? 'flex' : 'none';
    if (wheel) {
      wheel.classList.toggle('is-active', show);
      wheel.setAttribute('aria-expanded', show ? 'true' : 'false');
    }
    // Hidden panels have no layout — position thumbs once visible.
    if (show) {
      const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
      schedule(() => moveAllSegThumbs());
    }
  }

  const toggleSettingsView = () => {
    const isShowingSettings = Boolean(viewSettings && viewSettings.style.display !== 'none');
    setSettingsView(!isShowingSettings);
  };

  // Sliding segmented pill: glide a thumb under the active option.
  function moveSegThumb(group) {
    if (!group) return;
    const kids = Array.from(group.children);
    const thumb = kids.find((el) => el.classList && el.classList.contains('seg-thumb'));
    const active = kids.find((el) => el.tagName === 'BUTTON' && el.classList.contains('is-active'));
    if (!thumb || !active || typeof active.getBoundingClientRect !== 'function') return;
    const gRect = group.getBoundingClientRect();
    const bRect = active.getBoundingClientRect();
    if (!bRect.width) return;
    const first = !thumb.style.width;
    if (first) thumb.style.transition = 'none';
    thumb.style.width = `${bRect.width}px`;
    thumb.style.transform = `translateX(${bRect.left - gRect.left}px)`;
    if (first) {
      void thumb.offsetWidth;
      thumb.style.transition = '';
    }
  }

  function moveAllSegThumbs() {
    document.querySelectorAll('.seg').forEach(moveSegThumb);
  }

  // Send a message to the tab, self-healing tabs whose content script is missing
  async function sendTabMessage(tabId, msg) {
    if (!tabId) return undefined;
    try {
      return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
    } catch (_) {
      try {
        if (chrome.scripting && chrome.scripting.executeScript) {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            files: ['shared.js', 'content.js'],
          });
          return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
        }
      } catch (_) {}
      return undefined;
    }
  }

  function updatePreviewSentence(pair) {
    if (!previewSample) return;
    previewSample.innerHTML = '';
    const lines = Array.isArray(pair) ? pair : [pair];
    lines.forEach((line, li) => {
      if (li > 0) previewSample.appendChild(document.createElement('br'));
      line.split(/\s+/g).forEach((word, idx) => {
        if (idx > 0) previewSample.appendChild(document.createTextNode(' '));
        const boldLen = FocusReader && FocusReader.calculateBoldLength
          ? FocusReader.calculateBoldLength(word, state.fixation || 'optimal')
          : Math.floor(word.length * (FocusReader ? FocusReader.BOLD_RATIO : 1 / 3));
        if (boldLen >= 1) {
          const span = document.createElement('span');
          span.className = 'wb';
          span.textContent = word.slice(0, boldLen);
          previewSample.appendChild(span);
          previewSample.appendChild(document.createTextNode(word.slice(boldLen)));
        } else {
          previewSample.appendChild(document.createTextNode(word));
        }
      });
    });
  }

  function renderIntensity() {
    const weight = FocusReader && FocusReader.INTENSITY_WEIGHTS ? FocusReader.INTENSITY_WEIGHTS[state.intensity] : 700;
    const boost = FocusReader && FocusReader.boostFor ? FocusReader.boostFor(state.intensity) : 'transparent';
    const label = state.intensity.charAt(0).toUpperCase() + state.intensity.slice(1);
    if (dockVal) dockVal.textContent = `${label} (${weight})`;
    if (previewSample) {
      previewSample.style.setProperty('--wb-weight', String(weight));
      previewSample.style.setProperty('--wb-boost', boost);
    }

    intensityButtons.forEach((btn) => {
      const match = btn.dataset.intensity === state.intensity;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-checked', match ? 'true' : 'false');
    });
    moveSegThumb(document.getElementById('popupIntensityGroup'));
  }

  function renderMode() {
    const modeButtons = Array.from(document.querySelectorAll('#popupModeGroup .dock-seg-btn'));
    modeButtons.forEach((btn) => {
      const match = btn.dataset.mode === state.mode;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-checked', match ? 'true' : 'false');
    });
    if (settingsModeVal) {
      settingsModeVal.textContent = state.mode === 'manual' ? 'Manual' : 'Automatic';
    }
    moveSegThumb(document.getElementById('popupModeGroup'));
  }

  // Non-host keys in storage — everything else boolean is a per-site rule.
  const SITE_SYSTEM_KEYS = new Set(['mode', 'intensity', 'fixation', 'theme']);

  function cleanHost(input) {
    return (input || '')
      .trim()
      .toLowerCase()
      .replace(/^[a-zA-Z]+:\/\//, '')
      .replace(/\/.*$/, '')
      .trim();
  }

  // Site list follows the activation mode: automatic shows exclusions
  // (every site bolds except these), manual shows inclusions (only these bold).
  async function loadSiteRules() {
    if (!siteRulesList) return;
    const isAuto = state.mode !== 'manual';
    const wanted = isAuto ? false : true;
    if (siteRulesTitle) {
      siteRulesTitle.textContent = isAuto ? 'Excluded sites' : 'Included sites';
    }
    if (siteRulesHint) {
      siteRulesHint.textContent = isAuto
        ? 'Bold everywhere except these sites.'
        : 'Bold only these sites.';
    }
    if (siteRulesEmpty) {
      siteRulesEmpty.textContent = isAuto
        ? 'No excluded sites.'
        : 'No included sites.';
    }
    if (addRuleBtn) {
      addRuleBtn.textContent = isAuto ? 'Exclude' : 'Include';
    }
    if (newRuleHost) {
      newRuleHost.placeholder = isAuto ? 'site-to-exclude.com' : 'site-to-include.com';
    }
    siteRulesList.innerHTML = '';
    let hostRules = [];
    try {
      const allStorage = await chrome.storage.sync.get(null);
      hostRules = Object.entries(allStorage || {}).filter(
        ([key, val]) => !SITE_SYSTEM_KEYS.has(key) && val === wanted
      );
    } catch (err) {
      console.warn('Could not load site rules:', err);
    }
    if (siteRulesCount) {
      siteRulesCount.textContent = hostRules.length ? `${hostRules.length}` : '';
    }
    if (siteRulesEmpty) {
      siteRulesEmpty.style.display = hostRules.length ? 'none' : 'block';
    }
    hostRules.forEach(([host, isEnabled]) => {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const domainSpan = document.createElement('span');
      domainSpan.className = 'rule-domain';
      domainSpan.textContent = host;

      const metaGroup = document.createElement('div');
      metaGroup.className = 'rule-meta-group';

      const statusBadge = document.createElement('span');
      statusBadge.className = `rule-status-badge ${isEnabled ? 'rule-badge-on' : 'rule-badge-off'}`;
      statusBadge.textContent = isEnabled ? 'On' : 'Off';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'rule-del-btn';
      delBtn.title = `Remove rule for ${host}`;
      delBtn.setAttribute('aria-label', `Remove rule for ${host}`);
      delBtn.textContent = '×';

      delBtn.addEventListener('click', async () => {
        try {
          await chrome.storage.sync.remove(host);
        } catch (err) {
          console.warn('Could not remove site rule:', err);
        }
        if (host === state.host) {
          state.override = false;
          state.active = state.mode !== 'manual';
          render();
          if (tab && tab.id != null) {
            await sendTabMessage(tab.id, { greeting: state.active ? 'Activate' : 'Deactivate' });
          }
        }
        await loadSiteRules();
      });

      metaGroup.appendChild(statusBadge);
      metaGroup.appendChild(delBtn);
      row.appendChild(domainSpan);
      row.appendChild(metaGroup);
      siteRulesList.appendChild(row);
    });
  }

  function render() {
    const { active } = state;
    if (ctaText) ctaText.textContent = active ? 'On' : 'Off';
    if (ctaSub) {
      ctaSub.textContent = active ? 'Word anchors are bolded on this page' : 'Tap to bold word anchors on this page';
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('is-active', active);
      toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (!ctaText) toggleBtn.innerText = active ? 'Deactivate' : 'Activate';
    }
    if (previewSample) previewSample.classList.toggle('is-active', active);
    if (previewState) previewState.textContent = active ? 'Bionic' : 'Plain';
  }

  function showReady() {
    if (spinner) spinner.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'flex';
  }

  // --- Attach All UI Listeners Immediately (so in-popup settings work anywhere) ---
  if (wheel) {
    wheel.addEventListener('click', toggleSettingsView);
    wheel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSettingsView();
      }
    });
  }

  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
      setSettingsView(false);
    });
  }

  // Intensity buttons in main view
  intensityButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextIntensity = FocusReader.normalizeIntensity(btn.dataset.intensity);
      if (state.intensity === nextIntensity) return;
      state.intensity = nextIntensity;
      renderIntensity();
      try {
        await chrome.storage.sync.set({ intensity: nextIntensity });
        if (tab && tab.id != null) {
          await sendTabMessage(tab.id, { greeting: 'SetIntensity', intensity: nextIntensity });
        }
      } catch (e) {
        console.error('Failed to persist intensity:', e);
      }
    });
  });

  // Mode buttons in settings view
  const modeButtons = Array.from(document.querySelectorAll('#popupModeGroup .dock-seg-btn'));
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextMode = FocusReader && FocusReader.normalizeMode ? FocusReader.normalizeMode(btn.dataset.mode) : btn.dataset.mode;
      if (state.mode === nextMode) return;
      state.mode = nextMode;
      renderMode();
      await loadSiteRules();
      try {
        await chrome.storage.sync.set({ mode: nextMode });
        if (!state.override) {
          state.active = nextMode !== 'manual';
          render();
          if (tab && tab.id != null) {
            await sendTabMessage(tab.id, { greeting: state.active ? 'Activate' : 'Deactivate' });
          }
        }
      } catch (e) {
        console.error('Failed to persist mode:', e);
      }
    });
  });

  // Add a site to the current include / exclude list from the settings view
  if (addRuleForm) {
    addRuleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const host = cleanHost(newRuleHost && newRuleHost.value);
      if (!host) return;
      const action = state.mode !== 'manual' ? false : true;
      try {
        await chrome.storage.sync.set({ [host]: action });
        if (newRuleHost) newRuleHost.value = '';
      } catch (err) {
        console.error('Failed to save site rule:', err);
        return;
      }
      if (host === state.host) {
        state.override = true;
        state.active = action;
        render();
        if (tab && tab.id != null) {
          await sendTabMessage(tab.id, { greeting: action ? 'Activate' : 'Deactivate' });
        }
      }
      await loadSiteRules();
    });
  }

  // Site rules render from storage alone — load immediately.
  loadSiteRules();

  // Cycle preview sample sentence
  if (cycleBtn) {
    cycleBtn.addEventListener('click', () => {
      sampleIndex = (sampleIndex + 1) % SAMPLE_SENTENCES.length;
      updatePreviewSentence(SAMPLE_SENTENCES[sampleIndex]);
    });
  }

  // Theme Handling (dark / light)
  const themeToggle = $('themeToggle');
  const themeOrder = FocusReader && FocusReader.THEMES ? FocusReader.THEMES : ['dark', 'light'];
  const normalizeTheme = (t) => (FocusReader && FocusReader.normalizeTheme ? FocusReader.normalizeTheme(t) : (themeOrder.includes(t) ? t : 'dark'));
  try {
    const { theme } = await chrome.storage.sync.get(['theme']);
    document.documentElement.dataset.theme = normalizeTheme(theme);
  } catch (_) {}

  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      const current = document.documentElement.dataset.theme || 'dark';
      const nextTheme = themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length];
      document.documentElement.dataset.theme = nextTheme;
      try {
        await chrome.storage.sync.set({ theme: nextTheme });
      } catch (err) {
        console.warn('Could not persist theme:', err);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const isShowingSettings = Boolean(viewSettings && viewSettings.style.display !== 'none');
      if (isShowingSettings) {
        setSettingsView(false);
      } else {
        window.close();
      }
    }
  });

  // Toggle button on main view
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const next = !state.active;
      const greeting = next ? 'Activate' : 'Deactivate';
      const resp = await sendTabMessage(tab && tab.id, { greeting });
      state.reachable = resp !== undefined;
      state.active = next;
      // Toggling back to the mode default removes the per-site rule instead
      // of storing a redundant one, keeping the include / exclude list exact.
      const modeDefault = state.mode !== 'manual';
      state.override = next !== modeDefault;
      render();
      await loadSiteRules();
      if (state.host) {
        try {
          if (state.override) {
            await chrome.storage.sync.set({ [state.host]: next });
          } else {
            await chrome.storage.sync.remove(state.host);
          }
        } catch (e) {
          console.error('Storage save failed:', e);
        }
      }
    });
  }

  // --- Load Saved Preferences ---
  try {
    const stored = await chrome.storage.sync.get(['intensity', 'fixation', 'mode']);
    if (stored && stored.intensity) {
      state.intensity = FocusReader.normalizeIntensity(stored.intensity);
    }
    if (stored && stored.fixation && FocusReader.normalizeFixation) {
      state.fixation = FocusReader.normalizeFixation(stored.fixation);
    }
    if (stored && stored.mode && FocusReader.normalizeMode) {
      state.mode = FocusReader.normalizeMode(stored.mode);
    }
  } catch (err) {
    console.warn('Could not read saved preferences:', err);
  }

  renderIntensity();
  renderMode();
  await loadSiteRules();
  updatePreviewSentence(SAMPLE_SENTENCES[sampleIndex]);
  moveAllSegThumbs();
  window.addEventListener('resize', moveAllSegThumbs);
  try {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => moveAllSegThumbs());
    }
  } catch (_) {}

  // --- Resolve the Active Tab ---
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = tabs && tabs[0];
  } catch (err) {
    console.error('Failed to query tab:', err);
  }

  if (!tab || !tab.url) {
    if (toggleBtn) toggleBtn.disabled = true;
    setNote('Open a web page to use Read Fast - ADHD.');
    render();
    showReady();
    return;
  }

  const isWebPage = tab.url.startsWith('http://') || tab.url.startsWith('https://');
  if (!isWebPage) {
    if (toggleBtn) toggleBtn.disabled = true;
    setNote('Read Fast - ADHD only runs on http(s) web pages.');
    render();
    showReady();
    return;
  }

  try {
    state.host = new URL(tab.url).host;
  } catch {
    state.host = tab.url;
  }

  // --- Check Explicit Host Preference ---
  try {
    const stored = await chrome.storage.sync.get([state.host]);
    state.override = stored[state.host] !== undefined;
  } catch (err) {
    console.warn('Could not read host preference:', err);
  }

  // --- Query Live State from Tab ---
  {
    const resp = await sendTabMessage(tab.id, { greeting: 'isActive' });
    state.reachable = resp !== undefined;
    state.active = Boolean(resp);
  }
  if (!state.reachable) {
    try {
      const { mode, [state.host]: hostPref } = await chrome.storage.sync.get(['mode', state.host]);
      if (mode && FocusReader && FocusReader.normalizeMode) {
        state.mode = FocusReader.normalizeMode(mode);
        renderMode();
      }
      state.active = hostPref !== undefined ? hostPref === true : state.mode !== 'manual';
      state.override = hostPref !== undefined;
    } catch (_) {
      state.active = true;
    }
  }

  render();
  await loadSiteRules();
  showReady();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
