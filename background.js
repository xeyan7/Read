/* background.js — MV3 service worker matching E:Read background.js module 136.
 *
 * Responsibilities:
 *  - Keep tabs in sync when mode switches between 'manual' and 'automatic'.
 *  - Set badge text to 'off' with background color #725a57 when deactivated on a site,
 *    and clear badge when activated.
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
  return mode === 'automatic' ? 'automatic' : 'manual';
}

async function sendToTab(tabId, greeting) {
  try {
    await chrome.tabs.sendMessage(tabId, { greeting }, { frameId: 0 });
  } catch (_) {
    // Content script not yet injected
  }
}

/** Set badge text matching E:Read ("off" with #725a57 background, or empty) */
async function syncBadge(tabId, text) {
  try {
    await chrome.action.setBadgeText({ text, tabId });
    if (text === 'off') {
      await chrome.action.setBadgeBackgroundColor({ color: '#725a57', tabId });
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
        }
      }
    } catch (err) {
      console.warn('Mode broadcast error:', err);
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
    const hostState = await FocusReader.shouldBeActiveForUrl(tab.url);
    if (hostState === false) {
      await syncBadge(tabId, 'off');
    } else {
      const { mode } = await chrome.storage.sync.get(['mode']);
      if (mode === 'automatic') {
        await syncBadge(tabId, '');
      }
    }
  } catch (_) {}
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.action.enable();
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
});

globalThis.__focusReaderBackground = { currentMode, syncBadge };
