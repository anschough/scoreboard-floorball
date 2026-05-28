const socket = io();

// ════════════════════════════════════════════════════════════════════════════
// DOM-REFERENSER
// ════════════════════════════════════════════════════════════════════════════

const statusEl   = document.getElementById('connection-status');

// Bildmixer (sticky header)
const mixerBtns  = document.querySelectorAll('.mixer-btn');

// Resultat-synk-toggle
const scoreSyncBtns   = document.querySelectorAll('.score-sync-btn');
const scoreSyncStatus = document.getElementById('scoreSyncStatus');
const periodSyncBtns   = document.querySelectorAll('.period-sync-btn');
const periodSyncStatus = document.getElementById('periodSyncStatus');
const scoreButtons    = document.querySelectorAll('.btn-score-xl');

// Flik 1 – Scoreboard
const inputTeamA       = document.getElementById('inputTeamA');
const inputTeamB       = document.getElementById('inputTeamB');
const inputTeamAShort  = document.getElementById('inputTeamAShort');
const inputTeamBShort  = document.getElementById('inputTeamBShort');
const btnUpdateNames   = document.getElementById('btnUpdateNames');
const labelA         = document.getElementById('labelA');
const labelB         = document.getElementById('labelB');
const displayScoreA  = document.getElementById('displayScoreA');
const displayScoreB  = document.getElementById('displayScoreB');
const displayClock   = document.getElementById('displayClock');
const btnStart       = document.getElementById('btnStart');
const btnReset       = document.getElementById('btnReset');
const btnToggleClock = document.getElementById('btnToggleClock');

// Kommentatorer
const inputCommentator1 = document.getElementById('inputCommentator1');
const inputCommentator2 = document.getElementById('inputCommentator2');
const btnSaveCommentators = document.getElementById('btnSaveCommentators');

// Spelplats (för matchup-skylten)
const inputVenue   = document.getElementById('inputVenue');
const btnSaveVenue = document.getElementById('btnSaveVenue');

// Nollställ match
const btnResetMatch = document.getElementById('btnResetMatch');

// Period
const periodDisplay  = document.getElementById('periodDisplay');
const btnPeriodNext  = document.getElementById('btnPeriodNext');
const btnPeriodReset = document.getElementById('btnPeriodReset');

// Utvisningar
const penaltyHomeList  = document.getElementById('penaltyHomeList');
const penaltyAwayList  = document.getElementById('penaltyAwayList');
const penaltyHomeCount = document.getElementById('penaltyHomeCount');
const penaltyAwayCount = document.getElementById('penaltyAwayCount');
const inputPenaltyHomeJersey = document.getElementById('inputPenaltyHomeJersey');
const inputPenaltyAwayJersey = document.getElementById('inputPenaltyAwayJersey');

// Flik 2 – Hämta all data (en URL → match + tabell)
const urlMatchAll       = document.getElementById('urlMatchAll');
const btnFetchAll       = document.getElementById('btnFetchAll');
const fetchStatusAll    = document.getElementById('fetchStatusAll');

// Förhandsvisning hemma + borta (fylls av kombinerad fetch)
const previewInnebandyLineup = document.getElementById('previewInnebandyLineup');
const previewIbHomeName      = document.getElementById('previewIbHomeName');
const previewIbAwayName      = document.getElementById('previewIbAwayName');
const previewIbHomeList      = document.getElementById('previewIbHomeList');
const previewIbAwayList      = document.getElementById('previewIbAwayList');
const previewIbHomeCount     = document.getElementById('previewIbHomeCount');
const previewIbAwayCount     = document.getElementById('previewIbAwayCount');
const btnSendIbHome          = document.getElementById('btnSendIbHome');
const btnSendIbAway          = document.getElementById('btnSendIbAway');
const previewIbHomeLeadersWrap = document.getElementById('previewIbHomeLeadersWrap');
const previewIbAwayLeadersWrap = document.getElementById('previewIbAwayLeadersWrap');
const previewIbHomeLeadersList = document.getElementById('previewIbHomeLeadersList');
const previewIbAwayLeadersList = document.getElementById('previewIbAwayLeadersList');

// Flik 3 – Tabell-förhandsvisning (fylls av kombinerad fetch)
const previewInnebandyTable      = document.getElementById('previewInnebandyTable');
const previewInnebandyTableCount = document.getElementById('previewInnebandyTableCount');
const previewInnebandyTableBody  = document.getElementById('previewInnebandyTableBody');
const btnClearInnebandyTable     = document.getElementById('btnClearInnebandyTable');
const btnSendInnebandyTable      = document.getElementById('btnSendInnebandyTable');

// Flik 3 – Fixtures-förhandsvisning
const previewFixtures      = document.getElementById('previewFixtures');
const previewFixturesCount = document.getElementById('previewFixturesCount');
const previewFixturesList  = document.getElementById('previewFixturesList');
const btnClearFixtures     = document.getElementById('btnClearFixtures');
const btnSendFixtures      = document.getElementById('btnSendFixtures');

// Live-monitor (read-only) – speglar grafikens ticker + omgångens resultat
const liveMonitorBox = document.getElementById('liveMonitorBox');
const tickerFeedList = document.getElementById('tickerFeedList');
const liveResultsList = document.getElementById('liveResultsList');

// Flik 3 – Statistik inför match-förhandsvisning (read-only)
const previewPreGame      = document.getElementById('previewPreGame');
const pgPreviewHomeName   = document.getElementById('pgPreviewHomeName');
const pgPreviewAwayName   = document.getElementById('pgPreviewAwayName');
const pgPreviewBody       = document.getElementById('pgPreviewBody');
const btnClearPreGame     = document.getElementById('btnClearPreGame');
const btnSendPreGame      = document.getElementById('btnSendPreGame');

// ════════════════════════════════════════════════════════════════════════════
// LOKAL STATE – skrapad data som väntar på att skickas live
// ════════════════════════════════════════════════════════════════════════════
let pendingInnebandyTable = { name: '', rows: [] };
let pendingIbHome         = { name: '', players: [], leaders: [] };
let pendingIbAway         = { name: '', players: [], leaders: [] };
let pendingFixtures       = { title: '', fixtures: [] };
let pendingPreGameStats   = null;
// Live-monitor: rullande buffert av senaste ticker-mål (nyaste först)
const TICKER_FEED_MAX     = 8;
let tickerFeed            = [];
// Omgångens matcher + live-status (matchId → live-objekt från IBIS-pollen)
let currentRoundFixtures  = [];
let liveStatusMap         = new Map();
let liveSeriesTimer       = null;
// Senast valda spelar-/ledar-skylt – för visuell highlight + toggle
let activeLowerThirdKey = '';

// ════════════════════════════════════════════════════════════════════════════
// BILDMIXER – direktväxling till valfri grafik
// ════════════════════════════════════════════════════════════════════════════
mixerBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('switchGraphic', { to: btn.dataset.graphic });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PERIOD-KONTROLLER
// ════════════════════════════════════════════════════════════════════════════
btnPeriodNext.addEventListener('click',  () => socket.emit('periodNext'));
btnPeriodReset.addEventListener('click', () => socket.emit('periodReset'));

// ════════════════════════════════════════════════════════════════════════════
// UTVISNINGAR
// ════════════════════════════════════════════════════════════════════════════

/** "M:SS" format för utvisnings-nedräkning (1:54, 0:08, 4:59) */
function formatPenaltyTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// Tid för exit-animationen i CSS (.penalty-row.is-removing keyframe).
// Hellre setTimeout än animationend: animationend är opålitlig när
// keyframes animerar non-animatable värden (max-height: auto → 0) och kan
// uteblir helt → raden fastnar i DOM med .is-removing klass för alltid.
const PENALTY_EXIT_MS = 240;

/**
 * Renderar en utvisningslista. Diffar mot DOM så befintliga rader bara
 * uppdaterar text (ingen flash) och borttagna rader animeras ut innan
 * de tas bort. Nya rader animeras in via CSS .penalty-row.
 */
function renderPenaltyList(listEl, penalties) {
  const incomingIds = new Set(penalties.map(p => String(p.id)));

  // Steg 1: ta bort rader som inte längre finns i state. Hoppa över alla
  // li:s som inte är .penalty-row (t.ex. .penalty-empty), annars skulle de
  // klassas som "ej i state" och få .is-removing utan motsvarande timer.
  Array.from(listEl.children).forEach(li => {
    if (!li.classList.contains('penalty-row')) return;
    if (li.classList.contains('is-removing')) return;
    if (!incomingIds.has(li.dataset.id)) {
      li.classList.add('is-removing');
      setTimeout(() => li.remove(), PENALTY_EXIT_MS);
    }
  });

  // Steg 2: skapa eller uppdatera rader för varje aktiv utvisning
  penalties.forEach(p => {
    let li = listEl.querySelector(`li[data-id="${p.id}"]:not(.is-removing)`);
    if (!li) {
      li = document.createElement('li');
      li.className = 'penalty-row';
      li.dataset.id = String(p.id);
      li.innerHTML = `
        <span class="penalty-row-jersey"></span>
        <span class="penalty-row-time"></span>
        <button class="btn-penalty-remove" title="Ta bort utvisning" aria-label="Ta bort utvisning"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>`;
      listEl.appendChild(li);
    }
    const isQueued = p.status === 'queued';
    li.classList.toggle('is-queued', isQueued);
    li.querySelector('.penalty-row-jersey').textContent = p.jersey ? `#${p.jersey}` : '';
    li.querySelector('.penalty-row-time').textContent   = isQueued
      ? `VÄNTAR · ${formatPenaltyTime(p.duration)}`
      : formatPenaltyTime(p.remaining);
  });

  // Steg 3: rendera/städa tom-läge som en riktig <li> så skärmläsare hör
  // texten i stället för att möta en tom lista.
  const hasRows  = !!listEl.querySelector('.penalty-row:not(.is-removing)');
  let emptyLi    = listEl.querySelector('.penalty-empty');
  if (!hasRows && !emptyLi) {
    emptyLi = document.createElement('li');
    emptyLi.className   = 'penalty-empty';
    emptyLi.textContent = 'Inga aktiva';
    listEl.appendChild(emptyLi);
  } else if (hasRows && emptyLi) {
    emptyLi.remove();
  }
}

// Måste matcha MAX_PENALTIES_PER_TEAM i server.js (räknas i grupper)
const MAX_PENALTIES_PER_TEAM = 2;

// Räkna utvisningsgrupper: en 2+2 (poster med samma pairId) = 1 grupp.
function countPenaltyGroups(arr) {
  const pairs = new Set();
  let n = 0;
  for (const p of arr) {
    if (p.pairId) {
      if (!pairs.has(p.pairId)) { pairs.add(p.pairId); n++; }
    } else {
      n++;
    }
  }
  return n;
}

function updatePenaltyCounts(home, away) {
  // Visar antal AKTIVA + antal köade (om några), så operatören vet
  // direkt om en utvisning ligger och väntar bakom kulisserna.
  const fmt = (arr) => {
    const active = arr.filter(p => p.status !== 'queued').length;
    const queued = arr.filter(p => p.status === 'queued').length;
    const base   = `${active} aktiv${active === 1 ? '' : 'a'}`;
    return queued > 0 ? `${base} · ${queued} i kö` : base;
  };
  penaltyHomeCount.textContent = fmt(home);
  penaltyAwayCount.textContent = fmt(away);
  // Disabla knappar när cap (2 grupper) är nådd. En 2+2 räknas som 1 grupp.
  updatePenaltyButtons('home', home);
  updatePenaltyButtons('away', away);
}

function updatePenaltyButtons(team, arr) {
  const groups = countPenaltyGroups(arr);
  const full   = groups >= MAX_PENALTIES_PER_TEAM;
  document.querySelectorAll(`.btn-penalty[data-team="${team}"]`).forEach(btn => {
    btn.disabled = full;
    btn.title = full
      ? `Lagets utvisningar fulla (${groups}/${MAX_PENALTIES_PER_TEAM})`
      : (btn.dataset.kind === 'double'
          ? '2+2: lägger två 2-min där andra startar när första går ut'
          : '');
  });
}

function applyPenalties(home, away) {
  renderPenaltyList(penaltyHomeList, home || []);
  renderPenaltyList(penaltyAwayList, away || []);
  updatePenaltyCounts(home || [], away || []);
}

// Klick-delegering för +2/+2+2/+5-knappar (oavsett vilket lag).
// data-kind="double" → 2+2 (servern lägger till två 2-min, andra queued).
document.querySelectorAll('.btn-penalty').forEach(btn => {
  btn.addEventListener('click', () => {
    const team    = btn.dataset.team;
    const kind    = btn.dataset.kind || 'single';
    const minutes = parseInt(btn.dataset.minutes, 10);
    const jerseyInput = team === 'home' ? inputPenaltyHomeJersey : inputPenaltyAwayJersey;
    const jersey = jerseyInput.value.trim();
    if (kind === 'double') {
      socket.emit('penaltyAdd', { team, kind: 'double', jersey });
    } else {
      socket.emit('penaltyAdd', { team, minutes, jersey });
    }
    // Töm tröjnummer-fältet så nästa utvisning börjar tomt
    jerseyInput.value = '';
  });
});

// Klick-delegering för röd X-knapp (eventet bubblar upp till listan)
[penaltyHomeList, penaltyAwayList].forEach(list => {
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-penalty-remove');
    if (!btn) return;
    const li = btn.closest('li.penalty-row');
    if (!li) return;
    const team = list === penaltyHomeList ? 'home' : 'away';
    const id   = parseInt(li.dataset.id, 10);
    if (!Number.isFinite(id)) return;
    socket.emit('penaltyRemove', { team, id });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TIME-OUT
// ════════════════════════════════════════════════════════════════════════════
const btnTimeOutHome  = document.getElementById('btnTimeOutHome');
const btnTimeOutAway  = document.getElementById('btnTimeOutAway');
const btnTimeOutClear = document.getElementById('btnTimeOutClear');
const elTimeOutStatus = document.getElementById('timeoutStatus');

// Senast kända lagnamn så vi kan visa "Hemma · LAG A" i statusrutan
let latestTeamA = 'Hemma';
let latestTeamB = 'Borta';

function renderTimeOutStatus(timeOut) {
  if (!elTimeOutStatus) return;
  if (!timeOut) {
    elTimeOutStatus.classList.remove('is-active');
    elTimeOutStatus.innerHTML = '<span class="timeout-status-empty">Ingen aktiv time-out</span>';
    [btnTimeOutHome, btnTimeOutAway].forEach(b => b && (b.disabled = false));
    if (btnTimeOutClear) btnTimeOutClear.disabled = true;
    return;
  }
  const teamLabel = timeOut.team === 'home' ? `Hemma · ${latestTeamA}` : `Borta · ${latestTeamB}`;
  const isFinal   = timeOut.remaining <= 5;
  elTimeOutStatus.classList.add('is-active');
  elTimeOutStatus.innerHTML = `
    <span class="timeout-status-team">${teamLabel}</span>
    <span class="timeout-status-count${isFinal ? ' is-final' : ''}">${timeOut.remaining} s</span>`;
  // Bara en time-out åt gången – disabla start-knappar tills den avslutats
  [btnTimeOutHome, btnTimeOutAway].forEach(b => b && (b.disabled = true));
  if (btnTimeOutClear) btnTimeOutClear.disabled = false;
}

[btnTimeOutHome, btnTimeOutAway].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const team = btn.dataset.team;
    socket.emit('timeOutStart', { team });
    // Visa grafiken direkt – samma one-click-UX som Stream Deck-rutten
    socket.emit('switchGraphic', { to: 'timeout' });
  });
});
if (btnTimeOutClear) {
  btnTimeOutClear.addEventListener('click', () => {
    socket.emit('timeOutClear');
    socket.emit('switchGraphic', { to: 'scoreboard' });
  });
}

socket.on('timeOutUpdate', ({ timeOut } = {}) => {
  renderTimeOutStatus(timeOut);
});

// Riktade penalty-uppdateringar (kommer varje sekund från klock-loopen
// när utvisningar är aktiva). Använder samma render som stateUpdate så
// inga element rebuildas i onödan.
socket.on('penaltiesUpdate', ({ penaltiesHome, penaltiesAway }) => {
  applyPenalties(penaltiesHome, penaltiesAway);
});

// ════════════════════════════════════════════════════════════════════════════
// AKTIV GRAFIK-INDIKATOR
// ════════════════════════════════════════════════════════════════════════════

/** Speglar live-statusen till .on-air + aria-pressed på rätt mixer-knapp så
 *  skärmläsare kan höra vilken grafik som är aktiv (R3). */
function updateActiveIndicator(key) {
  // Mappa 'none' (= göm allt) till mixerns 'clear'-knapp för visuell ON AIR
  const mixerKey = key === 'none' ? 'clear' : key;
  mixerBtns.forEach(btn => {
    const isActive = btn.dataset.graphic === mixerKey;
    btn.classList.toggle('on-air', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SOCKET – ANSLUTNING
// ════════════════════════════════════════════════════════════════════════════
socket.on('connect', () => {
  statusEl.textContent = 'Server ansluten';
  statusEl.className   = 'status connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Server frånkopplad';
  statusEl.className   = 'status disconnected';
});

// ════════════════════════════════════════════════════════════════════════════
// SOCKET – STATE-UPPDATERINGAR (inkommande)
// ════════════════════════════════════════════════════════════════════════════

socket.on('stateUpdate', (state) => {
  // Hydrera fullnamn + kortnamn, men inte om input är fokuserad
  // (så användaren inte får sin skrivning överskriven).
  if (document.activeElement !== inputTeamA)      inputTeamA.value      = state.teamA;
  if (document.activeElement !== inputTeamB)      inputTeamB.value      = state.teamB;
  if (document.activeElement !== inputTeamAShort) inputTeamAShort.value = state.teamAShort || '';
  if (document.activeElement !== inputTeamBShort) inputTeamBShort.value = state.teamBShort || '';
  labelA.textContent        = state.teamA;
  labelB.textContent        = state.teamB;
  // Cache:a lagnamn så time-out-statusrutan kan visa "Hemma · LAG A"
  latestTeamA = state.teamA || 'Hemma';
  latestTeamB = state.teamB || 'Borta';
  displayScoreA.textContent = state.scoreA;
  displayScoreB.textContent = state.scoreB;
  displayClock.textContent  = state.clock;
  updateClockButtons(state.clockRunning);
  updateClockToggleButton(state.clockVisible !== false);
  // Period-display i live-kolumnen
  if (periodDisplay) {
    const p = state.period || 1;
    periodDisplay.textContent = p <= 3 ? `Period ${p}` : p === 4 ? 'Övertid' : 'Straffar';
  }

  // Kommentatorer + venue – hydrera bara om input INTE är fokuserad
  // så användaren inte får sin skrivning överskriven av en stateUpdate.
  const c = state.commentators || { name1: '', name2: '' };
  if (document.activeElement !== inputCommentator1) inputCommentator1.value = c.name1 || '';
  if (document.activeElement !== inputCommentator2) inputCommentator2.value = c.name2 || '';
  if (document.activeElement !== inputVenue)        inputVenue.value        = state.venue || '';

  // Hydrera previews från server-state. Datan finns kvar i matchState mellan
  // sid-omladdningar, så previews dyker upp automatiskt om data finns.
  hydratePreviewsFromState(state);

  // Utvisningar – speglar server-state. Kallas vid initial connect och varje
  // gång state ändras icke-relaterat till klocktick (penaltiesUpdate sköter
  // sekund-för-sekund-uppdateringen så den här gör ingen flash).
  applyPenalties(state.penaltiesHome, state.penaltiesAway);

  // Hydrera time-out-status (för operatör som ansluter mitt under en pågående)
  renderTimeOutStatus(state.timeOut);

  // Resultat-synk – toggle-status + score-knapp-disable
  applyScoreSyncState(state);
  // Period-synk – toggle-status + period-knapp-disable
  applyPeriodSyncState(state);
});

socket.on('clockTick',   ({ clock })   => { displayClock.textContent = clock; });
socket.on('clockStatus', ({ running }) => { updateClockButtons(running); });

let clockRunning = false;
function updateClockButtons(running) {
  clockRunning = !!running;
  if (clockRunning) {
    btnStart.textContent = 'Stopp';
    btnStart.classList.remove('btn-start');
    btnStart.classList.add('btn-pause');
    btnStart.setAttribute('aria-label', 'Stoppa matchklockan');
  } else {
    btnStart.textContent = 'Starta';
    btnStart.classList.remove('btn-pause');
    btnStart.classList.add('btn-start');
    btnStart.setAttribute('aria-label', 'Starta matchklockan');
  }
}

/** graphicState – återställ indikator vid anslutning/sidladdning */
socket.on('graphicState', ({ activeGraphic }) => {
  updateActiveIndicator(activeGraphic);
});

/** switchGraphic – synkronisera indikator när annan klient byter grafik */
socket.on('switchGraphic', ({ to }) => {
  updateActiveIndicator(to);
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTAT-SYNK (Innebandy API vs Manuell)
// ════════════════════════════════════════════════════════════════════════════

/** Senaste kända syncStatus, så vi kan re-rendera när mode växlar utan
 *  att vänta på nästa stateUpdate. */
let latestScoreSyncStatus = null;
let latestScoreSyncMode   = 'api';
let latestSyncMatchId     = null;

scoreSyncBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode !== 'api' && mode !== 'manual') return;
    if (mode === latestScoreSyncMode) return;
    socket.emit('setScoreSyncMode', { mode });
  });
});

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
  // Markera aktiv toggle-knapp
  scoreSyncBtns.forEach(btn => {
    const active = btn.dataset.mode === latestScoreSyncMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  // Inaktivera +/− i API-mode (även när ingen match är hämtad – då finns
  // ändå inget att räkna med och status-texten förklarar varför).
  const disable = latestScoreSyncMode === 'api';
  scoreButtons.forEach(btn => {
    btn.disabled = disable;
    btn.setAttribute('aria-disabled', disable ? 'true' : 'false');
  });
  // I API-mode döljs knapparna helt – disabled-statet är då bara defensivt
  // skydd om man tabb:ar till en knapp via tangentbord.
  document.querySelector('.score-board-xl')?.classList.toggle('is-api-sync', disable);

  // Status-text
  if (!scoreSyncStatus) return;
  scoreSyncStatus.classList.remove('is-ok', 'is-error');
  if (latestScoreSyncMode === 'manual') {
    scoreSyncStatus.textContent = 'Manuell hantering – använd +1/−1.';
    return;
  }
  if (!latestSyncMatchId) {
    scoreSyncStatus.textContent = 'Hämta data från IBIS för att starta synkronisering av matchresultat.';
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
  scoreSyncStatus.textContent = 'Hämtar från Innebandy API…';
}

// ════════════════════════════════════════════════════════════════════════════
// PERIOD-SYNK (Innebandy API vs Manuell)
// ════════════════════════════════════════════════════════════════════════════
// Speglar score-synken: 'api' = perioden plockas från IBIS (samma poll som
// score), 'manual' = Nästa period/Återställ styr. I api-mode disablas knapparna.

let latestPeriodSyncStatus = null;
let latestPeriodSyncMode   = 'api';

periodSyncBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode !== 'api' && mode !== 'manual') return;
    if (mode === latestPeriodSyncMode) return;
    socket.emit('setPeriodSyncMode', { mode });
  });
});

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
  periodSyncBtns.forEach(btn => {
    const active = btn.dataset.mode === latestPeriodSyncMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  // I api-mode blockerar servern manuella periodbyten ändå — disabling
  // av knapparna ger ett synligt och åtkomstvänligt skydd.
  const disable = latestPeriodSyncMode === 'api';
  [btnPeriodNext, btnPeriodReset].forEach(btn => {
    if (!btn) return;
    btn.disabled = disable;
    btn.setAttribute('aria-disabled', disable ? 'true' : 'false');
  });

  if (!periodSyncStatus) return;
  periodSyncStatus.classList.remove('is-ok', 'is-error');
  if (latestPeriodSyncMode === 'manual') {
    periodSyncStatus.textContent = 'Manuell hantering – använd Nästa period/Återställ.';
    return;
  }
  if (!latestSyncMatchId) {
    periodSyncStatus.textContent = 'Hämta data från IBIS för att starta synkronisering av period.';
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
  periodSyncStatus.textContent = 'Hämtar från Innebandy API…';
}


function formatSyncClock(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ════════════════════════════════════════════════════════════════════════════
// FLIK 1 – SCOREBOARD
// ════════════════════════════════════════════════════════════════════════════

btnUpdateNames.addEventListener('click', () => {
  socket.emit('updateNames', {
    teamA:      inputTeamA.value.trim(),
    teamB:      inputTeamB.value.trim(),
    teamAShort: inputTeamAShort.value.trim(),
    teamBShort: inputTeamBShort.value.trim()
  });
});

[inputTeamA, inputTeamB, inputTeamAShort, inputTeamBShort].forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') btnUpdateNames.click(); });
});

document.querySelectorAll('[data-team]').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('updateScore', {
      team:  btn.dataset.team,
      delta: parseInt(btn.dataset.delta, 10)
    });
  });
});

// Toggle: när klockan är stoppad → Starta, när den går → Stopp (pausar).
btnStart.addEventListener('click', () => {
  socket.emit(clockRunning ? 'clockPause' : 'clockStart');
});
btnReset.addEventListener('click', () => socket.emit('clockReset'));
btnToggleClock.addEventListener('click', () => socket.emit('toggleClockVisibility'));

/** Manuell tidsjustering – ±1 s eller absolut MM:SS via textfältet */
const btnClockMinus = document.getElementById('btnClockMinus');
const btnClockPlus  = document.getElementById('btnClockPlus');
const btnClockSet   = document.getElementById('btnClockSet');
const inputClockSet = document.getElementById('inputClockSet');

btnClockMinus.addEventListener('click', () => socket.emit('clockAdjust', { delta: -1 }));
btnClockPlus .addEventListener('click', () => socket.emit('clockAdjust', { delta:  1 }));

/** Parse matchtid → totala sekunder. Accepterar två format:
 *    "MM:SS" / "M:SS"  (med kolon)   → t.ex. "14:27", "1:27"
 *    "MMSS"  / "MSS"   (utan kolon)  → t.ex. "1427", "127" (sista 2 siffror = sek)
 *  Returnerar null vid ogiltigt format eller sekunder > 59. */
function parseMMSS(value) {
  const v = (value || '').trim();
  // Kolon-format: 1–2 minuter, 1–2 sekunder (sek 00–59)
  const colon = v.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  // Sifferformat: 3–4 siffror, sista 2 = sekunder, resterande = minuter
  const digits = v.match(/^(\d{1,2})(\d{2})$/);
  if (digits) {
    const sec = parseInt(digits[2], 10);
    if (sec > 59) return null;
    return parseInt(digits[1], 10) * 60 + sec;
  }
  return null;
}

// Behåller standard-hjälptexten så vi kan återställa den efter ett fel.
const inputClockSetHint = document.getElementById('inputClockSetHint');
const inputClockSetHintDefault = inputClockSetHint ? inputClockSetHint.textContent : '';

function applyClockSet() {
  const sec = parseMMSS(inputClockSet.value);
  if (sec == null) {
    // Visuell + programmatisk feedback för ogiltigt format. aria-invalid +
    // uppdaterad hint via aria-describedby gör att skärmläsare hör orsaken
    // till skakningen i stället för bara den röda kanten.
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
// När fältet får fokus: förifyll med nuvarande klocktid så det är lätt att
// finjustera istället för att skriva från noll.
inputClockSet.addEventListener('focus', () => {
  if (!inputClockSet.value) {
    inputClockSet.value = displayClock.textContent || '';
    inputClockSet.select();
  }
});

/** Uppdaterar knappens text + visuella state baserat på clockVisible */
function updateClockToggleButton(visible) {
  if (visible) {
    btnToggleClock.textContent = 'Dölj klockan';
    btnToggleClock.classList.remove('is-hidden');
  } else {
    btnToggleClock.textContent = 'Visa klockan';
    btnToggleClock.classList.add('is-hidden');
  }
}

// ── Kommentatorer ────────────────────────────────────────────────────────
btnSaveCommentators.addEventListener('click', () => {
  socket.emit('updateCommentators', {
    name1: inputCommentator1.value.trim(),
    name2: inputCommentator2.value.trim()
  });
});
[inputCommentator1, inputCommentator2].forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') btnSaveCommentators.click(); });
});

// ── Venue ────────────────────────────────────────────────────────────────
btnSaveVenue.addEventListener('click', () => {
  socket.emit('updateMatchMeta', { venue: inputVenue.value.trim() });
});
inputVenue.addEventListener('keydown', e => { if (e.key === 'Enter') btnSaveVenue.click(); });

// ── Nollställ match ──────────────────────────────────────────────────────
btnResetMatch.addEventListener('click', () => {
  const ok = window.confirm(
    'Detta tömmer ALL matchdata på servern: lagnamn, poäng, klocka, period, ' +
    'uppställningar, tabell, omgång, kommentatorer och spelplats.\n\n' +
    'Är du säker?'
  );
  if (!ok) return;
  socket.emit('resetMatchState');
});

// Lyssna på reset-event från servern: rensa lokala previews + pending state
socket.on('matchStateReset', () => {
  pendingInnebandyTable = { name: '', rows: [] };
  pendingIbHome         = { name: '', players: [], leaders: [] };
  pendingIbAway         = { name: '', players: [], leaders: [] };
  pendingFixtures       = { title: '', fixtures: [] };
  activeLowerThirdKey   = '';
  previewInnebandyLineup.hidden = true;
  previewInnebandyTable.hidden  = true;
  previewFixtures.hidden        = true;
  previewPreGame.hidden         = true;
  pendingPreGameStats           = null;
  previewIbHomeLeadersWrap.hidden = true;
  previewIbAwayLeadersWrap.hidden = true;
  if (fetchStatusAll) setStatus(fetchStatusAll, '');
  if (urlMatchAll) urlMatchAll.value = '';
  try { localStorage.removeItem(LS_URL_KEY); } catch (_) {}
  // Nollställ hydreringscache så nästa match säkert får färska renders
  lastHydrateLineupHome = '';
  lastHydrateLineupAway = '';
  lastHydrateTable      = '';
  lastHydrateFixtures   = '';
  lastHydratePreGame    = '';
  // Live-monitor: töm ticker-feed + resultat + stoppa pollning
  tickerFeed = [];
  renderTickerFeed();
  currentRoundFixtures = [];
  stopLiveSeriesPoll();
  if (liveResultsList) liveResultsList.innerHTML = '';
  refreshLiveMonitorVisibility();
});

// ════════════════════════════════════════════════════════════════════════════
// HJÄLPFUNKTIONER – Förhandsvisning
// ════════════════════════════════════════════════════════════════════════════

/** Sätter status-text med CSS-klass för färgkodning */
function setStatus(el, text, type = '') {
  el.textContent  = text;
  el.className    = `fetch-status${type ? ` ${type}` : ''}`;
}

/** Sätt om det är klickbart från context (team + teamName).
 *  IBIS-data (player) escape:as innan den sätts via innerHTML. */
function renderPreviewPlayers(containerEl, players, ctx) {
  containerEl.innerHTML = '';
  const clickable = !!(ctx && ctx.team);
  players.forEach(player => {
    const div   = document.createElement('div');
    div.className = 'preview-player' + (clickable ? ' is-clickable' : '');

    // Spelare är objekt { shirtNo, name, imageUrl } från servern. Stötta även
    // ren-sträng-formatet som fallback ifall någon legacy-bana skickar in det.
    let number = '';
    let name   = '';
    if (player && typeof player === 'object') {
      number = player.shirtNo ? String(player.shirtNo) : '';
      name   = player.name || '';
    } else if (typeof player === 'string') {
      const parts  = player.trim().split(/\s+/);
      const hasNum = parts.length > 1 && /^\d+$/.test(parts[0]);
      if (hasNum) { number = parts.shift(); name = parts.join(' '); }
      else        { name   = player; }
    }

    if (number) {
      div.innerHTML = `<span class="preview-player-num">${escapeHtml(number)}</span>${escapeHtml(name)}`;
    } else {
      div.textContent = name;
    }

    if (clickable) {
      div.dataset.team     = ctx.team;
      div.dataset.teamName = ctx.teamName || '';
      div.dataset.number   = number;
      div.dataset.name     = name;
      div.dataset.role     = '';
      div.dataset.ltKey    = `${ctx.team}|p|${number}|${name}`;
      div.title = `Klicka för att visa skylt: ${number ? `#${number} ` : ''}${name}`;
    }
    containerEl.appendChild(div);
  });
  applyActiveLowerThirdHighlight();
}

/** Renderar ledare/staff under spelarlistan (samma look + klickbarhet).
 *  IBIS-data escape:as innan den sätts via innerHTML. */
function renderPreviewLeaders(wrapEl, listEl, leaders, ctx) {
  listEl.innerHTML = '';
  if (!leaders || !leaders.length) {
    wrapEl.hidden = true;
    return;
  }
  wrapEl.hidden = false;
  const clickable = !!(ctx && ctx.team);
  leaders.forEach(l => {
    const div = document.createElement('div');
    div.className = 'preview-player' + (clickable ? ' is-clickable' : '');
    const role = (l.role || '').trim();
    const name = (l.name || '').trim();
    div.innerHTML = `<span class="preview-player-role">${escapeHtml(role)}</span>${escapeHtml(name)}`;
    if (clickable) {
      div.dataset.team     = ctx.team;
      div.dataset.teamName = ctx.teamName || '';
      div.dataset.number   = '';
      div.dataset.name     = name;
      div.dataset.role     = role;
      div.dataset.ltKey    = `${ctx.team}|l|${role}|${name}`;
      div.title = `Klicka för att visa skylt: ${role ? `${role} – ` : ''}${name}`;
    }
    listEl.appendChild(div);
  });
  applyActiveLowerThirdHighlight();
}

/** Markerar den rad som motsvarar nuvarande aktiva lower-third. */
function applyActiveLowerThirdHighlight() {
  document.querySelectorAll('.preview-player.is-clickable').forEach(el => {
    el.classList.toggle('is-active', el.dataset.ltKey === activeLowerThirdKey);
  });
}

/** Formaterar en match: "5–2" om spelad, annars "FRE 15/3 16:00".
 *  Returnerar HTML när matchen är spelad (escape:ar siffrorna defensivt). */
function formatFixtureMiddle(f) {
  if (f.isFinished && f.homeGoals != null) {
    return `<span class="pf-result">${escapeHtml(f.homeGoals)}–${escapeHtml(f.awayGoals)}</span>`;
  }
  if (!f.matchDateTime) return '';
  const d = new Date(f.matchDateTime);
  if (isNaN(d.getTime())) return '';
  const days = ['SÖN','MÅN','TIS','ONS','TOR','FRE','LÖR'];
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/** Renderar fixtures-listan i preview (hemma · resultat/tid · borta).
 *  IBIS-data escape:as. formatFixtureMiddle returnerar redan säker HTML. */
function renderPreviewFixtures(containerEl, fixtures) {
  containerEl.innerHTML = '';
  fixtures.forEach(f => {
    const row = document.createElement('div');
    row.className = 'preview-fixture';
    const lh = f.homeLogo ? `<img class="pf-logo" src="${escapeHtml(f.homeLogo)}" alt="">` : '';
    const la = f.awayLogo ? `<img class="pf-logo" src="${escapeHtml(f.awayLogo)}" alt="">` : '';
    row.innerHTML = `
      <span class="pf-home">
        <span class="pf-name">${escapeHtml(f.homeTeam)}</span>${lh}
      </span>
      <span class="pf-middle">${formatFixtureMiddle(f)}</span>
      <span class="pf-away">
        ${la}<span class="pf-name">${escapeHtml(f.awayTeam)}</span>
      </span>`;
    containerEl.appendChild(row);
  });
}

// ── Live-monitor: ticker-feed + omgångens resultat (read-only) ──────────────
// Visar samma mål-events som grafikens ticker (socket 'tickerGoal') i en
// rullande lista + omgångens senaste resultat. Boxen visas så fort det finns
// ett mål i feeden ELLER fixtures i state.

/** Visar boxen om feeden eller resultatlistan har innehåll, annars empty-text. */
function refreshLiveMonitorVisibility() {
  if (!liveMonitorBox) return;
  const hasData = tickerFeed.length > 0 || currentRoundFixtures.length > 0;
  liveMonitorBox.hidden = !hasData;
}

/** Renderar ticker-feeden. Alla IBIS-fält escape:as innan innerHTML. */
function renderTickerFeed() {
  if (!tickerFeedList) return;
  if (!tickerFeed.length) {
    tickerFeedList.innerHTML =
      '<p class="live-monitor-empty">Väntar på mål från andra matcher…</p>';
    return;
  }
  tickerFeedList.innerHTML = tickerFeed.map(g => {
    const team   = g.scoringTeam === 'home' ? g.homeTeam : g.awayTeam;
    const score  = `${escapeHtml(g.homeTeam)} ${escapeHtml(g.scoreHome)}–${escapeHtml(g.scoreAway)} ${escapeHtml(g.awayTeam)}`;
    const scorer = g.scorer ? `${escapeHtml(g.scorer.jersey)} ${escapeHtml(g.scorer.name)}`.trim() : 'Mål';
    const assist = g.assist ? `Pass: ${escapeHtml(g.assist.jersey)} ${escapeHtml(g.assist.name)}`.trim() : '';
    const time   = g.periodTime ? `P${escapeHtml(g.period ?? '?')} · ${escapeHtml(g.periodTime)}` : '';
    return `
      <div class="ticker-feed-row">
        <div class="tf-head">
          <span class="tf-team">⚽ ${escapeHtml(team)}</span>
          ${time ? `<span class="tf-time">${time}</span>` : ''}
        </div>
        <div class="tf-score">${score}</div>
        <div class="tf-scorer">${scorer}${assist ? ` · ${assist}` : ''}</div>
      </div>`;
  }).join('');
}

socket.on('tickerGoal', (goal) => {
  if (!goal || typeof goal !== 'object') return;
  tickerFeed.unshift(goal);
  if (tickerFeed.length > TICKER_FEED_MAX) tickerFeed.length = TICKER_FEED_MAX;
  renderTickerFeed();
  refreshLiveMonitorVisibility();
});

socket.on('tickerClear', () => {
  tickerFeed = [];
  renderTickerFeed();
  refreshLiveMonitorVisibility();
});

renderTickerFeed();  // initial placeholder så boxen ser komplett ut direkt

/** Renderar ENDAST pågående (live) matcher med resultat + tid. Saknas live-
 *  matcher visas en text. Logotyper berikas från fixtures via matchId. */
function renderRoundStatus() {
  if (!liveResultsList) return;
  liveResultsList.innerHTML = '';

  const fixtureById = new Map(
    currentRoundFixtures.map(f => [String(f.matchId), f])
  );

  if (!liveStatusMap.size) {
    liveResultsList.innerHTML =
      '<p class="live-monitor-empty">Inga andra pågående matcher just nu…</p>';
    refreshLiveMonitorVisibility();
    return;
  }

  liveStatusMap.forEach((lv) => {
    const f    = fixtureById.get(String(lv.matchId)) || {};
    const home = lv.homeTeam ?? f.homeTeam ?? '';
    const away = lv.awayTeam ?? f.awayTeam ?? '';
    const lh = f.homeLogo ? `<img class="pf-logo" src="${escapeHtml(f.homeLogo)}" alt="">` : '';
    const la = f.awayLogo ? `<img class="pf-logo" src="${escapeHtml(f.awayLogo)}" alt="">` : '';
    const time = lv.periodTime
      ? `P${escapeHtml(lv.period ?? '?')} · ${escapeHtml(lv.periodTime)}`
      : `P${escapeHtml(lv.period ?? '?')}`;
    const badge  = '<span class="rf-badge rf-badge-live"><span class="rf-dot"></span>LIVE</span>';
    const middle = `<span class="pf-result rf-live-score">${escapeHtml(lv.homeGoals)}–${escapeHtml(lv.awayGoals)}</span>` +
                   `<span class="rf-live-time">${time}</span>`;

    const row = document.createElement('div');
    row.className = 'round-fixture rf-live';
    row.innerHTML = `
      <span class="rf-status">${badge}</span>
      <span class="pf-home"><span class="pf-name">${escapeHtml(home)}</span>${lh}</span>
      <span class="pf-middle">${middle}</span>
      <span class="pf-away">${la}<span class="pf-name">${escapeHtml(away)}</span></span>`;
    liveResultsList.appendChild(row);
  });
  refreshLiveMonitorVisibility();
}

/** Plockar competitionId ur match-URL:en (input-fältet eller localStorage). */
function parseCompetitionId() {
  let url = (typeof urlMatchAll !== 'undefined' && urlMatchAll?.value || '').trim();
  if (!url) { try { url = localStorage.getItem(LS_URL_KEY) || ''; } catch (_) {} }
  const m = url.match(/\/sasong\/\d+\/(?:serie|turnering)\/(\d+)\//);
  return m ? m[1] : null;
}

/** Hämtar live-matcher för serien och uppdaterar statuslistan. */
async function pollLiveSeries() {
  const cid = parseCompetitionId();
  if (!cid) return;
  try {
    const res = await fetch(`/api/series/${cid}/live`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    const arr  = Array.isArray(data?.matches) ? data.matches : [];
    liveStatusMap = new Map(arr.map(m => [String(m.matchId), m]));
    renderRoundStatus();
  } catch (_) { /* tyst – nästa poll försöker igen */ }
}

/** Startar pollning (var 30:e s) om vi har en serie att fråga om. */
function startLiveSeriesPoll() {
  if (liveSeriesTimer || !parseCompetitionId()) return;
  pollLiveSeries();
  liveSeriesTimer = setInterval(pollLiveSeries, 30_000);
}

function stopLiveSeriesPoll() {
  if (liveSeriesTimer) { clearInterval(liveSeriesTimer); liveSeriesTimer = null; }
  liveStatusMap = new Map();
}

/**
 * Renderar Statistik-inför-match-previewen som en 3-kolumns tabell
 * [hemma-värde · etikett · borta-värde]. Section-rader (Powerplay/Boxplay)
 * spänner över alla 3 kolumner. Senaste 5-prickarna renderas inline
 * med samma färger som grafiken kommer att visa live.
 */
function renderPreGamePreview(data) {
  if (!data) {
    pendingPreGameStats     = null;
    previewPreGame.hidden   = true;
    pgPreviewBody.innerHTML = '';
    return;
  }
  pendingPreGameStats = data;
  pgPreviewHomeName.textContent = data.home.teamName || 'Hemma';
  pgPreviewAwayName.textContent = data.away.teamName || 'Borta';
  // Bygg raderna deklarativt så det är lätt att lägga till/ändra fält senare.
  const rows = [
    { label: 'Tabellplacering',  h: data.home.ranking,          a: data.away.ranking },
    { label: 'Inbördes möten',   h: data.home.meetingWins,      a: data.away.meetingWins },
    { label: 'Senaste mötet',    h: data.home.goalsLastMeeting, a: data.away.goalsLastMeeting },
    { label: 'Senaste 5 matcherna', h: renderLastDotsHtml(data.home.lastGames),
                                    a: renderLastDotsHtml(data.away.lastGames), html: true },
    { section: 'Powerplay' },
    { label: 'Antal PP',              h: data.home.numberOfPPs,    a: data.away.numberOfPPs },
    { label: 'Effektivitet i PP',     h: data.home.ppEffectivity,  a: data.away.ppEffectivity },
    { label: 'Gjorda mål i PP',       h: data.home.ppGoalsScored,  a: data.away.ppGoalsScored },
    { label: 'Snittid gjorda mål i PP', h: data.home.ppAvgGoalTime, a: data.away.ppAvgGoalTime },
    { label: 'Insläppta mål i PP',    h: data.home.ppGoalsAgainst, a: data.away.ppGoalsAgainst },
    { section: 'Boxplay' },
    { label: 'Antal BP',              h: data.home.numberOfBPs,    a: data.away.numberOfBPs },
    { label: 'Effektivitet i BP',     h: data.home.bpEffectivity,  a: data.away.bpEffectivity },
    { label: 'Insläppta mål i BP',    h: data.home.bpGoalsAgainst, a: data.away.bpGoalsAgainst },
    { label: 'Snittid insläppta mål i BP', h: data.home.bpAvgGoalAgainstTime,
                                          a: data.away.bpAvgGoalAgainstTime },
    { label: 'Gjorda mål i BP',       h: data.home.bpGoalsScored,  a: data.away.bpGoalsScored }
  ];
  pgPreviewBody.innerHTML = rows.map(r => {
    if (r.section) {
      return `<tr class="pg-section"><td colspan="3">${r.section}</td></tr>`;
    }
    const hCell = r.html ? r.h : escapeHtml(r.h);
    const aCell = r.html ? r.a : escapeHtml(r.a);
    return `<tr><td class="pg-val">${hCell}</td><td class="pg-label">${escapeHtml(r.label)}</td><td class="pg-val">${aCell}</td></tr>`;
  }).join('');
  previewPreGame.hidden = false;
}

/** Renderar små färgade prickar för senaste 5-listan – matchar grafiken. */
function renderLastDotsHtml(lastGames) {
  if (!Array.isArray(lastGames) || !lastGames.length) return '<span class="pg-muted">saknas</span>';
  return `<span class="pg-dots">` + lastGames.map(g =>
    `<span class="pg-dot" style="background:${g.color}" title="${escapeHtml(g.name)}"></span>`
  ).join('') + `</span>`;
}

/** Minimal HTML-escaper för säker render av textfält från IBIS. */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Renderar tabellrader i preview-tabellen (logo + 9 kolumner).
 *  IBIS-fält (row.team m.fl.) escape:as för säker innerHTML-insättning. */
function renderPreviewTable(tbodyEl, rows) {
  tbodyEl.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const logoHtml = row.logo
      ? `<img src="${escapeHtml(row.logo)}" alt="" class="preview-logo">`
      : '';
    const record = (row.goalsFor != null && row.goalsAgainst != null)
      ? `${escapeHtml(row.goalsFor)}–${escapeHtml(row.goalsAgainst)}`
      : '';
    tr.innerHTML = `
      <td>${logoHtml}</td>
      <td>${escapeHtml(row.pos)}</td>
      <td>${escapeHtml(row.team)}</td>
      <td>${escapeHtml(row.played)}</td>
      <td>${escapeHtml(row.wins ?? '')}</td>
      <td>${escapeHtml(row.draws ?? '')}</td>
      <td>${escapeHtml(row.losses ?? '')}</td>
      <td>${record}</td>
      <td>${escapeHtml(row.diff ?? '')}</td>
      <td>${escapeHtml(row.points)}</td>`;
    tbodyEl.appendChild(tr);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PERSISTENS – URL i localStorage + hydrering från server-state
// ════════════════════════════════════════════════════════════════════════════

const LS_URL_KEY = 'scoreboard:lastMatchUrl';

// Återställ senaste URL vid sidladdning så användaren slipper paste:a igen
const savedUrl = localStorage.getItem(LS_URL_KEY);
if (savedUrl && urlMatchAll && !urlMatchAll.value) {
  urlMatchAll.value = savedUrl;
}

// Cache av senast hydrerad data – undviker att rebuild:a hela DOM-trädet
// för previews på varje stateUpdate (vilket triggas av score-/klock-/period-
// ändringar). Innehållet är litet (en match) så stringify är försumbart.
let lastHydrateLineupHome = '';
let lastHydrateLineupAway = '';
let lastHydrateTable      = '';
let lastHydrateFixtures   = '';
let lastHydratePreGame    = '';

// Fyller previews från ett stateUpdate-objekt. Idempotent – körs vid varje
// stateUpdate utan att skada pågående interaktion.
function hydratePreviewsFromState(state) {
  // Speglar serverns aktiva lower-third så vi kan highlight:a rätt rad
  if (state.playerLowerThird && state.playerLowerThird.name) {
    const lt = state.playerLowerThird;
    const kind = lt.number ? 'p' : 'l';
    const tag  = lt.number || lt.role || '';
    activeLowerThirdKey = `${lt.team}|${kind}|${tag}|${lt.name}`;
  } else {
    activeLowerThirdKey = '';
  }

  if (state.lineupHome?.length) {
    pendingIbHome = {
      name:    state.teamA,
      players: state.lineupHome,
      leaders: state.lineupHomeLeaders || []
    };
    previewIbHomeName.textContent  = state.teamA;
    previewIbHomeCount.textContent = `${state.lineupHome.length} spelare`;
    const homeKey = JSON.stringify([state.teamA, state.lineupHome, state.lineupHomeLeaders || []]);
    if (homeKey !== lastHydrateLineupHome) {
      renderPreviewPlayers(previewIbHomeList, state.lineupHome,
        { team: 'home', teamName: state.teamA });
      renderPreviewLeaders(previewIbHomeLeadersWrap, previewIbHomeLeadersList,
        state.lineupHomeLeaders || [], { team: 'home', teamName: state.teamA });
      lastHydrateLineupHome = homeKey;
    }
    previewInnebandyLineup.hidden = false;
  }
  if (state.lineupAway?.length) {
    pendingIbAway = {
      name:    state.teamB,
      players: state.lineupAway,
      leaders: state.lineupAwayLeaders || []
    };
    previewIbAwayName.textContent  = state.teamB;
    previewIbAwayCount.textContent = `${state.lineupAway.length} spelare`;
    const awayKey = JSON.stringify([state.teamB, state.lineupAway, state.lineupAwayLeaders || []]);
    if (awayKey !== lastHydrateLineupAway) {
      renderPreviewPlayers(previewIbAwayList, state.lineupAway,
        { team: 'away', teamName: state.teamB });
      renderPreviewLeaders(previewIbAwayLeadersWrap, previewIbAwayLeadersList,
        state.lineupAwayLeaders || [], { team: 'away', teamName: state.teamB });
      lastHydrateLineupAway = awayKey;
    }
    previewInnebandyLineup.hidden = false;
  }
  if (state.table?.length) {
    pendingInnebandyTable = { name: state.tableName || '', rows: state.table };
    const tableKey = JSON.stringify([state.tableName, state.table]);
    if (tableKey !== lastHydrateTable) {
      renderPreviewTable(previewInnebandyTableBody, state.table);
      lastHydrateTable = tableKey;
    }
    previewInnebandyTableCount.textContent = state.tableName
      ? `${state.tableName} – ${state.table.length} lag`
      : `${state.table.length} lag`;
    previewInnebandyTable.hidden = false;
  }
  if (state.fixtures?.length) {
    pendingFixtures = { title: state.fixturesTitle || '', fixtures: state.fixtures };
    const fixturesKey = JSON.stringify([state.fixturesTitle, state.fixtures]);
    if (fixturesKey !== lastHydrateFixtures) {
      renderPreviewFixtures(previewFixturesList, state.fixtures);
      lastHydrateFixtures = fixturesKey;
    }
    previewFixturesCount.textContent = state.fixturesTitle
      ? `${state.fixturesTitle} – ${state.fixtures.length} matcher`
      : `${state.fixtures.length} matcher`;
    previewFixtures.hidden = false;
  }
  // Live-monitor: omgångens matcher med live-status (read-only).
  if (liveResultsList) {
    currentRoundFixtures = state.fixtures?.length ? state.fixtures : [];
    renderRoundStatus();
    if (currentRoundFixtures.length) startLiveSeriesPoll();
    else                             stopLiveSeriesPoll();
  }
  if (state.preGameStats) {
    const preGameKey = JSON.stringify(state.preGameStats);
    if (preGameKey !== lastHydratePreGame) {
      renderPreGamePreview(state.preGameStats);
      lastHydratePreGame = preGameKey;
    }
  }
  applyActiveLowerThirdHighlight();
}

// ════════════════════════════════════════════════════════════════════════════
// FLIK 2 + 3 – HÄMTA ALL DATA (en URL → match + tabell)
// ════════════════════════════════════════════════════════════════════════════

function triggerFetchAll() {
  const url = urlMatchAll.value.trim();
  if (!url) return;
  // Laddningsindikator: status + göm gamla previews + disabled-knapp
  setStatus(fetchStatusAll, 'Hämtar match och tabell…', 'loading');
  previewInnebandyLineup.hidden = true;
  previewInnebandyTable.hidden  = true;
  btnFetchAll.disabled = true;
  socket.emit('fetch_innebandy_all_data', { url });
}

btnFetchAll.addEventListener('click', triggerFetchAll);
urlMatchAll.addEventListener('keydown', e => {
  if (e.key === 'Enter') triggerFetchAll();
});

socket.on('fetch_result_innebandy_all_data', (data) => {
  btnFetchAll.disabled = false;

  const { match, standings, standingsName, standingsError,
          fixtures, fixturesTitle, fixturesError,
          preGameStats, preGameStatsError } = data || {};
  if (!match || (!match.homeRoster?.length && !match.awayRoster?.length)) {
    setStatus(fetchStatusAll, '⚠ Inga spelare hittades i matchen', 'error');
    return;
  }

  // ── 0. Spara URL för nästa sidladdning ─────────────────────────────────
  try { localStorage.setItem(LS_URL_KEY, urlMatchAll.value.trim()); } catch (_) {}

  // ── 1. Lagnamn → input-fält + scoreboard live ──────────────────────────
  inputTeamA.value = match.homeTeam || '';
  inputTeamB.value = match.awayTeam || '';
  socket.emit('updateNames', {
    teamA:      match.homeTeam      || '',
    teamB:      match.awayTeam      || '',
    teamAShort: match.homeShortName || '',
    teamBShort: match.awayShortName || ''
  });

  // ── 1b. Pusha data till server-state direkt (utan att växla grafik) ─
  //         så den överlever sid-omladdning även om användaren inte
  //         hunnit klicka "Visa live" än.
  socket.emit('updateLineups', {
    home:         match.homeRoster   || [],
    away:         match.awayRoster   || [],
    homeLeaders:  match.homeLeaders  || [],
    awayLeaders:  match.awayLeaders  || []
  });
  // Match-meta: spelplats + matchstart + logotyper för matchup-skylten
  socket.emit('updateMatchMeta', {
    venue:      match.venue      || '',
    matchStart: match.matchStart || '',
    homeLogo:   match.homeLogo   || '',
    awayLogo:   match.awayLogo   || ''
  });
  if (standings && standings.length) {
    socket.emit('updateTable', {
      rows: standings,
      name: standingsName || ''
    });
  }
  if (fixtures && fixtures.length) {
    socket.emit('updateFixtures', {
      fixtures,
      title: fixturesTitle || ''
    });
  }

  // ── 2. Uppställningar → båda previews ──────────────────────────────────
  pendingIbHome = {
    name:    match.homeTeam || '',
    players: match.homeRoster || [],
    leaders: match.homeLeaders || []
  };
  pendingIbAway = {
    name:    match.awayTeam || '',
    players: match.awayRoster || [],
    leaders: match.awayLeaders || []
  };

  previewIbHomeName.textContent  = match.homeTeam || '';
  previewIbAwayName.textContent  = match.awayTeam || '';
  previewIbHomeCount.textContent = `${match.homeRoster.length} spelare`;
  previewIbAwayCount.textContent = `${match.awayRoster.length} spelare`;
  renderPreviewPlayers(previewIbHomeList, match.homeRoster,
    { team: 'home', teamName: match.homeTeam || '' });
  renderPreviewPlayers(previewIbAwayList, match.awayRoster,
    { team: 'away', teamName: match.awayTeam || '' });
  renderPreviewLeaders(previewIbHomeLeadersWrap, previewIbHomeLeadersList,
    match.homeLeaders || [], { team: 'home', teamName: match.homeTeam || '' });
  renderPreviewLeaders(previewIbAwayLeadersWrap, previewIbAwayLeadersList,
    match.awayLeaders || [], { team: 'away', teamName: match.awayTeam || '' });
  previewInnebandyLineup.hidden = false;

  // ── 3. Tabell → preview (om hämtad, annars bara matchen) ───────────────
  if (standings && standings.length) {
    pendingInnebandyTable = { name: standingsName || '', rows: standings };
    renderPreviewTable(previewInnebandyTableBody, standings);
    previewInnebandyTableCount.textContent = standingsName
      ? `${standingsName} – ${standings.length} lag`
      : `${standings.length} lag`;
    previewInnebandyTable.hidden = false;
  } else {
    pendingInnebandyTable = { name: '', rows: [] };
    previewInnebandyTable.hidden = true;
  }

  // ── 3b. Omgångens matcher → preview ────────────────────────────────────
  if (fixtures && fixtures.length) {
    pendingFixtures = { title: fixturesTitle || '', fixtures };
    renderPreviewFixtures(previewFixturesList, fixtures);
    previewFixturesCount.textContent = fixturesTitle
      ? `${fixturesTitle} – ${fixtures.length} matcher`
      : `${fixtures.length} matcher`;
    previewFixtures.hidden = false;
  } else {
    pendingFixtures = { title: '', fixtures: [] };
    previewFixtures.hidden = true;
  }

  // ── 3c. Statistik inför match → preview ────────────────────────────────
  if (preGameStats) {
    renderPreGamePreview(preGameStats);
  } else {
    renderPreGamePreview(null);
  }

  // ── 4. Sammanfattning som status-meddelande ────────────────────────────
  const matchInfo = `✓ ${match.homeTeam} (${match.homeRoster.length}) vs ${match.awayTeam} (${match.awayRoster.length})`;
  if (standings && standings.length) {
    setStatus(fetchStatusAll, `${matchInfo} · tabell: ${standings.length} lag`, 'ok');
  } else if (standingsError) {
    // Matchen lyckades men tabellen inte – returnera tydligt utan att krascha
    setStatus(fetchStatusAll, `${matchInfo} · ⚠ tabell ej tillgänglig (${standingsError})`, 'ok');
  } else {
    setStatus(fetchStatusAll, matchInfo, 'ok');
  }
});

// ── Skicka enskilda grafiker live (knappar i previews) ──────────────────
btnSendIbHome.addEventListener('click', () => {
  if (!pendingIbHome.players.length) return;
  socket.emit('updateLineups', { home: pendingIbHome.players, away: null });
  socket.emit('switchGraphic', { to: 'lineupHome' });
});

btnSendIbAway.addEventListener('click', () => {
  if (!pendingIbAway.players.length) return;
  socket.emit('updateLineups', { home: null, away: pendingIbAway.players });
  socket.emit('switchGraphic', { to: 'lineupAway' });
});

// ── Klickbar lineup-rad → spelar-/ledar-lower-third ──────────────────────
// Klick på samma rad igen släcker skylten (toggle). Klick på en annan rad
// byter direkt till den nya personen utan att gå via "dölj".
[previewIbHomeList, previewIbAwayList,
 previewIbHomeLeadersList, previewIbAwayLeadersList].forEach(list => {
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.preview-player.is-clickable');
    if (!row) return;
    const key = row.dataset.ltKey || '';
    if (key && key === activeLowerThirdKey) {
      // Toggle av: släck skylten utan att visa scoreboarden efteråt
      activeLowerThirdKey = '';
      socket.emit('updatePlayerLowerThird', null);
      socket.emit('switchGraphic', { to: 'none' });
    } else {
      activeLowerThirdKey = key;
      socket.emit('updatePlayerLowerThird', {
        team:     row.dataset.team,
        teamName: row.dataset.teamName,
        number:   row.dataset.number,
        name:     row.dataset.name,
        role:     row.dataset.role
      });
      socket.emit('switchGraphic', { to: 'playerLowerThird' });
    }
    applyActiveLowerThirdHighlight();
  });
});

btnSendInnebandyTable.addEventListener('click', () => {
  if (!pendingInnebandyTable.rows.length) return;
  socket.emit('updateTable', {
    rows: pendingInnebandyTable.rows,
    name: pendingInnebandyTable.name
  });
  socket.emit('switchGraphic', { to: 'table' });
});

btnClearInnebandyTable.addEventListener('click', () => {
  pendingInnebandyTable = { name: '', rows: [] };
  previewInnebandyTable.hidden = true;
});

btnSendFixtures.addEventListener('click', () => {
  if (!pendingFixtures.fixtures.length) return;
  socket.emit('updateFixtures', {
    fixtures: pendingFixtures.fixtures,
    title:    pendingFixtures.title
  });
  socket.emit('switchGraphic', { to: 'fixtures' });
});

btnClearFixtures.addEventListener('click', () => {
  pendingFixtures = { title: '', fixtures: [] };
  previewFixtures.hidden = true;
});

// ── Statistik inför match ────────────────────────────────────────────────
btnSendPreGame.addEventListener('click', () => {
  if (!pendingPreGameStats) return;
  socket.emit('switchGraphic', { to: 'preGameStats' });
});
btnClearPreGame.addEventListener('click', () => {
  pendingPreGameStats = null;
  previewPreGame.hidden = true;
});

// (Tidigare api-docs-handler togs bort – api-docs.html laddar inte control.js
//  utan har egen inline-skript för kopiering. Hela blocket var dead code här.)

// ════════════════════════════════════════════════════════════════════════════
// FEL-HANTERING
// ════════════════════════════════════════════════════════════════════════════
socket.on('fetch_error', ({ context, message }) => {
  if (context === 'innebandy_all') {
    btnFetchAll.disabled = false;
    setStatus(fetchStatusAll, `Fel: ${message}`, 'error');
  } else {
    console.error('Okänt fetch_error:', context, message);
  }
});
