const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// Statiska filer (control.html, graphics.html, css, js).
// Dev-läge: ingen cache så att ändringar slår igenom direkt utan hard refresh.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));

// ── Matchstate ───────────────────────────────────────────────────────────────
let matchState = {
  teamA: 'Lag A',
  teamB: 'Lag B',
  teamAShort: 'Lag A',
  teamBShort: 'Lag B',
  scoreA: 0,
  scoreB: 0,
  clock: '00:00',
  clockRunning: false,
  clockVisible: true,
  period: 1,
  lineupHome: [],
  lineupAway: [],
  lineupHomeLeaders: [],   // [{name, role}, ...]
  lineupAwayLeaders: [],
  table: [],
  tableName: '',
  fixtures: [],
  fixturesTitle: '',     // t.ex. "Omgång 22"
  commentators: { name1: '', name2: '' },
  venue: '',
  homeLogo: '',
  awayLogo: '',
  matchStart: ''         // ISO datetime, t.ex. "2026-03-15T16:00:00"
};

// activeGraphic styr vad som visas på skärmen.
// Möjliga värden: 'scoreboard' | 'lineupHome' | 'lineupAway' | 'table' | 'none'
let graphicState = {
  activeGraphic: 'none'
};

// Hjälpare – broadcasta hela matchState till alla anslutna klienter.
const broadcastState = () => io.emit('stateUpdate', matchState);

// ── Intern klocka ────────────────────────────────────────────────────────────
let clockInterval = null;
let elapsedSeconds = 0;

function formatTime(s) {
  return `${Math.floor(s / 60).toString().padStart(2,'0')}:${(s % 60).toString().padStart(2,'0')}`;
}

function startClock() {
  if (clockInterval) return;
  matchState.clockRunning = true;
  clockInterval = setInterval(() => {
    elapsedSeconds++;
    matchState.clock = formatTime(elapsedSeconds);
    io.emit('clockTick', { clock: matchState.clock });
  }, 1000);
}

function pauseClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  matchState.clockRunning = false;
}

function resetClock() {
  pauseClock();
  elapsedSeconds = 0;
  matchState.clock = '00:00';
  io.emit('stateUpdate', matchState);
}

// Nollställer all matchdata till defaultvärden – används för "Rensa cache" /
// "Nollställ match" mellan sändningar så nästa match börjar från tomt blad.
// Stannar klockan, nollar period, tömmer lineups/tabell/omgång/kommentatorer
// /venue/logos och växlar tillbaka till scoreboarden som default-grafik.
function resetMatchState() {
  pauseClock();
  elapsedSeconds = 0;
  matchState = {
    teamA: 'Lag A',
    teamB: 'Lag B',
    teamAShort: 'Lag A',
    teamBShort: 'Lag B',
    scoreA: 0,
    scoreB: 0,
    clock: '00:00',
    clockRunning: false,
    clockVisible: true,
    period: 1,
    lineupHome: [],
    lineupAway: [],
    lineupHomeLeaders: [],
    lineupAwayLeaders: [],
    table: [],
    tableName: '',
    fixtures: [],
    fixturesTitle: '',
    commentators: { name1: '', name2: '' },
    venue: '',
    homeLogo: '',
    awayLogo: '',
    matchStart: ''
  };
  graphicState.activeGraphic = 'none';
  io.emit('stateUpdate', matchState);
  io.emit('switchGraphic', { to: 'none' });
  io.emit('clockStatus', { running: false });
  io.emit('matchStateReset');
  console.log('Matchdata nollställd');
}

// ── Texthjälp ────────────────────────────────────────────────────────────────
// Rensar bort radbrytningar, tabs och dubbla mellanslag från en sträng.
const cleanText = (str) =>
  (str || '').replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

// ── Axios-hjälpfunktion ──────────────────────────────────────────────────────
// Hämtar HTML från en URL med korrekt User-Agent för att undvika blockering.
async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/124.0 Safari/537.36',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8'
    }
  });
  return data;
}

// ── Innebandy Stats API ──────────────────────────────────────────────────────
// stats.innebandy.se är en SPA som hämtar data från ett REST-API.
// Steg 1: Hämta en kortlivad JWT från startkit-endpointen.
// Steg 2: Anropa relevant endpoint (standings/lineups) med Bearer-token.

// Gemensam token-helper – returnerar { accessToken, apiRoot, headers }.
async function getInnebandyAuth() {
  const { data: kit } = await axios.get(
    'https://api.innebandy.se/StatsAppApi/api/startkit',
    {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
                      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept':     'application/json',
        'Referer':    'https://stats.innebandy.se/'
      }
    }
  );
  return {
    apiRoot: kit.apiRoot,
    headers: {
      'Authorization': `Bearer ${kit.accessToken}`,
      'Accept':        'application/json',
      'Referer':       'https://stats.innebandy.se/'
    }
  };
}

// Formaterar en spelare till strängen "{nummer} {namn}".
// Sorterar samtliga spelare numeriskt på tröjnummer (1 → 99).
function formatPlayers(apiPlayers) {
  return [...apiPlayers]
    .sort((a, b) => (a.ShirtNo || 0) - (b.ShirtNo || 0))
    .map(p => `${p.ShirtNo} ${p.Name}`.trim());
}

// Formaterar ledare/staff till { name, role }. Sorterar tränare först.
function formatPersons(apiPersons) {
  const roleWeight = (r) => /tränare|huvudtränare/i.test(r) ? 0 : 1;
  return [...apiPersons]
    .sort((a, b) => {
      const w = roleWeight(a.RoleName || '') - roleWeight(b.RoleName || '');
      return w !== 0 ? w : (a.Name || '').localeCompare(b.Name || '', 'sv');
    })
    .map(p => ({ name: p.Name || '', role: p.RoleName || '' }));
}

// Hämtar uppställningar för en match-URL.
// URL-format: .../match/{matchId}/laguppstallning
async function fetchInnebandyLineup(url) {
  const match = url.match(/\/match\/(\d+)/);
  if (!match) throw new Error('Kunde inte hitta match-ID i URL:en');
  const matchId = match[1];

  const { apiRoot, headers } = await getInnebandyAuth();

  // Hämta uppställning + match-meta parallellt. Lineup-endpointen ger spelare
  // + logos; match-endpointen ger Venue (spelplats) m.m.
  const [lineupRes, detailRes] = await Promise.allSettled([
    axios.get(`${apiRoot}matches/${matchId}/lineups`, { timeout: 10000, headers }),
    axios.get(`${apiRoot}matches/${matchId}`,         { timeout: 10000, headers })
  ]);

  if (lineupRes.status === 'rejected') {
    throw lineupRes.reason;
  }
  const data   = lineupRes.value.data;
  const detail = detailRes.status === 'fulfilled' ? detailRes.value.data : {};

  return {
    homeName:      data.HomeTeam || '',
    awayName:      data.AwayTeam || '',
    homeShortName: data.HomeTeamShortName || '',
    awayShortName: data.AwayTeamShortName || '',
    homeLogo:      data.HomeTeamLogotypeUrl || '',
    awayLogo:      data.AwayTeamLogotypeUrl || '',
    venue:         detail.Venue || '',
    matchStart:    detail.MatchDateTime || '',
    home:          formatPlayers(data.HomeTeamPlayers || []),
    away:          formatPlayers(data.AwayTeamPlayers || []),
    homeLeaders:   formatPersons(data.HomeTeamTeamPersons || []),
    awayLeaders:   formatPersons(data.AwayTeamTeamPersons || [])
  };
}

// ── Innebandy Stats API – Omgångens matcher ─────────────────────────────────
// Hämtar alla matcher i serien, identifierar målrunda via källmatchens MatchID
// och returnerar { roundName, fixtures }. Matchen från URL:en ingår också.
async function fetchInnebandyFixtures(matchUrl) {
  const m = matchUrl.match(/\/sasong\/(\d+)\/serie\/(\d+)\/match\/(\d+)/);
  if (!m) throw new Error('Kunde inte hitta match-ID i URL:en');
  const [, , competitionId, matchId] = m;
  const matchIdNum = parseInt(matchId, 10);

  const { apiRoot, headers } = await getInnebandyAuth();
  const { data } = await axios.get(
    `${apiRoot}competitions/${competitionId}/matches`,
    { timeout: 10000, headers }
  );

  if (!Array.isArray(data)) throw new Error('Oväntat API-svar för spelschemat');

  // Hitta källmatchen för att bestämma vilken omgång vi vill visa
  const source = data.find(x => x.MatchID === matchIdNum);
  if (!source) throw new Error('Kunde inte hitta källmatchen i schemat');

  const round = source.Round;
  const roundName = source.RoundName || (round != null ? `Omgång ${round}` : '');

  // Filtrera till matcher i samma omgång, sortera kronologiskt
  const fixtures = data
    .filter(x => x.Round === round)
    .sort((a, b) => new Date(a.MatchDateTime) - new Date(b.MatchDateTime))
    .map(x => ({
      matchId:       x.MatchID,
      homeTeam:      x.HomeTeam || '',
      awayTeam:      x.AwayTeam || '',
      homeShortName: x.HomeTeamShortName || '',
      awayShortName: x.AwayTeamShortName || '',
      homeLogo:      x.HomeTeamLogotypeUrl || '',
      awayLogo:      x.AwayTeamLogotypeUrl || '',
      matchDateTime: x.MatchDateTime || '',
      homeGoals:     (x.GoalsHomeTeam != null) ? x.GoalsHomeTeam : null,
      awayGoals:     (x.GoalsAwayTeam != null) ? x.GoalsAwayTeam : null,
      isFinished:    x.GoalsHomeTeam != null && x.GoalsAwayTeam != null
    }));

  return { roundName, fixtures };
}

// ── Kombinerad hämtning: match + serietabell från en enda match-URL ─────────
// Härleder säsong + serie ur match-URL:en och hämtar bägge endpoints parallellt
// med Promise.allSettled. Om tabellen inte finns (t.ex. träningsmatch utan
// serietabell) returneras matchdatan ändå – med standingsError satt.
async function fetchInnebandyAll(matchUrl) {
  const m = matchUrl.match(/\/sasong\/(\d+)\/serie\/(\d+)\/match\/(\d+)/);
  if (!m) {
    throw new Error('URL:en måste innehålla /sasong/X/serie/Y/match/Z – kontrollera länken');
  }
  const [, season, competition, matchId] = m;

  // Normalisera till de officiella sid-URL:erna (de helper-funktioner
  // vi anropar nedan extraherar ID:n ur URL:erna själva).
  const normalizedMatchUrl = `https://stats.innebandy.se/sasong/${season}/serie/${competition}/match/${matchId}/laguppstallning`;
  const standingsUrl       = `https://stats.innebandy.se/sasong/${season}/serie/${competition}/serietabell`;
  const fixturesUrl        = `https://stats.innebandy.se/sasong/${season}/serie/${competition}/spelprogram`;

  // Parallell hämtning – misslyckas en sida fortsätter de andra ändå
  const [lineupRes, standingsRes, fixturesRes] = await Promise.allSettled([
    fetchInnebandyLineup(normalizedMatchUrl),
    fetchInnebandyStandings(standingsUrl),
    fetchInnebandyFixtures(normalizedMatchUrl)
  ]);

  // Match-data är obligatorisk – utan den finns inget meningsfullt att returnera
  if (lineupRes.status === 'rejected') {
    throw new Error(`Match-data kunde inte hämtas: ${lineupRes.reason.message}`);
  }

  const lineup = lineupRes.value;
  const out = {
    success: true,
    match: {
      homeTeam:      lineup.homeName,
      awayTeam:      lineup.awayName,
      homeShortName: lineup.homeShortName,
      awayShortName: lineup.awayShortName,
      homeLogo:      lineup.homeLogo,
      awayLogo:      lineup.awayLogo,
      venue:         lineup.venue,
      matchStart:    lineup.matchStart,
      homeRoster:    lineup.home,
      awayRoster:    lineup.away,
      homeLeaders:   lineup.homeLeaders,
      awayLeaders:   lineup.awayLeaders
    },
    standings:      null,
    standingsName:  '',
    standingsError: null,
    fixtures:       [],
    fixturesTitle:  '',
    fixturesError:  null
  };

  if (standingsRes.status === 'fulfilled') {
    out.standings     = standingsRes.value.rows;
    out.standingsName = standingsRes.value.name;
  } else {
    out.standingsError = standingsRes.reason.message;
  }

  if (fixturesRes.status === 'fulfilled') {
    out.fixtures      = fixturesRes.value.fixtures;
    out.fixturesTitle = fixturesRes.value.roundName;
  } else {
    out.fixturesError = fixturesRes.reason.message;
  }

  return out;
}

async function fetchInnebandyStandings(url) {
  const match = url.match(/\/serie\/(\d+)/);
  if (!match) throw new Error('Kunde inte hitta serie-ID i URL:en');
  const competitionId = match[1];

  const { apiRoot, headers } = await getInnebandyAuth();

  // Hämta seriens metadata + tabell parallellt
  const [metaResp, standingsResp] = await Promise.all([
    axios.get(`${apiRoot}competitions/${competitionId}`,
      { timeout: 10000, headers }),
    axios.get(`${apiRoot}competitions/${competitionId}/standings`,
      { timeout: 10000, headers })
  ]);

  const name = metaResp.data?.Name || '';

  const standingsRows = standingsResp.data.StandingsRows
    || standingsResp.data.standingsRows
    || standingsResp.data
    || [];
  if (!Array.isArray(standingsRows)) throw new Error('Oväntat API-svar');

  const rows = standingsRows.map(r => {
    const played       = (r.PlayedMatchesHome || 0) + (r.PlayedMatchesAway || 0);
    const wins         = (r.WinsHome   || 0) + (r.WinsAway   || 0)
                       + (r.SdWinsHome || 0) + (r.SdWinsAway || 0);
    const draws        = (r.DrawsHome  || 0) + (r.DrawsAway  || 0);
    const losses       = (r.LossesHome || 0) + (r.LossesAway || 0);
    const goalsFor     = (r.GoalsScoredHome  || 0) + (r.GoalsScoredAway  || 0);
    const goalsAgainst = (r.GoalsAgainstHome || 0) + (r.GoalsAgainstAway || 0);
    const diff         = r.ScoringDiff != null
      ? (r.ScoringDiff > 0 ? `+${r.ScoringDiff}` : String(r.ScoringDiff))
      : '';
    return {
      pos:    r.Position,
      team:   r.TeamName,
      logo:   r.TeamLogotypeUrl || '',
      played,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      diff,
      points: r.Points
    };
  }).sort((a, b) => a.pos - b.pos);

  return { name, rows };
}

// ── Socket-hantering ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Klient ansluten: ${socket.id}`);

  // Ny klient får aktuellt state + vilken grafik som är aktiv
  socket.emit('stateUpdate', matchState);
  socket.emit('graphicState', graphicState);

  // ── Poängtavla ───────────────────────────────────────────────────────────
  socket.on('updateNames', ({ teamA, teamB, teamAShort, teamBShort }) => {
    if (teamA != null) matchState.teamA = teamA || matchState.teamA;
    if (teamB != null) matchState.teamB = teamB || matchState.teamB;
    // Förkortning: använd inskickad short, annars första 6 tecken av fullnamn
    if (teamAShort !== undefined) {
      matchState.teamAShort = teamAShort || matchState.teamA.slice(0, 6);
    } else if (teamA) {
      matchState.teamAShort = matchState.teamA.slice(0, 6);
    }
    if (teamBShort !== undefined) {
      matchState.teamBShort = teamBShort || matchState.teamB.slice(0, 6);
    } else if (teamB) {
      matchState.teamBShort = matchState.teamB.slice(0, 6);
    }
    io.emit('stateUpdate', matchState);
  });

  socket.on('updateScore', ({ team, delta }) => {
    if (team === 'A') matchState.scoreA = Math.max(0, matchState.scoreA + delta);
    if (team === 'B') matchState.scoreB = Math.max(0, matchState.scoreB + delta);
    io.emit('stateUpdate', matchState);
  });

  socket.on('clockStart', () => { startClock(); io.emit('clockStatus', { running: true }); });
  socket.on('clockPause', () => { pauseClock(); io.emit('clockStatus', { running: false }); });
  socket.on('clockReset', () => { resetClock(); io.emit('clockStatus', { running: false }); });

  // Period via socket (HTTP-rutter finns också för Stream Deck)
  socket.on('periodNext', () => {
    matchState.period = Math.min(5, (matchState.period || 1) + 1);
    io.emit('stateUpdate', matchState);
  });
  socket.on('periodReset', () => {
    matchState.period = 1;
    io.emit('stateUpdate', matchState);
  });

  // Dölj/visa klockan (period förblir alltid synlig)
  socket.on('setClockVisibility', ({ visible }) => {
    matchState.clockVisible = !!visible;
    io.emit('stateUpdate', matchState);
  });
  socket.on('toggleClockVisibility', () => {
    matchState.clockVisible = !matchState.clockVisible;
    io.emit('stateUpdate', matchState);
  });

  // ── Laguppställningar & Tabell (data-uppdateringar) ──────────────────────
  socket.on('updateLineups', ({ home, away, homeLeaders, awayLeaders }) => {
    if (Array.isArray(home))         matchState.lineupHome        = home;
    if (Array.isArray(away))         matchState.lineupAway        = away;
    if (Array.isArray(homeLeaders))  matchState.lineupHomeLeaders = homeLeaders;
    if (Array.isArray(awayLeaders))  matchState.lineupAwayLeaders = awayLeaders;
    io.emit('stateUpdate', matchState);
  });

  socket.on('updateTable', (payload) => {
    // Accepterar antingen en array (rader) eller { rows, name }.
    if (Array.isArray(payload)) {
      matchState.table     = payload;
      matchState.tableName = '';
    } else if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.rows)) matchState.table = payload.rows;
      matchState.tableName = typeof payload.name === 'string' ? payload.name : '';
    }
    io.emit('stateUpdate', matchState);
  });

  // Kommentatorer (lower-third)
  socket.on('updateCommentators', ({ name1, name2 }) => {
    matchState.commentators = {
      name1: typeof name1 === 'string' ? name1.trim() : matchState.commentators.name1,
      name2: typeof name2 === 'string' ? name2.trim() : matchState.commentators.name2
    };
    io.emit('stateUpdate', matchState);
  });

  // Match-meta (venue + logos + matchstart) – kontrollpanelen pushar dessa
  // efter fetch så att användaren även kan redigera Venue innan visning.
  socket.on('updateMatchMeta', ({ venue, homeLogo, awayLogo, matchStart }) => {
    if (typeof venue      === 'string') matchState.venue      = venue.trim();
    if (typeof homeLogo   === 'string') matchState.homeLogo   = homeLogo;
    if (typeof awayLogo   === 'string') matchState.awayLogo   = awayLogo;
    if (typeof matchStart === 'string') matchState.matchStart = matchStart;
    io.emit('stateUpdate', matchState);
  });

  socket.on('updateFixtures', (payload) => {
    if (Array.isArray(payload)) {
      matchState.fixtures      = payload;
      matchState.fixturesTitle = '';
    } else if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.fixtures)) matchState.fixtures = payload.fixtures;
      matchState.fixturesTitle = typeof payload.title === 'string' ? payload.title : '';
    }
    io.emit('stateUpdate', matchState);
  });

  // ── Exklusiv grafik-växling ──────────────────────────────────────────────
  // Kontrollpanelen skickar vilket element som ska vara aktivt.
  // Servern sparar state så att nya klienter (OBS-reload) återfår rätt bild.
  socket.on('switchGraphic', ({ to }) => {
    const allowed = ['scoreboard', 'lineupHome', 'lineupAway', 'table', 'fixtures',
                     'commentators', 'matchup', 'intermission', 'none'];
    if (!allowed.includes(to)) return;
    graphicState.activeGraphic = to;
    io.emit('switchGraphic', { to });
    console.log(`Grafik-byte → ${to}`);
  });

  // ── API: stats.innebandy.se – Allt på en gång (match + serietabell) ─────
  socket.on('fetch_innebandy_all_data', async ({ url }) => {
    if (!url) return;
    console.log(`Hämtar all data: ${url}`);
    try {
      const data = await fetchInnebandyAll(url);
      socket.emit('fetch_result_innebandy_all_data', data);

      const tabStatus = data.standings
        ? `${data.standings.length} lag (${data.standingsName})`
        : `EJ HÄMTAD (${data.standingsError})`;
      console.log(`  → ${data.match.homeTeam} (${data.match.homeRoster.length}) vs ${data.match.awayTeam} (${data.match.awayRoster.length}) | Tabell: ${tabStatus}`);
    } catch (err) {
      console.error(`  → Fel: ${err.message}`);
      socket.emit('fetch_error', {
        context: 'innebandy_all',
        message: err.message
      });
    }
  });

  // ── Nollställ match (rensa all matchdata) ─────────────────────────────────
  socket.on('resetMatchState', () => {
    resetMatchState();
  });

  socket.on('disconnect', () => {
    console.log(`Klient frånkopplad: ${socket.id}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HTTP-API – för Elgato Stream Deck (eller annan extern trigger)
//
// Alla rutter är GET så att Stream Deck "Website"-actionen (eller curl) kan
// utlösa dem utan body. Varje rutt:
//   1. Uppdaterar serverns matchState/graphicState
//   2. Broadcastar samma socket-event som webb-kontrollpanelen skulle gjort
//   3. Returnerar res.json() omedelbart – Stream Deck timeoutar inte
// ════════════════════════════════════════════════════════════════════════════

// ── Poäng ────────────────────────────────────────────────────────────────────
function applyScore(team, delta) {
  if (team === 'A') matchState.scoreA = Math.max(0, matchState.scoreA + delta);
  if (team === 'B') matchState.scoreB = Math.max(0, matchState.scoreB + delta);
  broadcastState();
  return { scoreA: matchState.scoreA, scoreB: matchState.scoreB };
}

app.get('/api/score/home/add', (_req, res) => res.json({ success: true, ...applyScore('A',  1) }));
app.get('/api/score/home/sub', (_req, res) => res.json({ success: true, ...applyScore('A', -1) }));
app.get('/api/score/away/add', (_req, res) => res.json({ success: true, ...applyScore('B',  1) }));
app.get('/api/score/away/sub', (_req, res) => res.json({ success: true, ...applyScore('B', -1) }));

// ── Klocka ───────────────────────────────────────────────────────────────────
app.get('/api/clock/start', (_req, res) => {
  startClock();
  io.emit('clockStatus', { running: true });
  res.json({ success: true, running: true });
});

app.get('/api/clock/pause', (_req, res) => {
  pauseClock();
  io.emit('clockStatus', { running: false });
  res.json({ success: true, running: false });
});

app.get('/api/clock/reset', (_req, res) => {
  resetClock();
  io.emit('clockStatus', { running: false });
  res.json({ success: true, running: false, clock: matchState.clock });
});

app.get('/api/clock/toggle_visibility', (_req, res) => {
  matchState.clockVisible = !matchState.clockVisible;
  broadcastState();
  res.json({ success: true, clockVisible: matchState.clockVisible });
});

// ── Grafikväxling ────────────────────────────────────────────────────────────
// /api/graphic/scoreboard|lineupHome|lineupAway|table|clear
// 'clear' = göm alla grafiker (även scoreboarden) – ren feed för bildbyte etc.
// Toggle-rutt: visa kommentator-skylten om den är dold, dölj om den visas.
// Smidigt för Stream Deck – en knapp gör båda.
app.get('/api/graphic/commentators/toggle', (_req, res) => {
  const currently = graphicState.activeGraphic;
  const target    = currently === 'commentators' ? 'scoreboard' : 'commentators';

  graphicState.activeGraphic = target;
  io.emit('switchGraphic', { to: target });
  io.emit('stateUpdate', matchState);
  console.log(`HTTP-toggle kommentatorer → ${target}`);
  res.json({ success: true, activeGraphic: target });
});

app.get('/api/graphic/:target', (req, res) => {
  const allowed = ['scoreboard', 'lineupHome', 'lineupAway', 'table', 'fixtures',
                   'commentators', 'matchup', 'intermission', 'clear'];
  const target  = req.params.target;
  if (!allowed.includes(target)) {
    return res.status(400).json({ success: false, error: `Okänd grafik: ${target}` });
  }
  const to = target === 'clear' ? 'none' : target;

  // Validering: vägra växla till en grafik som saknar data – ger Stream Deck
  // tydlig feedback istället för att tyst visa en tom panel.
  if (to === 'commentators' &&
      !matchState.commentators.name1 && !matchState.commentators.name2) {
    return res.status(400).json({
      success: false,
      error: 'Inga kommentatorer angivna. Fyll i namn i kontrollpanelen först.'
    });
  }
  if (to === 'matchup' && !matchState.teamA && !matchState.teamB) {
    return res.status(400).json({
      success: false,
      error: 'Inga lagnamn lagrade. Hämta en match först.'
    });
  }
  if (to === 'intermission' && !matchState.teamA && !matchState.teamB) {
    return res.status(400).json({
      success: false,
      error: 'Inga lagnamn lagrade. Hämta en match först.'
    });
  }
  if (to === 'lineupHome' && !matchState.lineupHome.length) {
    return res.status(400).json({
      success: false,
      error: 'Ingen hemmalagsuppställning lagrad. Hämta en match i kontrollpanelen först.'
    });
  }
  if (to === 'lineupAway' && !matchState.lineupAway.length) {
    return res.status(400).json({
      success: false,
      error: 'Ingen bortalagsuppställning lagrad. Hämta en match i kontrollpanelen först.'
    });
  }
  if (to === 'table' && !matchState.table.length) {
    return res.status(400).json({
      success: false,
      error: 'Ingen tabelldata lagrad. Hämta en match i kontrollpanelen först.'
    });
  }
  if (to === 'fixtures' && !matchState.fixtures.length) {
    return res.status(400).json({
      success: false,
      error: 'Ingen omgångsdata lagrad. Hämta en match i kontrollpanelen först.'
    });
  }

  graphicState.activeGraphic = to;
  io.emit('switchGraphic', { to });
  // Defense in depth: pusha även färsk state så ev. klienter med stale data
  // (t.ex. OBS Browser Source med cachat innehåll) får senaste värdena.
  io.emit('stateUpdate', matchState);
  console.log(`HTTP-grafikbyte → ${to}`);
  res.json({ success: true, activeGraphic: to });
});

// ── Period ───────────────────────────────────────────────────────────────────
// Floorball: 1, 2, 3 = ordinarie perioder, 4 = övertid (ÖT), 5 = straffläggning.
// /next stegar uppåt och kapar vid 5. /reset hoppar tillbaka till 1.
app.get('/api/period/next', (_req, res) => {
  matchState.period = Math.min(5, (matchState.period || 1) + 1);
  broadcastState();
  res.json({ success: true, period: matchState.period });
});

app.get('/api/period/reset', (_req, res) => {
  matchState.period = 1;
  broadcastState();
  res.json({ success: true, period: 1 });
});

// ── Nollställ match ──────────────────────────────────────────────────────────
app.get('/api/reset', (_req, res) => {
  resetMatchState();
  res.json({ success: true });
});

// ── Statusfråga (för Stream Deck-feedback) ───────────────────────────────────
app.get('/api/state', (_req, res) => {
  res.json({
    success: true,
    teamA:        matchState.teamA,
    teamB:        matchState.teamB,
    teamAShort:   matchState.teamAShort,
    teamBShort:   matchState.teamBShort,
    scoreA:       matchState.scoreA,
    scoreB:       matchState.scoreB,
    clock:        matchState.clock,
    clockRunning: matchState.clockRunning,
    clockVisible: matchState.clockVisible,
    period:       matchState.period,
    activeGraphic: graphicState.activeGraphic
  });
});

// ── Starta server ────────────────────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n✅ Scoreboard-server igång på http://localhost:${PORT}`);
  console.log(`   Grafik (OBS Browser Source): http://localhost:${PORT}/graphics.html`);
  console.log(`   Kontrollpanel:               http://localhost:${PORT}/control.html\n`);
});
