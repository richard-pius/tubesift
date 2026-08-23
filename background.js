/**
 * TubeSift — Background (service worker on Chrome, event page on Firefox)
 *
 * Responsibilities:
 *   1. Seed / migrate settings on install and update
 *   2. Keep the Shorts interception in sync with the user's preference
 *   3. Aggregate the "videos hidden" counters reported by content scripts
 *   4. Paint the toolbar badge and handle keyboard shortcuts
 *
 * Shorts interception uses two complementary mechanisms because neither one
 * alone is sufficient:
 *
 *   - declarativeNetRequest catches *hard* navigations to /shorts/ before a
 *     single byte is fetched (no flash of content). Available on Chrome and on
 *     Firefox 128+, so it is feature-detected rather than assumed.
 *   - webNavigation.onHistoryStateUpdated catches *soft* SPA navigations —
 *     clicking a Short inside YouTube never issues a main_frame request, so DNR
 *     can never see it. This works identically on both browsers.
 */
'use strict';

// Chrome loads a single service worker file, so it pulls in the shared runtime
// itself. Firefox lists both files in manifest "background.scripts", where
// importScripts does not exist — hence the guard.
if (typeof importScripts === 'function' && typeof globalThis.TubeSift === 'undefined') {
  importScripts('common.js');
}

const TS = globalThis.TubeSift;
const { api, has, DEFAULTS, STAT_DEFAULTS, REASON_STATS, getSettings, todayKey } = TS;

const SHORTS_RULE_ID = 1;
const BLOCKED_PAGE = 'blocked.html';

// ── Shorts interception ────────────────────────────────────────

/** Installs the declarativeNetRequest redirect for hard /shorts/ navigations. */
async function addShortsBlockRule() {
  if (!has.declarativeNetRequest) return;
  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SHORTS_RULE_ID],
      addRules: [
        {
          id: SHORTS_RULE_ID,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: { extensionPath: '/' + BLOCKED_PAGE },
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
    // Firefox builds without DNR redirect support land here; the webNavigation
    // listener below still covers the user.
    console.warn('[TubeSift] Shorts redirect rule unavailable:', error);
  }
}

/** Removes the redirect rule so /shorts/ URLs load normally again. */
async function removeShortsBlockRule() {
  if (!has.declarativeNetRequest) return;
  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SHORTS_RULE_ID],
    });
  } catch (error) {
    console.warn('[TubeSift] Failed to remove Shorts redirect rule:', error);
  }
}

/** Brings the redirect rule in line with the current settings. */
async function syncShortsRule(settings) {
  const s = settings || (await getSettings());
  if (s.enabled && s.shortsBlocked && s.shortsRedirect) {
    await addShortsBlockRule();
  } else {
    await removeShortsBlockRule();
  }
}

/** Soft (SPA) navigation guard — DNR cannot see these. */
async function onSpaNavigation(details) {
  if (details.frameId !== 0) return;
  if (!/^https?:\/\/(www\.|m\.)?youtube\.com\/shorts\//.test(details.url)) return;

  const s = await getSettings();
  if (!(s.enabled && s.shortsBlocked && s.shortsRedirect)) return;

  try {
    await api.tabs.update(details.tabId, { url: api.runtime.getURL(BLOCKED_PAGE) });
  } catch (error) {
    console.warn('[TubeSift] Could not redirect Shorts navigation:', error);
  }
}

// ── Statistics ─────────────────────────────────────────────────

/**
 * Folds a batch of hide-reasons reported by a content script into the counters,
 * rolling the daily bucket over at midnight.
 */
async function recordHidden(reasons) {
  const stats = await api.storage.local.get(STAT_DEFAULTS);
  const today = todayKey();
  const patch =
    stats.statsDate === today
      ? { ...stats }
      : { ...stats, statsDate: today, statsToday: 0 };

  let batch = 0;
  for (const [reason, count] of Object.entries(reasons || {})) {
    const n = Number(count) || 0;
    if (n <= 0) continue;
    batch += n;
    const field = REASON_STATS[reason];
    if (field) patch[field] = (patch[field] || 0) + n;
  }
  if (batch === 0) return;

  patch.statsToday += batch;
  patch.statsTotal += batch;
  await api.storage.local.set(patch);
  await updateBadge(patch.statsToday);
}

// ── Toolbar badge ──────────────────────────────────────────────

/** Formats big numbers so they still fit inside the badge (e.g. 1.2k). */
function formatBadge(n) {
  if (n <= 0) return '';
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return '99k+';
}

/** Repaints the toolbar badge from the current settings + counters. */
async function updateBadge(todayCount) {
  if (!has.badge) return;
  try {
    const s = await getSettings();
    if (!s.enabled || !s.showBadge) {
      await api.action.setBadgeText({ text: '' });
      return;
    }
    let count = todayCount;
    if (typeof count !== 'number') {
      const stats = await api.storage.local.get(STAT_DEFAULTS);
      count = stats.statsDate === todayKey() ? stats.statsToday : 0;
    }
    await api.action.setBadgeText({ text: formatBadge(count) });
    await api.action.setBadgeBackgroundColor({ color: '#cc0000' });
    if (api.action.setBadgeTextColor) {
      await api.action.setBadgeTextColor({ color: '#ffffff' });
    }
  } catch (error) {
    console.warn('[TubeSift] Badge update failed:', error);
  }
}

/** Keeps the toolbar tooltip honest about whether filtering is running. */
async function updateActionTitle(enabled) {
  try {
    await api.action.setTitle({
      title: enabled ? 'TubeSift — filtering active' : 'TubeSift — paused',
    });
  } catch (error) {
    /* not fatal */
  }
}

// ── Lifecycle ──────────────────────────────────────────────────

api.runtime.onInstalled.addListener(async (details) => {
  // Merge defaults *under* existing values so updates never clobber choices.
  const existing = await getSettings();
  await TS.setSettings({ ...DEFAULTS, ...existing });

  const stats = await api.storage.local.get(STAT_DEFAULTS);
  if (!stats.installedAt) {
    await api.storage.local.set({ installedAt: Date.now() });
  }

  await syncShortsRule();
  await updateBadge();
  await updateActionTitle(existing.enabled !== false);

  if (details.reason === 'install') {
    try {
      await api.tabs.create({ url: api.runtime.getURL('options.html#welcome') });
    } catch (error) {
      /* ignore — the user can open options from the popup */
    }
  }
});

api.runtime.onStartup.addListener(async () => {
  await syncShortsRule();
  await updateBadge();
});

// ── Settings changes ───────────────────────────────────────────

api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' && area !== 'local') return;

  if (changes.shortsBlocked || changes.shortsRedirect || changes.enabled) {
    await syncShortsRule();
  }
  if (changes.enabled || changes.showBadge) {
    await updateBadge();
  }
  if (changes.enabled) {
    await updateActionTitle(changes.enabled.newValue !== false);
  }
});

// ── Messages from content scripts / UI ─────────────────────────

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  switch (message.type) {
    case 'ts:hidden':
      recordHidden(message.reasons);
      break;

    case 'ts:resetStats':
      api.storage.local
        .set({ ...STAT_DEFAULTS, installedAt: Date.now() })
        .then(() => updateBadge(0))
        .then(() => sendResponse({ ok: true }));
      return true; // keep the message channel open for the async reply

    case 'ts:ping':
      sendResponse({ ok: true });
      break;
  }
});

// ── Keyboard shortcuts ─────────────────────────────────────────

if (has.commands) {
  api.commands.onCommand.addListener(async (command) => {
    const s = await getSettings();
    if (command === 'toggle-extension') {
      await TS.setSettings({ enabled: !s.enabled });
    } else if (command === 'toggle-shorts') {
      await TS.setSettings({ shortsBlocked: !s.shortsBlocked });
    } else if (command === 'toggle-year-filter') {
      await TS.setSettings({ yearFilterEnabled: !s.yearFilterEnabled });
    }
  });
}

// ── SPA navigation guard ───────────────────────────────────────

if (has.webNavigation) {
  api.webNavigation.onHistoryStateUpdated.addListener(onSpaNavigation, {
    url: [{ hostSuffix: 'youtube.com', pathPrefix: '/shorts/' }],
  });
}

// Paint the badge as soon as the worker spins up.
updateBadge();
