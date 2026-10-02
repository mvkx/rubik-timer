const STORAGE_KEY = 'local_stopwatch_saved_times_v2';
const LEGACY_STORAGE_KEY = 'local_stopwatch_saved_times_ms_v1';
const SETTINGS_KEY = 'rubik_timer_settings_v1';
const INSPECTION_MS = 15000;
const INSPECTION_DNF_MS = 17000;
const display = document.getElementById('display');
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

let phase = 'idle'; // idle | inspecting | running | stopped
let elapsedMs = 0;
let startTimestamp = 0;
let inspectionStart = 0;
let pendingPenalty = 0;
let timerId = null;

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
}

function renderSaved() {
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
        return `<li data-index="${index}"${itemClass}><span class="saved-line-label">#${index + 1}</span><span class="${valueClass}">${formatResult(value)}${mark}</span><span class="saved-line-actions">${plusTwoBtn}<button type="button" class="saved-line-delete" data-index="${index}" aria-label="Delete solve #${index + 1}">✕</button></span></li>`;
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
    running: 'Stop',
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
  savedTimes.push({ ms: elapsedMs, penalty: pendingPenalty });
  persistSavedTimes();

  renderSaved();
  elapsedMs = 0;
  phase = 'idle';
  pendingPenalty = 0;
  renderDisplay();
  syncButtons();
}

function clearSavedTimes() {
  savedTimes = [];
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
  return Number.isInteger(entry.ms) && entry.ms >= 0 && (entry.penalty === 0 || entry.penalty === 2);
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
    return { inspection: parsed?.inspection === true, plusTwo: parsed?.plusTwo === true };
  } catch {
    return { inspection: false, plusTwo: false };
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
  savedTimes.splice(index, 1);
  persistSavedTimes();
  renderSaved();
}

startPauseBtn.addEventListener('click', () => {
  startPauseBtn.blur();
  if (phase === 'running') {
    pause();
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
      pause();
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

