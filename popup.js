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
  const popupFixationGroup = $('popupFixationGroup');
  const popupFixationVal = $('popupFixationVal');
  const settingsHostTag = $('settingsHostTag');
  const settingsHostHint = $('settingsHostHint');
  const settingsResetBtn = $('settingsResetBtn');
  const openFullOptionsBtn = $('openFullOptionsBtn');

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

  const SAMPLE_SENTENCES = [
    'Focus reader guides your eyes smoothly through long articles.',
    'Bionic reading anchors words for faster scanning.',
    'Dense documentation becomes clear and quick to scan.',
    'Your visual cortex follows guided words with ease.',
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
  }

  const toggleSettingsView = () => {
    const isShowingSettings = Boolean(viewSettings && viewSettings.style.display !== 'none');
    setSettingsView(!isShowingSettings);
  };

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

  function updatePreviewSentence(sentence) {
    if (!previewSample) return;
    previewSample.innerHTML = '';
    const words = sentence.split(/\s+/g);
    words.forEach((word, idx) => {
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
  }

  function renderIntensity() {
    const weight = FocusReader && FocusReader.INTENSITY_WEIGHTS ? FocusReader.INTENSITY_WEIGHTS[state.intensity] : 700;
    const label = state.intensity.charAt(0).toUpperCase() + state.intensity.slice(1);
    if (dockVal) dockVal.textContent = `${label} (${weight})`;
    if (previewSample) previewSample.style.setProperty('--wb-weight', String(weight));

    intensityButtons.forEach((btn) => {
      const match = btn.dataset.intensity === state.intensity;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-checked', match ? 'true' : 'false');
    });
  }

  function renderFixation() {
    const fixationButtons = Array.from(document.querySelectorAll('#popupFixationGroup .dock-seg-btn'));
    fixationButtons.forEach((btn) => {
      const match = btn.dataset.fixation === state.fixation;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-checked', match ? 'true' : 'false');
    });
    if (popupFixationVal) {
      if (state.fixation === 'classic') {
        popupFixationVal.textContent = 'Classic 33%';
      } else if (state.fixation === 'high') {
        popupFixationVal.textContent = 'High 55%';
      } else {
        popupFixationVal.textContent = 'Optimal 45%';
      }
    }
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
  }

  function renderHostRule() {
    if (settingsHostTag) {
      settingsHostTag.textContent = state.host || 'No active web host';
    }
    if (settingsHostHint) {
      if (state.override) {
        settingsHostHint.textContent = state.active
          ? 'Custom: Always bolded on this site'
          : 'Custom: Disabled on this site';
      } else {
        settingsHostHint.textContent = `Default: Follows ${state.mode === 'manual' ? 'manual mode' : 'auto flow'}`;
      }
    }
    if (settingsResetBtn) {
      settingsResetBtn.style.display = state.override ? 'inline-block' : 'none';
    }
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
    renderHostRule();
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
      renderHostRule();
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

  // Fixation buttons in settings view
  const fixationButtons = Array.from(document.querySelectorAll('#popupFixationGroup .dock-seg-btn'));
  fixationButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextFixation = FocusReader && FocusReader.normalizeFixation ? FocusReader.normalizeFixation(btn.dataset.fixation) : btn.dataset.fixation;
      if (state.fixation === nextFixation) return;
      state.fixation = nextFixation;
      renderFixation();
      updatePreviewSentence(SAMPLE_SENTENCES[sampleIndex]);
      try {
        await chrome.storage.sync.set({ fixation: nextFixation });
        if (tab && tab.id != null) {
          await sendTabMessage(tab.id, { greeting: 'SetFixation', fixation: nextFixation });
        }
      } catch (e) {
        console.error('Failed to persist fixation:', e);
      }
    });
  });

  // Reset custom site rule in settings view
  if (settingsResetBtn) {
    settingsResetBtn.addEventListener('click', async () => {
      if (!state.host) return;
      try {
        await chrome.storage.sync.remove(state.host);
      } catch (err) {
        console.warn('Could not reset site rule:', err);
      }
      state.override = false;
      state.active = state.mode !== 'manual';
      render();
      if (tab && tab.id != null) {
        await sendTabMessage(tab.id, { greeting: state.active ? 'Activate' : 'Deactivate' });
      }
    });
  }

  // Open full studio page button inside popup settings
  if (openFullOptionsBtn) {
    openFullOptionsBtn.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    });
  }

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
      state.override = true;
      render();
      if (state.host) {
        try {
          await chrome.storage.sync.set({ [state.host]: next });
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
  renderFixation();
  renderMode();
  updatePreviewSentence(SAMPLE_SENTENCES[sampleIndex]);

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
  showReady();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
