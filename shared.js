/* shared.js — pure bionic reading engine matching E:Read (ADHD Reader) module 563.
 * Safe to import in service workers, content scripts, and tests.
 *
 * All state lives in chrome.storage.sync:
 *   { mode: 'manual' | 'automatic', intensity: 'light' | 'medium' | 'strong',
 *     "<hostname>": true | false }
 */

'use strict';

const FocusReader = {
  STYLE_ID: 'adhdReaderStyleTag',
  LEGACY_STYLE_ID: 'focusReaderStyleTag',

  BOLD_CLASS: 'extension-adhd-reader-boldify',
  LEGACY_BOLD_CLASS: 'focus-reader-bold',

  CONTAINER_CLASS: 'extension-adhd-reader-container',
  LEGACY_CONTAINER_CLASS: 'focus-reader-container',

  WRAPPER_CLASS: 'extension-adhd-reader-wrapper',
  LEGACY_WRAPPER_CLASS: 'focus-reader-wrapper',

  PARAGRAPH_CLASS: 'extension-adhd-reader-p',
  LEGACY_PARAGRAPH_CLASS: 'focus-reader-p',

  /* Fixed 1/3 reading anchor ratio from E:Read */
  BOLD_RATIO: 1 / 3,

  INTENSITIES: ['light', 'medium', 'strong'],
  DEFAULT_INTENSITY: 'medium',
  INTENSITY_WEIGHTS: { light: 500, medium: 700, strong: 900 },

  /* UI color themes: minimal monochrome dark (default) and light. */
  THEMES: ['dark', 'light'],
  DEFAULT_THEME: 'dark',

  /* Coerce any stored value into a known theme id. */
  normalizeTheme(value) {
    return FocusReader.THEMES.includes(value) ? value : FocusReader.DEFAULT_THEME;
  },

  /* Default execution mode: always active on all sites unless explicitly disabled. */
  DEFAULT_MODE: 'automatic',

  /* Coerce any stored value into a known mode id (defaults to always-active). */
  normalizeMode(value) {
    return value === 'manual' ? 'manual' : 'automatic';
  },

  /* Fixation Anchor modes:
   *  - 'classic': Fixed 1/3 (33%) ratio from original E:Read
   *  - 'optimal': Research-backed OVP (Optimal Viewing Position ~45%)
   *  - 'high': Deep-focus anchor (~55%) for severe ADHD / cognitive strain
   */
  FIXATION_MODES: ['classic', 'optimal', 'high'],
  DEFAULT_FIXATION: 'optimal',
  FIXATION_RATIOS: { classic: 1 / 3, optimal: 0.45, high: 0.55 },

  normalizeFixation(value) {
    return FocusReader.FIXATION_MODES.includes(value) ? value : FocusReader.DEFAULT_FIXATION;
  },

  /**
   * Calculate the optimal number of characters to bold based on cognitive science
   * and word length. When ratio is 1/3 ('classic'), matches legacy floor(len * 1/3).
   * In 'optimal' mode, aligns with Rayner (1998) Optimal Viewing Position (OVP):
   *   - len 1: 0 (or 1)
   *   - len 2: 1 (50%)
   *   - len 3: 1 (33%)
   *   - len 4: 2 (50%)
   *   - len 5: 2 (40%)
   *   - len 6: 3 (50%)
   *   - len 7: 3 (43%)
   *   - len 8: 4 (50%)
   *   - len 9-10: 4 (~40%)
   *   - len 11+: Math.min(Math.ceil(len * 0.42), Math.floor(len * 0.5))
   */
  calculateBoldLength(word, modeOrRatio = FocusReader.BOLD_RATIO) {
    if (!word) return 0;
    const len = typeof word === 'string' ? word.length : Number(word);
    if (len <= 0) return 0;

    // Numeric ratio passed
    if (typeof modeOrRatio === 'number') {
      if (Math.abs(modeOrRatio - (1 / 3)) < 0.01) {
        return Math.floor(len * (1 / 3));
      }
      return Math.min(len, Math.max(1, Math.round(len * modeOrRatio)));
    }

    // Named modes
    if (modeOrRatio === 'classic') {
      return Math.floor(len * (1 / 3));
    }

    if (modeOrRatio === 'high') {
      if (len <= 1) return 1;
      return Math.min(len, Math.max(1, Math.ceil(len * 0.55)));
    }

    // Default: 'optimal' (OVP model)
    if (len <= 1) return 0;
    if (len === 2) return 1;
    if (len === 3) return 1;
    if (len === 4) return 2;
    if (len === 5) return 2;
    if (len === 6) return 3;
    if (len === 7) return 3;
    if (len === 8) return 4;
    if (len <= 10) return 4;
    return Math.min(Math.floor(len * 0.5), Math.max(4, Math.ceil(len * 0.42)));
  },

  /* Skipped tags matching E:Read ["A", "I"] + protective code/form/media elements */
  SKIP_TAGS: [
    'A', 'I', 'EM', 'CODE', 'PRE', 'SAMP', 'KBD',
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT', 'OPTION',
    'SVG', 'CANVAS', 'AUDIO', 'VIDEO', 'MATH', 'IFRAME', 'OBJECT', 'EMBED',
  ],

  /** Coerce any stored value into a known intensity id. */
  normalizeIntensity(value) {
    return FocusReader.INTENSITIES.includes(value) ? value : FocusReader.DEFAULT_INTENSITY;
  },

  /** The single CSS rule that switches bionic bolding on at a given weight. */
  styleRuleFor(intensity) {
    const weight = FocusReader.INTENSITY_WEIGHTS[FocusReader.normalizeIntensity(intensity)];
    return `.${FocusReader.BOLD_CLASS}, .${FocusReader.LEGACY_BOLD_CLASS} { font-weight: ${weight}; }`;
  },

  /** Back-compat accessor for the default rule. */
  get STYLE_RULE() {
    return FocusReader.styleRuleFor(FocusReader.DEFAULT_INTENSITY);
  },

  /** True when an element's subtree should be left alone (editable/hidden). */
  isSkippable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const editable = el.getAttribute && el.getAttribute('contenteditable');
    if (editable && editable !== 'false') return true;
    const hidden = el.getAttribute && el.getAttribute('aria-hidden') === 'true';
    if (hidden) return true;
    if (el.closest && el.closest('[contenteditable="true"], form, pre, code')) return true;
    return false;
  },

  /**
   * Recursively collect Text nodes under `root`, skipping SKIP_TAGS subtrees and
   * already-boldified containers. Matches E:Read `__getChildTextNodes`.
   */
  getChildTextNodes(root, skipTags = FocusReader.SKIP_TAGS) {
    const out = [];
    for (const child of root.childNodes) {
      if (child.nodeType === 1) {
        if (skipTags.includes(child.nodeName)) continue;
        if (
          child.classList &&
          (child.classList.contains(FocusReader.CONTAINER_CLASS) ||
            child.classList.contains(FocusReader.LEGACY_CONTAINER_CLASS))
        ) {
          continue;
        }
        if (FocusReader.isSkippable(child)) continue;
      }
      if (child.nodeName === '#text') {
        out.push(child);
        continue;
      }
      out.push(...FocusReader.getChildTextNodes(child, skipTags));
    }
    return out;
  },

  /**
   * Boldify one whitespace-separated word: first calculated characters
   * go into a <span class="extension-adhd-reader-boldify focus-reader-bold">,
   * the rest stays plain. Both are wrapped in a container span.
   * Isolates punctuation so anchors land strictly on letter phonemes.
   */
  boldifyWord(word, opts = FocusReader.BOLD_RATIO) {
    if (!word || !isNaN(word) || !isNaN(word.slice(0, 1))) {
      return document.createTextNode(word);
    }
    const modeOrRatio = typeof opts === 'object' && opts !== null
      ? (opts.fixation || opts.ratio || FocusReader.BOLD_RATIO)
      : opts;

    // Isolate leading/trailing punctuation if present
    const match = word.match(/^([^a-zA-Z0-9\u00C0-\u024F]*)([\s\S]*?)([^a-zA-Z0-9\u00C0-\u024F]*)$/);
    if (match && (match[1] || match[3]) && match[2].length > 0) {
      const prefix = match[1];
      const core = match[2];
      const suffix = match[3];
      if (!core || !isNaN(core) || !isNaN(core.slice(0, 1))) {
        return document.createTextNode(word);
      }
      const boldLen = FocusReader.calculateBoldLength(core, modeOrRatio);
      if (boldLen < 1) return document.createTextNode(word);

      const boldSpan = document.createElement('span');
      boldSpan.className = FocusReader.BOLD_CLASS;
      boldSpan.appendChild(document.createTextNode(core.slice(0, boldLen)));

      const container = document.createElement('span');
      container.className = FocusReader.CONTAINER_CLASS;
      if (prefix) container.appendChild(document.createTextNode(prefix));
      container.appendChild(boldSpan);
      container.appendChild(document.createTextNode(core.slice(boldLen) + suffix));
      return container;
    }

    const boldLen = FocusReader.calculateBoldLength(word, modeOrRatio);
    if (boldLen < 1) return document.createTextNode(word);

    const boldSpan = document.createElement('span');
    boldSpan.className = FocusReader.BOLD_CLASS;
    boldSpan.appendChild(document.createTextNode(word.slice(0, boldLen)));

    const container = document.createElement('span');
    container.className = FocusReader.CONTAINER_CLASS;
    container.appendChild(boldSpan);
    container.appendChild(document.createTextNode(word.slice(boldLen)));
    return container;
  },

  /**
   * Boldify a single <p> element in place. Idempotent: paragraphs already
   * carrying PARAGRAPH_CLASS are skipped. Matches E:Read `boldifyContent`.
   */
  boldifyParagraph(p, opts = {}) {
    if (!p || p.nodeName !== 'P') return;
    if (FocusReader.isSkippable(p)) return;
    const skipTags = opts.skipTags || FocusReader.SKIP_TAGS;
    if (
      p.classList &&
      (p.classList.contains(FocusReader.PARAGRAPH_CLASS) ||
        p.classList.contains(FocusReader.LEGACY_PARAGRAPH_CLASS))
    ) {
      return;
    }
    p.classList.add(FocusReader.PARAGRAPH_CLASS);

    const textNodes = FocusReader.getChildTextNodes(p, skipTags).filter(
      (n) => Math.floor(n.nodeValue.trim().length * FocusReader.BOLD_RATIO) >= 1
    );

    for (const textNode of textNodes) {
      const wrapper = document.createElement('span');
      wrapper.className = FocusReader.WRAPPER_CLASS;

      // Split on whitespace but remember separators so spacing is preserved.
      const separators = textNode.nodeValue.match(/\s+/g);
      const words = textNode.nodeValue.split(/\s+/g);

      for (const word of words) {
        wrapper.appendChild(FocusReader.boldifyWord(word, opts));
        if (separators && separators.length > 0) {
          wrapper.appendChild(document.createTextNode(separators.shift()));
        }
      }

      textNode.replaceWith(wrapper);
    }
  },

  /**
   * Per-host on/off check with www/base domain normalization.
   * Storage shape: { "<hostname>": true/false }.
   * Returns true (explicit on), false (explicit off), undefined (no pref).
   * Exact match to E:Read `shouldBeActiveValidation`.
   */
  async shouldBeActiveForUrl(url) {
    if (!url) return undefined;
    let host;
    try {
      host = new URL(url).host;
    } catch {
      return undefined;
    }
    try {
      const keys = [host];
      if (host.startsWith('www.')) {
        keys.push(host.slice(4));
      } else {
        keys.push(`www.${host}`);
      }
      const stored = await chrome.storage.sync.get(keys);
      for (const k of keys) {
        if (stored[k] === true) return true;
        if (stored[k] === false) return false;
      }
      return undefined;
    } catch {
      return undefined;
    }
  },

  /** Resolve the effective on/off state for a url, given mode + host pref.
   * Default is always-active: only an explicit host=false or global
   * mode='manual' turns reading off. */
  async resolveActive(url, mode) {
    const hostState = await FocusReader.shouldBeActiveForUrl(url);
    if (hostState !== undefined) return hostState;
    return mode !== 'manual';
  },
};

// Aliases for 100% E:Read module 563 drop-in compatibility
FocusReader.shouldBeActiveValidation = FocusReader.shouldBeActiveForUrl;
FocusReader.boldifyContent = FocusReader.boldifyParagraph;
FocusReader._boldifyWord = FocusReader.boldifyWord;
FocusReader.__getChildTextNodes = FocusReader.getChildTextNodes;

// Expose globally
globalThis.FocusReader = FocusReader;
globalThis.ERead = FocusReader;
