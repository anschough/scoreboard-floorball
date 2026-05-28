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
const btnPause       = document.getElementById('btnPause');
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

// ── Anslutningsstatus ────────────────────────────────────────────────────
socket.on('connect', () => {
  statusEl.textContent = 'Ansluten';
  statusEl.classList.remove('mc-status-off');
  statusEl.classList.add('mc-status-on');
});
socket.on('disconnect', () => {
  statusEl.textContent = 'Frånkopplad';
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
});

socket.on('clockTick',   ({ clock })   => { displayClock.textContent = clock; });
socket.on('clockStatus', ({ running }) => { updateClockButtons(running); });

function updateClockButtons(running) {
  btnStart.disabled = !!running;
  btnPause.disabled = !running;
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
btnStart.addEventListener('click', () => socket.emit('clockStart'));
btnPause.addEventListener('click', () => socket.emit('clockPause'));
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
