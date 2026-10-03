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
  const segItems = Array.from(document.querySelectorAll('#intensityGroup .seg-item'));
  const fixationItems = Array.from(document.querySelectorAll('#fixationGroup .seg-item'));
  const preview = document.getElementById('intensityPreview');
  const previewWeightBadge = document.getElementById('previewWeightBadge');

  // Studio Elements
  const studioParagraph = document.getElementById('studioParagraph');
  const studioToggleBtn = document.getElementById('studioToggleBtn');
  const studioToggleLabel = document.getElementById('studioToggleLabel');
  const topicChips = Array.from(document.querySelectorAll('.topic-chip'));
  const metricWpm = document.getElementById('metricWpm');
  const metricAnchor = document.getElementById('metricAnchor');

  // Rules Elements
  const siteRulesList = document.getElementById('siteRulesList');
  const siteRulesEmpty = document.getElementById('siteRulesEmpty');
  const addRuleForm = document.getElementById('addRuleForm');
  const newRuleHost = document.getElementById('newRuleHost');
  const newRuleAction = document.getElementById('newRuleAction');

  const modeCards = [manualCard, autoCard].filter(Boolean);
  let currentMode = FocusReader ? FocusReader.DEFAULT_MODE : 'automatic';
  let currentIntensity = FocusReader ? FocusReader.DEFAULT_INTENSITY : 'medium';
  let currentFixation = FocusReader ? FocusReader.DEFAULT_FIXATION : 'optimal';
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

  function renderFixation() {
    fixationItems.forEach((item) => {
      const isMatch = item.dataset.fixation === currentFixation;
      item.classList.toggle('is-selected', isMatch);
      item.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
    if (metricAnchor) {
      metricAnchor.textContent = currentFixation === 'classic' ? '33%' : (currentFixation === 'high' ? '55%' : '~45%');
    }
    moveSegThumb(document.getElementById('fixationGroup'));
  }

  // Sliding segmented pill: glide a thumb under the active option.
  function moveSegThumb(group) {
    if (!group) return;
    const kids = Array.from(group.children);
    const thumb = kids.find((el) => el.classList && el.classList.contains('seg-thumb'));
    const active = kids.find((el) => el.tagName === 'BUTTON' && el.classList.contains('is-selected'));
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
    document.querySelectorAll('.segmented').forEach(moveSegThumb);
  }

  function renderIntensity() {
    segItems.forEach((item) => {
      const isMatch = item.dataset.intensity === currentIntensity;
      item.classList.toggle('is-selected', isMatch);
      item.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });

    const weight = FocusReader && FocusReader.INTENSITY_WEIGHTS ? FocusReader.INTENSITY_WEIGHTS[currentIntensity] : 600;
    if (preview) {
      preview.style.setProperty('--wb-weight', String(weight));
    }
    if (previewWeightBadge) {
      previewWeightBadge.textContent = `Weight ${weight}`;
    }
    if (studioParagraph) {
      studioParagraph.style.setProperty('--wb-weight', String(weight));
    }
    moveSegThumb(document.getElementById('intensityGroup'));
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
      const boldLen = FocusReader && FocusReader.calculateBoldLength
        ? FocusReader.calculateBoldLength(word, currentFixation)
        : Math.floor(word.length * (FocusReader ? FocusReader.BOLD_RATIO : 1 / 3));
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
      const systemKeys = new Set(['mode', 'intensity', 'theme']);
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
        statusBadge.textContent = isEnabled ? 'Always on' : 'Always off';

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

  // --- Load saved preferences (default: always-active on all sites) -----------
  try {
    const res = await chrome.storage.sync.get(['mode', 'intensity', 'fixation']);
    currentMode = FocusReader ? FocusReader.normalizeMode(res && res.mode) : (res && res.mode === 'manual' ? 'manual' : 'automatic');
    if (res && res.intensity !== undefined) {
      currentIntensity = FocusReader ? FocusReader.normalizeIntensity(res.intensity) : res.intensity;
    }
    if (res && res.fixation !== undefined && FocusReader && FocusReader.normalizeFixation) {
      currentFixation = FocusReader.normalizeFixation(res.fixation);
    }
  } catch (err) {
    console.warn('Could not read storage:', err);
  }

  renderMode();
  renderIntensity();
  renderFixation();
  renderStudio();
  moveAllSegThumbs();
  window.addEventListener('resize', moveAllSegThumbs);
  try {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => moveAllSegThumbs());
    }
  } catch (_) {}
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

  // --- Fixation changes ------------------------------------------------------
  async function selectFixation(fixation) {
    if (fixation === currentFixation) return;
    currentFixation = FocusReader && FocusReader.normalizeFixation ? FocusReader.normalizeFixation(fixation) : fixation;
    renderFixation();
    renderStudio();
    flash(`Anchor density set to ${currentFixation}`);
    try {
      await chrome.storage.sync.set({ fixation: currentFixation });
    } catch (err) {
      console.error('Failed to save fixation:', err);
      if (statusText) statusText.textContent = 'Failed to save preference.';
    }
  }

  fixationItems.forEach((item) => {
    item.addEventListener('click', () => selectFixation(item.dataset.fixation));
    item.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        selectFixation(item.dataset.fixation);
      }
    });
  });

  // --- Theme Handling (dark / light) -----------------------------------------
  const themeToggle = document.getElementById('themeToggle');
  const themeOptions = Array.from(document.querySelectorAll('[data-theme-option]'));
  const themeOrder = FocusReader && FocusReader.THEMES ? FocusReader.THEMES : ['dark', 'light'];

  function renderThemePicker(activeTheme) {
    themeOptions.forEach((btn) => {
      const isMatch = btn.dataset.themeOption === activeTheme;
      btn.classList.toggle('is-selected', isMatch);
      btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
  }

  async function applyTheme(nextTheme, { silent = false } = {}) {
    const theme = FocusReader ? FocusReader.normalizeTheme(nextTheme) : nextTheme;
    document.documentElement.dataset.theme = theme;
    renderThemePicker(theme);
    if (!silent) flash(`Theme set to ${theme}`);
    try {
      await chrome.storage.sync.set({ theme });
    } catch (err) {
      console.warn('Could not persist theme:', err);
    }
  }

  try {
    const { theme } = await chrome.storage.sync.get(['theme']);
    const initial = FocusReader ? FocusReader.normalizeTheme(theme) : (theme || 'dark');
    document.documentElement.dataset.theme = initial;
    renderThemePicker(initial);
  } catch (_) {}

  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      const current = document.documentElement.dataset.theme || 'dark';
      const nextTheme = themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length];
      await applyTheme(nextTheme);
    });
  }

  themeOptions.forEach((btn) => {
    btn.addEventListener('click', async () => {
      await applyTheme(btn.dataset.themeOption);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOptions);
} else {
  initOptions();
}
