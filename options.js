/**
 * TubeSift — Options page
 *
 * Like the popup, every control saves immediately; there is no Save button.
 * Simple booleans are wired declaratively through `data-setting` attributes so
 * adding a checkbox to options.html needs no JavaScript change.
 */
'use strict';

(function () {
  const TS = globalThis.TubeSift;
  const { api } = TS;

  let settings = { ...TS.DEFAULTS };

  const $ = (id) => document.getElementById(id);

  // ── Toast ────────────────────────────────────────────────────

  const toast = $('toast');
  let toastTimer = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }

  // ── Saving ───────────────────────────────────────────────────

  async function save(patch, message) {
    Object.assign(settings, patch);
    await TS.setSettings(patch);
    if (message) showToast(message);
  }

  // ── Declarative boolean controls ─────────────────────────────

  const boolInputs = [...document.querySelectorAll('input[type="checkbox"][data-setting]')];

  for (const input of boolInputs) {
    input.addEventListener('change', async () => {
      await save({ [input.dataset.setting]: input.checked });
      renderDependencies();
    });
  }

  // ── Master switch ────────────────────────────────────────────

  const masterToggle = $('toggle-enabled');
  const masterLabel = $('master-label');

  masterToggle.addEventListener('change', async () => {
    await save({ enabled: masterToggle.checked });
    renderMaster();
  });

  function renderMaster() {
    masterToggle.checked = settings.enabled;
    masterLabel.textContent = settings.enabled ? 'Filtering active' : 'Paused';
    masterLabel.toggleAttribute('data-off', !settings.enabled);
  }

  // ── Year controls ────────────────────────────────────────────

  const yearMode = $('select-year-mode');
  const yearSingle = $('select-year-single');
  const yearFrom = $('select-year-from');
  const yearTo = $('select-year-to');

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

  function renderYearMode() {
    const isRange = settings.yearFilterMode === 'range';
    $('year-single-group').classList.toggle('hidden', isRange);
    $('year-range-group').classList.toggle('hidden', !isRange);
  }

  yearMode.addEventListener('change', async () => {
    await save({ yearFilterMode: yearMode.value });
    renderYearMode();
  });

  yearSingle.addEventListener('change', () => {
    save({ yearFilterSingle: parseInt(yearSingle.value, 10) });
  });

  // From/To reorder themselves instead of rejecting the choice.
  yearFrom.addEventListener('change', () => {
    const from = parseInt(yearFrom.value, 10);
    const to = parseInt(yearTo.value, 10);
    if (from > to) {
      yearTo.value = String(from);
      save({ yearFilterFrom: from, yearFilterTo: from });
    } else {
      save({ yearFilterFrom: from });
    }
  });

  yearTo.addEventListener('change', () => {
    const from = parseInt(yearFrom.value, 10);
    const to = parseInt(yearTo.value, 10);
    if (to < from) {
      yearFrom.value = String(to);
      save({ yearFilterFrom: to, yearFilterTo: to });
    } else {
      save({ yearFilterTo: to });
    }
  });

  // ── Duration controls ────────────────────────────────────────

  /** Saves a number input once typing pauses, clamped to a sane range. */
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

  bindNumber($('input-duration-min'), 'durationMin');
  bindNumber($('input-duration-max'), 'durationMax');

  // ── List textareas ───────────────────────────────────────────

  /** Binds a textarea to a string-array setting, saving on a typing pause. */
  function bindList(textarea, key, onSaved) {
    let timer = null;
    textarea.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const list = TS.parseList(textarea.value);
        await save({ [key]: list });
        if (onSaved) onSaved(list);
      }, 500);
    });

    // Normalise the text on blur so the user sees exactly what was stored.
    textarea.addEventListener('blur', () => {
      const list = TS.parseList(textarea.value);
      textarea.value = list.join('\n');
    });
  }

  bindList($('textarea-keywords'), 'blockedKeywords', renderListSummaries);
  bindList($('textarea-channels'), 'blockedChannels', renderListSummaries);
  bindList($('textarea-allowed'), 'allowedChannels');

  function renderListSummaries() {
    const describe = (list, noun) => {
      const n = Array.isArray(list) ? list.length : 0;
      return n === 0 ? `No ${noun}s yet` : `${n} ${noun}${n === 1 ? '' : 's'} blocked`;
    };
    $('keyword-summary').textContent = describe(settings.blockedKeywords, 'keyword');
    $('channel-summary').textContent = describe(settings.blockedChannels, 'channel');
  }

  // ── Focus rows ───────────────────────────────────────────────

  function renderFocusRows() {
    const frag = document.createDocumentFragment();

    for (const option of TS.FOCUS_OPTIONS) {
      const row = document.createElement('div');
      row.className = 'row';

      const text = document.createElement('div');
      text.className = 'row-text';

      const title = document.createElement('span');
      title.className = 'row-title';
      title.textContent = option.title;

      const desc = document.createElement('span');
      desc.className = 'row-desc';
      desc.textContent = option.desc;

      text.append(title, desc);

      const label = document.createElement('label');
      label.className = 'toggle';

      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = option.title;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.focusKey = option.key;

      const slider = document.createElement('span');
      slider.className = 'toggle-slider';

      label.append(sr, input, slider);
      row.append(text, label);
      frag.appendChild(row);

      input.addEventListener('change', () => save({ [option.key]: input.checked }));
    }

    $('focus-list').replaceChildren(frag);
  }

  // ── Theme ────────────────────────────────────────────────────

  const themeSelect = $('select-theme');

  themeSelect.addEventListener('change', async () => {
    await save({ theme: themeSelect.value });
    TS.applyTheme(themeSelect.value);
  });

  // ── Keyboard shortcuts ───────────────────────────────────────

  /** Renders the browser's live shortcut registrations, not a hard-coded list. */
  async function renderShortcuts() {
    const list = $('shortcut-list');
    const hint = $('shortcut-hint');

    if (!api.commands || !api.commands.getAll) {
      list.innerHTML = '';
      hint.textContent = 'This browser does not expose extension shortcuts.';
      return;
    }

    const commands = await api.commands.getAll();
    const frag = document.createDocumentFragment();

    for (const command of commands) {
      if (!command.description) continue; // skip _execute_action and friends

      const dt = document.createElement('dt');
      dt.textContent = command.description;

      const dd = document.createElement('dd');
      const kbd = document.createElement('kbd');
      if (command.shortcut) {
        kbd.textContent = command.shortcut;
      } else {
        kbd.textContent = 'Not set';
        kbd.setAttribute('data-unset', '');
      }
      dd.appendChild(kbd);

      frag.append(dt, dd);
    }

    list.replaceChildren(frag);

    hint.textContent = TS.isFirefox
      ? 'Change these under Add-ons and themes → the gear icon → Manage Extension Shortcuts.'
      : 'Change these at chrome://extensions/shortcuts (copy and paste the address).';
  }

  // ── Statistics summary ───────────────────────────────────────

  async function renderStatsSummary() {
    const stats = await TS.getStats();
    const total = stats.statsTotal || 0;
    $('stats-summary').textContent =
      total === 0
        ? 'No videos filtered yet'
        : `${new Intl.NumberFormat().format(total)} videos filtered so far`;
  }

  // ── Export / import ──────────────────────────────────────────

  $('btn-export').addEventListener('click', async () => {
    const payload = {
      app: 'TubeSift',
      version: api.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings: await TS.getSettings(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `tubesift-settings-${TS.todayKey()}.json`;
    link.click();

    // Revoking immediately can cancel the download in some builds.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('Settings exported');
  });

  const fileInput = $('file-import');

  $('btn-import').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-importing the same file
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed && parsed.settings ? parsed.settings : parsed;
      if (!incoming || typeof incoming !== 'object') throw new Error('bad shape');

      // Only accept keys we know about, and only with the expected type. A
      // hand-edited or unrelated file can never inject arbitrary settings.
      const clean = {};
      for (const [key, fallback] of Object.entries(TS.DEFAULTS)) {
        if (!(key in incoming)) continue;
        const value = incoming[key];

        if (Array.isArray(fallback)) {
          if (Array.isArray(value)) clean[key] = TS.parseList(value.join('\n'));
        } else if (typeof value === typeof fallback) {
          clean[key] = value;
        }
      }

      if (Object.keys(clean).length === 0) throw new Error('nothing usable');

      await TS.setSettings(clean);
      settings = await TS.getSettings();
      renderAll();
      showToast('Settings imported');
    } catch (error) {
      showToast('That file is not a TubeSift export');
    }
  });

  // ── Reset ────────────────────────────────────────────────────

  $('btn-reset-stats').addEventListener('click', async () => {
    try {
      await api.runtime.sendMessage({ type: 'ts:resetStats' });
    } catch (error) {
      await api.storage.local.set({ ...TS.STAT_DEFAULTS, installedAt: Date.now() });
    }
    renderStatsSummary();
    showToast('Counters reset');
  });

  $('btn-reset-all').addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Restore every TubeSift setting to its default?\n\n' +
        'Your keyword, channel and allow lists will be cleared. This cannot be undone.'
    );
    if (!confirmed) return;

    await TS.setSettings({ ...TS.DEFAULTS });
    settings = { ...TS.DEFAULTS };
    renderAll();
    showToast('Defaults restored');
  });

  // ── Rendering ────────────────────────────────────────────────

  /** Dims the detail panels whose owning toggle is off. */
  function renderDependencies() {
    $('year-inset').toggleAttribute('data-disabled', !settings.yearFilterEnabled);
    $('duration-inset').toggleAttribute('data-disabled', !settings.durationFilterEnabled);
  }

  function renderAll() {
    renderMaster();

    for (const input of boolInputs) {
      input.checked = !!settings[input.dataset.setting];
    }

    for (const input of document.querySelectorAll('[data-focus-key]')) {
      input.checked = !!settings[input.dataset.focusKey];
    }

    yearMode.value = settings.yearFilterMode;
    fillYears(yearSingle, settings.yearFilterSingle);
    fillYears(yearFrom, settings.yearFilterFrom);
    fillYears(yearTo, settings.yearFilterTo);
    renderYearMode();

    $('input-duration-min').value = String(settings.durationMin);
    $('input-duration-max').value = String(settings.durationMax);

    $('textarea-keywords').value = (settings.blockedKeywords || []).join('\n');
    $('textarea-channels').value = (settings.blockedChannels || []).join('\n');
    $('textarea-allowed').value = (settings.allowedChannels || []).join('\n');

    themeSelect.value = settings.theme;

    renderListSummaries();
    renderDependencies();
  }

  // ── Side navigation highlighting ─────────────────────────────

  /** Marks the sidebar link for whichever section is currently in view. */
  function setupScrollSpy() {
    const links = new Map(
      [...document.querySelectorAll('.sidenav-link')].map((a) => [a.hash.slice(1), a])
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of links.values()) link.removeAttribute('aria-current');
          const active = links.get(entry.target.id);
          if (active) active.setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '-92px 0px -65% 0px', threshold: 0 }
    );

    for (const id of links.keys()) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
  }

  // ── External changes ─────────────────────────────────────────

  api.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local') {
      renderStatsSummary();
      return;
    }
    if (area !== 'sync') return;

    // Ignore echoes of our own writes: only re-render when a value actually
    // differs from what this page already holds.
    const differs = Object.entries(changes).some(
      ([key, { newValue }]) =>
        key in TS.DEFAULTS && JSON.stringify(settings[key]) !== JSON.stringify(newValue)
    );
    if (!differs) return;

    const focused = document.activeElement;
    const editing = focused && /^(TEXTAREA|INPUT)$/.test(focused.tagName);

    settings = await TS.getSettings();
    if (editing) {
      // Do not yank text out from under someone who is mid-edit.
      renderMaster();
      renderDependencies();
    } else {
      renderAll();
    }
  });

  // ── Boot ─────────────────────────────────────────────────────

  async function boot() {
    settings = await TS.getSettings();
    TS.applyTheme(settings.theme);

    $('version-label').textContent = `Version ${api.runtime.getManifest().version}`;

    renderFocusRows();
    renderAll();
    renderStatsSummary();
    renderShortcuts();
    setupScrollSpy();

    if (window.location.hash === '#welcome') {
      $('welcome').classList.remove('hidden');
    }
  }

  boot();
})();
