const STORAGE_KEY = 'local_stopwatch_saved_times_v2';
const LEGACY_STORAGE_KEY = 'local_stopwatch_saved_times_ms_v1';
const SETTINGS_KEY = 'rubik_timer_settings_v1';
const INSPECTION_MS = 15000;
const INSPECTION_DNF_MS = 17000;
const MAX_PHASES = 8;
const MIN_SPLIT_GAP_MS = 150;
const display = document.getElementById('display');
const splitsEl = document.getElementById('splits');
const startPauseBtn = document.getElementById('startPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const clearBtn = document.getElementById('clearBtn');
const averageEl = document.getElementById('average');
const ao12El = document.getElementById('ao12');
const ao50El = document.getElementById('ao50');
const ao100El = document.getElementById('ao100');
const savedListEl = document.getElementById('savedList');
const inspectionToggle = document.getElementById('inspectionToggle');
const plusTwoToggle = document.getElementById('plusTwoToggle');
const splitsSelect = document.getElementById('splitsSelect');
const presetRow = document.getElementById('presetRow');
const presetSelect = document.getElementById('presetSelect');
const splitNamesEl = document.getElementById('splitNames');
const statsWidget = document.getElementById('statsWidget');
const phaseStatsEl = document.getElementById('phaseStats');

let phase = 'idle'; // idle | inspecting | running | stopped
let elapsedMs = 0;
let startTimestamp = 0;
let inspectionStart = 0;
let pendingPenalty = 0;
let timerId = null;
let splits = []; // cumulative ms at each recorded phase boundary of the current solve
let lastSplitsHtml = '';
const expandedEntries = new Set();

const HOLD_THRESHOLD_MS = 500;
let isHolding = false;
let isArmed = false;
let holdTimeoutId = null;

let settings = loadSettings();
let savedTimes = loadSavedTimes();
let hoverWindow = null;
let pinnedWindow = null;

inspectionToggle.checked = settings.inspection;
plusTwoToggle.checked = settings.plusTwo;

const PRESETS = {
  cfop: ['Cross', 'F2L', 'OLL', 'PLL'],
  roux: ['FB', 'SB', 'CMLL', 'LSE'],
};
const MAX_NAME_LENGTH = 12;

function effectiveValue(entry) {
  if (entry.penalty === 'DNF') {
    return 'DNF';
  }
  return entry.penalty === 2 ? entry.ms + 2000 : entry.ms;
}

function savedValues() {
  return savedTimes.map(effectiveValue);
}

function formatMs(totalMs) {
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function formatResult(value) {
  return value === 'DNF' ? 'DNF' : formatMs(value);
}

function formatPhase(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = String(ms % 1000).padStart(3, '0');
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}.${millis}` : `${seconds}.${millis}`;
}

// Cumulative boundaries -> per-phase durations; the last phase runs up to the total.
function phaseDurations(boundaries, totalMs) {
  return [...boundaries, totalMs].map((end, i) => end - (i === 0 ? 0 : boundaries[i - 1]));
}

function phaseName(index) {
  return settings.splitNames[index] || `P${index + 1}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function phaseItemHtml(index, ms, stats = null) {
  let cls = 'split-item';
  let extra = '';
  if (stats && stats.count >= 2) {
    if (ms === stats.phases[index].best) {
      cls += ' split-best';
    }
    const delta = ms - stats.phases[index].mean;
    if (delta !== 0) {
      extra = ` <span class="split-delta ${delta < 0 ? 'fast' : 'slow'}">${delta < 0 ? '−' : '+'}${(Math.abs(delta) / 1000).toFixed(2)}</span>`;
    }
  }
  return `<span class="${cls}"><span class="split-label">${escapeHtml(phaseName(index))}</span> ${formatPhase(ms)}${extra}</span>`;
}

// Only solves recorded with the current phase count are comparable; DNFs never carry splits.
function isPhaseEntry(entry) {
  return settings.splits > 1 && entry.penalty !== 'DNF' && entry.splits?.length === settings.splits - 1;
}

function phaseStats() {
  if (settings.splits < 2) {
    return null;
  }
  const solves = savedTimes.filter(isPhaseEntry);
  const rows = solves.map((entry) => phaseDurations(entry.splits, entry.ms));
  const grandTotal = solves.reduce((sum, entry) => sum + entry.ms, 0);
  const phases = Array.from({ length: settings.splits }, (_, i) => {
    const column = rows.map((row) => row[i]);
    const sum = column.reduce((a, b) => a + b, 0);
    return {
      best: column.length ? Math.min(...column) : null,
      mean: column.length ? Math.round(sum / column.length) : null,
      ao5: column.length >= 5 ? calculateTrimmedAverage(column.slice(-5)) : null,
      ao12: column.length >= 12 ? calculateTrimmedAverage(column.slice(-12)) : null,
      share: grandTotal > 0 ? sum / grandTotal : null,
    };
  });
  return {
    count: solves.length,
    phases,
    sumOfBests: solves.length ? phases.reduce((sum, p) => sum + p.best, 0) : null,
    bestSolve: solves.length ? Math.min(...solves.map((entry) => entry.ms)) : null,
  };
}

function renderPhaseStats(stats) {
  const cell = (ms) => (ms === null ? '—' : formatPhase(ms));
  if (!stats || stats.count === 0) {
    phaseStatsEl.innerHTML = '<p class="stats-empty">No solves with splits yet</p>';
    return;
  }
  const body = stats.phases
    .map((p, i) => `<tr><th scope="row">${escapeHtml(phaseName(i))}</th><td>${cell(p.best)}</td><td>${cell(p.mean)}</td><td>${cell(p.ao5)}</td><td>${cell(p.ao12)}</td><td>${Math.round(p.share * 100)}%</td></tr>`)
    .join('');
  phaseStatsEl.innerHTML = `<table class="stats-table"><thead><tr><th></th><th>Best</th><th>Mean</th><th>Ao5</th><th>Ao12</th><th>Share</th></tr></thead><tbody>${body}</tbody></table>`
    + `<p class="stats-foot">${stats.count} solve${stats.count === 1 ? '' : 's'} · Sum of bests ${formatPhase(stats.sumOfBests)} · Best solve ${formatPhase(stats.bestSolve)}</p>`;
}

function syncSplitSettingsUi() {
  const on = settings.splits > 1;
  splitsSelect.value = String(settings.splits);
  presetRow.hidden = !on;
  splitNamesEl.hidden = !on;
  statsWidget.hidden = !on;
  syncPresetSelect();
  const inputs = [];
  for (let i = 0; on && i < settings.splits; i += 1) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'split-name-input';
    input.maxLength = MAX_NAME_LENGTH;
    input.placeholder = `P${i + 1}`;
    input.value = settings.splitNames[i];
    input.dataset.index = String(i);
    input.setAttribute('aria-label', `Name of phase ${i + 1}`);
    inputs.push(input);
  }
  splitNamesEl.replaceChildren(...inputs);
}

function syncPresetSelect() {
  const names = settings.splitNames.slice(0, settings.splits);
  presetSelect.value = Object.keys(PRESETS).find(
    (key) => PRESETS[key].length === names.length && PRESETS[key].every((name, i) => name === names[i]),
  ) ?? 'custom';
}

function refreshSplitViews() {
  syncSplitSettingsUi();
  renderSplits();
  renderSaved();
  syncButtons();
}

function splitsRemaining() {
  return phase === 'running' && settings.splits > 1 && splits.length < settings.splits - 1;
}

function recordSplit() {
  const now = getCurrentElapsed();
  const last = splits.length > 0 ? splits[splits.length - 1] : 0;
  if (now - last < MIN_SPLIT_GAP_MS) {
    return;
  }
  splits.push(now);
  renderSplits();
  syncButtons();
}

function stopOrSplit() {
  if (splitsRemaining()) {
    recordSplit();
  } else {
    pause();
  }
}

function renderSplits() {
  const active = settings.splits > 1 && (phase === 'running' || phase === 'stopped');
  let html = '';
  if (active) {
    const durations = phase === 'stopped' ? phaseDurations(splits, elapsedMs) : splits.map((end, i) => end - (i === 0 ? 0 : splits[i - 1]));
    html = durations.map((ms, i) => phaseItemHtml(i, ms)).join('');
    if (phase === 'running') {
      html += `<span class="split-item split-current">${escapeHtml(phaseName(splits.length))}</span>`;
    }
  }
  if (html !== lastSplitsHtml) {
    lastSplitsHtml = html;
    splitsEl.innerHTML = html;
  }
  splitsEl.hidden = !active;
}

function setResultText(el, value) {
  el.textContent = value === null ? '—' : formatResult(value);
  el.classList.toggle('dnf', value === 'DNF');
}

// Ties trim the earlier solve first so highlighting is deterministic.
function getTrimPlan(windowTimes) {
  const trimCount = Math.ceil(windowTimes.length * 0.05);
  const key = (i) => (windowTimes[i] === 'DNF' ? Infinity : windowTimes[i]);
  const order = windowTimes
    .map((_, i) => i)
    .sort((a, b) => (key(a) === key(b) ? a - b : key(a) < key(b) ? -1 : 1));
  return {
    trimCount,
    low: order.slice(0, trimCount),
    high: order.slice(order.length - trimCount),
    kept: order.slice(trimCount, order.length - trimCount),
  };
}

function calculateTrimmedAverage(windowTimes) {
  // WCA rule: a DNF sorts as the worst result; the average itself becomes
  // DNF only if more DNFs remain than the trim count can discard.
  const { trimCount, kept } = getTrimPlan(windowTimes);
  const dnfCount = windowTimes.filter((value) => value === 'DNF').length;
  if (dnfCount > trimCount) {
    return 'DNF';
  }
  const total = kept.reduce((sum, i) => sum + windowTimes[i], 0);
  return Math.round(total / kept.length);
}

function getBestIndex() {
  let best = -1;
  const values = savedValues();
  values.forEach((value, index) => {
    if (value !== 'DNF' && (best === -1 || value < values[best])) {
      best = index;
    }
  });
  return best;
}

function applyHighlight() {
  const windowSize = hoverWindow ?? pinnedWindow;
  const items = savedListEl.querySelectorAll('li[data-index]');
  items.forEach((li) => li.classList.remove('out-of-window', 'trim-low', 'trim-high'));
  if (windowSize === null || savedTimes.length < windowSize) {
    return;
  }
  const start = savedTimes.length - windowSize;
  const plan = getTrimPlan(savedValues().slice(start));
  items.forEach((li) => {
    const index = Number(li.dataset.index);
    if (index < start) {
      li.classList.add('out-of-window');
    } else if (plan.low.includes(index - start)) {
      li.classList.add('trim-low');
    } else if (plan.high.includes(index - start)) {
      li.classList.add('trim-high');
    }
  });
}

function calculateAverageOf(windowSize) {
  if (savedTimes.length < windowSize) {
    return null;
  }
  return calculateTrimmedAverage(savedValues().slice(-windowSize));
}

function getCurrentElapsed() {
  if (phase !== 'running') {
    return elapsedMs;
  }
  return elapsedMs + (Date.now() - startTimestamp);
}

function canStart() {
  return phase === 'idle' || phase === 'inspecting';
}

function setTimerVisualState(state) {
  display.classList.toggle('holding', state === 'holding');
  display.classList.toggle('armed', state === 'armed');
}

function cancelHold() {
  if (holdTimeoutId !== null) {
    clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
  }
  isHolding = false;
  isArmed = false;
  setTimerVisualState('idle');
}

function renderDisplay() {
  let mainPart;
  let msPart = null;
  let overtime = false;
  if (phase === 'inspecting') {
    const t = Date.now() - inspectionStart;
    overtime = t >= INSPECTION_MS;
    mainPart = overtime ? '+2' : `00:${String(Math.ceil((INSPECTION_MS - t) / 1000)).padStart(2, '0')}`;
  } else {
    [mainPart, msPart = '000'] = formatMs(getCurrentElapsed()).split('.');
  }
  display.classList.toggle('inspecting', phase === 'inspecting');
  display.classList.toggle('overtime', overtime);
  const showPenalty = pendingPenalty === 2 && (phase === 'running' || phase === 'stopped');
  const penaltyHtml = showPenalty ? '<span class="time-penalty">+2</span>' : '';
  const decimals = msPart === null
    ? ''
    : `<span class="time-decimals"><span class="time-sep">.</span><span class="time-ms">${msPart}</span>${penaltyHtml}</span>`;
  display.innerHTML = `<span class="time-main">${mainPart}</span>${decimals}`;
  renderSplits();
}

function renderSaved() {
  const stats = phaseStats();
  renderPhaseStats(stats);
  if (savedTimes.length === 0) {
    savedListEl.innerHTML = '<li class="saved-empty">No saved times yet</li>';
  } else {
    const bestIndex = getBestIndex();
    const values = savedValues();
    const items = savedTimes
      .map((entry, index) => {
        const value = values[index];
        const valueClass = value === 'DNF' ? 'saved-line-value dnf' : 'saved-line-value';
        const itemClass = index === bestIndex ? ' class="best"' : '';
        const mark = entry.penalty === 2 ? '+' : '';
        const plusTwoBtn = settings.plusTwo && entry.penalty !== 'DNF'
          ? `<button type="button" class="saved-line-plus2${entry.penalty === 2 ? ' active' : ''}" data-index="${index}" aria-pressed="${entry.penalty === 2}" aria-label="Toggle +2 penalty on solve #${index + 1}">+2</button>`
          : '';
        const splitsBtn = entry.splits?.length
          ? `<button type="button" class="saved-line-splits-btn${expandedEntries.has(entry) ? ' active' : ''}" data-index="${index}" aria-expanded="${expandedEntries.has(entry)}" aria-label="Toggle splits for solve #${index + 1}">${expandedEntries.has(entry) ? '▴' : '▾'}</button>`
          : '';
        const splitsRow = entry.splits?.length && expandedEntries.has(entry)
          ? `<div class="saved-line-splits">${phaseDurations(entry.splits, entry.ms).map((ms, i) => phaseItemHtml(i, ms, isPhaseEntry(entry) ? stats : null)).join('')}</div>`
          : '';
        return `<li data-index="${index}"${itemClass}><span class="saved-line-label">#${index + 1}</span><span class="${valueClass}">${formatResult(value)}${mark}</span><span class="saved-line-actions">${splitsBtn}${plusTwoBtn}<button type="button" class="saved-line-delete" data-index="${index}" aria-label="Delete solve #${index + 1}">✕</button></span>${splitsRow}</li>`;
      })
      .join('');
    savedListEl.innerHTML = items;
  }

  setResultText(ao12El, calculateAverageOf(12));
  setResultText(ao50El, calculateAverageOf(50));
  setResultText(ao100El, calculateAverageOf(100));
  setResultText(averageEl, savedTimes.length < 5 ? null : calculateAverageOf(5));
  applyHighlight();
}

function syncButtons() {
  startPauseBtn.textContent = {
    idle: settings.inspection ? 'Inspect' : 'Start',
    inspecting: 'Start',
    running: splitsRemaining() ? 'Split' : 'Stop',
    stopped: 'Save',
  }[phase];
  resetBtn.hidden = phase !== 'stopped' && phase !== 'inspecting';
  resetBtn.textContent = phase === 'inspecting' ? 'Cancel' : 'DNF';
}

function tick() {
  if (phase === 'inspecting' && Date.now() - inspectionStart >= INSPECTION_DNF_MS) {
    autoDnf();
    return;
  }
  renderDisplay();
  syncButtons();
  timerId = requestAnimationFrame(tick);
}

function logDnf() {
  savedTimes.push({ ms: null, penalty: 'DNF' });
  persistSavedTimes();
  renderSaved();
}

function beginInspection() {
  if (phase !== 'idle') {
    return;
  }
  phase = 'inspecting';
  inspectionStart = Date.now();
  pendingPenalty = 0;
  timerId = requestAnimationFrame(tick);
  syncButtons();
}

function cancelInspection() {
  if (phase !== 'inspecting') {
    return;
  }
  cancelAnimationFrame(timerId);
  timerId = null;
  phase = 'idle';
  pendingPenalty = 0;
  renderDisplay();
  syncButtons();
}

// WCA: starting after 17s of inspection is a DNF.
function autoDnf() {
  timerId = null;
  phase = 'idle';
  pendingPenalty = 0;
  cancelHold();
  logDnf();
  renderDisplay();
  syncButtons();
}

function start() {
  if (!canStart()) {
    return;
  }
  if (phase === 'inspecting') {
    const used = Date.now() - inspectionStart;
    if (used >= INSPECTION_DNF_MS) {
      cancelAnimationFrame(timerId);
      autoDnf();
      return;
    }
    pendingPenalty = used >= INSPECTION_MS ? 2 : 0;
    cancelAnimationFrame(timerId);
  }
  phase = 'running';
  splits = [];
  startTimestamp = Date.now();
  timerId = requestAnimationFrame(tick);
  syncButtons();
}

function pause() {
  if (phase !== 'running') {
    return;
  }
  elapsedMs = getCurrentElapsed();
  phase = 'stopped';
  cancelAnimationFrame(timerId);
  timerId = null;
  renderDisplay();
  syncButtons();
}

function reset() {
  if (phase === 'inspecting') {
    cancelInspection();
    return;
  }
  const hadPendingSolve = phase === 'running' || phase === 'stopped';
  pause();
  elapsedMs = 0;
  phase = 'idle';
  pendingPenalty = 0;
  splits = [];
  if (hadPendingSolve) {
    logDnf();
  }
  renderDisplay();
  syncButtons();
}

function saveCurrentTime() {
  if (phase !== 'stopped') {
    return;
  }
  const entry = { ms: elapsedMs, penalty: pendingPenalty };
  if (splits.length > 0) {
    entry.splits = splits;
  }
  savedTimes.push(entry);
  persistSavedTimes();

  renderSaved();
  elapsedMs = 0;
  phase = 'idle';
  pendingPenalty = 0;
  splits = [];
  renderDisplay();
  syncButtons();
}

function clearSavedTimes() {
  savedTimes = [];
  expandedEntries.clear();
  persistSavedTimes();
  renderSaved();
}

function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  if (entry.penalty === 'DNF') {
    return true;
  }
  return Number.isInteger(entry.ms) && entry.ms >= 0 && (entry.penalty === 0 || entry.penalty === 2)
    && (entry.splits === undefined || isValidSplits(entry.splits, entry.ms));
}

function isValidSplits(list, totalMs) {
  return Array.isArray(list)
    && list.length > 0
    && list.length < MAX_PHASES
    && list.every((value, i) => Number.isInteger(value) && value >= (i === 0 ? 0 : list[i - 1]) && value <= totalMs);
}

function loadSavedTimes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
    }
    // v1 stored plain numbers and 'DNF'; migrate without touching the old key.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(legacy)) {
      return [];
    }
    return legacy.flatMap((value) => {
      if (value === 'DNF') {
        return [{ ms: null, penalty: 'DNF' }];
      }
      return Number.isInteger(value) && value >= 0 ? [{ ms: value, penalty: 0 }] : [];
    });
  } catch {
    return [];
  }
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    const phases = Number(parsed?.splits);
    const names = Array.isArray(parsed?.splitNames) ? parsed.splitNames : [];
    return {
      inspection: parsed?.inspection === true,
      plusTwo: parsed?.plusTwo === true,
      splits: Number.isInteger(phases) && phases >= 2 && phases <= MAX_PHASES ? phases : 0,
      splitNames: Array.from({ length: MAX_PHASES }, (_, i) => (typeof names[i] === 'string' ? names[i].trim().slice(0, MAX_NAME_LENGTH) : '')),
    };
  } catch {
    return { inspection: false, plusTwo: false, splits: 0, splitNames: Array(MAX_PHASES).fill('') };
  }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function persistSavedTimes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTimes));
}

function togglePlusTwo(index) {
  const entry = savedTimes[index];
  if (!entry || entry.penalty === 'DNF') {
    return;
  }
  entry.penalty = entry.penalty === 2 ? 0 : 2;
  persistSavedTimes();
  renderSaved();
}

function deleteSavedTime(index) {
  if (index < 0 || index >= savedTimes.length) {
    return;
  }
  const [removed] = savedTimes.splice(index, 1);
  expandedEntries.delete(removed);
  persistSavedTimes();
  renderSaved();
}

startPauseBtn.addEventListener('click', () => {
  startPauseBtn.blur();
  if (phase === 'running') {
    stopOrSplit();
  } else if (phase === 'stopped') {
    saveCurrentTime();
  } else if (phase === 'idle' && settings.inspection) {
    beginInspection();
  } else {
    start();
  }
});

resetBtn.addEventListener('click', () => {
  resetBtn.blur();
  reset();
});
clearBtn.addEventListener('click', clearSavedTimes);

// Blur so a later Space press goes to the timer instead of re-toggling the checkbox.
inspectionToggle.addEventListener('change', () => {
  settings.inspection = inspectionToggle.checked;
  persistSettings();
  if (!settings.inspection) {
    cancelInspection();
  }
  syncButtons();
  inspectionToggle.blur();
});
plusTwoToggle.addEventListener('change', () => {
  settings.plusTwo = plusTwoToggle.checked;
  persistSettings();
  renderSaved();
  plusTwoToggle.blur();
});
splitsSelect.addEventListener('change', () => {
  settings.splits = Number(splitsSelect.value);
  persistSettings();
  refreshSplitViews();
  splitsSelect.blur();
});
presetSelect.addEventListener('change', () => {
  const names = PRESETS[presetSelect.value];
  if (names) {
    settings.splits = names.length;
    settings.splitNames = Array.from({ length: MAX_PHASES }, (_, i) => names[i] ?? '');
    persistSettings();
    refreshSplitViews();
  }
  presetSelect.blur();
});
splitNamesEl.addEventListener('input', (event) => {
  const index = Number(event.target.dataset.index);
  settings.splitNames[index] = event.target.value.trim().slice(0, MAX_NAME_LENGTH);
  persistSettings();
  syncPresetSelect();
  renderSplits();
  renderSaved();
});
splitNamesEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.target.blur();
  }
});

const summaryEl = document.querySelector('.summary');

function windowFromEvent(event) {
  const el = event.target.closest('[data-n]');
  return el ? Number(el.dataset.n) : null;
}

// Mouse hover previews a window; click pins it (also how touch users reach it).
summaryEl.addEventListener('pointerover', (event) => {
  if (event.pointerType === 'mouse') {
    hoverWindow = windowFromEvent(event);
    applyHighlight();
  }
});
summaryEl.addEventListener('pointerout', (event) => {
  if (event.pointerType === 'mouse') {
    hoverWindow = null;
    applyHighlight();
  }
});
summaryEl.addEventListener('focusin', (event) => {
  hoverWindow = windowFromEvent(event);
  applyHighlight();
});
summaryEl.addEventListener('focusout', () => {
  hoverWindow = null;
  applyHighlight();
});
summaryEl.addEventListener('click', (event) => {
  const n = windowFromEvent(event);
  if (n !== null) {
    pinnedWindow = pinnedWindow === n ? null : n;
    applyHighlight();
  }
});

savedListEl.addEventListener('click', (event) => {
  const splitsBtn = event.target.closest('.saved-line-splits-btn');
  if (splitsBtn) {
    const entry = savedTimes[Number(splitsBtn.dataset.index)];
    if (entry) {
      if (!expandedEntries.delete(entry)) {
        expandedEntries.add(entry);
      }
      renderSaved();
    }
    return;
  }
  const plusTwoBtn = event.target.closest('.saved-line-plus2');
  if (plusTwoBtn) {
    togglePlusTwo(Number(plusTwoBtn.dataset.index));
    return;
  }
  const deleteBtn = event.target.closest('.saved-line-delete');
  if (!deleteBtn) {
    return;
  }
  deleteSavedTime(Number(deleteBtn.dataset.index));
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const isTypingTarget = target instanceof HTMLElement && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );

  if (isTypingTarget) {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    if (phase === 'running') {
      if (!event.repeat) {
        stopOrSplit();
      }
    } else if (phase === 'idle' && settings.inspection) {
      if (!event.repeat) {
        beginInspection();
      }
    } else if (!event.repeat && !isHolding && canStart()) {
      isHolding = true;
      setTimerVisualState('holding');
      holdTimeoutId = setTimeout(() => {
        isArmed = true;
        setTimerVisualState('armed');
      }, HOLD_THRESHOLD_MS);
    }
  }

  if (event.code === 'KeyR') {
    event.preventDefault();
    reset();
  }

  if (event.code === 'KeyS') {
    event.preventDefault();
    saveCurrentTime();
  }
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
  }
  if (event.code !== 'Space' || !isHolding) {
    return;
  }
  const shouldStart = isArmed;
  cancelHold();
  if (shouldStart) {
    start();
  }
});

window.addEventListener('blur', cancelHold);

renderDisplay();
renderSaved();
syncButtons();
syncSplitSettingsUi();

