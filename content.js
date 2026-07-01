/**
 * TubeSift — Content Script
 *
 * Runs on all youtube.com pages. Handles:
 *   1. Shorts DOM hiding (via CSS attribute toggle — see content.css)
 *   2. Year-based video filtering (JS-based DOM analysis)
 *
 * YouTube is a Single Page Application (SPA) that lazy-loads content as the
 * user scrolls and navigates. A MutationObserver continuously monitors the
 * DOM for new video elements and applies filters.
 *
 * Performance safeguards:
 *   - Shorts hiding uses pure CSS (no per-element JS work)
 *   - MutationObserver callback is debounced (200ms)
 *   - Processed elements are marked with data attributes to avoid re-work
 *   - requestAnimationFrame batches DOM writes
 *   - Observer ignores its own mutations via attribute filtering
 *
 * Copyright / ToS compliance:
 *   - Only manipulates the client-side DOM (show/hide elements)
 *   - Does NOT download, modify, or intercept any video streams
 *   - Does NOT circumvent paywalls, age-gates, or access controls
 */
'use strict';

(function TubeSift() {
  // ── Constants ──────────────────────────────────────────────────

  /** Attribute set on <html> to activate CSS-based Shorts hiding */
  const SHORTS_ATTR = 'data-tubesift-shorts-blocked';

  /** Attribute set on processed video elements */
  const PROCESSED_ATTR = 'data-tubesift-processed';

  /** Attribute set on year-filtered (hidden) video elements */
  const YEAR_HIDDEN_ATTR = 'data-tubesift-year-hidden';

  /** CSS selectors for video container elements */
  const VIDEO_SELECTORS = [
    'ytd-rich-item-renderer',      // Homepage grid items
    'ytd-video-renderer',           // Search results
    'ytd-compact-video-renderer',   // Sidebar / "Up next" recommendations
    'ytd-grid-video-renderer',      // Channel page grid
  ];

  /** Combined selector string for querySelectorAll */
  const ALL_VIDEOS_SELECTOR = VIDEO_SELECTORS.join(',');

  /** Debounce delay for MutationObserver callback (ms) */
  const DEBOUNCE_MS = 200;

  // ── State ──────────────────────────────────────────────────────

  let settings = {
    shortsBlocked: true,
    yearFilterEnabled: false,
    yearFilterMode: 'single',
    yearFilterSingle: new Date().getFullYear(),
    yearFilterFrom: 2005,
    yearFilterTo: new Date().getFullYear(),
  };

  let debounceTimer = null;
  let isProcessing = false;

  // ── Initialization ─────────────────────────────────────────────

  async function init() {
    // Load persisted settings
    try {
      const stored = await chrome.storage.sync.get(null);
      Object.assign(settings, stored);
    } catch (e) {
      // Extension context may be invalidated; use defaults
      console.warn('[TubeSift] Could not load settings:', e.message);
    }

    // Apply initial state
    applyShortsAttribute();
    scheduleProcess();

    // Observe DOM mutations for new content
    setupObserver();

    // Listen for YouTube SPA navigations
    document.addEventListener('yt-navigate-finish', onNavigate);

    // React to settings changes from the popup in real time
    try {
      chrome.storage.onChanged.addListener(onSettingsChanged);
    } catch (e) {
      // Context invalidated — will reload on next navigation
    }
  }

  // ── Settings Listener ──────────────────────────────────────────

  function onSettingsChanged(changes, area) {
    if (area !== 'sync') return;

    let needsReprocess = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (settings[key] !== newValue) {
        settings[key] = newValue;
        needsReprocess = true;
      }
    }

    if (!needsReprocess) return;

    applyShortsAttribute();

    // Clear processed markers so all videos are re-evaluated
    clearProcessedMarkers();
    scheduleProcess();
  }

  // ── Navigation Handler ─────────────────────────────────────────

  function onNavigate() {
    clearProcessedMarkers();
    scheduleProcess();
  }

  // ── Shorts CSS Toggle ──────────────────────────────────────────

  function applyShortsAttribute() {
    if (settings.shortsBlocked) {
      document.documentElement.setAttribute(SHORTS_ATTR, '');
    } else {
      document.documentElement.removeAttribute(SHORTS_ATTR);
    }
  }

  // ── MutationObserver ───────────────────────────────────────────

  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      // Skip mutations caused by our own attribute changes
      if (isProcessing) return;

      // Only react to childList mutations (new elements added)
      const hasNewContent = mutations.some(
        (m) => m.type === 'childList' && m.addedNodes.length > 0
      );
      if (!hasNewContent) return;

      scheduleProcess();
    });

    const target = document.body || document.documentElement;
    observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }

  // ── Debounced Processing ───────────────────────────────────────

  function scheduleProcess() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      requestAnimationFrame(processVideos);
    }, DEBOUNCE_MS);
  }

  // ── Year Filter Processing ─────────────────────────────────────

  function processVideos() {
    isProcessing = true;

    try {
      if (!settings.yearFilterEnabled) {
        // Remove all year-filter hiding
        const hidden = document.querySelectorAll(`[${YEAR_HIDDEN_ATTR}]`);
        hidden.forEach((el) => {
          el.removeAttribute(YEAR_HIDDEN_ATTR);
        });
        return;
      }

      // Find all unprocessed video containers
      const videos = document.querySelectorAll(
        VIDEO_SELECTORS.map((s) => `${s}:not([${PROCESSED_ATTR}])`).join(',')
      );

      videos.forEach((el) => {
        el.setAttribute(PROCESSED_ATTR, '');
        evaluateVideo(el);
      });
    } finally {
      isProcessing = false;
    }
  }

  /**
   * Evaluates a single video element and hides it if outside the year range.
   */
  function evaluateVideo(element) {
    // Skip Shorts (already handled by CSS)
    const shortsLink = element.querySelector('a[href*="/shorts/"]');
    if (shortsLink) return;

    // Extract the relative date text from metadata
    const dateText = extractDateText(element);
    if (!dateText) return;

    const year = parseRelativeDateToYear(dateText);
    if (year === null) return;

    if (!isYearAllowed(year)) {
      element.setAttribute(YEAR_HIDDEN_ATTR, year.toString());
    } else {
      element.removeAttribute(YEAR_HIDDEN_ATTR);
    }
  }

  // ── Date Extraction ────────────────────────────────────────────

  /**
   * Searches known metadata containers for a relative date string.
   * YouTube displays dates like "2 years ago", "3 months ago", etc.
   */
  function extractDateText(element) {
    // Selectors ordered by specificity / likelihood
    const candidates = element.querySelectorAll(
      '#metadata-line span,' +
      '#metadata #metadata-line span,' +
      '.inline-metadata-item,' +
      'ytd-video-meta-block span,' +
      '#metadata-line .inline-metadata-item'
    );

    for (const node of candidates) {
      const text = node.textContent.trim();
      if (isRelativeDateText(text)) {
        return text;
      }
    }

    // Fallback: search all text nodes in the metadata area
    const metaBlock = element.querySelector(
      'ytd-video-meta-block, #metadata-line, #metadata'
    );
    if (metaBlock) {
      const text = metaBlock.textContent;
      const match = text.match(
        /\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago/i
      );
      if (match) return match[0];
    }

    return null;
  }

  /**
   * Returns true if the text looks like a relative date (e.g. "2 years ago").
   */
  function isRelativeDateText(text) {
    return /^\s*(?:Streamed\s+)?\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\s*$/i.test(
      text
    );
  }

  // ── Date Parsing ───────────────────────────────────────────────

  /**
   * Converts a relative date string to an estimated publication year.
   *
   * Note: This is an approximation. A video that says "1 year ago" might
   * have been published in the current year or the previous year depending
   * on the exact date. This is an inherent limitation of relative dates.
   */
  function parseRelativeDateToYear(text) {
    const cleaned = text.toLowerCase().replace(/streamed\s+/i, '').trim();
    const match = cleaned.match(
      /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/
    );
    if (!match) return null;

    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const now = new Date();

    switch (unit) {
      case 'second':
      case 'minute':
      case 'hour':
        return now.getFullYear();

      case 'day': {
        const d = new Date(now);
        d.setDate(d.getDate() - amount);
        return d.getFullYear();
      }

      case 'week': {
        const d = new Date(now);
        d.setDate(d.getDate() - amount * 7);
        return d.getFullYear();
      }

      case 'month': {
        const d = new Date(now);
        d.setMonth(d.getMonth() - amount);
        return d.getFullYear();
      }

      case 'year':
        return now.getFullYear() - amount;

      default:
        return null;
    }
  }

  // ── Year Range Check ───────────────────────────────────────────

  /**
   * Checks whether a given year passes the user's filter.
   */
  function isYearAllowed(year) {
    if (settings.yearFilterMode === 'single') {
      return year === settings.yearFilterSingle;
    }
    // Range mode
    return year >= settings.yearFilterFrom && year <= settings.yearFilterTo;
  }

  // ── Helpers ────────────────────────────────────────────────────

  /**
   * Removes processed markers from all videos so they can be re-evaluated.
   * Called when settings change or the user navigates to a new page.
   */
  function clearProcessedMarkers() {
    const marked = document.querySelectorAll(`[${PROCESSED_ATTR}]`);
    isProcessing = true;
    marked.forEach((el) => el.removeAttribute(PROCESSED_ATTR));
    isProcessing = false;
  }

  // ── Entry Point ────────────────────────────────────────────────

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
