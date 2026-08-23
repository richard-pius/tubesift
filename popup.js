/**
 * TubeSift — Popup
 *
 * The popup is a thin, immediate-save view over chrome/browser.storage. Every
 * interaction writes straight through; there is no Save button and no local
 * draft state to get out of sync.
 *
 * It also listens for external storage changes so the UI stays truthful when a
 * setting is flipped from the options page or a keyboard shortcut while the
 * popup is open.
 */
'use strict';

(function () {
  const TS = globalThis.TubeSift;
  const { api } = TS;

  /** Current settings, kept in sync with storage. */
  let settings = { ...TS.DEFAULTS };

  // Focus rows are driven by the shared definitions in common.js so the popup
  // and the options page can never disagree about what exists.
  const { FOCUS_OPTIONS, RECOMMENDED_FOCUS } = TS;

  // ── Element lookups ──────────────────────────────────────────

  const $ = (id) => document.getElementById(id);

  const el = {
    enabled: $('toggle-enabled'),
    statusLine: $('status-line'),
    pausedBanner: $('paused-banner'),
    body: $('pop-body'),

    shorts: $('toggle-shorts'),
    shortsRedirect: $('toggle-shorts-redirect'),
    subShorts: $('sub-shorts'),

    year: $('toggle-year'),
    subYear: $('sub-year'),
    yearMode: $('select-year-mode'),
    yearSingleGroup: $('year-single-group'),
    yearRangeGroup: $('year-range-group'),
    yearSingle: $('select-year-single'),
    yearFrom: $('select-year-from'),
    yearTo: $('select-year-to'),

    duration: $('toggle-duration'),
    subDuration: $('sub-duration'),
    durationMin: $('input-duration-min'),
    durationMax: $('input-duration-max'),

    keyword: $('toggle-keyword'),
    keywordCount: $('keyword-count'),
    channel: $('toggle-channel'),
    channelCount: $('channel-count'),

    focusList: $('focus-list'),
    focusPreset: $('btn-focus-preset'),

    saved: $('saved-indicator'),
    version: $('version-label'),
    options: $('btn-options'),
    resetStats: $('btn-reset-stats'),
    tabIndicator: $('tab-indicator'),
  };

  const tabs = [...document.querySelectorAll('.tab')];

  // ── Saving ───────────────────────────────────────────────────

  let savedTimer = null;

  /** Writes a patch and flashes the "Saved" confirmation. */
  async function save(patch) {
    Object.assign(settings, patch);
    await TS.setSettings(patch);
    el.saved.classList.add('visible');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => el.saved.classList.remove('visible'), 1400);
  }

  // ── Rendering ────────────────────────────────────────────────

  /** Fills a <select> with every year from now back to YouTube's launch. */
  function fillYears(select, selected) {
    const frag = document.createDocumentFragment();
    for (let y = TS.CURRENT_YEAR; y >= TS.FIRST_YEAR; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      frag.appendChild(opt);
    }
    select.replaceChildren(frag);
    select.value = String(selected);
  }

  /** Builds the Focus tab rows from FOCUS_OPTIONS. */
  function renderFocusRows() {
    const frag = document.createDocumentFragment();

    for (const option of FOCUS_OPTIONS) {
      const row = document.createElement('div');
      row.className = 'row';

      const text = document.createElement('div');
      text.className = 'row-text';

      const title = document.createElement('span');
      title.className = 'row-title-sm';
      title.textContent = option.title;

      const desc = document.createElement('span');
      desc.className = 'row-desc';
      desc.textContent = option.desc;

      text.append(title, desc);

      const label = document.createElement('label');
      label.className = 'toggle';
      label.htmlFor = `focus-${option.key}`;

      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = option.title;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `focus-${option.key}`;
      input.dataset.focusKey = option.key;

      const slider = document.createElement('span');
      slider.className = 'toggle-slider';

      label.append(sr, input, slider);
      row.append(text, label);
      frag.appendChild(row);

      input.addEventListener('change', () => {
        save({ [option.key]: input.checked });
        updateFocusPresetLabel();
      });
    }

    el.focusList.replaceChildren(frag);
  }

  /** Pushes the whole settings object into the controls. */
  function renderSettings() {
    // Master
    el.enabled.checked = settings.enabled;
    el.statusLine.textContent = settings.enabled ? 'Filtering active' : 'Paused';
    el.statusLine.toggleAttribute('data-off', !settings.enabled);
    el.pausedBanner.classList.toggle('hidden', settings.enabled);
    el.body.toggleAttribute('data-paused', !settings.enabled);

    // Shorts
    el.shorts.checked = settings.shortsBlocked;
    el.shortsRedirect.checked = settings.shortsRedirect;
    el.subShorts.classList.toggle('hidden', !settings.shortsBlocked);

    // Year
    el.year.checked = settings.yearFilterEnabled;
    el.subYear.classList.toggle('hidden', !settings.yearFilterEnabled);
    el.yearMode.value = settings.yearFilterMode;
    fillYears(el.yearSingle, settings.yearFilterSingle);
    fillYears(el.yearFrom, settings.yearFilterFrom);
    fillYears(el.yearTo, settings.yearFilterTo);
    renderYearMode();

    // Duration
    el.duration.checked = settings.durationFilterEnabled;
    el.subDuration.classList.toggle('hidden', !settings.durationFilterEnabled);
    el.durationMin.value = String(settings.durationMin);
    el.durationMax.value = String(settings.durationMax);

    // Lists
    el.keyword.checked = settings.keywordFilterEnabled;
    el.channel.checked = settings.channelFilterEnabled;
    el.keywordCount.textContent = describeList(settings.blockedKeywords, 'keyword');
    el.channelCount.textContent = describeList(settings.blockedChannels, 'channel');

    // Focus
    for (const option of FOCUS_OPTIONS) {
      const input = document.getElementById(`focus-${option.key}`);
      if (input) input.checked = !!settings[option.key];
    }
    updateFocusPresetLabel();
  }

  /** "3 keywords blocked" / "No keywords yet". */
  function describeList(list, noun) {
    const n = Array.isArray(list) ? list.length : 0;
    if (n === 0) return `No ${noun}s yet`;
    return `${n} ${noun}${n === 1 ? '' : 's'} blocked`;
  }

  /** Shows the single-year picker or the from/to pair, per the chosen rule. */
  function renderYearMode() {
    const isRange = settings.yearFilterMode === 'range';
    el.yearSingleGroup.classList.toggle('hidden', isRange);
    el.yearRangeGroup.classList.toggle('hidden', !isRange);
  }

  function allRecommendedOn() {
    return RECOMMENDED_FOCUS.every((key) => settings[key]);
  }

  function updateFocusPresetLabel() {
    el.focusPreset.textContent = allRecommendedOn()
      ? 'Turn off recommended focus set'
      : 'Turn on recommended focus set';
  }

  // ── Stats ────────────────────────────────────────────────────

  async function renderStats() {
    const stats = await TS.getStats();
    const isToday = stats.statsDate === TS.todayKey();

    const set = (id, value) => {
      $(id).textContent = new Intl.NumberFormat().format(value || 0);
    };

    set('stat-today', isToday ? stats.statsToday : 0);
    set('stat-total', stats.statsTotal);
    set('stat-shorts', stats.statsShorts);
    set('stat-year', stats.statsYear);
    set('stat-duration', stats.statsDuration);
    set('stat-keyword', stats.statsKeyword);
    set('stat-channel', stats.statsChannel);

    $('stat-since').textContent = stats.installedAt
      ? `Counting since ${new Date(stats.installedAt).toLocaleDateString()}.`
      : '';
  }

  // ── Tabs ─────────────────────────────────────────────────────

  /** Activates a tab and slides the underline to it. */
  function selectTab(tab) {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).classList.toggle('hidden', !active);
    }
    moveIndicator(tab);
    if (tab.id === 'tab-stats') renderStats();
  }

  function moveIndicator(tab) {
    el.tabIndicator.style.width = `${tab.offsetWidth}px`;
    el.tabIndicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));

    // Left/right arrows move between tabs, per the WAI-ARIA tabs pattern.
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  }

  // ── Control wiring ───────────────────────────────────────────

  el.enabled.addEventListener('change', async () => {
    await save({ enabled: el.enabled.checked });
    renderSettings();
  });

  el.shorts.addEventListener('change', () => {
    el.subShorts.classList.toggle('hidden', !el.shorts.checked);
    save({ shortsBlocked: el.shorts.checked });
  });

  el.shortsRedirect.addEventListener('change', () => {
    save({ shortsRedirect: el.shortsRedirect.checked });
  });

  el.year.addEventListener('change', () => {
    el.subYear.classList.toggle('hidden', !el.year.checked);
    save({ yearFilterEnabled: el.year.checked });
  });

  el.yearMode.addEventListener('change', () => {
    settings.yearFilterMode = el.yearMode.value;
    renderYearMode();
    save({ yearFilterMode: el.yearMode.value });
  });

  el.yearSingle.addEventListener('change', () => {
    save({ yearFilterSingle: parseInt(el.yearSingle.value, 10) });
  });

  // From/To keep themselves in order rather than rejecting the input.
  el.yearFrom.addEventListener('change', () => {
    const from = parseInt(el.yearFrom.value, 10);
    const to = parseInt(el.yearTo.value, 10);
    if (from > to) {
      el.yearTo.value = String(from);
      save({ yearFilterFrom: from, yearFilterTo: from });
    } else {
      save({ yearFilterFrom: from });
    }
  });

  el.yearTo.addEventListener('change', () => {
    const from = parseInt(el.yearFrom.value, 10);
    const to = parseInt(el.yearTo.value, 10);
    if (to < from) {
      el.yearFrom.value = String(to);
      save({ yearFilterFrom: to, yearFilterTo: to });
    } else {
      save({ yearFilterTo: to });
    }
  });

  el.duration.addEventListener('change', () => {
    el.subDuration.classList.toggle('hidden', !el.duration.checked);
    save({ durationFilterEnabled: el.duration.checked });
  });

  /** Number inputs save on a short idle so typing "12" is not read as "1". */
  function bindNumber(input, key) {
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const value = Math.max(0, Math.min(600, parseInt(input.value, 10) || 0));
        input.value = String(value);
        save({ [key]: value });
      }, 400);
    });
  }

  bindNumber(el.durationMin, 'durationMin');
  bindNumber(el.durationMax, 'durationMax');

  el.keyword.addEventListener('change', () => {
    save({ keywordFilterEnabled: el.keyword.checked });
  });

  el.channel.addEventListener('change', () => {
    save({ channelFilterEnabled: el.channel.checked });
  });

  el.focusPreset.addEventListener('click', async () => {
    const turnOn = !allRecommendedOn();
    const patch = {};
    for (const key of RECOMMENDED_FOCUS) patch[key] = turnOn;
    await save(patch);
    renderSettings();
  });

  el.resetStats.addEventListener('click', async () => {
    try {
      await api.runtime.sendMessage({ type: 'ts:resetStats' });
    } catch (error) {
      // Background asleep or unreachable — clear the counters directly.
      await api.storage.local.set({ ...TS.STAT_DEFAULTS, installedAt: Date.now() });
    }
    renderStats();
  });

  // ── Opening the options page ─────────────────────────────────

  function openOptions(hash) {
    const url = api.runtime.getURL('options.html' + (hash || ''));
    if (hash) {
      api.tabs.create({ url });
    } else if (api.runtime.openOptionsPage) {
      api.runtime.openOptionsPage();
    } else {
      api.tabs.create({ url });
    }
    window.close();
  }

  el.options.addEventListener('click', () => openOptions());

  for (const button of document.querySelectorAll('[data-open-options]')) {
    button.addEventListener('click', () => openOptions(button.dataset.openOptions));
  }

  // ── External changes ─────────────────────────────────────────

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;

    let touched = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in TS.DEFAULTS) {
        settings[key] = newValue;
        touched = true;
      }
    }
    if (touched) renderSettings();
  });

  // ── Boot ─────────────────────────────────────────────────────

  async function boot() {
    settings = await TS.getSettings();
    TS.applyTheme(settings.theme);

    const manifest = api.runtime.getManifest();
    el.version.textContent = `v${manifest.version}`;

    renderFocusRows();
    renderSettings();
    renderStats();

    // Position the tab underline straight away — layout is already resolved by
    // the time this runs, and a requestAnimationFrame callback is not
    // guaranteed to fire if the popup is not compositing yet.
    moveIndicator(tabs[0]);

    // Reposition once webfonts have settled and the tabs may have resized.
    window.addEventListener('load', () => {
      const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      if (active) moveIndicator(active);
    });
  }

  boot();
})();
