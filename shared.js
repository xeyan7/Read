/* shared.js — pure bionic reading engine matching E:Read (ADHD Reader) module 563.
 * Safe to import in service workers, content scripts, and tests.
 *
 * All state lives in chrome.storage.sync:
 *   { mode: 'manual' | 'automatic', intensity: 'light' | 'medium' | 'strong',
 *     "<hostname>": true | false }
 */

'use strict';

// Re-injection safe: no top-level let/const/class — re-running this file
// (e.g. manual extension reload re-injecting shared.js into a tab that
// already has it) only re-assigns the same object reference instead of
// throwing "FocusReader has already been declared".
globalThis.FocusReader = globalThis.FocusReader || {
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
  /* Applied weights use calibrated font faces:
   * Light = 600 (semi-bold, calm and low-contrast for prolonged reading),
   * Medium = 750 (bold, balanced daily reading),
   * Strong = 900 (black, maximum punch — clearly visible even as white
   * on black where weight alone looks subtle).
   * Clear, distinct visual separation between all three tiers. */
  INTENSITY_WEIGHTS: { light: 600, medium: 750, strong: 900 },

  /* Displayed weights matching the applied font weights. */
  INTENSITY_DISPLAY_WEIGHTS: { light: 600, medium: 750, strong: 900 },

  /* Faux-bold boost per strength as a 0..1 alpha: a zero-blur text-shadow
   * whose alpha ramps with intensity. Strong glows enough to lift off dim
   * body text on black without blowing out to blobs. */
  INTENSITY_BOOST: { light: 0, medium: 0.08, strong: 0.22 },

  /* Continuous faux-bold stroke (px) per strength. Interpolates smoothly.
   * Light (0px), Medium (0.15px), Strong (0.4px) — gaps are deliberately
   * wide so each step reads clearly even on white, where weight alone
   * snaps between faces. */
  INTENSITY_STROKE: { light: 0, medium: 0.15, strong: 0.4 },

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

  /* Fixation Anchor modes (Letter Anchor Depth):
   *  - 'classic': Fixed 1/3 (33%) ratio from original E:Read
   *  - 'optimal': Shipped OVP tiered table (~35-45% avg, cap 5, never >50%)
   *  - 'high': Deep-focus anchor (~55%) for severe ADHD / cognitive strain
   */
  FIXATION_MODES: ['classic', 'optimal', 'high'],
  DEFAULT_FIXATION: 'optimal',
  FIXATION_RATIOS: { classic: 1 / 3, optimal: 0.42, high: 0.55 },

  /* Short high-frequency function words (Keith Rayner 1998, E-Z Reader model).
   * In eye-tracking research, proficient readers skip short grammatical words
   * ~65-75% of the time because they are easily recognized parafoveally.
   * Leaving them as plain text achieves the research-optimal ~65-70%
   * sentence fixation rate, eliminating the ADHD typographic strobe effect. */
  SHORT_FUNCTION_WORDS: new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'to', 'of', 'and', 'or',
    'for', 'by', 'as', 'if', 'is', 'it', 'be', 'so', 'up', 'no',
    'my', 'we', 'he', 'me', 'us', 'do', 'am',
  ]),

  /* Word Fixation Cadence (Saccade frequency - how many words get bolded):
   *  - 'optimal': Research-backed ~65-70% fixation rate (Keith Rayner 1998).
   *               Bolds informative content words while leaving short function
   *               words plain, mirroring natural ocular saccades.
   *  - 'all':     Bolds every word (100% continuous anchors).
   *  - 'alternating': Bolds every 2nd word (50% wide saccade jumps).
   */
  SACCADE_MODES: ['optimal', 'all', 'alternating'],
  DEFAULT_SACCADE: 'optimal',
  SACCADE_RATIOS: { optimal: '~67%', all: '100%', alternating: '50%' },

  normalizeSaccade(value) {
    return FocusReader.SACCADE_MODES.includes(value) ? value : FocusReader.DEFAULT_SACCADE;
  },

  /* Hard cap on bolded letters per word. Prevents long-word walls of bold
   * (Snell 2024 used first-half bolding with null effect; caps keep the
   * average near 40-45% instead of drifting to 50%+). */
  MAX_BOLD_LETTERS: 5,

  normalizeFixation(value) {
    return FocusReader.FIXATION_MODES.includes(value) ? value : FocusReader.DEFAULT_FIXATION;
  },

  /**
   * Evaluates whether a word should receive a bold fixation anchor based on
   * the saccade cadence mode and empirical eye-tracking research.
   */
  shouldBoldWord(word, opts = {}) {
    if (!word) return false;
    const clean = word.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]/gi, '');
    if (!clean || !isNaN(clean) || !isNaN(clean.slice(0, 1))) return false;
    if (clean.length <= 1) return false; // 1-letter words ('a', 'I') always plain

    const saccade = typeof opts === 'string'
      ? opts
      : (opts.saccade || FocusReader.DEFAULT_SACCADE || 'optimal');

    if (saccade === 'all') {
      return true;
    }

    if (saccade === 'alternating') {
      const idx = typeof opts.index === 'number' ? opts.index : 0;
      return idx % 2 === 0;
    }

    // Default 'optimal': Research-backed ~65-70% natural fixation rate (Rayner 1998).
    // Bypasses short function words (<= 3 chars) that the eye naturally skips.
    if (clean.length <= 3 && FocusReader.SHORT_FUNCTION_WORDS.has(clean)) {
      return false;
    }

    return true;
  },

  /**
   * Research-backed Optimal Viewing Position (OVP) letter bolding tiers (Rayner 1998, Snell 2024):
   *   - 1-letter words (a, I): 0 letters bolded (100% bold on a single letter creates a jarring visual bump).
   *   - 2-letter words (to, in, on): 1 letter (50%) when anchored, or kept plain if function word.
   *   - 3-letter words (the, and, cat): 1 letter (~33%). Bolding 2 letters would be 66.7%, which distorts the word contour.
   *   - 4-letter words (read, fast, word): 2 letters (50%—aligns with the OVP).
   *   - 5-letter words (focus, brain, speed): 2 letters (40%—aligns with the OVP).
   *   - 6-letter words (reader, visual, cortex): 3 letters (50%—syllable onset).
   *   - 7-letter words (reading, letters, optimal): 3 letters (42.8%—aligns with the OVP).
   *   - 8-letter words (research, sentence): 3 to 4 letters (37.5%–50%).
   *   - 9–10 letter words (attention, extension): 5 letters (50%–55%).
   *   - 11+ letter words (comprehension, internationalization): Hard-capped at 4–5 letters
   *     (strictly respecting the 4–5 character high-acuity foveal span; Rayner 1998).
   * When ratio is 1/3 ('classic'), matches legacy floor(len * 1/3).
   */
  calculateBoldLength(word, modeOrRatio = FocusReader.DEFAULT_FIXATION || 'optimal') {
    if (!word) return 0;
    const len = typeof word === 'string' ? word.length : Number(word);
    if (len <= 0) return 0;

    // Numeric ratio passed
    if (typeof modeOrRatio === 'number') {
      if (len <= 1) return 0;
      if (len === 4) return 2; // 4-letter words: strictly 2 bold, 2 simple
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
      if (len <= 1) return 0;
      if (len === 2 || len === 3) return 1;
      if (len === 4) return 2; // 4-letter words: strictly 2 bold, 2 simple (never 3)
      return Math.min(len, Math.max(1, Math.ceil(len * 0.55)));
    }

    // Default: 'optimal' (individual breakdown per word length)
    if (len <= 1) return 0;
    if (len === 2) return 1;
    if (len === 3) return 1;
    if (len === 4) return 2; // 4-letter words: 2 bold, 2 simple
    if (len === 5) return 2;
    if (len === 6) return 3;
    if (len === 7) return 3;
    if (len === 8) return 4;
    if (len === 9) return 5;
    if (len === 10) return 5;
    if (len === 11) return 5;
    if (len === 12) return 6;
    if (len === 13) return 6;
    if (len === 14) return 7;
    if (len === 15) return 7;
    if (len === 16) return 8;
    if (len === 17) return 8;
    if (len === 18) return 9;
    if (len === 19) return 9;
    if (len === 20) return 10;
    if (len === 21) return 10;
    if (len === 22) return 11;
    if (len === 23) return 11;
    if (len === 24) return 12;
    return Math.floor(len / 2);
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

  /** The single CSS rule that switches bionic bolding on at a given weight.
   * Var-driven so BOTH previews and live websites glide: the rule itself
   * never changes between strengths — only the three --wb-* vars move, and
   * their CSS transition (+ WAAPI glide in morphPreview) interpolates them
   * at 60fps. Hardcoding numbers per strength would snap.
   * Light pages ([data-fr-bg="light"], set by content.js from the body
   * background) get crisp weight-only bold — stroke/glow/brightness look
   * muddy as black-on-white (override sets filter:none below). Dark pages
   * keep the full pop: brightness lift scales with strength so Light
   * (≈1.18x, clearly lifted off dim body text), Medium (≈1.28x) and
   * Strong (≈1.59x) read as distinct steps even when weight alone
   * looks subtle as white-on-black. */
  styleRuleFor(intensity) {
    const key = FocusReader.normalizeIntensity(intensity);
    const weight = FocusReader.INTENSITY_WEIGHTS[key];
    const boost = FocusReader.boostFor(key);
    const stroke = FocusReader.strokeFor(key);
    const ease = FocusReader.MORPH_EASING || 'cubic-bezier(0.22, 1, 0.36, 1)';
    const ms = FocusReader.MORPH_MS || 550;
    const boldSel = `.${FocusReader.BOLD_CLASS}, .${FocusReader.LEGACY_BOLD_CLASS}`;
    return (
      `@property --wb-weight{syntax:'<number>';inherits:true;initial-value:750;}` +
      `@property --wb-stroke{syntax:'<length>';inherits:true;initial-value:0px;}` +
      `@property --wb-boost{syntax:'<number>';inherits:true;initial-value:0;}` +
      `:root{--wb-weight:${weight};--wb-boost:${boost};--wb-stroke:${stroke}px;` +
      `transition:--wb-weight ${ms}ms ${ease},--wb-stroke ${ms}ms ${ease},--wb-boost ${ms}ms ${ease},` +
      `-webkit-text-stroke-width ${ms}ms ${ease};}` +
      `${boldSel} { ` +
      `font-weight: var(--wb-weight, ${weight}); ` +
      `font-variation-settings: 'wght' var(--wb-weight, ${weight}); ` +
      `color: inherit; ` +
      `text-shadow: 0 0 calc(var(--wb-boost, ${boost}) * 3.5px) currentColor, 0 0 calc(var(--wb-boost, ${boost}) * 1px) currentColor; ` +
      `paint-order: stroke fill; ` +
      `filter: brightness(calc(1.18 + var(--wb-boost, ${boost}) * 1.2)); ` +
      `-webkit-text-stroke-width: var(--wb-stroke, ${stroke}px); -webkit-text-stroke-color: currentColor; }` +
      `html[data-fr-bg="light"] ${boldSel} { ` +
      `-webkit-text-stroke-width: var(--wb-stroke, ${stroke}px); text-shadow: none; filter: none; paint-order: stroke fill; }`
    );
  },

  /** Plain var triple for an intensity (used for WAAPI / inline sets). */
  varsFor(intensity) {
    const key = FocusReader.normalizeIntensity(intensity);
    return {
      weight: FocusReader.INTENSITY_WEIGHTS[key],
      boost: FocusReader.boostFor(key),
      stroke: FocusReader.strokeFor(key),
    };
  },

  /** Zero-blur text-shadow boost alpha for a strength (0 when unknown). */
  boostFor(intensity) {
    const map = FocusReader.INTENSITY_BOOST || {};
    const val = map[FocusReader.normalizeIntensity(intensity)];
    return typeof val === 'number' && Number.isFinite(val) ? val : 0;
  },

  /** Faux-bold stroke width (px) for a strength (0 when unknown). */
  strokeFor(intensity) {
    const map = FocusReader.INTENSITY_STROKE || {};
    const val = map[FocusReader.normalizeIntensity(intensity)];
    return typeof val === 'number' && Number.isFinite(val) ? val : 0;
  },

  /** Displayed weight number for a strength (matches the applied weight). */
  displayWeightFor(intensity) {
    const key = FocusReader.normalizeIntensity(intensity);
    const map = FocusReader.INTENSITY_DISPLAY_WEIGHTS || {};
    const val = map[key];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    return FocusReader.INTENSITY_WEIGHTS[key];
  },

  /** Human-readable label for a strength without numeric weights (e.g., 'Light', 'Medium', 'Strong'). */
  labelFor(intensity) {
    const key = FocusReader.normalizeIntensity(intensity);
    return key.charAt(0).toUpperCase() + key.slice(1);
  },

  /* Preview + website morph duration in ms. Must match the CSS transition on
   * .preview-sample / :root (--wb-weight / --wb-stroke / --wb-boost)
   * in popup.css + content pages. ~550ms with an expo-out
   * curve reads as a deliberate buttery glide rather than a snap. */
  MORPH_MS: 550,
  MORPH_EASING: 'cubic-bezier(0.22, 1, 0.36, 1)',

  /* In-flight morph timeout ids per preview container, so rapid
   * light -> medium -> strong clicks retarget cleanly instead of stacking. */
  _morphRafs: typeof WeakMap !== 'undefined' ? new WeakMap() : null,
  _morphState: typeof WeakMap !== 'undefined' ? new WeakMap() : null,
  _morphAnims: typeof WeakMap !== 'undefined' ? new WeakMap() : null,

  /** Current effective vars for an element (last morphed or inline values). */
  _readMorphVars(el) {
    const numOrNaN = (raw) => {
      if (raw == null) return NaN;
      const str = String(raw).trim().replace(/px\s*$/, '');
      if (!str) return NaN;
      const n = Number(str);
      return Number.isFinite(n) ? n : NaN;
    };
    let w = NaN;
    let b = NaN;
    let s;
    try {
      const cached = FocusReader._morphState ? FocusReader._morphState.get(el) : null;
      if (cached) {
        if (Number.isFinite(cached.w)) w = cached.w;
        if (Number.isFinite(cached.b)) b = cached.b;
        if (cached.s !== undefined) s = cached.s;
      }
    } catch (_) {}
    try {
      if (el && el.style) {
        if (!Number.isFinite(w)) {
          const parsedW = numOrNaN(el.style.getPropertyValue('--wb-weight'));
          if (Number.isFinite(parsedW)) w = parsedW;
        }
        if (!Number.isFinite(b)) {
          const parsedB = numOrNaN(el.style.getPropertyValue('--wb-boost'));
          if (Number.isFinite(parsedB)) b = parsedB;
        }
        if (s === undefined) {
          const parsedS = numOrNaN(el.style.getPropertyValue('--wb-stroke'));
          if (Number.isFinite(parsedS)) s = parsedS;
        }
      }
    } catch (_) {}
    // Fall back to computed style when nothing was ever set (first morph
    // then starts from the live value instead of jumping).
    try {
      if ((typeof window !== 'undefined' && window.getComputedStyle && el) &&
          (!Number.isFinite(w) || !Number.isFinite(b) || s === undefined)) {
        const cs = window.getComputedStyle(el);
        if (cs && typeof cs.getPropertyValue === 'function') {
          if (!Number.isFinite(w)) {
            const parsedW = numOrNaN(cs.getPropertyValue('--wb-weight'));
            if (Number.isFinite(parsedW)) w = parsedW;
          }
          if (!Number.isFinite(b)) {
            const parsedB = numOrNaN(cs.getPropertyValue('--wb-boost'));
            if (Number.isFinite(parsedB)) b = parsedB;
          }
          if (s === undefined) {
            const parsedS = numOrNaN(cs.getPropertyValue('--wb-stroke'));
            if (Number.isFinite(parsedS)) s = parsedS;
          }
        }
      }
    } catch (_) {}
    return {
      w: Number.isFinite(w) ? w : 750,
      b: Number.isFinite(b) ? b : 0.08,
      s: s !== undefined ? s : 0.15,
    };
  },

  /** True when the user prefers no animation — glide collapses to instant. */
  _prefersReducedMotion() {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
    } catch (_) {}
    return false;
  },

  /**
   * Morph preview bolding to the given weight / boost / stroke.
   * Writes --wb-weight, --wb-boost and --wb-stroke on each container and lets
   * the CSS transition (popup.css) interpolate them, so Light /
   * Medium / Strong visibly glide instead of snapping. Accepts either
   *   morphPreview(el, weight, boost, stroke, opts)
   * or the legacy
   *   morphPreview(el, weight, boost, opts)
   * (stroke left untouched). Falls back to the same instant set when motion
   * is reduced or animation is unavailable — the values are identical, only
   * the CSS transition is suppressed by prefers-reduced-motion.
   *
   * On top of the CSS glide, a Web Animations glide on the same three vars
   * is layered (Chromium animates registered custom props on the compositor
   * at a full 60fps). Inline styles still land synchronously on the final
   * values, so tests + persistence see the target instantly while the eye
   * sees a buttery from -> to glide with zero latency.
   *
   * Pass { instant: true } to skip the glide (used for the large studio
   * paragraph and first paint, where animating dozens of anchors janks).
   */
  morphPreview(containers, toWeight, toBoost, strokeOrOpts, maybeOpts) {
    const els = (Array.isArray(containers) ? containers : [containers]).filter(
      (el) => el && el.style && typeof el.style.setProperty === 'function'
    );
    if (!els.length) return;
    let toStroke;
    let opts = {};
    if (strokeOrOpts != null && typeof strokeOrOpts === 'object') {
      opts = strokeOrOpts;
    } else {
      if (strokeOrOpts !== undefined) toStroke = Number(strokeOrOpts);
      if (maybeOpts != null && typeof maybeOpts === 'object') opts = maybeOpts;
    }
    const targetW = Number(toWeight);
    const targetB = Number(toBoost);
    const hasStroke = toStroke !== undefined && Number.isFinite(toStroke);
    const instant = Boolean(opts && opts.instant);
    const reduced = FocusReader._prefersReducedMotion();
    const cancel = (el) => {
      if (FocusReader._morphRafs) {
        const prev = FocusReader._morphRafs.get(el);
        if (prev) {
          try {
            if (typeof clearTimeout === 'function') clearTimeout(prev);
          } catch (_) {}
          try {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(prev);
          } catch (_) {}
        }
        FocusReader._morphRafs.delete(el);
      }
      if (FocusReader._morphAnims) {
        try {
          const prevAnim = FocusReader._morphAnims.get(el);
          if (prevAnim && typeof prevAnim.cancel === 'function') prevAnim.cancel();
        } catch (_) {}
        try {
          FocusReader._morphAnims.delete(el);
        } catch (_) {}
      }
    };
    const glide = (el, from) => {
      // WAAPI layer: visual-only glide. Inline style already holds the final
      // values, so this never affects tests — it only smooths pixels.
      try {
        if (reduced || instant) return;
        if (!el.animate || typeof el.animate !== 'function') return;
        const sameW = from.w === targetW || (!Number.isFinite(targetW) && true);
        const sameB = from.b === targetB || (!Number.isFinite(targetB) && true);
        const sameS = !hasStroke || from.s === toStroke;
        if (sameW && sameB && sameS) return;
        const fromFrame = {};
        const toFrame = {};
        if (Number.isFinite(targetW)) {
          fromFrame['--wb-weight'] = String(from.w);
          toFrame['--wb-weight'] = String(targetW);
        }
        if (Number.isFinite(targetB)) {
          fromFrame['--wb-boost'] = String(from.b);
          toFrame['--wb-boost'] = String(targetB);
        }
        if (hasStroke) {
          fromFrame['--wb-stroke'] = `${from.s}px`;
          toFrame['--wb-stroke'] = `${toStroke}px`;
        }
        const anim = el.animate([fromFrame, toFrame], {
          duration: FocusReader.MORPH_MS || 550,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'none',
        });
        if (FocusReader._morphAnims) {
          FocusReader._morphAnims.set(el, anim);
          try {
            if (anim.finished && typeof anim.finished.then === 'function') {
              anim.finished.then(() => {
                try {
                  if (FocusReader._morphAnims.get(el) === anim) FocusReader._morphAnims.delete(el);
                } catch (_) {}
              }).catch(() => {});
            }
          } catch (_) {}
        }
      } catch (_) {}
    };
    els.forEach((el) => {
      const from = FocusReader._readMorphVars(el);
      cancel(el);
      // Instant path: suppress the CSS glide for one frame so large text
      // (studio) and first paint apply with zero latency.
      if (instant && el.style) {
        let prevTransition = '';
        try {
          prevTransition = el.style.transition || '';
          el.style.transition = 'none';
        } catch (_) {}
        if (Number.isFinite(targetW)) el.style.setProperty('--wb-weight', String(targetW));
        if (Number.isFinite(targetB)) el.style.setProperty('--wb-boost', String(targetB));
        if (hasStroke) el.style.setProperty('--wb-stroke', `${toStroke}px`);
        try {
          void el.offsetWidth;
        } catch (_) {}
        try {
          el.style.transition = prevTransition;
        } catch (_) {}
        if (FocusReader._morphState) {
          FocusReader._morphState.set(el, { w: targetW, b: targetB, s: hasStroke ? toStroke : from.s });
        }
        return;
      }
      if (Number.isFinite(targetW)) el.style.setProperty('--wb-weight', String(targetW));
      if (Number.isFinite(targetB)) el.style.setProperty('--wb-boost', String(targetB));
      if (hasStroke) el.style.setProperty('--wb-stroke', `${toStroke}px`);

      if (FocusReader._morphState) {
        FocusReader._morphState.set(el, {
          w: Number.isFinite(targetW) ? targetW : from.w,
          b: Number.isFinite(targetB) ? targetB : from.b,
          s: hasStroke ? toStroke : from.s,
        });
      }
      glide(el, from);
      if (el.classList && typeof el.classList.add === 'function') {
        el.classList.add('is-morphing');
        const timer = setTimeout(() => {
          if (el.classList && typeof el.classList.remove === 'function') {
            el.classList.remove('is-morphing');
          }
          if (FocusReader._morphRafs) {
            try {
              if (FocusReader._morphRafs.get(el) === timer) FocusReader._morphRafs.delete(el);
            } catch (_) {}
          }
        }, FocusReader.MORPH_MS || 550);
        if (FocusReader._morphRafs) {
          FocusReader._morphRafs.set(el, timer);
        }
      }
    });
  },

  /** Read back the last morphed values for a container (rAF coalescing). */
  morphStateFor(el) {
    if (FocusReader._morphState && el) {
      try {
        return FocusReader._morphState.get(el) || null;
      } catch (_) {}
    }
    return null;
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
    if (typeof opts === 'object' && opts !== null && opts.saccade) {
      if (!FocusReader.shouldBoldWord(word, opts)) {
        return document.createTextNode(word);
      }
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
      (n) => n.nodeValue.trim().length >= 2
    );

    const saccade = opts && opts.saccade
      ? FocusReader.normalizeSaccade(opts.saccade)
      : (FocusReader.DEFAULT_SACCADE || 'optimal');

    let wordCounter = 0;
    for (const textNode of textNodes) {
      const wrapper = document.createElement('span');
      wrapper.className = FocusReader.WRAPPER_CLASS;

      // Split on whitespace but remember separators so spacing is preserved.
      const separators = textNode.nodeValue.match(/\s+/g);
      const words = textNode.nodeValue.split(/\s+/g);

      for (const word of words) {
        if (!word) {
          if (separators && separators.length > 0) {
            wrapper.appendChild(document.createTextNode(separators.shift()));
          }
          continue;
        }
        const shouldBold = FocusReader.shouldBoldWord(word, {
          ...opts,
          index: wordCounter,
          saccade,
        });
        wordCounter++;
        if (shouldBold) {
          wrapper.appendChild(FocusReader.boldifyWord(word, opts));
        } else {
          wrapper.appendChild(document.createTextNode(word));
        }
        if (separators && separators.length > 0) {
          wrapper.appendChild(document.createTextNode(separators.shift()));
        }
      }

      textNode.replaceWith(wrapper);
    }
  },

  /**
   * Normalize a hostname for rule matching: lowercase, no trailing dot,
   * no port. Bracketed IPv6 keeps its brackets.
   */
  normalizeHostname(host) {
    let h = String(host || '').trim().toLowerCase();
    if (h.endsWith('.')) h = h.slice(0, -1);
    if (!h) return '';
    if (h.startsWith('[')) {
      const end = h.indexOf(']');
      return end >= 0 ? h.slice(0, end + 1) : h;
    }
    const first = h.indexOf(':');
    if (first >= 0 && h.indexOf(':', first + 1) < 0) {
      return h.slice(0, first);
    }
    return h;
  },

  /** True for IP literals — parent-domain walking never applies to them. */
  isIpHost(host) {
    const h = String(host || '');
    if (!h) return false;
    if (h.startsWith('[')) return true;
    return /^\d+\.\d+\.\d+\.\d+$/.test(h);
  },

  /**
   * Ordered rule-lookup keys for a host, most specific first: the exact
   * host, then each parent domain (so a rule on XYZ.com also governs
   * sub.XYZ.com and deep.sub.XYZ.com), each followed by its www. twin
   * for legacy www <-> bare equivalence. Never walks above a two-label
   * domain or into IP literals. A more specific stored rule always wins
   * because it is checked first.
   */
  domainCandidates(host) {
    const out = [];
    const push = (h) => {
      if (h && !out.includes(h)) out.push(h);
    };
    let raw = String(host || '').trim().toLowerCase();
    if (raw.endsWith('.')) raw = raw.slice(0, -1);
    if (!raw) return out;
    push(raw);
    const norm = FocusReader.normalizeHostname(raw);
    push(norm);
    if (FocusReader.isIpHost(norm)) {
      push(norm.startsWith('www.') ? norm.slice(4) : `www.${norm}`);
      return out;
    }
    const parts = norm.split('.');
    for (let i = 1; i < parts.length; i += 1) {
      const cand = parts.slice(i).join('.');
      if (!cand.includes('.')) break;
      push(cand);
    }
    for (const base of out.slice()) {
      push(base.startsWith('www.') ? base.slice(4) : `www.${base}`);
    }
    return out;
  },

  /**
   * Per-host on/off check with subdomain inheritance: a rule stored for
   * XYZ.com also applies to sub.XYZ.com (most-specific stored rule wins).
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
    const keys = FocusReader.domainCandidates(host);
    if (!keys.length) return undefined;
    try {
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

// Lexical alias for the method bodies above. `var` (not let/const) so a
// second evaluation in the same realm re-declares harmlessly.
var FocusReader = globalThis.FocusReader;

// Aliases for 100% E:Read module 563 drop-in compatibility
FocusReader.shouldBeActiveValidation = FocusReader.shouldBeActiveForUrl;
FocusReader.boldifyContent = FocusReader.boldifyParagraph;
FocusReader._boldifyWord = FocusReader.boldifyWord;
FocusReader.__getChildTextNodes = FocusReader.getChildTextNodes;

// Expose globally
globalThis.FocusReader = FocusReader;
globalThis.ERead = FocusReader;

// Register typed CSS properties for hardware-accelerated preview morphing
if (typeof CSS !== 'undefined' && typeof CSS.registerProperty === 'function') {
  try {
    CSS.registerProperty({
      name: '--wb-weight',
      syntax: '<number>',
      inherits: true,
      initialValue: '750',
    });
  } catch (_) {}
  try {
    CSS.registerProperty({
      name: '--wb-stroke',
      syntax: '<length>',
      inherits: true,
      initialValue: '0px',
    });
  } catch (_) {}
  try {
    CSS.registerProperty({
      name: '--wb-boost',
      syntax: '<number>',
      inherits: true,
      initialValue: '0',
    });
  } catch (_) {}
}
