/**
 * TubeSift — Shared Runtime (common.js)
 *
 * Loaded first by every extension surface: background, content script,
 * popup, options page and the blocked page.
 *
 * Responsibilities:
 *   1. Cross-browser WebExtension API shim (Chrome / Edge / Firefox / Opera)
 *   2. The single source of truth for the settings schema + defaults
 *   3. Small promise-based storage helpers used everywhere
 *
 * Everything is exposed on `globalThis.TubeSift` so the file can be loaded as
 * a plain classic script (content scripts, popup, options) *and* pulled into
 * the Chrome service worker via importScripts().
 */
'use strict';

(function (global) {
  // ── 1. Cross-browser API shim ────────────────────────────────
  //
  // Firefox exposes the promise-based `browser.*` namespace. Chrome/Edge/Opera
  // expose `chrome.*`, which is promise-based for MV3. Firefox *also* defines a
  // partial `chrome.*` alias, so `browser` is preferred when it is real.
  const api =
    typeof browser !== 'undefined' && browser.runtime && browser.runtime.id
      ? browser
      : chrome;

  /** True when running on Gecko (Firefox / Firefox for Android). */
  const isFirefox =
    typeof navigator !== 'undefined' && /Gecko\//.test(navigator.userAgent || '');

  /** Feature probes — never assume an API exists, browsers differ. */
  const has = {
    declarativeNetRequest: !!(api.declarativeNetRequest &&
      api.declarativeNetRequest.updateDynamicRules),
    webNavigation: !!(api.webNavigation && api.webNavigation.onHistoryStateUpdated),
    commands: !!api.commands,
    badge: !!(api.action && api.action.setBadgeText),
  };

  // ── 2. Settings schema ───────────────────────────────────────

  const CURRENT_YEAR = new Date().getFullYear();
  const FIRST_YEAR = 2005; // YouTube launched in 2005

  /**
   * Every persisted setting with its default. Passing this object straight to
   * storage.get() gives us defaults-on-read for free in both browsers.
   */
  const DEFAULTS = {
    // Master
    enabled: true,
    theme: 'system', // system | dark | light

    // Shorts
    shortsBlocked: true,
    shortsRedirect: true, // also intercept direct /shorts/ navigations

    // Year filter
    yearFilterEnabled: false,
    yearFilterMode: 'single', // single | range | after | before
    yearFilterSingle: CURRENT_YEAR,
    yearFilterFrom: CURRENT_YEAR - 5,
    yearFilterTo: CURRENT_YEAR,

    // Duration filter (minutes; 0 = unbounded)
    durationFilterEnabled: false,
    durationMin: 0,
    durationMax: 0,

    // Keyword filter (matches video titles, case-insensitive)
    keywordFilterEnabled: false,
    blockedKeywords: [],

    // Channel filter
    channelFilterEnabled: false,
    blockedChannels: [],
    allowedChannels: [], // always shown, bypasses every filter

    // Focus mode — declutter the YouTube UI
    hideHomeFeed: false,
    hideSidebarRecs: false,
    hideComments: false,
    hideLiveChat: false,
    hideEndScreen: false,
    hideExplore: false,
    hideNotifications: false,
    hideMixes: false,
    hidePlayables: false,
    grayscaleThumbs: false,

    // Behaviour
    showBadge: true,
    countStats: true,
  };

  /**
   * Focus-mode options, declared once and rendered by both the popup and the
   * options page. Adding an option here plus a matching rule in content.css is
   * all it takes — no UI code changes.
   */
  const FOCUS_OPTIONS = [
    { key: 'hideHomeFeed', title: 'Hide home feed', desc: 'Replace the endless grid with a calm placeholder' },
    { key: 'hideSidebarRecs', title: 'Hide recommendations', desc: 'Remove the "Up next" sidebar on watch pages' },
    { key: 'hideComments', title: 'Hide comments', desc: 'Collapse the comment section entirely' },
    { key: 'hideLiveChat', title: 'Hide live chat', desc: 'Remove the chat panel on live streams' },
    { key: 'hideEndScreen', title: 'Hide end screens', desc: 'No suggested-video overlays when a video ends' },
    { key: 'hideExplore', title: 'Hide Explore & Trending', desc: 'Remove trending entries from the sidebar' },
    { key: 'hideNotifications', title: 'Hide notification bell', desc: 'Take the red dot out of your eyeline' },
    { key: 'hideMixes', title: 'Hide Mixes & radio', desc: 'Skip auto-generated endless playlists' },
    { key: 'hidePlayables', title: 'Hide Playables', desc: "Remove YouTube's in-page games" },
    { key: 'grayscaleThumbs', title: 'Grayscale thumbnails', desc: 'Colour returns when you hover a video' },
  ];

  /** The subset switched on by the "recommended focus set" shortcut. */
  const RECOMMENDED_FOCUS = [
    'hideSidebarRecs',
    'hideEndScreen',
    'hideExplore',
    'hideMixes',
    'grayscaleThumbs',
  ];

  /** Usage counters — kept in storage.local (fast, unsynced, no quota worry). */
  const STAT_DEFAULTS = {
    statsDate: '', // ISO yyyy-mm-dd the daily counters belong to
    statsToday: 0,
    statsTotal: 0,
    statsShorts: 0,
    statsYear: 0,
    statsDuration: 0,
    statsKeyword: 0,
    statsChannel: 0,
    installedAt: 0,
  };

  /** Reason keys reported by the content script, mapped to their stat field. */
  const REASON_STATS = {
    shorts: 'statsShorts',
    year: 'statsYear',
    duration: 'statsDuration',
    keyword: 'statsKeyword',
    channel: 'statsChannel',
  };

  // ── 3. Storage helpers ───────────────────────────────────────

  /**
   * Reads all settings, merged over DEFAULTS.
   * Falls back to storage.local if sync is unavailable (Firefox without an
   * account historically, or when the sync quota errors out).
   */
  async function getSettings() {
    try {
      return await api.storage.sync.get(DEFAULTS);
    } catch (err) {
      console.warn('[TubeSift] storage.sync unavailable, using local:', err);
      return api.storage.local.get(DEFAULTS);
    }
  }

  /** Writes a partial settings patch. */
  async function setSettings(patch) {
    try {
      await api.storage.sync.set(patch);
    } catch (err) {
      console.warn('[TubeSift] storage.sync write failed, using local:', err);
      await api.storage.local.set(patch);
    }
  }

  /** Reads the usage counters. */
  function getStats() {
    return api.storage.local.get(STAT_DEFAULTS);
  }

  /** Today as yyyy-mm-dd in the user's local timezone. */
  function todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Normalises a user-entered list (textarea or comma separated) to an array. */
  function parseList(raw) {
    return String(raw || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s, i, arr) => arr.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i)
      .slice(0, 500);
  }

  // ── 4. Theme helper (popup / options / blocked page) ─────────

  /** Applies the stored theme preference to the current document. */
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  // ── Export ───────────────────────────────────────────────────

  global.TubeSift = {
    api,
    isFirefox,
    has,
    CURRENT_YEAR,
    FIRST_YEAR,
    DEFAULTS,
    FOCUS_OPTIONS,
    RECOMMENDED_FOCUS,
    STAT_DEFAULTS,
    REASON_STATS,
    getSettings,
    setSettings,
    getStats,
    todayKey,
    parseList,
    applyTheme,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
