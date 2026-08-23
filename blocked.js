/**
 * TubeSift — Shorts block page
 *
 * Shown when a /shorts/ URL is intercepted. Beyond the two navigation buttons
 * it offers an escape hatch: turning Shorts back on from here is one click,
 * because a blocker the user cannot easily switch off is a blocker they end up
 * uninstalling.
 */
'use strict';

(function () {
  const TS = globalThis.TubeSift;
  const { api } = TS;

  const YOUTUBE = 'https://www.youtube.com';

  // ── Back button ──────────────────────────────────────────────

  document.getElementById('btn-back').addEventListener('click', () => {
    // We replaced a Shorts URL, so the previous entry may itself be a Short.
    // Falling back to the YouTube home page avoids a redirect loop.
    if (history.length > 1) {
      history.back();
    } else {
      window.location.href = YOUTUBE;
    }
  });

  // ── Escape hatch ─────────────────────────────────────────────

  document.getElementById('btn-allow').addEventListener('click', async () => {
    await TS.setSettings({ shortsBlocked: false, shortsRedirect: false });
    window.location.href = YOUTUBE;
  });

  document.getElementById('btn-options').addEventListener('click', () => {
    if (api.runtime.openOptionsPage) {
      api.runtime.openOptionsPage();
    } else {
      window.location.href = api.runtime.getURL('options.html');
    }
  });

  // ── Theme + running total ────────────────────────────────────

  async function boot() {
    try {
      const settings = await TS.getSettings();
      TS.applyTheme(settings.theme);

      const stats = await TS.getStats();
      const blocked = stats.statsShorts || 0;
      if (blocked > 0) {
        const line = document.getElementById('stat-line');
        line.textContent = `${new Intl.NumberFormat().format(blocked)} Shorts filtered so far.`;
        line.classList.remove('hidden');
      }
    } catch (error) {
      // Storage unavailable — the page is still perfectly usable as-is.
    }
  }

  boot();
})();
