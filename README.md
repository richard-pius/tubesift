<p align="center">
  <img src="icons/icon128.png" alt="TubeSift Logo" width="96" height="96" style="border-radius: 16px;">
</p>

<h1 align="center">TubeSift</h1>

<p align="center">
  <strong>Filter YouTube videos by year · Block Shorts · Stay focused</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-brightgreen" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-105%2B-blue" alt="Chrome 105+">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
  <img src="https://img.shields.io/badge/Permissions-Minimal-green" alt="Minimal Permissions">
  <img src="https://img.shields.io/badge/Data%20Collection-None-brightgreen" alt="No Data Collection">
</p>

---

A lightweight, privacy-respecting Chrome extension that gives you control over your YouTube feed. Filter videos by publication year and completely block YouTube Shorts — all client-side, no data collection, no video downloading.

## ✨ Features

### 🗓️ Year Filter
- **Single Year Mode** — Show only videos from one specific year (e.g., 2024)
- **Year Range Mode** — Show videos from a custom range (e.g., 2020–2024)
- Works on homepage, search results, sidebar recommendations, and channel pages

### 🚫 Shorts Blocker
- Hides all Shorts shelves, thumbnails, and links from the YouTube UI
- **Blocks** direct navigation to `youtube.com/shorts/*` with a branded blocked page
- Removes Shorts from the sidebar, search chips, and recommendations

### 🔒 Privacy
- **Client-side only** — Only hides/shows HTML elements in your browser
- **Zero data collection** — No telemetry, no analytics, no external requests
- **No video downloads** — Does not touch video streams
- **Minimal permissions** — `storage` + `declarativeNetRequest` + YouTube host only

---

## 🚀 Installation

### Prerequisites
- **Google Chrome** version 105 or later (or any Chromium-based browser: Edge, Brave, Vivaldi, Arc, etc.)

### Step 1 — Download

**Option A: Clone with Git**
```bash
git clone https://github.com/YOUR_USERNAME/tubesift.git
```

**Option B: Download ZIP**
- Click the green **Code** button at the top of this page → **Download ZIP**
- Extract the ZIP to any folder

### Step 2 — Load in Chrome

1. Open **`chrome://extensions/`** in your browser
2. Turn on **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the folder containing `manifest.json`

### Step 3 — Pin & Use

1. Click the **puzzle piece** icon (🧩) in the toolbar
2. Click the **pin** 📌 next to **TubeSift**
3. Go to [youtube.com](https://www.youtube.com) — Shorts are hidden by default
4. Click the TubeSift icon to configure year filtering

> **Updating:** To update, `git pull` (or re-download the ZIP), then go to `chrome://extensions/` and click the 🔄 reload button on the TubeSift card.

---

## 📦 Project Structure

```
tubesift/
├── manifest.json        # Manifest V3 configuration
├── background.js        # Service worker — Shorts URL redirect
├── content.js           # DOM manipulation — MutationObserver + year filter
├── content.css          # CSS-based Shorts hiding (high performance)
├── popup.html           # Extension popup UI
├── popup.css            # Popup styling (dark theme)
├── popup.js             # Popup settings logic
├── blocked.html         # "Shorts Blocked" landing page
├── blocked.css          # Blocked page styling
├── icons/
│   ├── icon16.png       # 16×16 px — Browser toolbar
│   ├── icon48.png       # 48×48 px — Extensions page
│   └── icon128.png      # 128×128 px — Install dialog
├── LICENSE              # MIT License
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

---

## 🔧 How It Works

```
┌─────────────────┐    chrome.storage.sync     ┌──────────────────┐
│    popup.js      │ ◄──────────────────────► │  background.js    │
│  (Settings UI)   │                            │ (Service Worker)  │
└────────┬────────┘                            └────────┬─────────┘
         │                                              │
         │ onChanged                                    │ declarativeNetRequest
         ▼                                              ▼
┌─────────────────┐                            ┌──────────────────┐
│   content.js     │                            │  /shorts/ URLs   │
│ + content.css    │                            │  → blocked.html  │
│ (DOM Filtering)  │                            └──────────────────┘
└─────────────────┘
```

| Component | What it does |
|---|---|
| **`background.js`** | Service worker. When Shorts blocking is on, adds a `declarativeNetRequest` dynamic rule that redirects any `/shorts/` URL to `blocked.html`. |
| **`content.css`** | Injected into YouTube. Hides all Shorts elements via CSS `:has()` selectors, activated by a `data-tubesift-shorts-blocked` attribute on `<html>`. No JavaScript needed for Shorts hiding. |
| **`content.js`** | Debounced `MutationObserver` monitors YouTube's SPA for new video elements. Parses relative date strings ("2 years ago") to estimate publication year. Hides videos outside the user's selected range. |
| **`popup.js`** | Reads/writes preferences to `chrome.storage.sync`. Changes apply instantly — no page reload needed. |

### Performance

- **CSS-only Shorts hiding** — native browser engine, zero JS overhead
- **200ms debounced MutationObserver** — prevents thrashing during scroll
- **`requestAnimationFrame` batching** — DOM writes sync with paint cycle
- **Processed-element tracking** — `data-tubesift-processed` attribute prevents re-work
- **Self-mutation guard** — `isProcessing` flag prevents infinite observer loops

### Permissions (and why)

| Permission | Why it's needed |
|---|---|
| `storage` | Save your preferences across sessions |
| `declarativeNetRequest` | Redirect `/shorts/` URLs to blocked page |
| `*://*.youtube.com/*` | Content script runs on YouTube pages |

No `tabs`, `webNavigation`, `activeTab`, or `<all_urls>` requested.

---

## ⚠️ Known Limitations

1. **Year estimation is approximate** — YouTube shows relative dates ("2 years ago"), not exact dates. A video showing "1 year ago" could be from the current year or the previous year depending on the exact upload date.

2. **English-only date parsing** — Relative date matching works with English YouTube ("years ago", "months ago"). Non-English locales still get Shorts blocking but year filtering won't apply.

3. **YouTube DOM changes** — YouTube occasionally updates their page structure. If the extension stops working after a YouTube update, the CSS selectors may need updating. Open an issue if you notice this.

---

## 🤝 Contributing

Contributions are welcome!

1. Fork this repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push (`git push origin feature/my-feature`)
5. Open a Pull Request

### Ideas for contribution
- 🌍 **i18n** — Date parsing for non-English YouTube locales
- 🧪 **Tests** — Unit tests for date parsing logic
- 🎨 **UI** — Popup improvements, themes
- 🐛 **Selectors** — Update CSS selectors when YouTube changes their DOM

---

## ⚖️ Disclaimer

- This extension only manipulates the client-side DOM (showing/hiding HTML elements). It does not download videos, block ads, circumvent paywalls, or access YouTube's APIs.
- "YouTube" is a registered trademark of Google LLC. TubeSift is an independent project, not affiliated with or endorsed by Google or YouTube.
- Use at your own discretion. See [LICENSE](LICENSE) for details.

---

## 📄 License

[MIT License](LICENSE) — free to use, modify, and distribute.

---

<p align="center">
  <sub>Made with ❤️ for distraction-free YouTube</sub>
</p>
