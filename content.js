/* content.js — runs on every web page matching E:Read myscript.js module 436.
 *
 * Strategy (matching E:Read):
 * 1. Ensure <style id="adhdReaderStyleTag"> is present in <head>.
 *    Empty = OFF, containing weight rule = ON. The popup queries this via "isActive".
 * 2. Boldify all <p> tags idempotently.
 * 3. MutationObserver watches body childList mutations and boldifies any new <p> nodes
 *    instantly for SPA / dynamic feeds.
 * 4. On page load, evaluates mode + per-host sync preference.
 * 5. Handles live "Activate", "Deactivate", "isActive", and "SetIntensity" messages.
 */

'use strict';

if (!globalThis.__focusReaderContentLoaded) {
  globalThis.__focusReaderContentLoaded = true;

  const FocusReaderContent = (() => {
    let initialized = false;
    let intensity = FocusReader.DEFAULT_INTENSITY;
    let fixation = FocusReader.DEFAULT_FIXATION || 'optimal';
    let saccade = FocusReader.DEFAULT_SACCADE || 'optimal';
    let observer = null;
    let isMutatingDOM = false;
    let rafId = null;

    function ensureStyleTag() {
      let tag =
        document.querySelector(`#${FocusReader.STYLE_ID}`) ||
        document.querySelector(`#${FocusReader.LEGACY_STYLE_ID}`);
      if (!tag) {
        tag = document.createElement('style');
        tag.setAttribute('id', FocusReader.STYLE_ID);
        tag.setAttribute('type', 'text/css');
        (document.head || document.documentElement).appendChild(tag);
      }
      return tag;
    }

    function setActive(on) {
      const tag = ensureStyleTag();
      const rule = on ? FocusReader.styleRuleFor(intensity) : '';
      tag.textContent = rule;
      tag.innerHTML = rule;
    }

    function isActive() {
      const tag =
        document.querySelector(`#${FocusReader.STYLE_ID}`) ||
        document.querySelector(`#${FocusReader.LEGACY_STYLE_ID}`);
      return Boolean(tag && (tag.textContent || tag.innerHTML || '').length > 0);
    }

    function boldifyAllParagraphs() {
      if (isMutatingDOM) return;
      isMutatingDOM = true;
      try {
        const paragraphs = document.querySelectorAll('p');
        for (const p of paragraphs) {
          FocusReader.boldifyParagraph(p, { fixation, saccade });
        }
      } finally {
        isMutatingDOM = false;
      }
    }

    function watchForNewParagraphs() {
      const target = document.body || document.documentElement;
      if (!target || observer) return;
      observer = new MutationObserver((mutations) => {
        if (isMutatingDOM) return;
        const hasChildList = mutations.some((m) => m.type === 'childList');
        if (hasChildList) {
          if (typeof cancelAnimationFrame === 'function' && rafId) {
            cancelAnimationFrame(rafId);
          }
          const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
          rafId = schedule(() => {
            rafId = null;
            const hasUnprocessed = Array.from(document.querySelectorAll('p')).some(
              (p) =>
                !p.classList.contains(FocusReader.PARAGRAPH_CLASS) &&
                !p.classList.contains(FocusReader.LEGACY_PARAGRAPH_CLASS)
            );
            if (hasUnprocessed) {
              boldifyAllParagraphs();
            }
          });
        }
      });
      observer.observe(target, { childList: true, subtree: true });
    }

    function stopWatching() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (typeof cancelAnimationFrame === 'function' && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    function applyIntensity(next) {
      intensity = FocusReader.normalizeIntensity(next);
      if (isActive()) setActive(true);
      return intensity;
    }

    function applyFixation(next) {
      fixation = FocusReader.normalizeFixation ? FocusReader.normalizeFixation(next) : next;
      if (isActive()) boldifyAllParagraphs();
      return fixation;
    }

    function applySaccade(next) {
      saccade = FocusReader.normalizeSaccade ? FocusReader.normalizeSaccade(next) : next;
      if (isActive()) boldifyAllParagraphs();
      return saccade;
    }

    async function decideActive() {
      try {
        const { mode, intensity: storedIntensity, fixation: storedFixation, saccade: storedSaccade } =
          await chrome.storage.sync.get(['mode', 'intensity', 'fixation', 'saccade']);
        if (storedIntensity !== undefined) intensity = FocusReader.normalizeIntensity(storedIntensity);
        if (storedFixation !== undefined && FocusReader.normalizeFixation) {
          fixation = FocusReader.normalizeFixation(storedFixation);
        }
        if (storedSaccade !== undefined && FocusReader.normalizeSaccade) {
          saccade = FocusReader.normalizeSaccade(storedSaccade);
        }
        return await FocusReader.resolveActive(document.location.href, mode);
      } catch {
        return false;
      }
    }

    async function refreshActive() {
      const shouldBeActive = await decideActive();
      setActive(shouldBeActive);
      if (shouldBeActive) {
        boldifyAllParagraphs();
        watchForNewParagraphs();
      } else {
        stopWatching();
      }
      return shouldBeActive;
    }

    async function init() {
      if (initialized) return;
      initialized = true;
      ensureStyleTag();
      await refreshActive();
    }

    // Kick off as soon as DOM is interactive or complete
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', init);
      window.addEventListener('load', init);
      const timer = setInterval(() => {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          clearInterval(timer);
          init();
        }
      }, 100);
    }

    // SPA navigations reuse document
    window.addEventListener('popstate', refreshActive);
    window.addEventListener('hashchange', refreshActive);

    return {
      init,
      setActive,
      isActive,
      boldifyAllParagraphs,
      watchForNewParagraphs,
      stopWatching,
      applyIntensity,
      applyFixation,
      applySaccade,
      refreshActive,
      decideActive,
      get intensity() {
        return intensity;
      },
      get fixation() {
        return fixation;
      },
      get saccade() {
        return saccade;
      },
      get initialized() {
        return initialized;
      },
    };
  })();

  globalThis.FocusReaderContent = FocusReaderContent;
  globalThis.EReadContent = FocusReaderContent;

  // Message listener matching E:Read myscript.js module 436
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.greeting) return;
    switch (msg.greeting) {
      case 'isActive':
        sendResponse(FocusReaderContent.isActive());
        break;
      case 'Activate':
        FocusReaderContent.setActive(true);
        FocusReaderContent.boldifyAllParagraphs();
        FocusReaderContent.watchForNewParagraphs();
        try {
          chrome.runtime.sendMessage({ greeting: 'Activate' });
        } catch (_) {}
        sendResponse(true);
        break;
      case 'Deactivate':
        FocusReaderContent.setActive(false);
        FocusReaderContent.stopWatching();
        try {
          chrome.runtime.sendMessage({ greeting: 'Deactivate' });
        } catch (_) {}
        sendResponse(false);
        break;
      case 'SetIntensity':
        FocusReaderContent.applyIntensity(msg.intensity);
        sendResponse(true);
        break;
      case 'SetFixation':
        FocusReaderContent.applyFixation(msg.fixation);
        sendResponse(true);
        break;
      case 'SetSaccade':
        FocusReaderContent.applySaccade(msg.saccade);
        sendResponse(true);
        break;
    }
  });

  // Live updates from options / popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.intensity) FocusReaderContent.applyIntensity(changes.intensity.newValue);
    if (changes.fixation) FocusReaderContent.applyFixation(changes.fixation.newValue);
    if (changes.saccade) FocusReaderContent.applySaccade(changes.saccade.newValue);
  });
}
