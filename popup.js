/**
 * TubeSift — Popup Script
 *
 * Manages the popup UI state: reads settings from chrome.storage.sync,
 * renders controls, and writes changes back on user interaction.
 * All saves are immediate and provide visual feedback.
 */
'use strict';

(function () {
  // ── DOM References ───────────────────────────────────────────

  const toggleShorts = document.getElementById('toggle-shorts');
  const toggleYear = document.getElementById('toggle-year');
  const yearControls = document.getElementById('year-controls');
  const btnModeSingle = document.getElementById('btn-mode-single');
  const btnModeRange = document.getElementById('btn-mode-range');
  const pickerSingle = document.getElementById('picker-single');
  const pickerRange = document.getElementById('picker-range');
  const selectSingle = document.getElementById('select-year-single');
  const selectFrom = document.getElementById('select-year-from');
  const selectTo = document.getElementById('select-year-to');
  const saveIndicator = document.getElementById('save-indicator');

  // ── Year Options ─────────────────────────────────────────────

  const CURRENT_YEAR = new Date().getFullYear();
  const START_YEAR = 2005; // YouTube was founded in 2005

  /**
   * Populates a <select> element with year options from 2005 to now.
   */
  function populateYearSelect(selectEl, selectedYear) {
    selectEl.innerHTML = '';
    for (let y = CURRENT_YEAR; y >= START_YEAR; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === selectedYear) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  // ── Settings I/O ─────────────────────────────────────────────

  /**
   * Loads settings from storage and updates the UI.
   */
  async function loadSettings() {
    const settings = await chrome.storage.sync.get({
      shortsBlocked: true,
      yearFilterEnabled: false,
      yearFilterMode: 'single',
      yearFilterSingle: CURRENT_YEAR,
      yearFilterFrom: 2020,
      yearFilterTo: CURRENT_YEAR,
    });

    // Shorts toggle
    toggleShorts.checked = settings.shortsBlocked;

    // Year filter toggle
    toggleYear.checked = settings.yearFilterEnabled;
    yearControls.classList.toggle('hidden', !settings.yearFilterEnabled);

    // Mode
    setMode(settings.yearFilterMode);

    // Year dropdowns
    populateYearSelect(selectSingle, settings.yearFilterSingle);
    populateYearSelect(selectFrom, settings.yearFilterFrom);
    populateYearSelect(selectTo, settings.yearFilterTo);
  }

  /**
   * Saves a partial settings object to storage and shows the save indicator.
   */
  async function saveSettings(partial) {
    await chrome.storage.sync.set(partial);
    flashSaveIndicator();
  }

  // ── UI Helpers ───────────────────────────────────────────────

  /**
   * Switches between 'single' and 'range' mode in the UI.
   */
  function setMode(mode) {
    const isSingle = mode === 'single';
    btnModeSingle.classList.toggle('active', isSingle);
    btnModeRange.classList.toggle('active', !isSingle);
    pickerSingle.classList.toggle('hidden', !isSingle);
    pickerRange.classList.toggle('hidden', isSingle);
  }

  /**
   * Briefly shows a "Saved" indicator in the footer.
   */
  let saveTimer = null;
  function flashSaveIndicator() {
    saveIndicator.classList.add('visible');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveIndicator.classList.remove('visible');
    }, 1500);
  }

  // ── Event Listeners ──────────────────────────────────────────

  // Shorts toggle
  toggleShorts.addEventListener('change', () => {
    saveSettings({ shortsBlocked: toggleShorts.checked });
  });

  // Year filter toggle
  toggleYear.addEventListener('change', () => {
    const enabled = toggleYear.checked;
    yearControls.classList.toggle('hidden', !enabled);
    saveSettings({ yearFilterEnabled: enabled });
  });

  // Mode buttons
  btnModeSingle.addEventListener('click', () => {
    setMode('single');
    saveSettings({ yearFilterMode: 'single' });
  });

  btnModeRange.addEventListener('click', () => {
    setMode('range');
    saveSettings({ yearFilterMode: 'range' });
  });

  // Year selects
  selectSingle.addEventListener('change', () => {
    saveSettings({ yearFilterSingle: parseInt(selectSingle.value, 10) });
  });

  selectFrom.addEventListener('change', () => {
    const from = parseInt(selectFrom.value, 10);
    const to = parseInt(selectTo.value, 10);
    // Auto-correct if from > to
    if (from > to) {
      selectTo.value = from;
      saveSettings({
        yearFilterFrom: from,
        yearFilterTo: from,
      });
    } else {
      saveSettings({ yearFilterFrom: from });
    }
  });

  selectTo.addEventListener('change', () => {
    const from = parseInt(selectFrom.value, 10);
    const to = parseInt(selectTo.value, 10);
    // Auto-correct if to < from
    if (to < from) {
      selectFrom.value = to;
      saveSettings({
        yearFilterFrom: to,
        yearFilterTo: to,
      });
    } else {
      saveSettings({ yearFilterTo: to });
    }
  });

  // ── Initialize ───────────────────────────────────────────────

  loadSettings();
})();
