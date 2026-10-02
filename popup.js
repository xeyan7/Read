/* popup.js — E:read toolbar popup.
 * Binds the tactile popup UI to the live bionic-reading state of the active tab,
 * provides instant intensity adjustment, and enables sample text exploration.
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
  const hostName = $('hostName');
  const hostBadge = $('hostBadge');
  const statusDot = $('statusDot');
  const previewSample = $('previewSample');
  const previewState = $('previewState');
  const pageNote = $('pageNote');
  const resetHost = $('resetHost');
  const dockVal = $('dockVal');
  const intensityButtons = Array.from(document.querySelectorAll('.dock-seg-btn'));
  const cycleBtn = $('cycleSampleBtn');

  const state = {
    active: false,
    host: '',
    reachable: false,
    override: false,
    intensity: FocusReader ? FocusReader.DEFAULT_INTENSITY : 'medium',
  };

  const SAMPLE_SENTENCES = [
    'Focus reader guides your eyes smoothly through long articles.',
    'Bionic reading anchors your cognitive fixation on crucial syllable structures.',
    'Complex technical documentation becomes effortlessly clear and rapid to scan.',
    'The human visual cortex processes typographic guidance with remarkable velocity.',
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

  function updatePreviewSentence(sentence) {
    if (!previewSample) return;
    previewSample.innerHTML = '';
    const words = sentence.split(/\s+/g);
    words.forEach((word, idx) => {
      if (idx > 0) previewSample.appendChild(document.createTextNode(' '));
      const boldLen = Math.floor(word.length * (FocusReader ? FocusReader.BOLD_RATIO : 1 / 3));
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

  function render() {
    const { active, override } = state;
    if (ctaText) ctaText.textContent = active ? 'Deactivate' : 'Activate';
    if (ctaSub) {
      ctaSub.textContent = active ? 'Bionic anchoring active on this tab' : 'Apply bionic reading to this tab';
    }
    if (toggleBtn) {
      toggleBtn.classList.toggle('is-active', active);
      toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      // In E:Read, toggle button has the text directly if ctaText is missing
      if (!ctaText) toggleBtn.innerText = active ? 'Deactivate' : 'Activate';
    }
    if (hostBadge) {
      hostBadge.textContent = active ? 'ACTIVE' : 'OFF';
      hostBadge.classList.toggle('badge-active', active);
    }
    if (statusDot) statusDot.classList.toggle('dot-active', active);
    if (previewSample) previewSample.classList.toggle('is-active', active);
    if (previewState) previewState.textContent = active ? 'Bionic on' : 'Standard';
    if (resetHost) resetHost.style.display = override ? 'inline-flex' : 'none';
  }

  function showReady() {
    if (spinner) spinner.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'block';
  }

  // --- Resolve the active tab -------------------------------------------------
  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = tabs && tabs[0];
  } catch (err) {
    console.error('Failed to query tab:', err);
  }

  // Load saved intensity
  try {
    const stored = await chrome.storage.sync.get(['intensity']);
    if (stored && stored.intensity) {
      state.intensity = FocusReader.normalizeIntensity(stored.intensity);
    }
  } catch (err) {
    console.warn('Could not read saved intensity:', err);
  }
  renderIntensity();

  if (!tab || !tab.url) {
    if (hostName) hostName.textContent = 'No active tab';
    if (hostBadge) hostBadge.textContent = 'N/A';
    if (toggleBtn) toggleBtn.disabled = true;
    setNote('Open a web page to use E:read.');
    render();
    showReady();
    return;
  }

  const isWebPage = tab.url.startsWith('http://') || tab.url.startsWith('https://');
  if (!isWebPage) {
    if (hostName) hostName.textContent = 'System page';
    if (hostBadge) hostBadge.textContent = 'N/A';
    if (toggleBtn) toggleBtn.disabled = true;
    setNote('E:read only runs on http(s) web pages.');
    render();
    showReady();
    return;
  }

  try {
    state.host = new URL(tab.url).host;
  } catch {
    state.host = tab.url;
  }
  if (hostName) {
    hostName.textContent = state.host;
    hostName.title = state.host;
  }

  // --- Check explicit host preference ----------------------------------------
  try {
    const stored = await chrome.storage.sync.get([state.host]);
    state.override = stored[state.host] !== undefined;
  } catch (err) {
    console.warn('Could not read host preference:', err);
  }

  // --- Query live state matching E:Read ---------------------------------------
  try {
    state.active = Boolean(await chrome.tabs.sendMessage(tab.id, { greeting: 'isActive' }, { frameId: 0 }));
    state.reachable = true;
  } catch {
    state.reachable = false;
    // Fall back to stored preference if available
    try {
      const { mode, [state.host]: hostPref } = await chrome.storage.sync.get(['mode', state.host]);
      state.active = hostPref !== undefined ? hostPref === true : mode === 'automatic';
    } catch (_) {
      state.active = false;
    }
  }

  render();
  showReady();

  // --- Actions matching E:Read ------------------------------------------------
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const next = !state.active;
      const greeting = next ? 'Activate' : 'Deactivate';
      try {
        await chrome.tabs.sendMessage(tab.id, { greeting });
        state.reachable = true;
      } catch (e) {
        console.warn('Message send failed (tab may need refresh):', e);
      }
      state.active = next;
      state.override = true;
      render();
      try {
        await chrome.storage.sync.set({ [state.host]: next });
      } catch (e) {
        console.error('Storage save failed:', e);
      }
    });
  }

  if (resetHost) {
    resetHost.addEventListener('click', async () => {
      try {
        await chrome.storage.sync.remove(state.host);
      } catch (e) {
        console.error('Storage remove failed:', e);
      }
      state.override = false;
      const { mode } = await chrome.storage.sync.get(['mode']);
      const shouldBeActive = mode === 'automatic';
      try {
        await chrome.tabs.sendMessage(tab.id, {
          greeting: shouldBeActive ? 'Activate' : 'Deactivate',
        });
      } catch (e) {
        console.warn('Message send failed:', e);
      }
      state.active = shouldBeActive;
      render();
    });
  }

  // Intensity buttons in popup
  intensityButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextIntensity = FocusReader.normalizeIntensity(btn.dataset.intensity);
      if (state.intensity === nextIntensity) return;
      state.intensity = nextIntensity;
      renderIntensity();
      try {
        await chrome.storage.sync.set({ intensity: nextIntensity });
        if (tab && tab.id != null) {
          await chrome.tabs.sendMessage(tab.id, { greeting: 'SetIntensity', intensity: nextIntensity }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to persist intensity:', e);
      }
    });
  });

  // Cycle preview sample sentence
  if (cycleBtn) {
    cycleBtn.addEventListener('click', () => {
      sampleIndex = (sampleIndex + 1) % SAMPLE_SENTENCES.length;
      updatePreviewSentence(SAMPLE_SENTENCES[sampleIndex]);
    });
  }

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  };
  if (wheel) {
    wheel.addEventListener('click', openSettings);
    wheel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSettings();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
