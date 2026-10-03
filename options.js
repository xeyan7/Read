/* options.js — Focus Reader preferences & reading studio.
 * Handles activation modes, intensity calibration, interactive cognitive studio,
 * and custom per-site rules management with instant sync.
 */
'use strict';

let isOptionsInitialized = false;

async function initOptions() {
  if (isOptionsInitialized) return;
  isOptionsInitialized = true;
  const manualCard = document.getElementById('modeManual');
  const autoCard = document.getElementById('modeAutomatic');
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  const segItems = Array.from(document.querySelectorAll('.seg-item'));
  const preview = document.getElementById('intensityPreview');
  const previewWeightBadge = document.getElementById('previewWeightBadge');

  // Studio Elements
  const studioParagraph = document.getElementById('studioParagraph');
  const studioToggleBtn = document.getElementById('studioToggleBtn');
  const studioToggleLabel = document.getElementById('studioToggleLabel');
  const topicChips = Array.from(document.querySelectorAll('.topic-chip'));
  const metricWpm = document.getElementById('metricWpm');

  // Rules Elements
  const siteRulesList = document.getElementById('siteRulesList');
  const siteRulesEmpty = document.getElementById('siteRulesEmpty');
  const addRuleForm = document.getElementById('addRuleForm');
  const newRuleHost = document.getElementById('newRuleHost');
  const newRuleAction = document.getElementById('newRuleAction');

  const modeCards = [manualCard, autoCard].filter(Boolean);
  let currentMode = 'manual';
  let currentIntensity = FocusReader ? FocusReader.DEFAULT_INTENSITY : 'medium';
  let studioBionicActive = true;
  let currentTopic = 'science';

  const TOPIC_TEXTS = {
    science:
      'The human visual cortex parses linguistic information through rapid ocular fixations called saccades. By accentuating initial phonemes and syllable boundaries, bionic reading minimizes unnecessary regressions and accelerates syntactic comprehension across dense scientific literature.',
    philosophy:
      'Perception is not merely passive reception of light, but an active cognitive construction. In the act of reading, consciousness projects anticipatory frameworks onto the printed word, grasping holistic meaning before the entirety of each syllable is fully inspected.',
    technology:
      'Modern compilers and distributed architectures rely on deterministic anchoring to optimize execution pipelines. Similarly, typographic anchoring structures arbitrary text streams into predictable cognitive chunks that unlock heightened reading throughput and reduced ocular strain.',
    literature:
      'The dawn broke across the cold obsidian peaks, casting long geometric shadows over the ancient library. Within the vaulted stone sanctuary, thousands of illuminated manuscripts whispered forgotten truths to those patient enough to decipher their enduring beauty.',
  };

  function flash(message) {
    if (!statusText || !statusBar) return;
    statusText.textContent = message;
    statusBar.classList.add('flash');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => statusBar.classList.remove('flash'), 2600);
  }

  function renderMode() {
    modeCards.forEach((card) => {
      const isMatch = card.dataset.mode === currentMode;
      card.classList.toggle('is-selected', isMatch);
      card.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
  }

  function renderIntensity() {
    segItems.forEach((item) => {
      const isMatch = item.dataset.intensity === currentIntensity;
      item.classList.toggle('is-selected', isMatch);
      item.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });

    const weight = FocusReader && FocusReader.INTENSITY_WEIGHTS ? FocusReader.INTENSITY_WEIGHTS[currentIntensity] : 700;
    if (preview) {
      preview.style.setProperty('--wb-weight', String(weight));
    }
    if (previewWeightBadge) {
      previewWeightBadge.textContent = `Weight ${weight}`;
    }
    if (studioParagraph) {
      studioParagraph.style.setProperty('--wb-weight', String(weight));
    }
  }

  // --- Reading Studio Logic --------------------------------------------------
  function renderStudio() {
    if (!studioParagraph) return;
    const rawText = TOPIC_TEXTS[currentTopic] || TOPIC_TEXTS.science;
    studioParagraph.innerHTML = '';

    if (!studioBionicActive) {
      studioParagraph.textContent = rawText;
      if (metricWpm) metricWpm.textContent = '~240';
      return;
    }

    if (metricWpm) metricWpm.textContent = '~340';
    const words = rawText.split(/\s+/g);
    words.forEach((word, idx) => {
      if (idx > 0) studioParagraph.appendChild(document.createTextNode(' '));
      const boldLen = Math.floor(word.length * (FocusReader ? FocusReader.BOLD_RATIO : 1 / 3));
      if (boldLen >= 1) {
        const span = document.createElement('span');
        span.className = FocusReader ? FocusReader.BOLD_CLASS : 'focus-reader-bold';
        span.textContent = word.slice(0, boldLen);
        studioParagraph.appendChild(span);
        studioParagraph.appendChild(document.createTextNode(word.slice(boldLen)));
      } else {
        studioParagraph.appendChild(document.createTextNode(word));
      }
    });
  }

  if (studioToggleBtn) {
    studioToggleBtn.addEventListener('click', () => {
      studioBionicActive = !studioBionicActive;
      studioToggleBtn.setAttribute('aria-pressed', studioBionicActive ? 'true' : 'false');
      studioToggleBtn.classList.toggle('studio-btn-primary', studioBionicActive);
      if (studioToggleLabel) {
        studioToggleLabel.textContent = studioBionicActive ? 'Bionic Mode ON' : 'Standard Text';
      }
      renderStudio();
    });
  }

  topicChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      topicChips.forEach((c) => {
        c.classList.remove('is-active');
        c.setAttribute('aria-selected', 'false');
      });
      chip.classList.add('is-active');
      chip.setAttribute('aria-selected', 'true');
      currentTopic = chip.dataset.topic;
      renderStudio();
    });
  });

  // --- Site Rules Manager ----------------------------------------------------
  async function loadSiteRules() {
    if (!siteRulesList || !siteRulesEmpty) return;
    siteRulesList.innerHTML = '';

    try {
      const allStorage = await chrome.storage.sync.get(null);
      const systemKeys = new Set(['mode', 'intensity']);
      const hostRules = Object.entries(allStorage || {}).filter(
        ([key, val]) => !systemKeys.has(key) && typeof val === 'boolean'
      );

      if (hostRules.length === 0) {
        siteRulesEmpty.style.display = 'flex';
        return;
      }

      siteRulesEmpty.style.display = 'none';

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
        statusBadge.textContent = isEnabled ? 'Always Active' : 'Always Disabled';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'rule-del-btn';
        delBtn.title = `Remove rule for ${host}`;
        delBtn.setAttribute('aria-label', `Remove rule for ${host}`);
        delBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;

        delBtn.addEventListener('click', async () => {
          try {
            await chrome.storage.sync.remove(host);
            flash(`Removed rule for ${host}`);
            await loadSiteRules();
          } catch (e) {
            console.error('Failed to remove rule:', e);
          }
        });

        metaGroup.appendChild(statusBadge);
        metaGroup.appendChild(delBtn);
        row.appendChild(domainSpan);
        row.appendChild(metaGroup);
        siteRulesList.appendChild(row);
      });
    } catch (err) {
      console.warn('Could not load site rules:', err);
    }
  }

  if (addRuleForm) {
    addRuleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      let rawHost = (newRuleHost.value || '').trim().toLowerCase();
      if (!rawHost) return;

      // Clean protocol and trailing paths if user pasted a full URL
      rawHost = rawHost.replace(/^[a-zA-Z]+:\/\//, '').replace(/\/.*$/, '').trim();
      if (!rawHost) return;

      const action = newRuleAction.value === 'true';
      try {
        await chrome.storage.sync.set({ [rawHost]: action });
        newRuleHost.value = '';
        flash(`Added rule: ${rawHost} (${action ? 'Always Active' : 'Always Disabled'})`);
        await loadSiteRules();
      } catch (err) {
        console.error('Failed to save site rule:', err);
      }
    });
  }

  // --- Load saved preferences ------------------------------------------------
  try {
    const res = await chrome.storage.sync.get(['mode', 'intensity']);
    if (res && res.mode === 'automatic') currentMode = 'automatic';
    if (res && res.intensity !== undefined) {
      currentIntensity = FocusReader ? FocusReader.normalizeIntensity(res.intensity) : res.intensity;
    }
  } catch (err) {
    console.warn('Could not read storage:', err);
  }

  renderMode();
  renderIntensity();
  renderStudio();
  await loadSiteRules();

  // --- Mode changes ----------------------------------------------------------
  async function selectMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    renderMode();
    flash(mode === 'automatic' ? 'Automatic mode active across all tabs' : 'Manual activation mode active');
    try {
      await chrome.storage.sync.set({ mode });
    } catch (err) {
      console.error('Failed to save mode:', err);
      if (statusText) statusText.textContent = 'Failed to save preference.';
    }
  }

  modeCards.forEach((card) => {
    card.addEventListener('click', () => selectMode(card.dataset.mode));
    card.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        selectMode(card.dataset.mode);
      }
    });
  });

  // --- Intensity changes -----------------------------------------------------
  async function selectIntensity(intensity) {
    if (intensity === currentIntensity) return;
    currentIntensity = FocusReader ? FocusReader.normalizeIntensity(intensity) : intensity;
    renderIntensity();
    renderStudio();
    flash(`Intensity set to ${currentIntensity}`);
    try {
      await chrome.storage.sync.set({ intensity: currentIntensity });
    } catch (err) {
      console.error('Failed to save intensity:', err);
      if (statusText) statusText.textContent = 'Failed to save preference.';
    }
  }

  segItems.forEach((item) => {
    item.addEventListener('click', () => selectIntensity(item.dataset.intensity));
    item.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        selectIntensity(item.dataset.intensity);
      }
    });
  });

  // --- Theme Toggle Handling -------------------------------------------------
  const themeToggle = document.getElementById('themeToggle');
  try {
    const { theme } = await chrome.storage.sync.get(['theme']);
    if (theme) {
      document.documentElement.dataset.theme = theme;
    }
  } catch (_) {}

  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      const isDark = document.documentElement.dataset.theme === 'dark';
      const nextTheme = isDark ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextTheme;
      flash(`Theme set to ${nextTheme} mode`);
      try {
        await chrome.storage.sync.set({ theme: nextTheme });
      } catch (err) {
        console.warn('Could not persist theme:', err);
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOptions);
} else {
  initOptions();
}
