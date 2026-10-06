/* test/helpers/env.mjs
 * A tiny jsdom harness that loads the extension's plain scripts (shared.js,
 * content.js, popup.js) the same way a browser would, with a fake
 * `chrome` API. No bundling, no transpiling — what runs in tests is the same
 * source that ships.
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

export const readSource = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * Minimal chrome.* mock. Mirrors only the surface the extension touches.
 * @param {{ storage?: Record<string, unknown>, tabs?: object[], onTabMessage?: Function }} opts
 */
export function createChromeMock(opts = {}) {
  const storage = { ...(opts.storage || {}) };
  const messageListeners = [];
  const sentMessages = [];
  const badges = {};
  const tabMessages = [];
  const injections = [];

  const pickKeys = (keys) => {
    if (keys == null) return { ...storage };
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) if (k in storage) out[k] = storage[k];
    return out;
  };

  const chrome = {
    storage: {
      onChanged: { addListener() {} },
      sync: {
        async get(keys) {
          return pickKeys(keys);
        },
        async set(obj) {
          Object.assign(storage, obj);
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storage[k];
        },
        onChanged: { addListener() {} },
      },
    },
    runtime: {
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onInstalled: { addListener() {} },
      async sendMessage(msg) {
        sentMessages.push(msg);
      },
      openOptionsPage() {},
      getURL: (p) => `chrome-extension://focus-reader/${p}`,
    },
    tabs: {
      onUpdated: { addListener() {} },
      async query() {
        return opts.tabs || [];
      },
      async sendMessage(tabId, msg) {
        tabMessages.push({ tabId, msg });
        if (opts.onTabMessage) return opts.onTabMessage(tabId, msg);
        return undefined;
      },
    },
    action: {
      setBadgeText({ text, tabId }) {
        badges[tabId ?? 'default'] = text;
      },
      setBadgeBackgroundColor() {},
      async enable() {},
    },
    scripting: {
      async executeScript(opts) {
        injections.push(opts);
      },
    },
  };

  return { chrome, storage, messageListeners, sentMessages, badges, tabMessages, injections };
}

/**
 * Build a jsdom window, inject the chrome mock, and evaluate `scripts`
 * (paths relative to the project root) inside it.
 *
 * @param {object} o
 * @param {string} [o.html]
 * @param {string} [o.url]
 * @param {string[]} [o.scripts]
 * @param {Record<string, unknown>} [o.storage]
 * @param {object[]} [o.tabs]
 * @param {Function} [o.onTabMessage]
 * @param {string|null} [o.forceReadyState] force document.readyState (content.js gates on 'complete')
 */
export function createPage({
  html = '<!DOCTYPE html><html><head></head><body></body></html>',
  url = 'https://example.com/page',
  scripts = [],
  storage = {},
  tabs = [],
  onTabMessage,
  forceReadyState = null,
} = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;

  const mock = createChromeMock({ storage, tabs, onTabMessage });
  window.chrome = mock.chrome;

  if (forceReadyState) {
    Object.defineProperty(window.document, 'readyState', {
      value: forceReadyState,
      configurable: true,
    });
  }

  for (const script of scripts) {
    // Run the file's source in global scope so `globalThis` === window.
    window.eval(`${readSource(script)}\n//# sourceURL=${script}`);
  }

  return { dom, window, document: window.document, mock };
}

/** Let jsdom deliver DOMContentLoaded / MutationObserver microtasks. */
export const settle = async (turns = 6) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/** Normalize a subtree's text content for assertions. */
export const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();
