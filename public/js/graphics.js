const socket = io();

// ── DOM-refs: Poängtavla ─────────────────────────────────────────────────────
const elScoreboard = document.getElementById('scoreboard');
const elTeamA      = document.getElementById('teamA');
const elTeamB      = document.getElementById('teamB');
const elScoreA     = document.getElementById('scoreA');
const elScoreB     = document.getElementById('scoreB');
const elClock      = document.getElementById('clock');
const elPeriod     = document.getElementById('period');

// ── DOM-refs: Uppställningar & Tabell ────────────────────────────────────────
const elLineupHome      = document.getElementById('lineup-home');
const elLineupAway      = document.getElementById('lineup-away');
const elLineupHomeTitle = document.getElementById('lineupHomeTitle');
const elLineupAwayTitle = document.getElementById('lineupAwayTitle');
const elLineupHomeGrid  = document.getElementById('lineupHomeGrid');
const elLineupAwayGrid  = document.getElementById('lineupAwayGrid');
const elTableGraphic    = document.getElementById('table-graphic');
const elTableBody       = document.getElementById('tableBody');
const elTableEyebrow    = document.getElementById('tableEyebrow');
const elFixturesGraphic = document.getElementById('fixtures-graphic');
const elFixturesList    = document.getElementById('fixturesList');
const elFixturesTitle   = document.getElementById('fixturesTitle');
const elCommentators    = document.getElementById('commentators-graphic');
const elCommentator1    = document.getElementById('commentatorName1');
const elCommentator2    = document.getElementById('commentatorName2');
const elMatchup         = document.getElementById('matchup-graphic');
const elMatchupHomeName = document.getElementById('matchupHomeName');
const elMatchupAwayName = document.getElementById('matchupAwayName');
const elMatchupHomeLogo = document.getElementById('matchupHomeLogo');
const elMatchupAwayLogo = document.getElementById('matchupAwayLogo');
const elMatchupVenue    = document.getElementById('matchupVenue');
const elMatchupStart    = document.getElementById('matchupStart');
const elMatchupCompetition = document.getElementById('matchupCompetition');
const elLineupHomeLeadersList = document.getElementById('lineupHomeLeaders');
const elLineupAwayLeadersList = document.getElementById('lineupAwayLeaders');

// Spelar-/ledar-skylt (lower-third nere till vänster)
const elPlayerLt     = document.getElementById('player-lowerthird');
const elPlayerLtTeam = document.getElementById('playerLtTeam');
const elPlayerLtNum  = document.getElementById('playerLtNum');
const elPlayerLtRole = document.getElementById('playerLtRole');
const elPlayerLtName = document.getElementById('playerLtName');

// Utvisningar (penalties)
const elPenaltiesHome = document.getElementById('penalties-home');
const elPenaltiesAway = document.getElementById('penalties-away');

// Statistik inför match
const elPreGame             = document.getElementById('pregame-stats-graphic');
const elPgHomeName          = document.getElementById('pgHomeName');
const elPgAwayName          = document.getElementById('pgAwayName');
const elPgHomeLogo          = document.getElementById('pgHomeLogo');
const elPgAwayLogo          = document.getElementById('pgAwayLogo');
const elPgTableBody         = document.getElementById('pgTableBody');

// Intermission/Pausvila
const elIntermission        = document.getElementById('intermission-graphic');
const elIntermissionHomeName = document.getElementById('intermissionHomeName');
const elIntermissionAwayName = document.getElementById('intermissionAwayName');
const elIntermissionHomeLogo = document.getElementById('intermissionHomeLogo');
const elIntermissionAwayLogo = document.getElementById('intermissionAwayLogo');
const elIntermissionWaiting  = document.getElementById('intermissionWaiting');

// Karta: state-nyckel → DOM-element
const graphicElements = {
  lineupHome:   elLineupHome,
  lineupAway:   elLineupAway,
  table:        elTableGraphic,
  fixtures:     elFixturesGraphic,
  commentators: elCommentators,
  matchup:      elMatchup,
  intermission: elIntermission,
  playerLowerThird: elPlayerLt,
  preGameStats: elPreGame
};

// Grafiker som tillåter scoreboarden att stå kvar (lower-third overlays).
// Kommentator-skylten visas numera på egen hand och är därför INTE en overlay.
const SCOREBOARD_OVERLAYS = new Set();
const shouldShowScoreboard = (g) => g === 'scoreboard' || SCOREBOARD_OVERLAYS.has(g);

// ════════════════════════════════════════════════════════════════════════════
// STATE MACHINE – Exklusiv grafik-växling
// Sekvens: [Nuvarande åker ut] → [Nästa tonas in]
// ════════════════════════════════════════════════════════════════════════════

// Matcha exit-tiden i CSS (0.4s + 0.18s delay = 0.58s) + marginal.
// Detta är hur länge switchTo() väntar mellan exit och nästa enter.
const ANIM_MS = 600;

let activeKey     = 'scoreboard'; // Vad som är aktivt just nu
let transitioning = false;        // Spärrar dubbla anrop under pågående byte

/**
 * Sätter ett elements synlighet direkt, utan fördröjning.
 * Används vid omedelbar återställning (ny anslutning / OBS-reload).
 */
function setVisible(key, visible) {
  if (key === 'scoreboard') {
    elScoreboard.classList.toggle('scoreboard-hidden', !visible);
    elScoreboard.setAttribute('aria-hidden', String(!visible));
  } else {
    const el = graphicElements[key];
    if (!el) return;
    el.classList.toggle('visible', visible);
    el.setAttribute('aria-hidden', String(!visible));
  }
}

/**
 * Växlar mellan grafik-element. Hanterar både exklusiva grafiker (lineup,
 * table, fixtures, matchup) och lower-third overlays (commentators) som får
 * ligga ovanpå scoreboarden.
 */
function switchTo(targetKey) {
  if (transitioning || targetKey === activeKey) return;
  transitioning = true;

  const fromKey            = activeKey;
  const wasScoreboardShown = shouldShowScoreboard(fromKey);
  const willScoreboardShow = shouldShowScoreboard(targetKey);

  // Steg 1 – Dölj utgående grafik
  if (fromKey !== 'scoreboard') {
    setVisible(fromKey, false);
  }
  // Dölj scoreboarden om vi växlar till en fullskärms-grafik
  if (wasScoreboardShown && !willScoreboardShow) {
    setVisible('scoreboard', false);
  }

  // Steg 2 – Visa nästa grafik efter att ut-animationen är klar
  setTimeout(() => {
    activeKey = targetKey;
    if (willScoreboardShow && !wasScoreboardShown) {
      setVisible('scoreboard', true);
    }
    if (targetKey !== 'scoreboard') {
      // Räkna om "VI VÄNTAR PÅ …"-texten precis innan intermission animeras
      // in, så den alltid speglar senaste periodvärdet utan race-conditions.
      if (targetKey === 'intermission') refreshIntermissionWaiting();
      setVisible(targetKey, true);
    }
    setTimeout(() => { transitioning = false; }, ANIM_MS);
  }, ANIM_MS);
}

// ════════════════════════════════════════════════════════════════════════════
// RENDERFUNKTIONER
// ════════════════════════════════════════════════════════════════════════════

/** Renderar klockan med kolonen i en egen span så den kan pulseras via CSS */
function renderClock(value) {
  const [mm = '00', ss = '00'] = (value || '00:00').split(':');
  elClock.innerHTML = `${mm}<span class="colon">:</span>${ss}`;
}

/** Bounce-animation på poängsiffran */
function bumpScore(el) {
  el.classList.remove('bump');
  void el.offsetWidth; // Tvinga reflow så animation startar om
  el.classList.add('bump');
  el.addEventListener('transitionend', () => el.classList.remove('bump'), { once: true });
}

/**
 * Renderar spelarrutnätet i en uppställningspanel.
 * Extraherar tröjnummer om raden börjar med en siffra.
 * animation-delay sätts per spelare för kaskad-effekt.
 */
function renderLineup(gridEl, players) {
  gridEl.innerHTML = '';
  players.forEach((player, i) => {
    const row  = document.createElement('div');
    row.className = 'player-row';
    // Fördröjning: startar efter att grid:en hunnit fade:a in (0.46s + 0.35s
    // text-stagger = ~0.55s baseline) plus 45ms per spelare.
    row.style.animationDelay = `${0.55 + i * 0.045}s`;

    // Dela upp "8 Erik Svensson" → nummer + namn
    const parts = player.trim().split(/\s+/);
    const hasNum = parts.length > 1 && /^\d+$/.test(parts[0]);

    if (hasNum) {
      const num  = parts.shift();
      row.innerHTML = `
        <span class="player-num">${num}</span>
        <span class="player-name">${parts.join(' ')}</span>`;
    } else {
      row.innerHTML = `<span class="player-name">${player}</span>`;
    }

    gridEl.appendChild(row);
  });
}

/** Renderar lagets logotyp – fallback till en cirkel med första bokstaven */
function renderLogo(wrapEl, url, teamName) {
  wrapEl.innerHTML = '';
  if (url) {
    const img = new Image();
    img.alt = '';
    img.src = url;
    img.onerror = () => {
      // Bilden gick inte att ladda – fall tillbaka till bokstavs-placeholder
      const ph = document.createElement('div');
      ph.className = 'matchup-logo-placeholder';
      ph.textContent = (teamName || '?').trim().charAt(0).toUpperCase();
      wrapEl.innerHTML = '';
      wrapEl.appendChild(ph);
    };
    wrapEl.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'matchup-logo-placeholder';
    ph.textContent = (teamName || '?').trim().charAt(0).toUpperCase();
    wrapEl.appendChild(ph);
  }
}

/**
 * Räknar ut den dynamiska "vi väntar på …"-texten utifrån nuvarande
 * periodstate. Hanterar både siffror (1-5) och fritext ("Period 1",
 * "  period   2 ", "PERIOD 3", "Övertid", "Sudden Death", …). Använder
 * regex så variationer i mellanslag/versaler inte spelar någon roll.
 *
 * Mappning:
 *   Period 1 → "VI VÄNTAR PÅ PERIOD 2"
 *   Period 2 → "VI VÄNTAR PÅ PERIOD 3"
 *   Period 3 → "VI VÄNTAR PÅ ÖVERTID"
 *   Övrigt   → "PAUS"
 */
function computeNextPeriodLabel(periodInput) {
  // Steg 1 – Försök hitta ett periodnummer 1-3
  let n = null;

  if (typeof periodInput === 'number' && Number.isFinite(periodInput)) {
    n = Math.trunc(periodInput);
  } else if (periodInput != null) {
    // Normalisera: trimma, lowercase, kollapsa whitespace
    const raw = String(periodInput).toLowerCase().replace(/\s+/g, ' ').trim();
    // Matcha "period 1", "p1", eller bara "1" / "2" / "3"
    const m = raw.match(/(?:period|p)\s*([1-5])\b/) || raw.match(/^([1-5])$/);
    if (m) n = parseInt(m[1], 10);
  }

  // Steg 2 – Mappa till lämplig text
  if (n === 1) return 'VI VÄNTAR PÅ PERIOD 2';
  if (n === 2) return 'VI VÄNTAR PÅ PERIOD 3';
  if (n === 3) return 'VI VÄNTAR PÅ ÖVERTID';
  return 'PAUS';
}

/**
 * Uppdaterar intermission-skyltens dynamiska text baserat på vad som just
 * nu står i scoreboardens period-element. Anropas både vid varje
 * stateUpdate och precis innan skylten animeras in.
 */
function refreshIntermissionWaiting() {
  if (!elIntermissionWaiting) return;
  elIntermissionWaiting.textContent =
    computeNextPeriodLabel(elPeriod.textContent);
}

/**
 * Räknar ut den största font-size ett lagnamn kan ha utan att rinna över
 * logon. Långa namn (t.ex. "ROSERSBERG ARLANDA IBK") överskuggar annars
 * logon eftersom .matchup-team-name har white-space: nowrap och min-width: 0
 * – då rinner texten visuellt över logon istället för att krympa span:en.
 *
 * Returnerar { baseSize, desiredSize } i px. desiredSize === baseSize om
 * namnet redan får plats med CSS-default.
 */
function measureTeamNameFit(nameEl) {
  if (!nameEl) return null;
  // Nollställ ev. tidigare skalning så vi alltid mäter mot CSS-baseline
  nameEl.style.fontSize = '';

  const teamEl = nameEl.parentElement;
  if (!teamEl) return null;

  const logoEl = teamEl.querySelector('.matchup-logo-wrap, .intermission-logo-wrap');
  const teamWidth = teamEl.clientWidth;
  const logoWidth = logoEl ? logoEl.getBoundingClientRect().width : 0;
  const teamStyles = getComputedStyle(teamEl);
  const gap = parseFloat(teamStyles.columnGap || teamStyles.gap || '0') || 0;

  const available = teamWidth - logoWidth - gap;
  const natural = nameEl.scrollWidth;
  const baseSize = parseFloat(getComputedStyle(nameEl).fontSize);

  if (available <= 0 || natural <= available) {
    return { baseSize, desiredSize: baseSize };
  }
  // 0.97 = liten säkerhetsmarginal så texten inte snuddar logon
  const scaled = baseSize * (available / natural) * 0.97;
  return { baseSize, desiredSize: scaled };
}

/**
 * Skalar ett par av lagnamn (hemma + borta) symmetriskt: båda får samma
 * font-size, satt till den mindre av de två "önskade" storlekarna. Det
 * ger en balanserad broadcast-look där bortalagets långa namn drar med
 * sig hemmalagets storlek nedåt om det behövs.
 */
function fitTeamNamePair(homeEl, awayEl) {
  const home = measureTeamNameFit(homeEl);
  const away = measureTeamNameFit(awayEl);
  if (!home && !away) return;

  // Båda lagen ska aldrig visas större än CSS-baseline – ta minsta önskad
  const targets = [home, away].filter(Boolean).map(m => m.desiredSize);
  const baseSize = (home || away).baseSize;
  const finalSize = Math.min(baseSize, ...targets);

  // Endast applicera om vi faktiskt behöver krympa – annars rensa override
  // så CSS-default får styra (rem-baserat, följer ev. responsiva regler).
  if (finalSize >= baseSize - 0.5) {
    if (homeEl) homeEl.style.fontSize = '';
    if (awayEl) awayEl.style.fontSize = '';
  } else {
    const px = `${finalSize.toFixed(2)}px`;
    if (homeEl) homeEl.style.fontSize = px;
    if (awayEl) awayEl.style.fontSize = px;
  }
}

/** Skalar matchup- och intermission-radernas lagnamn till matchande storlekar */
function fitAllTeamNames() {
  fitTeamNamePair(elMatchupHomeName, elMatchupAwayName);
  fitTeamNamePair(elIntermissionHomeName, elIntermissionAwayName);
}

/** Returnerar matchstart-tiden som "HH:MM" för matchup-skylten */
function formatMatchStart(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/** Renderar ledare/staff. Format: "ROLL · Förnamn Efternamn" per rad */
function renderLeaders(containerEl, leaders) {
  containerEl.innerHTML = '';
  containerEl.style.removeProperty('--leader-role-width');
  if (!leaders || !leaders.length) return;
  leaders.forEach(l => {
    const row = document.createElement('div');
    row.className = 'leader-row';
    row.innerHTML = `
      <span class="leader-role">${l.role || ''}</span>
      <span class="leader-name">${l.name || ''}</span>`;
    containerEl.appendChild(row);
  });
  // Mät bredaste roll i containern och sätt som min-width så att alla
  // ledarnamn linjerar i samma kolumn även när rollerna varierar i längd
  // (t.ex. TRÄNARE vs MATERIELFÖRVALTARE).
  let maxWidth = 0;
  containerEl.querySelectorAll('.leader-role').forEach(el => {
    const w = el.scrollWidth;
    if (w > maxWidth) maxWidth = w;
  });
  if (maxWidth > 0) {
    containerEl.style.setProperty('--leader-role-width', `${Math.ceil(maxWidth)}px`);
  }
}

/**
 * Renderar spelar-/ledar-lower-third. Visar lagnamn som rubrik, sen
 * antingen tröjnummer + namn (spelare) eller namn + roll under (ledare).
 *
 * När data === null gör vi MEDVETET ingenting med innehållet. Annars
 * skulle texten nollas innan exit-animationen hinner köra och OBS
 * skulle visa en tom box i ~580 ms. Synligheten styrs av .visible-
 * klassen via switchTo() – när panelen blir osynlig spelar det ingen
 * roll att den gamla texten fortfarande ligger i DOM:en, och nästa
 * gång panelen aktiveras får den färsk data innan den fadar in.
 */
function renderPlayerLowerThird(data) {
  if (!elPlayerLt || !data) return;
  elPlayerLtTeam.textContent = (data.teamName || '').toUpperCase();
  elPlayerLtNum.textContent  = data.number || '';
  elPlayerLtRole.textContent = (data.role || '').toUpperCase();
  elPlayerLtName.textContent = data.name || '';
  elPlayerLt.classList.toggle('has-number', !!data.number);
  elPlayerLt.classList.toggle('has-role',   !data.number && !!data.role);
}

/** Formaterar matchtid till "FRE 15/3" + "16:00" för fixtures-listan */
function formatFixtureTime(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const dayNames = ['SÖN', 'MÅN', 'TIS', 'ONS', 'TOR', 'FRE', 'LÖR'];
  const date = `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

/**
 * Renderar omgångens matcher. Varje rad är ett grid:
 * [hemma-namn + logo] [resultat/tid] [borta-logo + namn]
 * Vinnare markeras i highlight-blå, ospelade visar datum + tid.
 */
function renderFixtures(fixtures) {
  elFixturesList.innerHTML = '';
  fixtures.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'fixture-row';
    // Stagger efter att panelen + header glidit in: ~0.55s baseline + 0.06s/rad
    row.style.animationDelay = `${0.55 + i * 0.06}s`;

    const logoHome = f.homeLogo ? `<img class="fix-team-logo" src="${f.homeLogo}" alt="" loading="lazy">` : '';
    const logoAway = f.awayLogo ? `<img class="fix-team-logo" src="${f.awayLogo}" alt="" loading="lazy">` : '';

    let middleHtml;
    if (f.isFinished) {
      const hWin = f.homeGoals > f.awayGoals ? 'fix-score-winner' : '';
      const aWin = f.awayGoals > f.homeGoals ? 'fix-score-winner' : '';
      middleHtml = `
        <div class="fix-result">
          <span class="${hWin}">${f.homeGoals}</span><span class="fix-score-sep">–</span><span class="${aWin}">${f.awayGoals}</span>
        </div>`;
    } else {
      const { date, time } = formatFixtureTime(f.matchDateTime);
      middleHtml = `
        <div class="fix-time">
          <span class="fix-time-date">${date}</span>
          <span>${time}</span>
        </div>`;
    }

    row.innerHTML = `
      <div class="fix-side fix-side-home">
        <span class="fix-team-name">${f.homeTeam}</span>
        ${logoHome}
      </div>
      <div class="fix-middle">${middleHtml}</div>
      <div class="fix-side fix-side-away">
        ${logoAway}
        <span class="fix-team-name">${f.awayTeam}</span>
      </div>`;
    elFixturesList.appendChild(row);
  });
}

/**
 * Renderar tabellkroppen.
 * animation-delay per rad ger en cascade-effekt när tabellen tonas in.
 */
function renderTable(rows) {
  elTableBody.innerHTML = '';
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    // Header tar 0.28s + 0.35s, sen tabellen 0.40s + 0.35s = ~0.55s baseline
    tr.style.animationDelay = `${0.55 + i * 0.05}s`;

    const posClass = `td-pos col-pos${row.pos <= 3 ? ` pos-${row.pos}` : ''}`;
    const logoHtml = row.logo
      ? `<img src="${row.logo}" alt="" class="team-logo" loading="lazy">`
      : '';
    const record = (row.goalsFor != null && row.goalsAgainst != null)
      ? `${row.goalsFor}–${row.goalsAgainst}`
      : '';

    tr.innerHTML = `
      <td class="td-logo col-logo">${logoHtml}</td>
      <td class="${posClass}">${row.pos}</td>
      <td class="td-team col-team">${row.team}</td>
      <td class="td-num col-num">${row.played}</td>
      <td class="td-num col-num">${row.wins ?? ''}</td>
      <td class="td-num col-num">${row.draws ?? ''}</td>
      <td class="td-num col-num">${row.losses ?? ''}</td>
      <td class="td-num col-record">${record}</td>
      <td class="td-num col-diff">${row.diff ?? ''}</td>
      <td class="td-num td-points col-num">${row.points}</td>`;
    elTableBody.appendChild(tr);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// UTVISNINGAR (PENALTIES)
// ════════════════════════════════════════════════════════════════════════════

/** "M:SS" format för en utvisnings remaining-tid (i sekunder) */
function formatPenaltyTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/**
 * Diff-rendering: skapa nya rutor med entry-animation, uppdatera tiden på
 * befintliga, och animera ut rutor som inte längre finns i state innan de
 * tas bort. Sparar DOM-flicker när tiden tickar sekund för sekund.
 */
function renderPenaltyStack(containerEl, penalties) {
  if (!containerEl) return;
  const incomingIds = new Set(penalties.map(p => String(p.id)));

  // Animera ut element som inte längre är med
  Array.from(containerEl.children).forEach(box => {
    if (box.classList.contains('is-removing')) return;
    if (!incomingIds.has(box.dataset.id)) {
      box.classList.add('is-removing');
      box.addEventListener('animationend', () => box.remove(), { once: true });
    }
  });

  // Skapa eller uppdatera kvarvarande
  penalties.forEach(p => {
    let box = containerEl.querySelector(
      `.penalty-box[data-id="${p.id}"]:not(.is-removing)`
    );
    if (!box) {
      box = document.createElement('div');
      box.className = 'penalty-box';
      box.dataset.id = String(p.id);
      box.innerHTML = `
        <span class="penalty-label">UTVISNING</span>
        <span class="penalty-time"></span>`;
      containerEl.appendChild(box);
    }
    box.querySelector('.penalty-time').textContent = formatPenaltyTime(p.remaining);
  });
}

function applyPenalties(home, away) {
  renderPenaltyStack(elPenaltiesHome, home || []);
  renderPenaltyStack(elPenaltiesAway, away || []);
}


// ════════════════════════════════════════════════════════════════════════════
// STATISTIK INFÖR MATCH
// Renderar IBIS' pregamestats-data + härledda PP/BP-värden. Rader spelas
// upp i en kaskad – samma stagger-mönster som tabellen.
// ════════════════════════════════════════════════════════════════════════════

/** Sekventiella rader för pre-game-tabellen. Section-poster spänner alla
 *  tre kolumner. html: true betyder att värdet redan är säker HTML
 *  (används för Senaste 5-prickarna). */
function preGameRowsFor(data) {
  return [
    { label: 'Tabellplacering',  h: data.home.ranking,          a: data.away.ranking,          big: true },
    { label: 'Inbördes möten',   h: data.home.meetingWins,      a: data.away.meetingWins,      big: true },
    { label: 'Senaste mötet',    h: data.home.goalsLastMeeting, a: data.away.goalsLastMeeting, big: true },
    { label: 'Senaste 5 matcherna', h: lastDotsHtml(data.home.lastGames),
                                    a: lastDotsHtml(data.away.lastGames), html: true },
    { section: 'Powerplay' },
    { label: 'Antal PP',                h: data.home.numberOfPPs,    a: data.away.numberOfPPs,    big: true },
    { label: 'Effektivitet i PP',       h: data.home.ppEffectivity,  a: data.away.ppEffectivity,  big: true },
    { label: 'Gjorda mål i PP',         h: data.home.ppGoalsScored,  a: data.away.ppGoalsScored },
    { label: 'Snittid gjorda mål i PP', h: data.home.ppAvgGoalTime,  a: data.away.ppAvgGoalTime },
    { label: 'Insläppta mål i PP',      h: data.home.ppGoalsAgainst, a: data.away.ppGoalsAgainst },
    { section: 'Boxplay' },
    { label: 'Antal BP',                h: data.home.numberOfBPs,    a: data.away.numberOfBPs,    big: true },
    { label: 'Effektivitet i BP',       h: data.home.bpEffectivity,  a: data.away.bpEffectivity,  big: true },
    { label: 'Insläppta mål i BP',      h: data.home.bpGoalsAgainst, a: data.away.bpGoalsAgainst },
    { label: 'Snittid insläppta mål i BP', h: data.home.bpAvgGoalAgainstTime,
                                           a: data.away.bpAvgGoalAgainstTime },
    { label: 'Gjorda mål i BP',         h: data.home.bpGoalsScored,  a: data.away.bpGoalsScored }
  ];
}

function lastDotsHtml(lastGames) {
  if (!Array.isArray(lastGames) || !lastGames.length) {
    return '<span class="pg-muted">saknas</span>';
  }
  return `<span class="pg-dots">` + lastGames.map(g =>
    `<span class="pg-dot" style="background:${g.color}"></span>`
  ).join('') + `</span>`;
}

function escapeHtmlGfx(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderPreGameStats(data) {
  if (!data) {
    elPgTableBody.innerHTML = '';
    return;
  }
  elPgHomeName.textContent = (data.home.teamName || 'HEMMA').toUpperCase();
  elPgAwayName.textContent = (data.away.teamName || 'BORTA').toUpperCase();
  renderLogo(elPgHomeLogo, data.home.logo, data.home.teamName);
  renderLogo(elPgAwayLogo, data.away.logo, data.away.teamName);

  const rows = preGameRowsFor(data);
  elPgTableBody.innerHTML = rows.map((r, i) => {
    // Stagger – header tar 0.28-0.36s, sen rader 0.04s extra per rad
    const delay = `${0.55 + i * 0.04}s`;
    if (r.section) {
      return `<tr class="pg-row pg-section-row" style="animation-delay:${delay}"><td colspan="3">${escapeHtmlGfx(r.section)}</td></tr>`;
    }
    const sizeCls = r.big ? ' pg-big' : '';
    const hCell = r.html ? r.h : escapeHtmlGfx(r.h);
    const aCell = r.html ? r.a : escapeHtmlGfx(r.a);
    return `<tr class="pg-row${sizeCls}" style="animation-delay:${delay}">
      <td class="pg-val pg-val-home">${hCell}</td>
      <td class="pg-label">${escapeHtmlGfx(r.label)}</td>
      <td class="pg-val pg-val-away">${aCell}</td>
    </tr>`;
  }).join('');
}


// ════════════════════════════════════════════════════════════════════════════
// SOCKET-LYSSNARE
// ════════════════════════════════════════════════════════════════════════════

/** Fullständigt state – vid anslutning och dataf-uppdateringar */
socket.on('stateUpdate', (state) => {
  // Poängtavla
  const prevA = parseInt(elScoreA.textContent, 10);
  const prevB = parseInt(elScoreB.textContent, 10);
  // Scoreboard visar förkortningar (med fallback till fullnamn)
  elTeamA.textContent  = state.teamAShort || state.teamA;
  elTeamB.textContent  = state.teamBShort || state.teamB;
  elScoreA.textContent = state.scoreA;
  elScoreB.textContent = state.scoreB;
  renderClock(state.clock);
  if (state.scoreA !== prevA) bumpScore(elScoreA);
  if (state.scoreB !== prevB) bumpScore(elScoreB);
  elClock.classList.toggle('running', state.clockRunning);

  // Period: 1-3 → "Period 1/2/3", 4 → "Övertid", 5 → "Straffar"
  const p = state.period || 1;
  elPeriod.textContent = p <= 3 ? `Period ${p}` : p === 4 ? 'Övertid' : 'Straffar';

  // Uppställningar & tabell – uppdatera data, rör inte synligheten
  elLineupHomeTitle.textContent = state.teamA;
  elLineupAwayTitle.textContent = state.teamB;
  renderLineup(elLineupHomeGrid, state.lineupHome || []);
  renderLineup(elLineupAwayGrid, state.lineupAway || []);
  renderTable(state.table || []);
  elTableEyebrow.textContent = (state.tableName || 'INNEBANDY').toUpperCase();

  // Omgångens matcher
  renderFixtures(state.fixtures || []);
  elFixturesTitle.textContent = state.fixturesTitle || 'Spelprogram';

  // Klock-visibility (default = true om fältet saknas i äldre state)
  const showClock = state.clockVisible !== false;
  elScoreboard.classList.toggle('clock-hidden', !showClock);

  // Kommentator-skylt: text + visa endast namn som har innehåll
  const c = state.commentators || { name1: '', name2: '' };
  elCommentator1.textContent = c.name1 || '';
  elCommentator2.textContent = c.name2 || '';

  // Matchup-skylt: fullnamn + logos + venue + matchstart (med fallback)
  elMatchupHomeName.textContent = state.teamA || 'HEMMA';
  elMatchupAwayName.textContent = state.teamB || 'BORTA';
  elMatchupVenue.textContent    = state.venue || '—';
  elMatchupStart.textContent    = formatMatchStart(state.matchStart);
  // Division/serie överst – återanvänder tableName (samma competition)
  elMatchupCompetition.textContent = state.tableName || '';
  renderLogo(elMatchupHomeLogo, state.homeLogo, state.teamA);
  renderLogo(elMatchupAwayLogo, state.awayLogo, state.teamB);

  // Intermission-skylt: speglar fullnamn + logos från scoreboard-laget och
  // håller "VI VÄNTAR PÅ …"-texten i synk med periodvärdet i state.
  elIntermissionHomeName.textContent = state.teamA || 'HEMMA';
  elIntermissionAwayName.textContent = state.teamB || 'BORTA';
  renderLogo(elIntermissionHomeLogo, state.homeLogo, state.teamA);
  renderLogo(elIntermissionAwayLogo, state.awayLogo, state.teamB);

  // Auto-shrink långa lagnamn så de ryms i grid-cellen utan radbrytning.
  // Kör synkront (mätningen av scrollWidth triggar reflow så vi får färska
  // värden direkt) och dessutom i nästa frame för fall där logo-bilder
  // eller webfonts byts in efteråt och påverkar bredden. rAF används inte
  // ensamt – det är throttlat i dolda flikar (OBS-källor är synliga så
  // där fungerar det, men sync-anropet gör oss robusta även annars).
  fitAllTeamNames();
  requestAnimationFrame(fitAllTeamNames);
  // Använd numeriska state.period direkt – computeNextPeriodLabel hanterar
  // både number och string så det är robust mot framtida förändringar.
  elIntermissionWaiting.textContent = computeNextPeriodLabel(state.period);

  // Ledare för uppställningarna
  renderLeaders(elLineupHomeLeadersList, state.lineupHomeLeaders || []);
  renderLeaders(elLineupAwayLeadersList, state.lineupAwayLeaders || []);

  // Spelar-/ledar-lower-third
  renderPlayerLowerThird(state.playerLowerThird);

  // Statistik inför match – hydrera DOM. Skylten visas/döljs via
  // switchTo()/graphicState så vi rör inte synligheten här.
  renderPreGameStats(state.preGameStats || null);

  // Utvisningar – hydrera från full state vid connect/reload, sen sköter
  // penaltiesUpdate sekund-för-sekund-tickande utan att rebuild:a DOM.
  applyPenalties(state.penaltiesHome, state.penaltiesAway);
});

socket.on('penaltiesUpdate', ({ penaltiesHome, penaltiesAway }) => {
  applyPenalties(penaltiesHome, penaltiesAway);
});

socket.on('clockTick',   ({ clock })   => { renderClock(clock); });
socket.on('clockStatus', ({ running }) => { elClock.classList.toggle('running', running); });

/**
 * graphicState – skickas till ny klient vid anslutning.
 * Återställer korrekt visningsläge omedelbart, utan animation-fördröjning,
 * så att OBS får rätt bild direkt vid sidladdning.
 */
socket.on('graphicState', ({ activeGraphic }) => {
  transitioning = false;
  activeKey     = activeGraphic;

  // Sätt alla element till rätt state direkt – respekterar overlays
  setVisible('scoreboard', shouldShowScoreboard(activeGraphic));
  Object.keys(graphicElements).forEach(key => {
    setVisible(key, key === activeGraphic);
  });
});

/**
 * switchGraphic – triggas av kontrollpanelen via servern.
 * Kör den sekventiella animationen (ut → in).
 */
socket.on('switchGraphic', ({ to }) => {
  switchTo(to);
});

// Räkna om team-namnens auto-shrink när viewport ändras (OBS-källans
// storlek, fönsterstorlek) och när webfonts laddats klart (annars mäter
// vi mot fallback-fonten och kan ge fel skalning).
window.addEventListener('resize', () => requestAnimationFrame(fitAllTeamNames));
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => requestAnimationFrame(fitAllTeamNames));
}
