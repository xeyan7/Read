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

  /* Skipped tags matching E:Read ["A", "I"] + protective code/form elements */
  SKIP_TAGS: [
    'A', 'I', 'EM', 'CODE', 'PRE', 'SAMP', 'KBD',
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT', 'OPTION',
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
    const editable = el.getAttribute && el.getAttribute('contenteditable');
    if (editable && editable !== 'false') return true;
    const hidden = el.getAttribute && el.getAttribute('aria-hidden') === 'true';
    return Boolean(hidden);
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
   * Boldify one whitespace-separated word: first floor(len * BOLD_RATIO) chars
   * go into a <span class="extension-adhd-reader-boldify focus-reader-bold">,
   * the rest stays plain. Both are wrapped in a container span.
   * Matches E:Read `_boldifyWord`.
   */
  boldifyWord(word) {
    if (!word || !isNaN(word) || !isNaN(word.slice(0, 1))) {
      return document.createTextNode(word);
    }
    const boldLen = Math.floor(word.length * FocusReader.BOLD_RATIO);
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
        wrapper.appendChild(FocusReader.boldifyWord(word));
        if (separators && separators.length > 0) {
          wrapper.appendChild(document.createTextNode(separators.shift()));
        }
      }

      textNode.replaceWith(wrapper);
    }
  },

  /**
   * Per-host on/off check. Storage shape: { "<hostname>": true/false }.
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
      const stored = await chrome.storage.sync.get([host]);
      if (stored[host] === true) return true;
      if (stored[host] === undefined) return undefined;
    } catch {
      return undefined;
    }
    return false;
  },

  /** Resolve the effective on/off state for a url, given mode + host pref. */
  async resolveActive(url, mode) {
    const hostState = await FocusReader.shouldBeActiveForUrl(url);
    if (hostState !== undefined) return hostState;
    return mode === 'automatic';
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
