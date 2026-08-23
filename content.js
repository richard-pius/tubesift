/**
 * TubeSift — Content Script
 *
 * Runs on every youtube.com page (desktop and m.youtube.com). Handles:
 *   1. Shorts hiding                       — pure CSS, toggled by an attribute
 *   2. Focus mode (declutter the UI)       — pure CSS, toggled by attributes
 *   3. Video filtering by year / duration / keyword / channel — JS + DOM
 *
 * YouTube is a single-page app that lazy-loads content as the user scrolls and
 * navigates, so a MutationObserver watches for new video cards and filters them.
 *
 * Performance safeguards:
 *   - Everything that CSS can do is done in CSS (zero per-element JS cost)
 *   - The observer callback is debounced and only reacts to added nodes
 *   - Cards are marked once resolved so they are never re-parsed
 *   - Cards whose metadata has not streamed in yet are deliberately left
 *     unmarked so a later pass can resolve them
 *   - DOM writes are batched inside requestAnimationFrame
 *
 * Terms-of-service posture:
 *   - Only client-side DOM visibility is changed
 *   - No video stream is downloaded, modified or intercepted
 *   - No paywall, age-gate or access control is circumvented
 */
'use strict';

(function TubeSiftContent() {
  const TS = globalThis.TubeSift;
  if (!TS) return; // common.js failed to load — bail out quietly
  const { api } = TS;

  // ── Attributes ─────────────────────────────────────────────────

  /** Set on <html> to activate the CSS rule sets. */
  const ROOT_FLAGS = {
    shortsBlocked: 'data-ts-shorts',
    hideHomeFeed: 'data-ts-hide-home',
    hideSidebarRecs: 'data-ts-hide-recs',
    hideComments: 'data-ts-hide-comments',
    hideLiveChat: 'data-ts-hide-chat',
    hideEndScreen: 'data-ts-hide-endscreen',
    hideExplore: 'data-ts-hide-explore',
    hideNotifications: 'data-ts-hide-notifications',
    hideMixes: 'data-ts-hide-mixes',
    hidePlayables: 'data-ts-hide-playables',
    grayscaleThumbs: 'data-ts-grayscale',
  };

  /** Marks a card whose metadata was successfully read. */
  const SEEN_ATTR = 'data-ts-seen';

  /** Marks a hidden card; the value is the reason (year, duration, ...). */
  const HIDDEN_ATTR = 'data-ts-hidden';

  // ── Selectors ──────────────────────────────────────────────────

  /** Containers that represent one video in a feed, grid, list or sidebar. */
  const CARD_SELECTORS = [
    'ytd-rich-item-renderer', // home / subscriptions grid
    'ytd-video-renderer', // search results
    'ytd-compact-video-renderer', // watch-page sidebar
    'ytd-grid-video-renderer', // legacy channel grid
    'ytd-playlist-video-renderer', // inside a playlist
    'ytd-video-preview', // hover preview card
    'yt-lockup-view-model', // 2024+ unified card
  ];

  /** Only cards TubeSift has not resolved yet, so passes stay cheap. */
  const UNSEEN_SELECTOR = CARD_SELECTORS.map((s) => `${s}:not([${SEEN_ATTR}])`).join(',');

  /** Where a card's title lives, most specific first. */
  const TITLE_SELECTORS = [
    '#video-title',
    'a#video-title-link',
    'yt-formatted-string#video-title',
    'h3 a[title]',
    '.yt-lockup-metadata-view-model__title',
    'span[role="text"]',
  ].join(',');

  /** Where a card's channel name lives. */
  const CHANNEL_SELECTORS = [
    'ytd-channel-name a',
    'ytd-channel-name yt-formatted-string',
    '#channel-name a',
    '#channel-name',
    '.yt-content-metadata-view-model__metadata-text',
    '#text.ytd-channel-name',
  ].join(',');

  /** Where a card's duration badge lives. */
  const DURATION_SELECTORS = [
    'ytd-thumbnail-overlay-time-status-renderer #text',
    'ytd-thumbnail-overlay-time-status-renderer span',
    '.badge-shape-wiz__text',
    '.ytp-time-duration',
    'badge-shape[aria-label]',
  ].join(',');

  /** Where a card's published-date text lives. */
  const META_SELECTORS = [
    '#metadata-line span',
    '.inline-metadata-item',
    'ytd-video-meta-block span',
    '.yt-content-metadata-view-model__metadata-text',
    '#metadata span',
  ].join(',');

  /** Debounce for the mutation observer (ms). */
  const DEBOUNCE_MS = 180;

  /** How often hidden-video counts are flushed to the background (ms). */
  const STATS_FLUSH_MS = 2000;

  /** Upper bound on the per-session set of already-counted videos. */
  const MAX_COUNTED_KEYS = 5000;

  // ── State ──────────────────────────────────────────────────────

  let settings = { ...TS.DEFAULTS };
  let debounceTimer = null;
  let statsTimer = null;
  let selfMutating = false;
  let pendingStats = Object.create(null);

  /** Videos already counted this page session — keeps the statistics honest. */
  const countedKeys = new Set();

  // ── Initialisation ─────────────────────────────────────────────

  /**
   * Loads settings and paints the CSS flags immediately — this runs at
   * document_start so blocked elements never flash into view.
   */
  async function boot() {
    try {
      settings = await TS.getSettings();
    } catch (error) {
      // Extension context can be invalidated during an update; defaults are fine.
      console.warn('[TubeSift] Could not load settings:', error.message);
    }
    applyRootFlags();
    whenBodyReady(init);
  }

  /** Wires up everything that needs a live DOM. */
  function init() {
    applyRootFlags();
    scheduleProcess();
    setupObserver();

    document.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('popstate', onNavigate);

    try {
      api.storage.onChanged.addListener(onSettingsChanged);
    } catch (error) {
      /* context invalidated — settings will be re-read on the next page load */
    }
  }

  // ── Settings ───────────────────────────────────────────────────

  function onSettingsChanged(changes, area) {
    if (area !== 'sync' && area !== 'local') return;

    let changed = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!(key in TS.DEFAULTS)) continue;
      settings[key] = newValue;
      changed = true;
    }
    if (!changed) return;

    applyRootFlags();
    resetCards();
    scheduleProcess();
  }

  function onNavigate() {
    // YouTube reuses card elements across navigations, so re-evaluate them all.
    resetCards();
    scheduleProcess();
  }

  // ── CSS flags on <html> ────────────────────────────────────────

  /**
   * Mirrors the boolean settings onto <html> attributes. content.css keys every
   * rule off these, which keeps hiding work inside the browser's style engine.
   */
  function applyRootFlags() {
    const root = document.documentElement;
    const on = settings.enabled !== false;

    root.toggleAttribute('data-ts-active', on);
    for (const [key, attr] of Object.entries(ROOT_FLAGS)) {
      root.toggleAttribute(attr, on && !!settings[key]);
    }
  }

  // ── Observer ───────────────────────────────────────────────────

  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      if (selfMutating) return;
      const hasNewNodes = mutations.some(
        (m) => m.type === 'childList' && m.addedNodes.length > 0
      );
      if (hasNewNodes) scheduleProcess();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function scheduleProcess() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      requestAnimationFrame(processCards);
    }, DEBOUNCE_MS);
  }

  // ── Card processing ────────────────────────────────────────────

  /** True when at least one card-level filter is switched on. */
  function anyCardFilterActive() {
    return (
      settings.enabled !== false &&
      (settings.yearFilterEnabled ||
        settings.durationFilterEnabled ||
        (settings.keywordFilterEnabled && settings.blockedKeywords.length > 0) ||
        (settings.channelFilterEnabled && settings.blockedChannels.length > 0))
    );
  }

  function processCards() {
    const filtering = anyCardFilterActive();
    // Shorts are hidden by CSS, but a pass is still worth running so they can
    // be counted for the statistics panel.
    const counting = settings.enabled !== false && settings.shortsBlocked;

    selfMutating = true;
    try {
      if (!filtering) unhideAll();
      if (!filtering && !counting) return;

      for (const card of document.querySelectorAll(UNSEEN_SELECTOR)) {
        evaluateCard(card, filtering);
      }
    } finally {
      selfMutating = false;
    }
  }

  /** Clears every TubeSift decision so cards get a fresh verdict. */
  function resetCards() {
    selfMutating = true;
    try {
      for (const el of document.querySelectorAll(`[${SEEN_ATTR}]`)) {
        el.removeAttribute(SEEN_ATTR);
      }
      unhideAll();
    } finally {
      selfMutating = false;
    }
  }

  function unhideAll() {
    for (const el of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
      el.removeAttribute(HIDDEN_ATTR);
    }
  }

  /**
   * Decides the fate of a single card.
   *
   * A card is only marked "seen" once we managed to read a title, because
   * YouTube frequently inserts the shell of a card before its metadata streams
   * in. Leaving it unmarked lets the next pass finish the job.
   */
  function evaluateCard(card, filtering) {
    // Shorts are hidden by CSS, so all that is left to do here is count them.
    // Marking them seen keeps them out of every later query.
    const shortsLink = card.querySelector('a[href*="/shorts/"]');
    if (shortsLink) {
      card.setAttribute(SEEN_ATTR, '');
      if (settings.shortsBlocked) countHidden('shorts', shortsLink.href);
      return;
    }

    if (!filtering) return;

    const title = readText(card, TITLE_SELECTORS);
    if (!title) return; // metadata has not arrived yet — retry on the next pass

    card.setAttribute(SEEN_ATTR, '');

    const channel = readText(card, CHANNEL_SELECTORS);

    // The allow list always wins, before any other rule is considered.
    if (channel && matchesList(channel, settings.allowedChannels)) {
      card.removeAttribute(HIDDEN_ATTR);
      return;
    }

    const reason = firstFailingRule(card, title, channel);
    if (reason) {
      if (card.getAttribute(HIDDEN_ATTR) !== reason) {
        card.setAttribute(HIDDEN_ATTR, reason);
        countHidden(reason, cardKey(card, title, channel));
      }
    } else {
      card.removeAttribute(HIDDEN_ATTR);
    }
  }

  /**
   * A stable identity for a card, used to keep the statistics honest.
   *
   * The video URL is ideal; where there is none (some lockup variants) the
   * title and channel together are a good enough stand-in.
   */
  function cardKey(card, title, channel) {
    const link = card.querySelector('a[href*="/watch?v="], a[href^="/watch"]');
    if (link) {
      const id = /[?&]v=([\w-]{6,})/.exec(link.getAttribute('href') || '');
      if (id) return id[1];
    }
    return title + ' :: ' + channel;
  }

  /** Returns the name of the first rule the card violates, or null. */
  function firstFailingRule(card, title, channel) {
    if (
      settings.channelFilterEnabled &&
      channel &&
      matchesList(channel, settings.blockedChannels)
    ) {
      return 'channel';
    }

    if (settings.keywordFilterEnabled && matchesList(title, settings.blockedKeywords)) {
      return 'keyword';
    }

    if (settings.durationFilterEnabled) {
      const seconds = parseDuration(readText(card, DURATION_SELECTORS));
      if (seconds !== null && !isDurationAllowed(seconds)) return 'duration';
    }

    if (settings.yearFilterEnabled) {
      const year = readYear(card);
      if (year !== null && !isYearAllowed(year)) return 'year';
    }

    return null;
  }

  // ── Extraction helpers ─────────────────────────────────────────

  /** Returns the first non-empty text match for a selector list. */
  function readText(card, selectors) {
    for (const node of card.querySelectorAll(selectors)) {
      const text = (node.getAttribute('title') || node.textContent || '').trim();
      if (text) return text;
    }
    return '';
  }

  /** Case-insensitive substring match against a user-supplied list. */
  function matchesList(text, list) {
    if (!text || !Array.isArray(list) || list.length === 0) return false;
    const haystack = text.toLowerCase();
    return list.some((entry) => {
      const needle = String(entry).trim().toLowerCase();
      return needle.length > 0 && haystack.includes(needle);
    });
  }

  /** Parses "12:34" / "1:02:03" into seconds. Returns null when unparseable. */
  function parseDuration(text) {
    if (!text) return null;
    const match = text.match(/(?:(\d+):)?(\d{1,2}):(\d{2})\b/);
    if (!match) return null;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function isDurationAllowed(seconds) {
    const min = (Number(settings.durationMin) || 0) * 60;
    const max = (Number(settings.durationMax) || 0) * 60;
    if (min > 0 && seconds < min) return false;
    if (max > 0 && seconds > max) return false;
    return true;
  }

  /** Best-effort publication year for a card. */
  function readYear(card) {
    for (const node of card.querySelectorAll(META_SELECTORS)) {
      const text = node.textContent.trim();
      const year = textToYear(text);
      if (year !== null) return year;
    }

    // Fallback: scan the whole metadata block in one go.
    const block = card.querySelector(
      'ytd-video-meta-block, #metadata-line, #metadata, .yt-content-metadata-view-model-wiz'
    );
    return block ? textToYear(block.textContent) : null;
  }

  /**
   * Converts YouTube's date text into a year.
   *
   * Handles the relative form ("2 years ago", "Streamed 3 months ago") and the
   * absolute form ("Jan 5, 2020") that appears on playlists and some locales.
   *
   * Relative dates are inherently coarse: a video labelled "1 year ago" may sit
   * on either side of a new year. This is a limitation of the source data, not
   * of the parser.
   */
  function textToYear(text) {
    if (!text) return null;
    const cleaned = text.toLowerCase();

    const relative = cleaned.match(
      /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/
    );
    if (relative) {
      const amount = parseInt(relative[1], 10);
      const unit = relative[2];
      const d = new Date();

      switch (unit) {
        case 'second':
        case 'minute':
        case 'hour':
          return d.getFullYear();
        case 'day':
          d.setDate(d.getDate() - amount);
          return d.getFullYear();
        case 'week':
          d.setDate(d.getDate() - amount * 7);
          return d.getFullYear();
        case 'month':
          d.setMonth(d.getMonth() - amount);
          return d.getFullYear();
        case 'year':
          return d.getFullYear() - amount;
        default:
          return null;
      }
    }

    // Absolute date, e.g. "Jan 5, 2020" or "5 January 2020".
    const absolute = text.match(/\b(19[5-9]\d|20\d{2})\b/);
    if (absolute) {
      const year = parseInt(absolute[1], 10);
      if (year >= TS.FIRST_YEAR && year <= TS.CURRENT_YEAR + 1) return year;
    }

    return null;
  }

  /** Applies the configured year rule. */
  function isYearAllowed(year) {
    switch (settings.yearFilterMode) {
      case 'range':
        return year >= settings.yearFilterFrom && year <= settings.yearFilterTo;
      case 'after':
        return year >= settings.yearFilterSingle;
      case 'before':
        return year <= settings.yearFilterSingle;
      case 'single':
      default:
        return year === settings.yearFilterSingle;
    }
  }

  // ── Statistics ─────────────────────────────────────────────────

  /**
   * Buffers a hide event; flushed to the background in batches.
   *
   * Every card is counted at most once per page session, keyed by video. Without
   * this, a settings change or an SPA navigation re-evaluates cards that are
   * already on screen and the counters would climb without a single new video
   * having been filtered.
   */
  function countHidden(reason, key) {
    if (!settings.countStats) return;

    if (key) {
      if (countedKeys.has(key)) return;
      // Long browsing sessions are bounded so the set cannot grow forever.
      if (countedKeys.size >= MAX_COUNTED_KEYS) countedKeys.clear();
      countedKeys.add(key);
    }

    pendingStats[reason] = (pendingStats[reason] || 0) + 1;
    if (statsTimer) return;
    statsTimer = setTimeout(flushStats, STATS_FLUSH_MS);
  }

  function flushStats() {
    statsTimer = null;
    const reasons = pendingStats;
    pendingStats = Object.create(null);
    if (Object.keys(reasons).length === 0) return;

    try {
      const sending = api.runtime.sendMessage({ type: 'ts:hidden', reasons });
      // Chrome rejects the promise when no listener replies; that is harmless.
      if (sending && typeof sending.catch === 'function') sending.catch(() => {});
    } catch (error) {
      /* background asleep or context invalidated — counts are best-effort */
    }
  }

  // Flush whatever is buffered before the page goes away.
  window.addEventListener('pagehide', flushStats);

  // ── Entry point ────────────────────────────────────────────────

  /** Runs `fn` now if <body> exists, otherwise as soon as it does. */
  function whenBodyReady(fn) {
    if (document.body) {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  }

  boot();
})();
