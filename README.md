<p align="center">
  <img src="icons/icon128.png" alt="TubeSift Logo" width="96" height="96" style="border-radius: 16px;">
</p>

<h1 align="center">TubeSift</h1>

<p align="center">
  <strong>Block Shorts · Filter by year, length, keyword or channel · Stay focused</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-2.0.0-blue" alt="Version 2.0.0">
  <img src="https://img.shields.io/badge/Manifest-V3-brightgreen" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-105%2B-blue" alt="Chrome 105+">
  <img src="https://img.shields.io/badge/Firefox-121%2B-orange" alt="Firefox 121+">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
  <img src="https://img.shields.io/badge/Data%20Collection-None-brightgreen" alt="No Data Collection">
</p>

---

A lightweight, privacy-respecting extension that gives you back control of your
YouTube feed. Block Shorts, filter videos by publication year, length, keyword or
channel, and strip out the parts of the interface designed to keep you scrolling.

Everything happens client-side in your own browser. No accounts, no telemetry,
no network requests, no video downloading.

Runs on **Chrome, Edge, Brave, Vivaldi, Opera and Firefox** from one codebase.

---

## ✨ Features

### 🚫 Shorts blocker
- Hides Shorts shelves, cards, chips, channel tabs and sidebar entries
- Optionally intercepts direct `/shorts/` links and shows a block page
- Catches in-app (single-page) navigation too, not just full page loads

### 🎛️ Video filters
| Filter | What it does |
|---|---|
| **Year** | Show only videos published in an exact year, a range, or newer/older than a year |
| **Length** | Hide anything shorter or longer than your minute limits |
| **Keyword** | Hide videos whose title contains any word or phrase you list |
| **Channel** | Hide every video from channels you list |
| **Always allow** | Channels that bypass *every* filter above |

### 🧘 Focus mode
Ten independent switches to quiet the interface: hide the home feed, watch-page
recommendations, comments, live chat, end-screen overlays, Explore/Trending, the
notification bell, Mixes and radio, Playables, or desaturate thumbnails (colour
returns on hover). A one-click **recommended set** turns on a sensible subset.

### 📊 Statistics
A local count of how many videos were filtered today and all-time, broken down by
reason, with an optional toolbar badge. Stored on your device; nothing is sent
anywhere. Can be switched off entirely.

### ⌨️ Keyboard shortcuts
| Shortcut | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> | Pause or resume TubeSift |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Toggle Shorts blocking |
| *(unassigned)* | Toggle the year filter |

### 🎨 Interface
- Tabbed popup, plus a full settings page with search-free side navigation
- Light and dark themes that follow your system, or can be forced either way
- WCAG AA colour contrast throughout, full keyboard navigation, visible focus
  rings, `prefers-reduced-motion` respected
- Export and import your settings as JSON

---

## 🚀 Installation

### Chrome / Edge / Brave / Vivaldi / Opera

1. Download or clone this repository
2. Run `npm run build` (or use the repo folder directly — it *is* the Chrome build)
3. Open `chrome://extensions/`
4. Turn on **Developer mode** (top right)
5. Click **Load unpacked** and select `dist/chrome/` (or the repo root)

### Firefox

Firefox needs a different manifest (event page instead of a service worker), so
you must build first:

```bash
npm run build
```

Then:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `dist/firefox/manifest.json`

> Temporary add-ons are removed when Firefox restarts. For a permanent install,
> the signed `.zip` from `dist/` must be submitted to addons.mozilla.org.

### After installing

1. Pin TubeSift to your toolbar (puzzle-piece icon → pin)
2. Visit [youtube.com](https://www.youtube.com) — Shorts are blocked by default
3. Click the TubeSift icon to configure everything else

---

## 🛠️ Building

The build is dependency-free — it needs nothing but Node 18+.

```bash
npm run build
```

| Command | Result |
|---|---|
| `npm run build` | Both browsers, directories + zips in `dist/` |
| `npm run build:chrome` | Chrome only |
| `npm run build:firefox` | Firefox only |
| `npm run build:dev` | Directories only, no zips |
| `npm run check` | Syntax-check every script |

Each build copies the shared sources and drops in the right manifest, so
`dist/chrome/` and `dist/firefox/` are both directly loadable.

---

## 📦 Project structure

```
tubesift/
├── manifest.json          # Chrome/Chromium manifest (service worker)
├── manifest.firefox.json  # Firefox manifest (event page, gecko id)
├── common.js              # Browser API shim, settings schema, storage helpers
├── background.js          # Shorts interception, statistics, badge, shortcuts
├── content.js             # Card filtering (year/length/keyword/channel)
├── content.css            # CSS-driven Shorts hiding + focus mode
├── theme.css              # Shared design tokens and UI primitives
├── popup.html/.css/.js    # Toolbar popup — Filters / Focus / Stats
├── options.html/.css/.js  # Full settings page, backup & restore
├── blocked.html/.css/.js  # "Shorts blocked" page
├── build.mjs              # Zero-dependency two-target build + ZIP writer
├── icons/                 # 16 / 48 / 128 px
├── CHANGELOG.md
├── LICENSE
└── README.md
```

---

## 🔧 How it works

```
        ┌──────────────┐   storage.sync   ┌──────────────────┐
        │   popup.js   │ ◄──────────────► │   background.js  │
        │  options.js  │                  │  (SW / event pg) │
        └──────┬───────┘                  └────────┬─────────┘
               │ onChanged                         │
               ▼                                   ▼
        ┌──────────────┐                  ┌──────────────────┐
        │  content.js  │  ── counts ────► │ declarativeNet…  │
        │ + content.css│                  │ + webNavigation  │
        └──────────────┘                  │ → blocked.html   │
                                          └──────────────────┘
```

### Cross-browser strategy

`common.js` picks the right namespace (`browser.*` on Firefox, `chrome.*`
elsewhere), both of which are promise-based, and feature-detects every optional
API rather than assuming it exists. The genuine differences live in the two
manifests:

| | Chrome | Firefox |
|---|---|---|
| Background | `service_worker` | `scripts` (event page) |
| Shared code loaded via | `importScripts()` | manifest `scripts` array |
| DNR permission | `declarativeNetRequest` | `declarativeNetRequestWithHostAccess` |
| Extra | `minimum_chrome_version` | `browser_specific_settings.gecko` |

### Shorts interception uses two mechanisms

Neither is sufficient alone:

- **declarativeNetRequest** catches full page loads of `/shorts/` before any
  bytes are fetched, so there is no flash of content. Feature-detected, since
  older Firefox builds lack redirect support.
- **webNavigation.onHistoryStateUpdated** catches in-app navigation. Clicking a
  Short inside YouTube never issues a top-level request, so DNR can never see
  it. This works identically on both browsers.

### Performance

- Everything CSS can do is done in CSS — Shorts hiding and all ten focus-mode
  options cost zero per-element JavaScript
- The `MutationObserver` callback is debounced (180 ms) and only reacts to added
  nodes; DOM writes are batched in `requestAnimationFrame`
- Resolved cards are marked so they are never re-parsed, while cards whose
  metadata has not streamed in yet are deliberately left unmarked for a later pass
- A self-mutation guard stops the observer reacting to its own changes
- Statistics are buffered and flushed in batches, deduplicated per video so
  navigating around cannot inflate the counters

### Permissions (and why)

| Permission | Why it's needed |
|---|---|
| `storage` | Save your preferences and counters |
| `declarativeNetRequest` | Redirect `/shorts/` URLs to the block page |
| `webNavigation` | Catch in-app navigation to Shorts |
| `*://*.youtube.com/*` | Run the content script on YouTube |

No `tabs`, no `activeTab`, no `<all_urls>`, no host access beyond YouTube.

---

## ⚠️ Known limitations

1. **Year estimation is approximate.** YouTube reports relative dates ("2 years
   ago"), so a video's year is exact to within a few weeks either side of New
   Year. Absolute dates ("Jan 5, 2020") are parsed exactly where shown.

2. **Date parsing is English-only.** Relative-date matching expects English
   YouTube. Other locales still get Shorts blocking, focus mode, keyword and
   channel filters, but year filtering will not apply.

3. **Length filtering needs a visible duration badge.** Live streams and
   premieres have no duration, so they are never hidden by the length filter.

4. **YouTube changes its DOM.** Selectors cover both the classic `ytd-*`
   elements and the newer `*-view-model` components, but YouTube ships A/B
   variants. Please open an issue if something stops being caught.

5. **Firefox temporary installs.** Until the add-on is signed and published,
   Firefox removes it on restart.

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Run `npm run check` before committing
4. Open a pull request

Ideas: date parsing for non-English locales, more selector coverage, unit tests,
per-site scheduling, additional focus-mode options.

---

## ⚖️ Disclaimer

- TubeSift only changes what your own browser displays. It does not download
  videos, block ads, circumvent paywalls or age-gates, or use YouTube's APIs.
- "YouTube" is a trademark of Google LLC. TubeSift is an independent project,
  not affiliated with or endorsed by Google or YouTube.
- See [LICENSE](LICENSE) for details.

---

## 📄 License

[MIT License](LICENSE) — free to use, modify and distribute.

---

<p align="center">
  <sub>Made with ❤️ for distraction-free YouTube</sub>
</p>
