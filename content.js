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

const FocusReaderContent = (() => {
  let initialized = false;
  let intensity = FocusReader.DEFAULT_INTENSITY;
  let observer = null;

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
    const paragraphs = document.querySelectorAll('p');
    for (const p of paragraphs) {
      FocusReader.boldifyParagraph(p);
    }
  }

  function watchForNewParagraphs() {
    const target = document.body || document.documentElement;
    if (!target || observer) return;
    observer = new MutationObserver((mutations) => {
      const hasChildList = mutations.some((m) => m.type === 'childList');
      if (hasChildList) {
        const hasUnprocessed = Array.from(document.querySelectorAll('p')).some(
          (p) =>
            !p.classList.contains(FocusReader.PARAGRAPH_CLASS) &&
            !p.classList.contains(FocusReader.LEGACY_PARAGRAPH_CLASS)
        );
        if (hasUnprocessed) {
          boldifyAllParagraphs();
        }
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  function applyIntensity(next) {
    intensity = FocusReader.normalizeIntensity(next);
    if (isActive()) setActive(true);
    return intensity;
  }

  async function decideActive() {
    try {
      const { mode, intensity: storedIntensity } = await chrome.storage.sync.get(['mode', 'intensity']);
      if (storedIntensity !== undefined) intensity = FocusReader.normalizeIntensity(storedIntensity);
      return await FocusReader.resolveActive(document.location.href, mode);
    } catch {
      return false;
    }
  }

  async function refreshActive() {
    const shouldBeActive = await decideActive();
    setActive(shouldBeActive);
    return shouldBeActive;
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    ensureStyleTag();
    boldifyAllParagraphs();
    watchForNewParagraphs();
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
    applyIntensity,
    refreshActive,
    decideActive,
    get intensity() {
      return intensity;
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
      FocusReaderContent.boldifyAllParagraphs();
      FocusReaderContent.setActive(true);
      try {
        chrome.runtime.sendMessage({ greeting: 'Activate' });
      } catch (_) {}
      sendResponse(true);
      break;
    case 'Deactivate':
      FocusReaderContent.setActive(false);
      try {
        chrome.runtime.sendMessage({ greeting: 'Deactivate' });
      } catch (_) {}
      sendResponse(false);
      break;
    case 'SetIntensity':
      FocusReaderContent.applyIntensity(msg.intensity);
      sendResponse(true);
      break;
  }
});

// Live intensity updates from options / popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.intensity) FocusReaderContent.applyIntensity(changes.intensity.newValue);
});
