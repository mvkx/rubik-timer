const STORAGE_KEY = 'local_stopwatch_saved_times_ms_v1';
const display = document.getElementById('display');
const startPauseBtn = document.getElementById('startPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const averageEl = document.getElementById('average');
const ao12El = document.getElementById('ao12');
const ao50El = document.getElementById('ao50');
const ao100El = document.getElementById('ao100');
const savedListEl = document.getElementById('savedList');

let running = false;
let elapsedMs = 0;
let startTimestamp = 0;
let timerId = null;

const HOLD_THRESHOLD_MS = 500;
let isHolding = false;
let isArmed = false;
let holdTimeoutId = null;

let savedTimes = loadSavedTimes();

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

function calculateTrimmedAverage(windowTimes) {
  // WCA rule: a DNF sorts as the worst result; the average itself becomes
  // DNF only if more DNFs remain than the trim count can discard.
  const trimCount = Math.ceil(windowTimes.length * 0.05);
  const dnfCount = windowTimes.filter((value) => value === 'DNF').length;
  if (dnfCount > trimCount) {
    return 'DNF';
  }
  const sorted = windowTimes
    .slice()
    .sort((a, b) => (a === 'DNF' ? Infinity : a) - (b === 'DNF' ? Infinity : b));
  const kept = sorted.slice(trimCount, sorted.length - trimCount);
  const total = kept.reduce((sum, value) => sum + value, 0);
  return Math.round(total / kept.length);
}

function calculateAverageOf(windowSize) {
  if (savedTimes.length < windowSize) {
    return null;
  }
  return calculateTrimmedAverage(savedTimes.slice(-windowSize));
}

function getCurrentElapsed() {
  if (!running) {
    return elapsedMs;
  }
  return elapsedMs + (Date.now() - startTimestamp);
}

function canStart() {
  return !running && elapsedMs === 0;
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
  const formatted = formatMs(getCurrentElapsed());
  const [mainPart, msPart = '000'] = formatted.split('.');
  display.innerHTML = `<span class="time-main">${mainPart}</span><span class="time-decimals"><span class="time-sep">.</span><span class="time-ms">${msPart}</span></span>`;
}

function renderSaved() {
  if (savedTimes.length === 0) {
    savedListEl.innerHTML = '<li class="saved-empty">No saved times yet</li>';
  } else {
    const items = savedTimes
      .map((value, index) => {
        const valueClass = value === 'DNF' ? 'saved-line-value dnf' : 'saved-line-value';
        return `<li><span class="saved-line-label">#${index + 1}</span><span class="${valueClass}">${formatResult(value)}</span><button type="button" class="saved-line-delete" data-index="${index}" aria-label="Delete solve #${index + 1}">✕</button></li>`;
      })
      .join('');
    savedListEl.innerHTML = items;
  }

  setResultText(ao12El, calculateAverageOf(12));
  setResultText(ao50El, calculateAverageOf(50));
  setResultText(ao100El, calculateAverageOf(100));
  setResultText(averageEl, savedTimes.length < 5 ? null : calculateAverageOf(5));
}

function syncButtons() {
  const locked = !running && elapsedMs !== 0;
  startPauseBtn.textContent = running ? 'Stop' : 'Start';
  startPauseBtn.disabled = locked;
  saveBtn.disabled = running || getCurrentElapsed() === 0;
}

function tick() {
  renderDisplay();
  syncButtons();
  timerId = requestAnimationFrame(tick);
}

function start() {
  if (!canStart()) {
    return;
  }
  running = true;
  startTimestamp = Date.now();
  timerId = requestAnimationFrame(tick);
  syncButtons();
}

function pause() {
  if (!running) {
    return;
  }
  const currentElapsed = getCurrentElapsed();
  running = false;
  elapsedMs = currentElapsed;
  cancelAnimationFrame(timerId);
  timerId = null;
  renderDisplay();
  syncButtons();
}

function reset() {
  const hadPendingSolve = running || elapsedMs !== 0;
  pause();
  elapsedMs = 0;
  if (hadPendingSolve) {
    savedTimes.push('DNF');
    persistSavedTimes();
    renderSaved();
  }
  renderDisplay();
  syncButtons();
}

function saveCurrentTime() {
  if (running) {
    return;
  }
  const current = getCurrentElapsed();
  if (current === 0) {
    return;
  }
  savedTimes.push(current);
  persistSavedTimes();

  renderSaved();
  elapsedMs = 0;
  renderDisplay();
  syncButtons();
}

function clearSavedTimes() {
  savedTimes = [];
  persistSavedTimes();
  renderSaved();
}

function loadSavedTimes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value) => value === 'DNF' || (Number.isInteger(value) && value >= 0));
  } catch {
    return [];
  }
}

function persistSavedTimes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTimes));
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
  if (running) {
    pause();
  } else {
    start();
  }
});

resetBtn.addEventListener('click', reset);
saveBtn.addEventListener('click', saveCurrentTime);
clearBtn.addEventListener('click', clearSavedTimes);

savedListEl.addEventListener('click', (event) => {
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
    if (running) {
      pause();
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

