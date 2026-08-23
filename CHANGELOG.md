# Changelog

All notable changes to TubeSift are documented here.
This project follows [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-08-23

A major release: Firefox support, four new filters, focus mode, statistics, a
rebuilt interface, and a settings page.

The version is a major bump because the settings schema and the internal DOM
attributes changed. Existing preferences are preserved on update — new options
are merged underneath whatever you already had.

### Added

**Cross-browser support**
- Runs on Firefox 121+ alongside Chrome, Edge, Brave, Vivaldi and Opera
- `common.js` shim resolves the `browser.*` / `chrome.*` namespace difference and
  feature-detects every optional API
- Separate `manifest.firefox.json` (event page, `declarativeNetRequestWithHostAccess`,
  gecko id) built from the same sources
- Zero-dependency `build.mjs` produces loadable directories and store-ready zips
  for both browsers, including its own ZIP writer

**New filters**
- Filter by video length, with independent minimum and maximum limits
- Filter by keyword — hide videos whose title contains any listed word or phrase
- Filter by channel — hide everything from listed channels
- "Always allow" list: channels that bypass every filter
- Year filter gained *newer than* and *older than* modes alongside exact and range
- Absolute dates ("Jan 5, 2020") are now parsed in addition to relative ones

**Focus mode** — ten independent switches, all implemented in pure CSS:
hide home feed, watch-page recommendations, comments, live chat, end-screen
overlays, Explore/Trending, notification bell, Mixes and radio, Playables, and
grayscale thumbnails. Plus a one-click recommended set.

**Statistics**
- Local counts of videos filtered today and all-time, broken down by reason
- Optional toolbar badge showing today's count
- Deduplicated per video, so browsing around does not inflate the numbers
- Can be switched off; a reset button clears everything

**Interface**
- Rebuilt popup with Filters / Focus / Stats tabs and a sliding indicator
- New full settings page: side navigation, backup & restore, shortcut reference
- Shared `theme.css` design-token system
- Light and dark themes following the system, or forced either way
- Master pause switch in both the popup and the settings page
- Export and import settings as JSON, with strict validation on import
- Block page now offers a one-click "Allow Shorts again" escape hatch

**Other**
- Keyboard shortcuts to pause TubeSift, toggle Shorts, and toggle the year filter
- Settings page opens automatically on first install

### Changed

- Shorts interception now also catches in-app navigation via `webNavigation`.
  Previously, clicking a Short inside YouTube bypassed the block entirely,
  because single-page navigation issues no top-level request for
  `declarativeNetRequest` to intercept.
- Content script runs at `document_start` instead of `document_idle`, so hidden
  elements no longer flash into view before being removed.
- Shorts hiding covers considerably more surfaces: channel tabs, mobile
  navigation, playlist rows, notification entries and the newer
  `*-view-model` components YouTube is rolling out.
- Video-card detection extended to `yt-lockup-view-model` and playlist rows.
- Observer debounce reduced from 200 ms to 180 ms.
- Internal DOM attributes renamed from `data-tubesift-*` to the shorter `data-ts-*`.
- Accessibility: WCAG AA contrast in both themes, ARIA tab semantics with arrow-key
  navigation, labelled controls, consistent focus rings, `prefers-reduced-motion`
  support, and a skip link on the settings page.

### Fixed

- Cards whose metadata had not yet streamed in were marked as processed and never
  re-examined, so some videos escaped filtering. They are now left unmarked for a
  later pass.
- The extension no longer has to be reloaded for a settings change to apply to
  already-rendered cards.
- Toggling a filter off now reliably unhides everything it had hidden.

### Security & privacy

- Imported settings files are validated key-by-key against the known schema with
  type checking; unknown keys, wrong types and prototype-pollution attempts are
  rejected.
- Still no telemetry, no analytics, no external requests, and no host permissions
  beyond `*://*.youtube.com/*`.

---

## [1.0.0] — Initial release

### Added
- Year filter with single-year and range modes
- Shorts blocking via CSS hiding plus a `declarativeNetRequest` redirect
- Dark-themed popup with instant-save settings
- Branded "Shorts blocked" page
