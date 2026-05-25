const socket = io();

// ════════════════════════════════════════════════════════════════════════════
// DOM-REFERENSER
// ════════════════════════════════════════════════════════════════════════════

const statusEl   = document.getElementById('connection-status');
const activeInd  = document.getElementById('activeGraphicIndicator');

// Bildmixer (sticky header)
const mixerBtns  = document.querySelectorAll('.mixer-btn');

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
const btnPause       = document.getElementById('btnPause');
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

// ════════════════════════════════════════════════════════════════════════════
// LOKAL STATE – skrapad data som väntar på att skickas live
// ════════════════════════════════════════════════════════════════════════════
let pendingInnebandyTable = { name: '', rows: [] };
let pendingIbHome         = { name: '', players: [] };
let pendingIbAway         = { name: '', players: [] };
let pendingFixtures       = { title: '', fixtures: [] };

// Läsbar etikett för varje grafik-nyckel
const GRAPHIC_LABELS = {
  scoreboard:   'Scoreboard',
  lineupHome:   'Hemmalaguppställning',
  lineupAway:   'Bortalagsuppställning',
  table:        'Ligatabell',
  fixtures:     'Omgångens matcher',
  commentators: 'Kommentatorer (lower-third)',
  matchup:      'Inför/Paus (Matchup)',
  intermission: 'Pausvila',
  none:         'Ingen grafik visas'
};

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

/**
 * Renderar en utvisningslista. Diffar mot DOM så befintliga rader bara
 * uppdaterar text (ingen flash) och borttagna rader animeras ut innan
 * de tas bort. Nya rader animeras in via CSS .penalty-row.
 */
function renderPenaltyList(listEl, penalties) {
  const incomingIds = new Set(penalties.map(p => String(p.id)));

  // Steg 1: ta bort rader som inte längre finns i state
  Array.from(listEl.children).forEach(li => {
    if (li.classList.contains('is-removing')) return;
    if (!incomingIds.has(li.dataset.id)) {
      li.classList.add('is-removing');
      li.addEventListener('animationend', () => li.remove(), { once: true });
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
        <button class="btn-penalty-remove" title="Ta bort utvisning" aria-label="Ta bort utvisning">×</button>`;
      listEl.appendChild(li);
    }
    li.querySelector('.penalty-row-jersey').textContent = p.jersey ? `#${p.jersey}` : '';
    li.querySelector('.penalty-row-time').textContent   = formatPenaltyTime(p.remaining);
  });
}

function updatePenaltyCounts(home, away) {
  const fmt = (n) => `${n} aktiv${n === 1 ? '' : 'a'}`;
  penaltyHomeCount.textContent = fmt(home.length);
  penaltyAwayCount.textContent = fmt(away.length);
}

function applyPenalties(home, away) {
  renderPenaltyList(penaltyHomeList, home || []);
  renderPenaltyList(penaltyAwayList, away || []);
  updatePenaltyCounts(home || [], away || []);
}

// Klick-delegering för +2/+5-knappar (oavsett vilket lag)
document.querySelectorAll('.btn-penalty').forEach(btn => {
  btn.addEventListener('click', () => {
    const team    = btn.dataset.team;
    const minutes = parseInt(btn.dataset.minutes, 10);
    const jerseyInput = team === 'home' ? inputPenaltyHomeJersey : inputPenaltyAwayJersey;
    const jersey = jerseyInput.value.trim();
    socket.emit('penaltyAdd', { team, minutes, jersey });
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

// Riktade penalty-uppdateringar (kommer varje sekund från klock-loopen
// när utvisningar är aktiva). Använder samma render som stateUpdate så
// inga element rebuildas i onödan.
socket.on('penaltiesUpdate', ({ penaltiesHome, penaltiesAway }) => {
  applyPenalties(penaltiesHome, penaltiesAway);
});

// ════════════════════════════════════════════════════════════════════════════
// AKTIV GRAFIK-INDIKATOR
// ════════════════════════════════════════════════════════════════════════════

/** Uppdaterar ON AIR-pillen + sätter .on-air på rätt mixer-knapp */
function updateActiveIndicator(key) {
  activeInd.textContent = GRAPHIC_LABELS[key] || key;
  // Mappa 'none' (= göm allt) till mixerns 'clear'-knapp för visuell ON AIR
  const mixerKey = key === 'none' ? 'clear' : key;
  mixerBtns.forEach(btn => {
    btn.classList.toggle('on-air', btn.dataset.graphic === mixerKey);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SOCKET – ANSLUTNING
// ════════════════════════════════════════════════════════════════════════════
socket.on('connect', () => {
  statusEl.textContent = 'Ansluten';
  statusEl.className   = 'status connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Frånkopplad';
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
});

socket.on('clockTick',   ({ clock })   => { displayClock.textContent = clock; });
socket.on('clockStatus', ({ running }) => { updateClockButtons(running); });

function updateClockButtons(running) {
  btnStart.disabled = running;
  btnPause.disabled = !running;
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

btnStart.addEventListener('click', () => socket.emit('clockStart'));
btnPause.addEventListener('click', () => socket.emit('clockPause'));
btnReset.addEventListener('click', () => socket.emit('clockReset'));
btnToggleClock.addEventListener('click', () => socket.emit('toggleClockVisibility'));

/** Manuell tidsjustering – ±1 s eller absolut MM:SS via textfältet */
const btnClockMinus = document.getElementById('btnClockMinus');
const btnClockPlus  = document.getElementById('btnClockPlus');
const btnClockSet   = document.getElementById('btnClockSet');
const inputClockSet = document.getElementById('inputClockSet');

btnClockMinus.addEventListener('click', () => socket.emit('clockAdjust', { delta: -1 }));
btnClockPlus .addEventListener('click', () => socket.emit('clockAdjust', { delta:  1 }));

/** Parse "MM:SS" eller "M:SS" → totala sekunder. Returnerar null vid ogiltigt. */
function parseMMSS(value) {
  const m = (value || '').trim().match(/^(\d{1,2}):([0-5]?\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function applyClockSet() {
  const sec = parseMMSS(inputClockSet.value);
  if (sec == null) {
    // Visuell feedback för ogiltigt format
    inputClockSet.classList.add('input-error');
    inputClockSet.focus();
    inputClockSet.select();
    setTimeout(() => inputClockSet.classList.remove('input-error'), 700);
    return;
  }
  socket.emit('clockSet', { seconds: sec });
  inputClockSet.value = '';
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
  pendingIbHome         = { name: '', players: [] };
  pendingIbAway         = { name: '', players: [] };
  pendingFixtures       = { title: '', fixtures: [] };
  previewInnebandyLineup.hidden = true;
  previewInnebandyTable.hidden  = true;
  previewFixtures.hidden        = true;
  if (fetchStatusAll) setStatus(fetchStatusAll, '');
  if (urlMatchAll) urlMatchAll.value = '';
  try { localStorage.removeItem(LS_URL_KEY); } catch (_) {}
});

// ════════════════════════════════════════════════════════════════════════════
// HJÄLPFUNKTIONER – Förhandsvisning
// ════════════════════════════════════════════════════════════════════════════

/** Sätter status-text med CSS-klass för färgkodning */
function setStatus(el, text, type = '') {
  el.textContent  = text;
  el.className    = `fetch-status${type ? ` ${type}` : ''}`;
}

/**
 * Renderar en lista med spelare i ett preview-element.
 * Extraherar tröjnummer om raden börjar med siffra.
 */
function renderPreviewPlayers(containerEl, players) {
  containerEl.innerHTML = '';
  players.forEach(player => {
    const div   = document.createElement('div');
    div.className = 'preview-player';

    const parts  = player.trim().split(/\s+/);
    const hasNum = parts.length > 1 && /^\d+$/.test(parts[0]);

    if (hasNum) {
      const num = parts.shift();
      div.innerHTML = `<span class="preview-player-num">${num}</span>${parts.join(' ')}`;
    } else {
      div.textContent = player;
    }
    containerEl.appendChild(div);
  });
}

/** Formaterar en match: "5–2" om spelad, annars "FRE 15/3 16:00" */
function formatFixtureMiddle(f) {
  if (f.isFinished && f.homeGoals != null) {
    return `<span class="pf-result">${f.homeGoals}–${f.awayGoals}</span>`;
  }
  if (!f.matchDateTime) return '';
  const d = new Date(f.matchDateTime);
  if (isNaN(d.getTime())) return '';
  const days = ['SÖN','MÅN','TIS','ONS','TOR','FRE','LÖR'];
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/** Renderar fixtures-listan i preview (hemma · resultat/tid · borta) */
function renderPreviewFixtures(containerEl, fixtures) {
  containerEl.innerHTML = '';
  fixtures.forEach(f => {
    const row = document.createElement('div');
    row.className = 'preview-fixture';
    const lh = f.homeLogo ? `<img class="pf-logo" src="${f.homeLogo}" alt="">` : '';
    const la = f.awayLogo ? `<img class="pf-logo" src="${f.awayLogo}" alt="">` : '';
    row.innerHTML = `
      <span class="pf-home">
        <span class="pf-name">${f.homeTeam}</span>${lh}
      </span>
      <span class="pf-middle">${formatFixtureMiddle(f)}</span>
      <span class="pf-away">
        ${la}<span class="pf-name">${f.awayTeam}</span>
      </span>`;
    containerEl.appendChild(row);
  });
}

/** Renderar tabellrader i preview-tabellen (logo + 9 kolumner). */
function renderPreviewTable(tbodyEl, rows) {
  tbodyEl.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const logoHtml = row.logo
      ? `<img src="${row.logo}" alt="" class="preview-logo">`
      : '';
    const record = (row.goalsFor != null && row.goalsAgainst != null)
      ? `${row.goalsFor}–${row.goalsAgainst}`
      : '';
    tr.innerHTML = `
      <td>${logoHtml}</td>
      <td>${row.pos}</td>
      <td>${row.team}</td>
      <td>${row.played}</td>
      <td>${row.wins ?? ''}</td>
      <td>${row.draws ?? ''}</td>
      <td>${row.losses ?? ''}</td>
      <td>${record}</td>
      <td>${row.diff ?? ''}</td>
      <td>${row.points}</td>`;
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

// Fyller previews från ett stateUpdate-objekt. Idempotent – körs vid varje
// stateUpdate utan att skada pågående interaktion.
function hydratePreviewsFromState(state) {
  if (state.lineupHome?.length) {
    pendingIbHome = { name: state.teamA, players: state.lineupHome };
    previewIbHomeName.textContent  = state.teamA;
    previewIbHomeCount.textContent = `${state.lineupHome.length} spelare`;
    renderPreviewPlayers(previewIbHomeList, state.lineupHome);
    previewInnebandyLineup.hidden = false;
  }
  if (state.lineupAway?.length) {
    pendingIbAway = { name: state.teamB, players: state.lineupAway };
    previewIbAwayName.textContent  = state.teamB;
    previewIbAwayCount.textContent = `${state.lineupAway.length} spelare`;
    renderPreviewPlayers(previewIbAwayList, state.lineupAway);
    previewInnebandyLineup.hidden = false;
  }
  if (state.table?.length) {
    pendingInnebandyTable = { name: state.tableName || '', rows: state.table };
    renderPreviewTable(previewInnebandyTableBody, state.table);
    previewInnebandyTableCount.textContent = state.tableName
      ? `${state.tableName} – ${state.table.length} lag`
      : `${state.table.length} lag`;
    previewInnebandyTable.hidden = false;
  }
  if (state.fixtures?.length) {
    pendingFixtures = { title: state.fixturesTitle || '', fixtures: state.fixtures };
    renderPreviewFixtures(previewFixturesList, state.fixtures);
    previewFixturesCount.textContent = state.fixturesTitle
      ? `${state.fixturesTitle} – ${state.fixtures.length} matcher`
      : `${state.fixtures.length} matcher`;
    previewFixtures.hidden = false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FLIK 2 + 3 – HÄMTA ALL DATA (en URL → match + tabell)
// ════════════════════════════════════════════════════════════════════════════

function triggerFetchAll() {
  const url = urlMatchAll.value.trim();
  if (!url) return;
  // Laddningsindikator: status + göm gamla previews + disabled-knapp
  setStatus(fetchStatusAll, 'Hämtar match och tabell parallellt…', 'loading');
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
          fixtures, fixturesTitle, fixturesError } = data || {};
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
  pendingIbHome = { name: match.homeTeam || '', players: match.homeRoster || [] };
  pendingIbAway = { name: match.awayTeam || '', players: match.awayRoster || [] };

  previewIbHomeName.textContent  = match.homeTeam || '';
  previewIbAwayName.textContent  = match.awayTeam || '';
  previewIbHomeCount.textContent = `${match.homeRoster.length} spelare`;
  previewIbAwayCount.textContent = `${match.awayRoster.length} spelare`;
  renderPreviewPlayers(previewIbHomeList, match.homeRoster);
  renderPreviewPlayers(previewIbAwayList, match.awayRoster);
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

// ════════════════════════════════════════════════════════════════════════════
// FLIK 4 – STREAM DECK HTTP-API DOKUMENTATION
// Visar bas-URL utifrån var kontrollpanelen körs så rutterna kan klistras
// direkt in i Stream Deck. Klick på en rutt kopierar hela URL:en till urklipp.
// ════════════════════════════════════════════════════════════════════════════

const apiBaseUrlEl  = document.getElementById('apiBaseUrl');
const apiCopyToast  = document.getElementById('apiCopyToast');

if (apiBaseUrlEl) {
  apiBaseUrlEl.textContent = window.location.origin;
}

// Delegerad click-handler: kopiera full URL för alla .api-route-koder
document.addEventListener('click', async (e) => {
  const codeEl = e.target.closest('.api-route');
  if (!codeEl) return;
  const fullUrl = window.location.origin + codeEl.textContent.trim();
  try {
    await navigator.clipboard.writeText(fullUrl);
    if (apiCopyToast) {
      apiCopyToast.hidden = false;
      // Trigga reflow så animationen kan spelas om vid upprepade klick
      apiCopyToast.style.animation = 'none';
      void apiCopyToast.offsetWidth;
      apiCopyToast.style.animation = '';
      // Göm efter animationen slutar (1.4s)
      clearTimeout(apiCopyToast._t);
      apiCopyToast._t = setTimeout(() => { apiCopyToast.hidden = true; }, 1400);
    }
  } catch (err) {
    console.error('Kunde inte kopiera till urklipp:', err);
  }
});

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
