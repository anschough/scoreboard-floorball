/* ══════════════════════════════════════════════════════════════════════════
   MOBILE-CONTROL.JS
   Minimal mobil-kontroll. Bara: score, klocka, period.
   Återanvänder samma socket-events som control.js, så denna sida funkar i
   samma server-state utan ändringar i server.js.
═══════════════════════════════════════════════════════════════════════════ */

const socket = io();

// ── Element ──────────────────────────────────────────────────────────────
const statusEl       = document.getElementById('connection-status');

const labelA         = document.getElementById('labelA');
const labelB         = document.getElementById('labelB');
const displayScoreA  = document.getElementById('displayScoreA');
const displayScoreB  = document.getElementById('displayScoreB');

const displayClock   = document.getElementById('displayClock');
const btnStart       = document.getElementById('btnStart');
const btnReset       = document.getElementById('btnReset');
const btnClockMinus  = document.getElementById('btnClockMinus');
const btnClockPlus   = document.getElementById('btnClockPlus');
const btnClockSet    = document.getElementById('btnClockSet');
const inputClockSet  = document.getElementById('inputClockSet');
const inputClockSetHint = document.getElementById('inputClockSetHint');
const inputClockSetHintDefault = inputClockSetHint ? inputClockSetHint.textContent : '';

const periodDisplay  = document.getElementById('periodDisplay');
const btnPeriodNext  = document.getElementById('btnPeriodNext');
const btnPeriodReset = document.getElementById('btnPeriodReset');

// Resultat-synk – read-only display (styrs från control.html)
const scoreSyncModeEl = document.getElementById('scoreSyncMode');
const scoreSyncStatus = document.getElementById('scoreSyncStatus');
const scoreButtons    = document.querySelectorAll('.mc-btn-score');

// Period-synk – read-only display (styrs från control.html)
const periodSyncModeEl = document.getElementById('periodSyncMode');
const periodSyncStatus = document.getElementById('periodSyncStatus');

const SYNC_MODE_LABELS = {
  api:    'Hämtas från IBIS',
  manual: 'Hantera manuellt'
};

// ── Anslutningsstatus ────────────────────────────────────────────────────
socket.on('connect', () => {
  statusEl.textContent = 'Server ansluten';
  statusEl.classList.remove('mc-status-off');
  statusEl.classList.add('mc-status-on');
});
socket.on('disconnect', () => {
  statusEl.textContent = 'Server frånkopplad';
  statusEl.classList.remove('mc-status-on');
  statusEl.classList.add('mc-status-off');
});

// ── State-uppdatering (delas med control.html via stateUpdate-eventet) ──
socket.on('stateUpdate', (state) => {
  if (state.teamA) labelA.textContent = state.teamA;
  if (state.teamB) labelB.textContent = state.teamB;
  displayScoreA.textContent = state.scoreA;
  displayScoreB.textContent = state.scoreB;
  displayClock.textContent  = state.clock;
  updateClockButtons(state.clockRunning);
  const p = state.period || 1;
  periodDisplay.textContent = p <= 3 ? `Period ${p}` : p === 4 ? 'Övertid' : 'Straffar';
  applyScoreSyncState(state);
  applyPeriodSyncState(state);
});

socket.on('clockTick',   ({ clock })   => { displayClock.textContent = clock; });
socket.on('clockStatus', ({ running }) => { updateClockButtons(running); });

let clockRunning = false;
function updateClockButtons(running) {
  clockRunning = !!running;
  if (clockRunning) {
    btnStart.textContent = 'Stopp';
    btnStart.classList.remove('mc-btn-start');
    btnStart.classList.add('mc-btn-pause');
    btnStart.setAttribute('aria-label', 'Stoppa matchklockan');
  } else {
    btnStart.textContent = 'Starta';
    btnStart.classList.remove('mc-btn-pause');
    btnStart.classList.add('mc-btn-start');
    btnStart.setAttribute('aria-label', 'Starta matchklockan');
  }
}

// ── Score ────────────────────────────────────────────────────────────────
document.querySelectorAll('[data-team]').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('updateScore', {
      team:  btn.dataset.team,
      delta: parseInt(btn.dataset.delta, 10)
    });
  });
});

// ── Klocka ───────────────────────────────────────────────────────────────
// Toggle: när klockan är stoppad → Starta, när den går → Stopp (pausar).
btnStart.addEventListener('click', () => {
  socket.emit(clockRunning ? 'clockPause' : 'clockStart');
});
btnReset.addEventListener('click', () => socket.emit('clockReset'));
btnClockMinus.addEventListener('click', () => socket.emit('clockAdjust', { delta: -1 }));
btnClockPlus .addEventListener('click', () => socket.emit('clockAdjust', { delta:  1 }));

/** Parse matchtid → totala sekunder. Accepterar två format:
 *    "MM:SS" / "M:SS"  (med kolon)   → t.ex. "14:27", "1:27"
 *    "MMSS"  / "MSS"   (utan kolon)  → t.ex. "1427", "127" (sista 2 siffror = sek)
 *  Returnerar null vid ogiltigt format eller sekunder > 59. */
function parseMMSS(value) {
  const v = (value || '').trim();
  const colon = v.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const digits = v.match(/^(\d{1,2})(\d{2})$/);
  if (digits) {
    const sec = parseInt(digits[2], 10);
    if (sec > 59) return null;
    return parseInt(digits[1], 10) * 60 + sec;
  }
  return null;
}

function applyClockSet() {
  const sec = parseMMSS(inputClockSet.value);
  if (sec == null) {
    inputClockSet.classList.add('input-error');
    inputClockSet.setAttribute('aria-invalid', 'true');
    if (inputClockSetHint) {
      inputClockSetHint.textContent =
        'Ogiltigt format. Skriv tiden som 12:30 eller 1230.';
    }
    inputClockSet.focus();
    inputClockSet.select();
    setTimeout(() => {
      inputClockSet.classList.remove('input-error');
      inputClockSet.removeAttribute('aria-invalid');
      if (inputClockSetHint) inputClockSetHint.textContent = inputClockSetHintDefault;
    }, 1800);
    return;
  }
  socket.emit('clockSet', { seconds: sec });
  inputClockSet.value = '';
  inputClockSet.removeAttribute('aria-invalid');
  if (inputClockSetHint) inputClockSetHint.textContent = inputClockSetHintDefault;
  inputClockSet.blur();
}

btnClockSet.addEventListener('click', applyClockSet);
inputClockSet.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); applyClockSet(); }
});

// ── Period ───────────────────────────────────────────────────────────────
btnPeriodNext .addEventListener('click', () => socket.emit('periodNext'));
btnPeriodReset.addEventListener('click', () => socket.emit('periodReset'));

// ── Resultat-synk (IBIS API vs Manuell) ─────────────────────────────────
// Speglar samma UX som control.html: aktiv toggle, disabled score-knappar
// i API-mode, och statustext som visar synk-status från servern.
let latestScoreSyncStatus = null;
let latestScoreSyncMode   = 'api';
let latestSyncMatchId     = null;

// Mobil-vyn är read-only: aktiv resultatkälla speglas hit från
// kontrollpanelen via stateUpdate. Användaren kan inte byta mode härifrån
// – det görs på control.html. Därför ingen click-handler.

socket.on('scoreSyncStatus', (status) => {
  latestScoreSyncStatus = status || null;
  renderScoreSyncUI();
});

function applyScoreSyncState(state) {
  latestScoreSyncMode   = state.scoreSyncMode === 'manual' ? 'manual' : 'api';
  latestSyncMatchId     = state.syncMatchId || null;
  latestScoreSyncStatus = state.scoreSyncStatus || latestScoreSyncStatus;
  renderScoreSyncUI();
}

function renderScoreSyncUI() {
  if (scoreSyncModeEl) {
    scoreSyncModeEl.textContent = SYNC_MODE_LABELS[latestScoreSyncMode]
      || SYNC_MODE_LABELS.api;
    scoreSyncModeEl.dataset.mode = latestScoreSyncMode;
  }

  const disable = latestScoreSyncMode === 'api';
  scoreButtons.forEach(btn => {
    btn.disabled = disable;
    btn.setAttribute('aria-disabled', disable ? 'true' : 'false');
  });
  // I API-mode döljs knapparna helt – disabled-statet är då bara defensivt
  // skydd om man tabb:ar till en knapp via tangentbord.
  document.querySelector('.mc-score')?.classList.toggle('is-api-sync', disable);

  if (!scoreSyncStatus) return;
  scoreSyncStatus.classList.remove('is-ok', 'is-error');
  if (latestScoreSyncMode === 'manual') {
    scoreSyncStatus.textContent = 'Hanteras manuellt från kontrollpanelen eller här i liverapporteringen.';
    return;
  }
  if (!latestSyncMatchId) {
    scoreSyncStatus.textContent = 'Väntar på match från kontrollpanelen.';
    return;
  }
  if (latestScoreSyncStatus && latestScoreSyncStatus.ok) {
    const ts = formatSyncClock(latestScoreSyncStatus.ts);
    scoreSyncStatus.textContent = `Synkad ${ts} · uppdateras var 15:e sekund.`;
    scoreSyncStatus.classList.add('is-ok');
    return;
  }
  if (latestScoreSyncStatus && latestScoreSyncStatus.error) {
    scoreSyncStatus.textContent = `Synk-fel: ${latestScoreSyncStatus.error}`;
    scoreSyncStatus.classList.add('is-error');
    return;
  }
  scoreSyncStatus.textContent = 'Hämtar från IBIS…';
}

function formatSyncClock(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── Period-synk (IBIS API vs Manuell) ───────────────────────────────────
// Read-only spegling från control.html: disabling av Nästa period/Återställ
// när IBIS-synk är aktiv så att operatören inte tror att knappen gör något.
let latestPeriodSyncStatus = null;
let latestPeriodSyncMode   = 'api';

socket.on('periodSyncStatus', (status) => {
  latestPeriodSyncStatus = status || null;
  renderPeriodSyncUI();
});

function applyPeriodSyncState(state) {
  latestPeriodSyncMode   = state.periodSyncMode === 'manual' ? 'manual' : 'api';
  latestPeriodSyncStatus = state.periodSyncStatus || latestPeriodSyncStatus;
  renderPeriodSyncUI();
}

function renderPeriodSyncUI() {
  if (periodSyncModeEl) {
    periodSyncModeEl.textContent = SYNC_MODE_LABELS[latestPeriodSyncMode]
      || SYNC_MODE_LABELS.api;
    periodSyncModeEl.dataset.mode = latestPeriodSyncMode;
  }

  const disable = latestPeriodSyncMode === 'api';
  [btnPeriodNext, btnPeriodReset].forEach(btn => {
    if (!btn) return;
    btn.disabled = disable;
    btn.setAttribute('aria-disabled', disable ? 'true' : 'false');
  });

  if (!periodSyncStatus) return;
  periodSyncStatus.classList.remove('is-ok', 'is-error');
  if (latestPeriodSyncMode === 'manual') {
    periodSyncStatus.textContent = 'Hanteras manuellt från kontrollpanelen eller här i liverapporteringen.';
    return;
  }
  if (!latestSyncMatchId) {
    periodSyncStatus.textContent = 'Väntar på match från kontrollpanelen.';
    return;
  }
  if (latestPeriodSyncStatus && latestPeriodSyncStatus.ok) {
    const ts = formatSyncClock(latestPeriodSyncStatus.ts);
    periodSyncStatus.textContent = `Synkad ${ts} · uppdateras var 15:e sekund.`;
    periodSyncStatus.classList.add('is-ok');
    return;
  }
  if (latestPeriodSyncStatus && latestPeriodSyncStatus.error) {
    periodSyncStatus.textContent = `Synk-fel: ${latestPeriodSyncStatus.error}`;
    periodSyncStatus.classList.add('is-error');
    return;
  }
  periodSyncStatus.textContent = 'Hämtar från IBIS…';
}
