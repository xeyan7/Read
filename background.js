/* background.js — MV3 service worker matching E:Read background.js module 136.
 *
 * Responsibilities:
 *  - Keep tabs in sync when mode switches between 'manual' and 'automatic'.
 *  - Set badge text to 'off' with neutral slate (#4B5563) background when
 *    deactivated on a site, and clear badge when activated.
 */

'use strict';

try {
  importScripts('shared.js');
} catch (_) {
  // Already present (e.g. tests) — ignore.
}

const isWebTab = (tab) => Boolean(tab && tab.url && tab.url.startsWith('http'));

async function currentMode() {
  const { mode } = await chrome.storage.sync.get(['mode']);
  return mode === 'manual' ? 'manual' : 'automatic';
}

async function sendToTab(tabId, greeting) {
  return sendMsgToTab(tabId, { greeting });
}

async function sendMsgToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
    return;
  } catch (_) {
    // No receiving end — tab predates the content script. Inject, retry once.
    try {
      if (chrome.scripting && chrome.scripting.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          files: ['shared.js', 'content.js'],
        });
        await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
      }
    } catch (_) {}
  }
}

/** Set badge text ("off" with neutral slate background, or empty) */
async function syncBadge(tabId, text) {
  try {
    await chrome.action.setBadgeText({ text, tabId });
    if (text === 'off') {
      await chrome.action.setBadgeBackgroundColor({ color: '#4B5563', tabId });
    }
  } catch (_) {}
}

/** Broadcast state when storage mode or intensity changes, matching E:Read module 136 */
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.mode) {
    const nextMode = changes.mode.newValue;
    try {
      const tabs = (await chrome.tabs.query({})).filter(isWebTab);
      for (const tab of tabs) {
        const hostState = await FocusReader.shouldBeActiveForUrl(tab.url);
        if (nextMode === 'manual') {
          if (hostState !== true) {
            await sendToTab(tab.id, 'Deactivate');
            await syncBadge(tab.id, 'off');
          }
        } else if (nextMode === 'automatic') {
          if (hostState !== false) {
            await sendToTab(tab.id, 'Activate');
            await syncBadge(tab.id, '');
          }
        } else {
          // Unknown mode value — fall back to effective state so an explicit
          // per-site rule still wins (excluded stays off, included stays on).
          try {
            const active = await FocusReader.resolveActive(tab.url, nextMode);
            await sendMsgToTab(tab.id, { greeting: active ? 'Activate' : 'Deactivate' });
            await syncBadge(tab.id, active ? '' : 'off');
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('Mode broadcast error:', err);
    }
  }
  // Live-apply reading calibration to every open tab so a strength / density
  // change takes effect without reload. Content scripts also listen to
  // storage directly; this covers tabs whose receiver missed that event.
  const liveKeys = [
    ['intensity', 'SetIntensity'],
    ['fixation', 'SetFixation'],
    ['saccade', 'SetSaccade'],
  ];
  for (const [key, greeting] of liveKeys) {
    if (changes[key]) {
      try {
        const tabs = (await chrome.tabs.query({})).filter(isWebTab);
        for (const tab of tabs) {
          await sendMsgToTab(tab.id, { greeting, [key]: changes[key].newValue });
        }
      } catch (err) {
        console.warn(`${key} broadcast error:`, err);
      }
    }
  }
});

// Runtime messages from content scripts matching E:Read
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender && sender.tab && sender.tab.id != null) {
    if (msg.greeting === 'Activate') {
      syncBadge(sender.tab.id, '');
    } else if (msg.greeting === 'Deactivate') {
      syncBadge(sender.tab.id, 'off');
    }
  }
});

// Sync badge on tab navigation or completion
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isWebTab(tab)) return;
  try {
    // Effective state: explicit per-site true/false wins; otherwise the
    // global mode decides (manual = off by default, automatic = on).
    // This keeps excluded sites showing 'off' and included sites clearing
    // the badge in every mode combination.
    const { mode } = await chrome.storage.sync.get(['mode']);
    const active = await FocusReader.resolveActive(tab.url, mode);
    await syncBadge(tabId, active ? '' : 'off');
  } catch (_) {}
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.action.enable();
  } catch (_) {}
  // Seed first-install defaults so preferences are saved from the start:
  // dark UI theme, medium strength, automatic activation. Only fills keys
  // that are still missing so existing user choices are never overwritten.
  try {
    const FR = typeof FocusReader !== 'undefined' ? FocusReader : null;
    const stored = await chrome.storage.sync.get(['mode', 'intensity', 'theme', 'fixation', 'saccade']);
    const seed = {};
    if (stored.mode === undefined) seed.mode = (FR && FR.DEFAULT_MODE) || 'automatic';
    if (stored.intensity === undefined) seed.intensity = (FR && FR.DEFAULT_INTENSITY) || 'medium';
    if (stored.theme === undefined) seed.theme = (FR && FR.DEFAULT_THEME) || 'dark';
    if (stored.fixation === undefined) seed.fixation = (FR && FR.DEFAULT_FIXATION) || 'optimal';
    if (stored.saccade === undefined) seed.saccade = (FR && FR.DEFAULT_SACCADE) || 'optimal';
    if (Object.keys(seed).length > 0) {
      await chrome.storage.sync.set(seed);
    }
  } catch (_) {}
  // Enforce red book icon everywhere (toolbar + store listings use manifest,
  // this guarantees the runtime toolbar icon too).
  try {
    await chrome.action.setIcon({
      path: {
        16: 'icons/logo-16.png',
        32: 'icons/logo-32.png',
        48: 'icons/logo-48.png',
        128: 'icons/logo-128.png'
      }
    });
  } catch (_) {}
  // Tabs already open at install/update time never received the content
  // script — inject it so messaging never hits a missing receiving end.
  try {
    if (chrome.scripting && chrome.scripting.executeScript) {
      const tabs = (await chrome.tabs.query({})).filter(isWebTab);
      for (const tab of tabs) {
        if (tab.id == null) continue;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            files: ['shared.js', 'content.js'],
          });
        } catch (_) {}
      }
    }
  } catch (_) {}
});

globalThis.__focusReaderBackground = { currentMode, syncBadge };
