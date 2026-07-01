/**
 * TubeSift — Background Service Worker
 *
 * Manages the Shorts redirect rule via chrome.declarativeNetRequest.
 * When Shorts blocking is enabled, navigating to youtube.com/shorts/*
 * is redirected to the extension's blocked.html page.
 *
 * Uses dynamic rules so the redirect can be toggled on/off from the popup
 * without requiring a static ruleset or extension reload.
 */
'use strict';

const SHORTS_RULE_ID = 1;

const DEFAULT_SETTINGS = {
  shortsBlocked: true,
  yearFilterEnabled: false,
  yearFilterMode: 'single',
  yearFilterSingle: new Date().getFullYear(),
  yearFilterFrom: 2005,
  yearFilterTo: new Date().getFullYear(),
};

/**
 * Adds the declarativeNetRequest rule that redirects /shorts/ URLs
 * to the extension's blocked.html page.
 */
async function addShortsBlockRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SHORTS_RULE_ID],
      addRules: [
        {
          id: SHORTS_RULE_ID,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: {
              extensionPath: '/blocked.html',
            },
          },
          condition: {
            urlFilter: '/shorts/',
            requestDomains: ['youtube.com'],
            resourceTypes: ['main_frame'],
          },
        },
      ],
    });
  } catch (error) {
    console.error('[TubeSift] Failed to add Shorts block rule:', error);
  }
}

/**
 * Removes the Shorts redirect rule so /shorts/ URLs load normally.
 */
async function removeShortsBlockRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SHORTS_RULE_ID],
    });
  } catch (error) {
    console.error('[TubeSift] Failed to remove Shorts block rule:', error);
  }
}

/**
 * Synchronizes the redirect rule with the current stored setting.
 */
async function syncShortsRule() {
  const { shortsBlocked } = await chrome.storage.sync.get('shortsBlocked');
  if (shortsBlocked !== false) {
    await addShortsBlockRule();
  } else {
    await removeShortsBlockRule();
  }
}

// ── Lifecycle Events ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Merge defaults with any existing settings (preserves user choices on update)
  const existing = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...existing });
  await syncShortsRule();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncShortsRule();
});

// React to settings changes from the popup
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.shortsBlocked) {
    if (changes.shortsBlocked.newValue) {
      await addShortsBlockRule();
    } else {
      await removeShortsBlockRule();
    }
  }
});
