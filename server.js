// Laddar .env (lösenord, API-nycklar) för lokal körning. På Render sätts
// miljövariablerna i dashboarden i stället – då finns ingen .env och detta är
// en tyst no-op.
require('dotenv').config();

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const axios   = require('axios');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// Bakom Render/proxy: lita på X-Forwarded-Proto så att secure-cookies sätts
// korrekt (https) i produktion men inte stör http i lokal utveckling.
app.set('trust proxy', 1);

// ── Autentisering ─────────────────────────────────────────────────────────────
// Ett delat lösenord (APP_PASSWORD) skyddar kontroll-/inställningssidorna samt
// alla skriv-API:er och muterande socket-händelser. Visningssidorna (graphics,
// replay, landningssidan) är medvetet öppna eftersom OBS Browser Source inte kan
// logga in – de kan ändå inte ändra något (de tar bara emot state).
//
// Sätts inget APP_PASSWORD körs appen olåst (bekvämt lokalt) men loggar en tydlig
// varning. På Render: sätt APP_PASSWORD i miljövariablerna.
const APP_PASSWORD   = process.env.APP_PASSWORD || '';
const AUTH_ENABLED   = APP_PASSWORD.length > 0;
// Hemlighet för att signera session-cookies. Default härleds från lösenordet så
// att sessioner överlever omstarter; sätt SESSION_SECRET för full kontroll.
const SESSION_SECRET = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update(`${APP_PASSWORD}:scoreboard-session`).digest('hex');
// Valfri API-nyckel för Stream Deck/automation som anropar /api/* utan cookie.
// Skickas som ?key=… eller header X-API-Key.
const API_KEY        = process.env.API_KEY || '';
const SESSION_COOKIE = 'sb_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagar

function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Timing-säker jämförelse. Hashar båda sidor till fast längd (32 byte) först,
// så att varken körtiden eller buffertlängden läcker något om hemligheten
// (t.ex. lösenordets längd).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function signSession(expiresAt) {
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return false;
  const expiresAt = parseInt(payload, 10);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

// Är denna HTTP-request inloggad? (Olåst läge → alltid true.)
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

// Giltig API-nyckel? Endast relevant när API_KEY är satt.
function hasApiKey(req) {
  if (!API_KEY) return false;
  const key = (req.get && req.get('x-api-key')) || (req.query && req.query.key);
  return !!key && safeEqual(key, API_KEY);
}

// ── Brute-force-skydd för inloggning ─────────────────────────────────────────
// Enkel in-memory-räknare per IP. Räcker för en enkel-instans-app; nollställs
// vid omstart. Förhindrar att någon gissar det delade lösenordet i snabb takt.
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOGIN_MAX_FAILS = 10;             // max misslyckade försök per fönster
const loginAttempts = new Map();        // ip -> { count, first }

function loginRateLimited(ip) {
  // Lat rensning så att Map:en inte växer obegränsat.
  if (loginAttempts.size > 5000) {
    const now = Date.now();
    for (const [k, v] of loginAttempts) {
      if (now - v.first > LOGIN_WINDOW_MS) loginAttempts.delete(k);
    }
  }
  const rec = loginAttempts.get(ip);
  if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) return false;
  return rec.count >= LOGIN_MAX_FAILS;
}

function recordLoginFailure(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

// Healthcheck för Render m.fl. Svarar omedelbart utan att röra annan logik
// så att portdetekteringen och deploy-health-check alltid lyckas snabbt.
app.get('/healthz', (_req, res) => res.status(200).type('text/plain').send('ok'));

// JSON-parser för sponsor-uppladdningar (data-URL:er på upp till ~5 MB/st × 10).
// Sätts före static så att API-rutterna nedan kan läsa req.body.
app.use(express.json({ limit: '60mb' }));

// ── Inloggning ─────────────────────────────────────────────────────────────
// Registreras FÖRE static + guards så att login alltid är nåbar.
app.post('/api/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  const ip = req.ip || 'okänd';
  if (loginRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'För många försök. Vänta en stund och försök igen.' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || !safeEqual(password, APP_PASSWORD)) {
    recordLoginFailure(ip);
    return res.status(401).json({ ok: false, error: 'Fel lösenord' });
  }
  loginAttempts.delete(ip); // lyckad inloggning → nollställ räknaren
  const token = signSession(Date.now() + SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Hjälp för login-sidan att veta om autentisering ens är på.
app.get('/api/auth/status', (req, res) => {
  res.json({ authEnabled: AUTH_ENABLED, authed: isAuthed(req) });
});

// ── Sidskydd ───────────────────────────────────────────────────────────────
// Kontroll-/inställningssidor kräver inloggning. Måste ligga FÖRE static, annars
// hade static serverat HTML:en direkt. Oinloggade skickas till login med ?next=.
//
// VIKTIGT: express.static avkodar och normaliserar sökvägen på egen hand, så en
// exakt strängmatchning här kan kringgås med t.ex. /%63ontrol.html (URL-encoding),
// /CONTROL.HTML (versaler på skiftlägesokänsligt filsystem) eller
// /x/../control.html (path traversal). Vi avkodar, normaliserar och gör gemener
// på samma sätt som static innan vi jämför, så att inget kryphål släpper förbi.
const PROTECTED_PAGES = new Set(['/control.html', '/mobile-control.html', '/settings.html']);

function normalizedPath(rawPath) {
  let p = rawPath;
  try { p = decodeURIComponent(p); } catch { /* ogiltig encoding → använd rådata */ }
  return path.posix.normalize(p).toLowerCase();
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!PROTECTED_PAGES.has(normalizedPath(req.path))) return next();
  if (isAuthed(req)) return next();
  return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
});

// ── API-skydd ──────────────────────────────────────────────────────────────
// Allt under /api kräver inloggning eller giltig API-nyckel, förutom öppna
// läs-endpoints (status/sponsorlista) och login/logout/auth-status ovan.
app.use('/api', (req, res, next) => {
  // Öppna läs-endpoints som de publika visningssidorna (graphics/replay) använder:
  // - /state    : Stream Deck-feedback
  // - /sponsors : sponsorlista
  // - /series/:id/live : övriga-matcher-tickern i OBS-grafiken
  if (req.method === 'GET' && (
        req.path === '/state' ||
        req.path === '/sponsors' ||
        /^\/series\/\d+\/live$/.test(req.path)
      )) return next();
  if (isAuthed(req) || hasApiKey(req)) return next();
  return res.status(401).json({ ok: false, error: 'Ej inloggad' });
});

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
  // CompetitionID (serie/turnering) för omgångens matcher. Sätts när en
  // match-URL hämtas och används av grafiken för att polla live-status på
  // de övriga matcherna i omgången. null = ingen serie kopplad.
  fixturesCompetitionId: null,
  commentators: { name1: '', name2: '' },
  venue: '',
  homeLogo: '',
  awayLogo: '',
  matchStart: '',        // ISO datetime, t.ex. "2026-03-15T16:00:00"
  // Spelare-/ledar-skylt (lower-third nere till vänster). Sätts via klick
  // i kontrollpanelens lineup-lista. null = ingen aktiv skylt.
  //   { team: 'home'|'away', teamName, number, name, role }
  playerLowerThird: null,
  // Utvisningar – synkade med matchklockan. Varje objekt:
  //   { id: number, duration: number, remaining: number, jersey?: string }
  // duration + remaining anges i sekunder. När remaining når 0 tas
  // utvisningen automatiskt bort av klock-loopen.
  penaltiesHome: [],
  penaltiesAway: [],
  // Statistik inför match (pregamestats + ppstatistics aggregerat).
  // null = ingen data hämtad än. När data finns: { home: {...}, away: {...} }
  // Se buildPreGameStats() för fältlistan.
  preGameStats: null,
  // Aktiv time-out. null = ingen pågående. När en startas:
  //   { team: 'home'|'away', duration: 30, remaining: 30 }
  // Tickas i realtid (oberoende av matchklockan) av timeOutInterval.
  timeOut: null,
  // Resultat-synk: 'api' (default) = poll IBIS var SCORE_SYNC_INTERVAL_MS,
  // 'manual' = +1/−1-knapparna styr. syncMatchId sätts när en match-URL
  // hämtas via fetch_innebandy_all_data och används av pollern.
  scoreSyncMode: 'api',
  syncMatchId: null,
  // Senaste status-rapport från pollern – exponeras till UI så vi kan visa
  // "Synkad 14:23:05" / "Fel: …". null = ingen synk-körning ännu.
  //   { ok: boolean, ts: number, error?: string }
  scoreSyncStatus: null,
  // Period-synk: 'api' (default) = period plockas från IBIS i samma poll-anrop
  // som scoren, 'manual' = Nästa period/Återställ-knapparna styr. Egen status
  // så UI:t kan särskilja "perioden synkad just nu" från "scoren synkad".
  //   periodSyncStatus = { ok: boolean, ts: number, error?: string } | null
  periodSyncMode: 'api',
  periodSyncStatus: null,
  // Periodlängd i minuter. Matchklockan stoppas automatiskt när
  // elapsedSeconds når periodLengthMinutes * 60 (default 20 min enligt
  // IBF-regelboken). Persisteras i data/settings.json och behålls
  // mellan match-nollställningar.
  periodLengthMinutes: 20,
  // Övertidens längd i minuter. Tillämpas när period === 4. Default
  // 5 min enligt IBF-regelboken (sudden death-overtid). Samma
  // persistens som periodLengthMinutes.
  overtimeLengthMinutes: 5
};

// Monotont stigande räknare för utvisnings-ID:n. Undviker kollisioner som
// Date.now() kan ge när två utvisningar läggs till på samma millisekund.
let penaltySeq = 0;

// activeGraphic styr vad som visas på skärmen.
// Möjliga värden: 'scoreboard' | 'lineupHome' | 'lineupAway' | 'table' | 'none'
let graphicState = {
  activeGraphic: 'none'
};

// ── Sponsor-state ────────────────────────────────────────────────────────────
// Sponsorer hanteras separat från matchState eftersom de bör persistera
// mellan matcher och över serverstart. Filerna lagras i public/sponsors/ och
// listan i data/sponsors.json. Max 15 logos.
const SPONSORS_MAX        = 15;
const SPONSORS_DIR        = path.join(__dirname, 'public', 'sponsors');
const SPONSORS_DATA_DIR   = path.join(__dirname, 'data');
const SPONSORS_MANIFEST   = path.join(SPONSORS_DATA_DIR, 'sponsors.json');
const SPONSOR_MIME_EXT    = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

let sponsorState = { sponsors: [] };  // [{ id, url, name }]

function ensureSponsorDirs() {
  if (!fs.existsSync(SPONSORS_DIR))      fs.mkdirSync(SPONSORS_DIR, { recursive: true });
  if (!fs.existsSync(SPONSORS_DATA_DIR)) fs.mkdirSync(SPONSORS_DATA_DIR, { recursive: true });
}

function loadSponsors() {
  ensureSponsorDirs();
  if (!fs.existsSync(SPONSORS_MANIFEST)) return;
  try {
    const raw = fs.readFileSync(SPONSORS_MANIFEST, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.sponsors)) {
      // Filtrera bort poster vars fil saknas (manuell rensning av public/sponsors/).
      sponsorState.sponsors = parsed.sponsors
        .filter(s => s && s.id && s.url)
        .filter(s => {
          const filePath = path.join(__dirname, 'public', s.url.replace(/^\//, ''));
          return fs.existsSync(filePath);
        });
    }
  } catch (err) {
    console.error('[sponsors] kunde inte läsa manifest:', err.message);
  }
}

function saveSponsorManifest() {
  ensureSponsorDirs();
  fs.writeFileSync(SPONSORS_MANIFEST, JSON.stringify(sponsorState, null, 2), 'utf8');
}

function broadcastSponsors() {
  io.emit('sponsorsUpdate', sponsorState);
}

// Parsar en data-URL "data:image/png;base64,iVBORw0..." → { mime, buffer } eller null.
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!SPONSOR_MIME_EXT[mime]) return null;
  try {
    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return null;
    return { mime, buffer };
  } catch {
    return null;
  }
}

// Skriv en ny sponsorbild till disk och returnera { id, url, name }.
function writeSponsorFile(parsed, originalName) {
  const ext = SPONSOR_MIME_EXT[parsed.mime];
  const id  = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.${ext}`;
  const filePath = path.join(SPONSORS_DIR, filename);
  fs.writeFileSync(filePath, parsed.buffer);
  return {
    id,
    url:  `/sponsors/${filename}`,
    name: (typeof originalName === 'string' && originalName.trim())
            ? originalName.trim().slice(0, 80)
            : ''
  };
}

// Ta bort en sponsorfil från disk (best-effort, loggar fel).
function deleteSponsorFile(url) {
  if (!url) return;
  const filePath = path.join(__dirname, 'public', url.replace(/^\//, ''));
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('[sponsors] kunde inte ta bort fil:', filePath, err.message);
  }
}

loadSponsors();

// ── Persistenta inställningar ───────────────────────────────────────────────
// Inställningar som ska överleva serverstart och match-nollställning sparas
// här (t.ex. periodlängd). Liten JSON-fil bredvid sponsors.json.
const SETTINGS_FILE = path.join(SPONSORS_DATA_DIR, 'settings.json');
const PERIOD_LENGTH_MIN = 1;
const PERIOD_LENGTH_MAX = 99;

function clampPeriodLength(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return null;
  return Math.max(PERIOD_LENGTH_MIN, Math.min(PERIOD_LENGTH_MAX, v));
}

function loadSettings() {
  ensureSponsorDirs();
  if (!fs.existsSync(SETTINGS_FILE)) return;
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const pl = clampPeriodLength(parsed.periodLengthMinutes);
    if (pl != null) matchState.periodLengthMinutes = pl;
    const ol = clampPeriodLength(parsed.overtimeLengthMinutes);
    if (ol != null) matchState.overtimeLengthMinutes = ol;
  } catch (err) {
    console.error('[settings] kunde inte läsa:', err.message);
  }
}

function saveSettings() {
  ensureSponsorDirs();
  const payload = {
    periodLengthMinutes:   matchState.periodLengthMinutes,
    overtimeLengthMinutes: matchState.overtimeLengthMinutes
  };
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] kunde inte spara:', err.message);
  }
}

loadSettings();

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
  // Om vi redan står på (eller över) periodlängden från ett tidigare stopp:
  // starta inte. Operatören måste nollställa eller justera klockan först,
  // annars skulle vi ticka över maxtid direkt.
  if (elapsedSeconds >= periodLimitSeconds()) return;
  matchState.clockRunning = true;
  clockInterval = setInterval(() => {
    elapsedSeconds++;
    matchState.clock = formatTime(elapsedSeconds);
    io.emit('clockTick', { clock: matchState.clock });

    // Tick utvisningarna i samma loop. När klockan pausas (clearInterval)
    // pausas utvisningarna automatiskt – det är hela poängen med en
    // gemensam loop.
    tickPenalties();

    // Auto-stopp vid periodlängdens slut (default 20:00). Pausar klockan
    // och broadcastar clockStatus så kontrollpanelens Start/Stopp-knapp
    // återgår till "Starta". Stannar på exakt MM:00 så scoreboarden visar
    // periodens sluttid tills operatören startar nästa.
    if (elapsedSeconds >= periodLimitSeconds()) {
      pauseClock();
      io.emit('clockStatus', { running: false });
    }
  }, 1000);
}

// Döljer klockan automatiskt vid straffläggning (period 5) och visar
// den igen vid reset till period 1.
function applyPeriodClockRule(newPeriod) {
  if (newPeriod === 5) matchState.clockVisible = false;
  else if (newPeriod === 1) matchState.clockVisible = true;
}

function periodLimitSeconds() {
  // Period 4 = övertid – då gäller övertidsinställningen i stället för
  // ordinarie periodlängd. Övriga perioder (inkl. straffläggning) följer
  // ordinarie periodlängd; producenten pausar manuellt vid behov.
  const isOvertime = matchState.period === 4;
  const minutes = isOvertime
    ? (clampPeriodLength(matchState.overtimeLengthMinutes) || 5)
    : (clampPeriodLength(matchState.periodLengthMinutes)   || 20);
  return minutes * 60;
}

// ── Utvisningslogik ──────────────────────────────────────────────────────────
// Modell: varje utvisning har status 'active' (tickar och syns i grafiken)
// eller 'queued' (väntar tills en aktiv löper ut). Hård cap räknas i
// "grupper" (utvisningstyper), inte enskilda entries: en vanlig 2/5-min är
// 1 grupp, en 2+2 är 1 grupp (två entries med samma pairId). Caps:
// MAX_PENALTIES_PER_TEAM = 2 grupper per lag, så man kan lägga t.ex. 2+2
// plus en 2-min samtidigt. MAX_ACTIVE_PENALTIES = 2 håller att max 2 tickar
// samtidigt (regeln 3-mot-5 som minst) – relevant för 2+2 där andra halvan
// startar när första löper ut.
//
// Säker array-mutation: iterera BAKIFRÅN och splice. Då kan vi ta bort
// element under iterationen utan att indexen skiftar – två utvisningar som
// går ut på samma tick hanteras korrekt.
const MAX_PENALTIES_PER_TEAM = 2;
const MAX_ACTIVE_PENALTIES   = 2;

function countActive(arr) {
  let n = 0;
  for (const p of arr) if (p.status === 'active') n++;
  return n;
}

// Räkna utvisningsgrupper: poster med samma pairId (2+2) räknas som EN grupp,
// övriga som var sin grupp. Används för cap-kontrollen.
function countGroups(arr) {
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

// Promota äldsta queued till active så länge det finns plats. Mutates arr.
// Returnerar true om något ändrades så broadcast triggas.
function promoteQueued(arr) {
  let changed = false;
  while (countActive(arr) < MAX_ACTIVE_PENALTIES) {
    // En köad post i ett par (2+2) får inte starta förrän dess syskon
    // (samma pairId) löpt ut – halvorna avtjänas i följd, aldrig parallellt.
    const next = arr.find(p =>
      p.status === 'queued' &&
      !(p.pairId && arr.some(o => o.pairId === p.pairId && o.status === 'active'))
    );
    if (!next) break;
    next.status    = 'active';
    next.remaining = next.duration;  // queued-tid räknas inte med
    changed = true;
  }
  return changed;
}

function tickPenaltyArray(arr) {
  let changed = false;
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    if (p.status !== 'active') continue;
    p.remaining -= 1;
    changed = true;
    if (p.remaining <= 0) arr.splice(i, 1);
  }
  // Fyll på från kön om en aktiv just löpte ut
  if (promoteQueued(arr)) changed = true;
  return changed;
}

function tickPenalties() {
  const a = tickPenaltyArray(matchState.penaltiesHome);
  const b = tickPenaltyArray(matchState.penaltiesAway);
  if (a || b) {
    io.emit('penaltiesUpdate', {
      penaltiesHome: matchState.penaltiesHome,
      penaltiesAway: matchState.penaltiesAway
    });
  }
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

// Manuell justering – används när vi missat att starta/stoppa i exakt rätt
// ögonblick. Klocka kan justeras både medan den tickar och när den är pausad.
// Penalty-timrar är frikopplade från elapsedSeconds och påverkas inte.
const MAX_CLOCK_SECONDS = 99 * 60 + 59;
function setClockSeconds(seconds) {
  const s = Math.max(0, Math.min(MAX_CLOCK_SECONDS, Math.floor(seconds)));
  elapsedSeconds = s;
  matchState.clock = formatTime(elapsedSeconds);
  io.emit('clockTick', { clock: matchState.clock });
}

// Nollställer all matchdata till defaultvärden – används för "Rensa cache" /
// "Nollställ match" mellan sändningar så nästa match börjar från tomt blad.
// Stannar klockan, nollar period, tömmer lineups/tabell/omgång/kommentatorer
// /venue/logos och växlar tillbaka till scoreboarden som default-grafik.
function resetMatchState() {
  pauseClock();
  stopTimeOut();
  elapsedSeconds = 0;
  // Periodlängd och övertid är producent-inställningar, inte matchdata –
  // behåll värdena över nollställning så operatören slipper sätta om dem
  // inför varje match.
  const keepPeriodLength   = matchState.periodLengthMinutes   || 20;
  const keepOvertimeLength = matchState.overtimeLengthMinutes || 5;
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
    fixturesCompetitionId: null,
    commentators: { name1: '', name2: '' },
    venue: '',
    homeLogo: '',
    awayLogo: '',
    matchStart: '',
    playerLowerThird: null,
    penaltiesHome: [],
    penaltiesAway: [],
    preGameStats: null,
    timeOut: null,
    scoreSyncMode: 'api',
    syncMatchId: null,
    scoreSyncStatus: null,
    periodSyncMode: 'api',
    periodSyncStatus: null,
    periodLengthMinutes:   keepPeriodLength,
    overtimeLengthMinutes: keepOvertimeLength
  };
  penaltySeq = 0;
  stopScoreSyncPoll();
  graphicState.activeGraphic = 'none';
  io.emit('stateUpdate', matchState);
  io.emit('switchGraphic', { to: 'none' });
  io.emit('clockStatus', { running: false });
  io.emit('matchStateReset');
  console.log('Matchdata nollställd');
}

// ── Time-out ─────────────────────────────────────────────────────────────────
// IBF-regel: 30 sekunder realtid (inte matchklocka). Egen interval-loop så
// den tickar även när matchklockan är pausad. Vid 0 → auto-clear + växla
// tillbaka till scoreboarden så grafiken inte hänger kvar tom.
const TIME_OUT_SECONDS = 30;
let timeOutInterval = null;

function broadcastTimeOut() {
  io.emit('timeOutUpdate', { timeOut: matchState.timeOut });
}

function startTimeOut(team) {
  const t = team === 'away' ? 'away' : team === 'home' ? 'home' : null;
  if (!t) return null;
  stopTimeOut();
  matchState.timeOut = {
    team:      t,
    duration:  TIME_OUT_SECONDS,
    remaining: TIME_OUT_SECONDS
  };
  broadcastTimeOut();
  timeOutInterval = setInterval(() => {
    if (!matchState.timeOut) { stopTimeOut(); return; }
    matchState.timeOut.remaining -= 1;
    if (matchState.timeOut.remaining <= 0) {
      // Auto-avsluta: nolla state, broadcast. Time-outen är numera en overlay
      // ovanpå scoreboarden så ingen grafik-växling behövs — pillen tonas
      // bort när matchState.timeOut blir null.
      stopTimeOut();
    } else {
      broadcastTimeOut();
    }
  }, 1000);
  return matchState.timeOut;
}

function stopTimeOut() {
  if (timeOutInterval) { clearInterval(timeOutInterval); timeOutInterval = null; }
  matchState.timeOut = null;
  broadcastTimeOut();
}

// ── Resultat- & period-synk från IBIS ──────────────────────────────────────
// När scoreSyncMode === 'api' och syncMatchId är satt pollar vi
// matches/{matchId}-endpointen och uppdaterar scoreA/scoreB automatiskt.
// Pollas frekvent nog för "live"-känsla, men inte så snabbt att IBIS
// kan tycka det är obehagligt. Innebandy-mål är relativt sällsynta så
// 15 s är en bra balans.
// Period plockas från samma response när periodSyncMode === 'api'.
const SCORE_SYNC_INTERVAL_MS = 15000;
let scoreSyncInterval = null;
let scoreSyncInFlight  = false;

function stopScoreSyncPoll() {
  if (scoreSyncInterval) { clearInterval(scoreSyncInterval); scoreSyncInterval = null; }
}

// Försöker plocka periodnummer från IBIS-responsen. Innebandyns periodfält har
// olika namn i olika ändpunkter, så vi provar flera kandidater i tur och ordning.
// Returnerar 1-5 eller null om inget hittas/parsas till siffra.
function extractPeriodFromIbis(data) {
  if (!data) return null;
  const candidates = [
    data.Period, data.CurrentPeriod, data.PeriodNumber, data.MatchPeriod,
    data.PeriodNo, data.Halftime
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const n = parseInt(c, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 5) return n;
  }
  return null;
}

async function pollScoreOnce() {
  if (scoreSyncInFlight) return;          // skydda mot överlappande requests
  // En poll räcker så länge minst ett av syncmodes är aktivt
  if (matchState.scoreSyncMode !== 'api' && matchState.periodSyncMode !== 'api') return;
  const matchId = matchState.syncMatchId;
  if (!matchId) return;
  scoreSyncInFlight = true;
  try {
    const { apiRoot, headers } = await getInnebandyAuth();
    const { data } = await axios.get(`${apiRoot}matches/${matchId}`,
      { timeout: 10000, headers });
    let changed = false;

    if (matchState.scoreSyncMode === 'api') {
      const home = (data && data.GoalsHomeTeam != null) ? parseInt(data.GoalsHomeTeam, 10) : null;
      const away = (data && data.GoalsAwayTeam != null) ? parseInt(data.GoalsAwayTeam, 10) : null;
      if (Number.isFinite(home) && home !== matchState.scoreA) {
        matchState.scoreA = home; changed = true;
      }
      if (Number.isFinite(away) && away !== matchState.scoreB) {
        matchState.scoreB = away; changed = true;
      }
      matchState.scoreSyncStatus = { ok: true, ts: Date.now() };
    }

    if (matchState.periodSyncMode === 'api') {
      const p = extractPeriodFromIbis(data);
      if (p != null) {
        if (p !== matchState.period) { matchState.period = p; applyPeriodClockRule(p); changed = true; }
        matchState.periodSyncStatus = { ok: true, ts: Date.now() };
      } else {
        matchState.periodSyncStatus = {
          ok: false, ts: Date.now(),
          error: 'IBIS-svaret innehöll inget periodfält'
        };
      }
    }

    if (changed) io.emit('stateUpdate', matchState);
    else {
      if (matchState.scoreSyncMode === 'api') io.emit('scoreSyncStatus', matchState.scoreSyncStatus);
      if (matchState.periodSyncMode === 'api') io.emit('periodSyncStatus', matchState.periodSyncStatus);
    }
  } catch (err) {
    const errStatus = {
      ok: false, ts: Date.now(),
      error: (err && err.message) || 'Okänt fel'
    };
    if (matchState.scoreSyncMode === 'api') {
      matchState.scoreSyncStatus = errStatus;
      io.emit('scoreSyncStatus', errStatus);
    }
    if (matchState.periodSyncMode === 'api') {
      matchState.periodSyncStatus = errStatus;
      io.emit('periodSyncStatus', errStatus);
    }
    console.warn('[ibis-sync] fel:', err.message);
  } finally {
    scoreSyncInFlight = false;
  }
}

function startScoreSyncPoll() {
  stopScoreSyncPoll();
  // Pollen körs så länge minst ett av syncmodes är 'api'
  if (matchState.scoreSyncMode !== 'api' && matchState.periodSyncMode !== 'api') return;
  if (!matchState.syncMatchId) return;
  // Hämta direkt så vi inte väntar i 15 s innan första värdet
  pollScoreOnce();
  scoreSyncInterval = setInterval(pollScoreOnce, SCORE_SYNC_INTERVAL_MS);
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
// Validerar att svaret innehåller apiRoot + accessToken så att en HTML-felsida
// från IBIS eller en tom respons inte orsakar obegripliga krascher längre ner.
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
  if (!kit || typeof kit !== 'object') {
    throw new Error('IBIS startkit svarade med oväntat format');
  }
  if (!kit.apiRoot || !kit.accessToken) {
    throw new Error('IBIS startkit saknar apiRoot eller accessToken – API:et kan ha ändrats');
  }
  return {
    apiRoot: kit.apiRoot,
    headers: {
      'Authorization': `Bearer ${kit.accessToken}`,
      'Accept':        'application/json',
      'Referer':       'https://stats.innebandy.se/'
    }
  };
}

// ── Scoreboard-kortnamn (akronymer) ───────────────────────────────────────
// IBIS' TeamShortName är 6 tecken ("Sollen", "Rosers") – för långt för en
// snygg scoreboard. Vi bygger istället en 2–5-bokstavs akronym genom att:
//   1. Behålla redan akronym-iga ord (ALL-CAPS ≤4 tecken: FBC, IFK, IBK)
//   2. Ta första bokstaven från övriga "riktiga" ord
//   3. Filtrera bort generiska klubbsuffix (IBK, IF, BK, SK, IBF, IBS, FC)
//   4. Om koden blir <3 tecken: fallback till första 4 tecken av huvudordet
// Resultatet är default – producenten kan fortfarande editera fritt i
// kontrollpanelen (för t.ex. "RA19" där 19 är lagets nummer).
// Generiska klubbtyp-suffix + sport-ord som inte tillför akronym-värde
// ("Linköping Innebandy" ska bli "LINK", inte "LI"; "AIK" är förenings-
// identitet och hör hemma här — men för "Mullsjö AIS IF" råkar AIS hamna
// i akronym-pathen via ALL-CAPS-regeln så det är OK).
const GENERIC_SUFFIXES = new Set([
  'IBK', 'IF', 'BK', 'SK', 'IBF', 'IBS', 'FC', 'AIK', 'INNEBANDY'
]);

function buildScoreboardCode(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  const clean = fullName.trim().replace(/\s+/g, ' ');
  if (!clean) return '';

  // Behåll bara ord som inte är generiska suffix
  const words = clean.split(' ')
    .map(w => w.replace(/[^\p{L}0-9]/gu, ''))
    .filter(w => w && !GENERIC_SUFFIXES.has(w.toUpperCase()));
  if (!words.length) {
    // Allt var generic-suffix – fallback till första 4 av originalet
    return clean.replace(/[^\p{L}0-9]/gu, '').slice(0, 4).toUpperCase();
  }

  // Bygg akronym: behåll all-caps-ord, annars första bokstaven
  const parts = words.map(w => {
    // Redan all-caps + max 4 tecken = redan en akronym → behåll
    if (/^[A-ZÅÄÖ]{2,4}$/.test(w)) return w;
    return w.charAt(0);
  });
  let code = parts.join('').toUpperCase();

  // För kort? Fallback till första 4 tecken av huvudordet. Tröskeln är
  // < 2 så att 2-bokstavskoder från ≥2 ord (t.ex. "Rosersberg Arlanda" →
  // "RA") behålls – de är ofta hur klubbar marknadsför sig själva.
  if (code.length < 2) {
    const mainWord = words.find(w => !/^[A-ZÅÄÖ]{2,4}$/.test(w)) || words[0];
    code = mainWord.slice(0, 4).toUpperCase();
  }

  // Cap till 5 tecken (scoreboarden har begränsat utrymme)
  return code.slice(0, 5);
}

// Formaterar en spelare till strängen "{nummer} {namn}".
// Sorterar samtliga spelare numeriskt på tröjnummer (1 → 99).
function formatPlayers(apiPlayers) {
  // Returnerar objekt så att foto-URL:en (ImageUrl från IBIS) följer med
  // genom hela kedjan ända ut till spelar-/ledar-lower-third-grafiken.
  // Klienterna förväntar sig { shirtNo, name, imageUrl }.
  return [...apiPlayers]
    .sort((a, b) => (a.ShirtNo || 0) - (b.ShirtNo || 0))
    .map(p => ({
      shirtNo:  p.ShirtNo != null ? String(p.ShirtNo) : '',
      name:     p.Name || '',
      imageUrl: p.ImageUrl || ''
    }));
}

// Normaliserar IBIS' rollnamn till det vi vill visa i grafiken.
// "Lagankuten" är IBIS' interna rollnamn för icke-tränar-staff – vi visar
// det som "Ledare" för att matcha sektionsrubriken och hålla en
// konsekvent terminologi mot tittarna.
function normalizeRoleName(role) {
  if (!role) return '';
  const trimmed = String(role).trim();
  if (/^lagankut/i.test(trimmed)) return 'Ledare';
  return trimmed;
}

// Formaterar ledare/staff till { name, role }. Sorterar tränare först.
function formatPersons(apiPersons) {
  const roleWeight = (r) => /tränare|huvudtränare/i.test(r) ? 0 : 1;
  return [...apiPersons]
    .sort((a, b) => {
      const w = roleWeight(a.RoleName || '') - roleWeight(b.RoleName || '');
      return w !== 0 ? w : (a.Name || '').localeCompare(b.Name || '', 'sv');
    })
    .map(p => ({ name: p.Name || '', role: normalizeRoleName(p.RoleName) }));
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
    // Auto-genererad akronym från fullnamnet (FBCS, RA, IFKL …). IBIS'
    // egen TeamShortName är 6 tecken vilket är för långt för scoreboarden;
    // producenten kan fortfarande editera fältet manuellt efter hämtningen.
    homeShortName: buildScoreboardCode(data.HomeTeam) || data.HomeTeamShortName || '',
    awayShortName: buildScoreboardCode(data.AwayTeam) || data.AwayTeamShortName || '',
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

// ── Innebandy Stats API – Statistik inför match ──────────────────────────────
// Två separata IBIS-endpoints kombineras:
//   1. matches/{matchId}/pregamestats  →  rankning, head-to-head, senaste 5
//   2. competitions/{compId}/ppstatistics  →  powerplay/boxplay per lag
// Aggregeras till ett "preGameStats"-objekt som matchar UI-radernas
// fältnamn. Resultatkoder för Senaste-5-prickarna är 1-8 (definierade av
// IBIS-frontend); färgerna nedan är direktkopierade så grafiken ser ut
// som stats.innebandy.se.
const LAST_GAME_RESULT_LEGEND = {
  1: { name: 'Förlust efter ordinarie tid', color: '#ff0000' },
  2: { name: 'Förlust efter övertid',       color: '#cb1010' },
  3: { name: 'Förlust efter straffar',      color: '#850e0e' },
  4: { name: 'Oavgjort',                    color: '#ebebeb' },
  5: { name: 'Oavgjort efter förlängning',  color: '#333333' },
  6: { name: 'Vinst efter full tid',        color: '#46b240' },
  7: { name: 'Vinst efter övertid',         color: '#358931' },
  8: { name: 'Vinst efter straffar',        color: '#245e21' }
};

/**
 * Medelvärde av två sekund-värden, formaterat som "MM:SS". Värden = 0
 * räknas som "ej tillgängliga" och hoppas över i snittet. Returnerar
 * "Saknas" om båda är 0. Speglar IBIS' egen 'ih'-hjälpare exakt så vår
 * grafik visar samma siffror som stats.innebandy.se.
 */
function formatAvgSeconds(s1, s2) {
  let sum = 0, count = 0;
  if (s1 > 0) { sum += s1; count++; }
  if (s2 > 0) { sum += s2; count++; }
  if (sum <= 0 || count <= 0) return 'Saknas';
  const avg = sum / count;
  const m = Math.floor(avg / 60);
  const s = Math.floor(avg) % 60;
  if (m === 0 && s === 0) return 'Saknas';
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Procent eller "-" om nämnaren är 0. (1 - x) för boxplay-effektivitet. */
function pct(num, den, invert = false) {
  if (!den || den <= 0) return '-';
  const ratio = invert ? (1 - num / den) : (num / den);
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Slår ihop pregamestats + ppstatistics till en kompakt struktur som
 * grafiken renderar 1:1. Tolererar att ppRow saknas (t.ex. ny serie
 * där statistik ännu inte är inrapporterad) – då blir PP/BP-fälten "-".
 */
function buildPreGameStatsSide(pre, side, ppRow) {
  const isHome = side === 'home';
  const lastGamesRaw = (isHome ? pre.HomeTeamLastGames : pre.AwayTeamLastGames) || [];
  const lastGames = lastGamesRaw
    .filter(v => v != null)
    .map(code => ({
      code,
      name:  (LAST_GAME_RESULT_LEGEND[code] || {}).name  || 'Okänt',
      color: (LAST_GAME_RESULT_LEGEND[code] || {}).color || '#888'
    }));

  const ranking          = isHome ? pre.HomeTeamRanking          : pre.AwayTeamRanking;
  const meetingWins      = isHome ? pre.HomeTeamMeetingWins      : pre.AwayTeamMeetingWins;
  const goalsLastMeeting = isHome ? pre.HomeTeamGoalsLastMeeting : pre.AwayTeamGoalsLastMeeting;

  // PP/BP-block – tomt om ppRow saknas. Vi returnerar "-" så att grafiken
  // kan rendera samma cell-struktur oavsett.
  const pp = ppRow || {};
  const ppGoalsScored   = (pp.GoalsScoredPP1  || 0) + (pp.GoalsScoredPP2  || 0);
  const ppGoalsAgainst  = (pp.GoalsAgainstPP1 || 0) + (pp.GoalsAgainstPP2 || 0);
  const bpGoalsAgainst  = (pp.GoalsAgainstBP1 || 0) + (pp.GoalsAgainstBP2 || 0);
  const bpGoalsScored   = (pp.GoalsScoredBP1  || 0) + (pp.GoalsScoredBP2  || 0);

  return {
    teamName:        (isHome ? pre.HomeTeam        : pre.AwayTeam)        || '',
    teamShortName:   (isHome ? pre.HomeTeamShortName : pre.AwayTeamShortName) || '',
    logo:            (isHome ? pre.HomeTeamLogotypeUrl : pre.AwayTeamLogotypeUrl) || '',
    ranking:          ranking != null ? String(ranking) : '-',
    meetingWins:      meetingWins != null ? String(meetingWins) : '0',
    goalsLastMeeting: goalsLastMeeting != null ? String(goalsLastMeeting) : '0',
    lastGames,
    // Powerplay
    numberOfPPs:      ppRow ? String(pp.NumberOfPPs || 0) : '-',
    ppEffectivity:    ppRow ? pct(ppGoalsScored, pp.NumberOfPPs) : '-',
    ppGoalsScored:    ppRow ? String(ppGoalsScored) : '-',
    ppAvgGoalTime:    ppRow ? formatAvgSeconds(pp.SecondsToGoalScoredPP1, pp.SecondsToGoalScoredPP2) : '-',
    ppGoalsAgainst:   ppRow ? String(ppGoalsAgainst) : '-',
    // Boxplay
    numberOfBPs:      ppRow ? String(pp.NumberOfBPs || 0) : '-',
    bpEffectivity:    ppRow ? pct(bpGoalsAgainst, pp.NumberOfBPs, true) : '-',
    bpGoalsAgainst:   ppRow ? String(bpGoalsAgainst) : '-',
    bpAvgGoalAgainstTime: ppRow ? formatAvgSeconds(pp.SecondsToGoalAgainstBP1, pp.SecondsToGoalAgainstBP2) : '-',
    bpGoalsScored:    ppRow ? String(bpGoalsScored) : '-'
  };
}

/**
 * Hämtar och bygger statistik inför match.
 * URL-format: ...sasong/X/(serie|turnering)/Y/match/Z/(statistik|laguppstallning|...)
 */
async function fetchInnebandyPreGameStats(matchUrl) {
  const m = matchUrl.match(/\/sasong\/(\d+)\/(?:serie|turnering)\/(\d+)\/match\/(\d+)/);
  if (!m) throw new Error('Kunde inte hitta säsong/serie/match-ID i URL:en');
  const [, , competitionId, matchId] = m;

  const { apiRoot, headers } = await getInnebandyAuth();

  // Parallell hämtning. ppstatistics är "nice to have" – pregamestats är
  // obligatoriskt (utan det får vi ingen meningsfull skylt).
  const [preRes, ppRes] = await Promise.allSettled([
    axios.get(`${apiRoot}matches/${matchId}/pregamestats`,        { timeout: 10000, headers }),
    axios.get(`${apiRoot}competitions/${competitionId}/ppstatistics`, { timeout: 10000, headers })
  ]);

  if (preRes.status === 'rejected') {
    throw new Error(`pregamestats svarade inte: ${preRes.reason.message}`);
  }
  const pre = preRes.value.data;
  if (!pre || !pre.HomeTeamID || !pre.AwayTeamID) {
    throw new Error('Oväntat svar från pregamestats – saknar lag-ID:n');
  }

  // Slå upp PP/BP-raderna per lag. Om endpointen avvisades eller raderna
  // saknas (t.ex. ny serie utan registrerad statistik) skickar vi vidare
  // null så buildPreGameStatsSide kan rendera "-" istället för krasch.
  const ppRows = ppRes.status === 'fulfilled' && Array.isArray(ppRes.value.data?.PPStatisticsRows)
    ? ppRes.value.data.PPStatisticsRows
    : [];
  const homePp = ppRows.find(r => r.TeamID === pre.HomeTeamID) || null;
  const awayPp = ppRows.find(r => r.TeamID === pre.AwayTeamID) || null;

  return {
    matchDateTime:   pre.MatchDateTime || '',
    venueName:       pre.VenueName     || '',
    competitionName: pre.CompetitionName || '',
    home: buildPreGameStatsSide(pre, 'home', homePp),
    away: buildPreGameStatsSide(pre, 'away', awayPp)
  };
}

// ── Innebandy Stats API – Omgångens matcher ─────────────────────────────────
// Hämtar alla matcher i serien, identifierar målrunda via källmatchens MatchID
// och returnerar { roundName, fixtures }. Matchen från URL:en ingår också.
async function fetchInnebandyFixtures(matchUrl) {
  const m = matchUrl.match(/\/sasong\/(\d+)\/(?:serie|turnering)\/(\d+)\/match\/(\d+)/);
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
// serietabell, eller cup/turnering) returneras matchdatan ändå – med
// standingsError satt. Accepterar både /serie/ (seriespel) och /turnering/
// (cup/playoff) i URL:en eftersom IBIS använder båda formaten.
async function fetchInnebandyAll(matchUrl) {
  const m = matchUrl.match(/\/sasong\/(\d+)\/(?:serie|turnering)\/(\d+)\/match\/(\d+)/);
  if (!m) {
    throw new Error('URL:en måste innehålla /sasong/X/(serie|turnering)/Y/match/Z – kontrollera länken');
  }
  const [, season, competition, matchId] = m;

  // Normalisera till de officiella sid-URL:erna (de helper-funktioner
  // vi anropar nedan extraherar ID:n ur URL:erna själva).
  const normalizedMatchUrl = `https://stats.innebandy.se/sasong/${season}/serie/${competition}/match/${matchId}/laguppstallning`;
  const standingsUrl       = `https://stats.innebandy.se/sasong/${season}/serie/${competition}/serietabell`;
  const fixturesUrl        = `https://stats.innebandy.se/sasong/${season}/serie/${competition}/spelprogram`;

  // Parallell hämtning – misslyckas en sida fortsätter de andra ändå
  const [lineupRes, standingsRes, fixturesRes, preGameRes] = await Promise.allSettled([
    fetchInnebandyLineup(normalizedMatchUrl),
    fetchInnebandyStandings(standingsUrl),
    fetchInnebandyFixtures(normalizedMatchUrl),
    fetchInnebandyPreGameStats(normalizedMatchUrl)
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
    fixturesError:  null,
    preGameStats:   null,
    preGameStatsError: null
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

  if (preGameRes.status === 'fulfilled') {
    out.preGameStats = preGameRes.value;
  } else {
    out.preGameStatsError = preGameRes.reason.message;
  }

  return out;
}

async function fetchInnebandyStandings(url) {
  const match = url.match(/\/(?:serie|turnering)\/(\d+)/);
  if (!match) throw new Error('Kunde inte hitta serie-ID i URL:en');
  const competitionId = match[1];

  const { apiRoot, headers } = await getInnebandyAuth();

  // Hämta seriens metadata + tabell parallellt. allSettled så att en saknad
  // metadata-endpoint inte gör att hela tabellen misslyckas.
  const [metaRes, standingsRes] = await Promise.allSettled([
    axios.get(`${apiRoot}competitions/${competitionId}`,
      { timeout: 10000, headers }),
    axios.get(`${apiRoot}competitions/${competitionId}/standings`,
      { timeout: 10000, headers })
  ]);

  // Tabellen är obligatorisk; metadata (namn) är "nice to have"
  if (standingsRes.status === 'rejected') {
    throw new Error(`Tabell-API:et svarade inte: ${standingsRes.reason.message}`);
  }
  const name = metaRes.status === 'fulfilled'
    ? (metaRes.value.data?.Name || '')
    : '';

  const standingsData = standingsRes.value.data;
  const standingsRows = standingsData?.StandingsRows
    || standingsData?.standingsRows
    || standingsData
    || [];
  if (!Array.isArray(standingsRows)) throw new Error('Oväntat API-svar för serietabell');

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

// ── Innebandy Stats API – Live-matcher i serien (ticker) ────────────────────
// Klient-tickern (public/js/other-matches-ticker.js) pollar denna endpoint var
// 30:e sekund för att upptäcka nya mål i "övriga matcher". Vi:
//   1. Hämtar competitions/{id}/matches (lista över seriens alla matcher)
//   2. Filtrerar fram troliga live-matcher via MatchDateTime-fönster
//   3. Hämtar matches/{matchId} per kandidat för period + ev. sista mål
//   4. Behåller bara de vars period kunde plockas (= verkligen live)
// Cachas några sekunder så att flera samtidiga producer-flikar inte
// dunkar IBIS extra hårt. IBIS-mål är sällsynta nog att en liten lag är OK.
const SERIES_LIVE_CACHE_MS = 8000;
const SERIES_LIVE_CONCURRENCY = 6;
const seriesLiveCache = new Map();  // key: competitionId → { ts, payload }

// Heuristik: matchen har troligen redan startat och är inte färdig än.
// IBIS' listrespons saknar pålitligt status-fält så vi använder ett tidsfönster:
// startad men inte mer än 4 h sedan start (täcker 3×20 min + paus + ev. ot/sd).
function isPotentiallyLive(m, now) {
  if (!m || !m.MatchDateTime) return false;
  const start = new Date(m.MatchDateTime).getTime();
  if (!Number.isFinite(start)) return false;
  if (start > now) return false;
  if (now - start > 4 * 60 * 60 * 1000) return false;
  const status = (m.MatchStatus || m.Status || '').toString().toLowerCase();
  if (status === 'finished' || status === 'ended' || status === 'final') return false;
  return true;
}

// Periodtid (MM:SS) – fältnamnet varierar mellan IBIS-endpoints. Saknas ett
// gångbart värde returnerar vi null (klienten klarar att rendera utan).
function extractPeriodTimeFromIbis(data) {
  if (!data) return null;
  const candidates = [data.PeriodTime, data.MatchTime, data.ClockTime, data.GameTime];
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{1,2}:\d{2}$/.test(c)) return c;
  }
  return null;
}

function timeToSeconds(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || ''));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

// Plockar ut senaste målet ur match-detaljerna. IBIS kan ha händelser i flera
// olika arrays (Goals, MatchEvents, …) och med olika fältnamn — vi gör en
// best-effort genomgång. Returnerar null om vi inte kan hitta något säkert.
// Klient-tickern faller då tillbaka på score-diff för att avgöra scoringTeam.
function extractLastGoalFromIbis(data) {
  if (!data) return null;
  const arrays = [data.Goals, data.MatchGoals, data.MatchEvents, data.Events]
    .filter(Array.isArray);

  const goalEvents = [];
  for (const arr of arrays) {
    const explicitGoalList = arr === data.Goals || arr === data.MatchGoals;
    for (const e of arr) {
      const type = (e?.EventType || e?.Type || e?.Event || '').toString().toLowerCase();
      if (explicitGoalList || type === 'goal') goalEvents.push(e);
    }
  }
  if (!goalEvents.length) return null;

  // Sortera "senaste först" – period × 1000 + sekunder i perioden räcker som key
  goalEvents.sort((a, b) => {
    const aKey = (a.Period || a.PeriodNumber || 1) * 1000
               + timeToSeconds(a.Time || a.PeriodTime || a.MatchTime);
    const bKey = (b.Period || b.PeriodNumber || 1) * 1000
               + timeToSeconds(b.Time || b.PeriodTime || b.MatchTime);
    return bKey - aKey;
  });

  const g = goalEvents[0];
  const scoringTeam =
    (g.ScoringTeam === 'Home' || g.Team === 'Home' || g.IsHomeTeam === true) ? 'home'
    : (g.ScoringTeam === 'Away' || g.Team === 'Away' || g.IsHomeTeam === false) ? 'away'
    : null;

  const scorerName = g.Scorer || g.Player || g.PlayerName || g.ScorerName;
  const assistName = g.Assist || g.AssistPlayer || g.AssistName;

  return {
    scoringTeam,
    scorer: scorerName ? {
      jersey: String(g.ScorerJersey || g.PlayerJersey || g.JerseyNumber || ''),
      name:   String(scorerName)
    } : null,
    assist: assistName ? {
      jersey: String(g.AssistJersey || g.AssistPlayerJersey || ''),
      name:   String(assistName)
    } : null,
    period:     g.Period || g.PeriodNumber || null,
    periodTime: g.Time || g.PeriodTime || g.MatchTime || null
  };
}

// Begränsar antalet parallella anrop mot IBIS. Promise.all över N arbetare
// som drar nästa index ur en gemensam räknare tills listan är slut.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await fn(items[idx], idx);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function filterExcludedFromLivePayload(payload, excludeMatchId) {
  if (excludeMatchId == null) return payload;
  const exclude = String(excludeMatchId);
  return { matches: payload.matches.filter(m => String(m.matchId) !== exclude) };
}

async function fetchInnebandyLiveSeries(competitionId, { excludeMatchId = null } = {}) {
  const cacheKey = String(competitionId);
  const cached   = seriesLiveCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SERIES_LIVE_CACHE_MS) {
    return filterExcludedFromLivePayload(cached.payload, excludeMatchId);
  }

  const { apiRoot, headers } = await getInnebandyAuth();
  const { data: list } = await axios.get(
    `${apiRoot}competitions/${competitionId}/matches`,
    { timeout: 10000, headers }
  );
  if (!Array.isArray(list)) throw new Error('Oväntat API-svar för serie-matcher');

  const now        = Date.now();
  const candidates = list.filter(m => isPotentiallyLive(m, now));

  // Per-match-detaljer parallellt. En misslyckad match fäller inte hela
  // tickern – vi loggar och hoppar över den.
  const detailed = await mapWithConcurrency(candidates, SERIES_LIVE_CONCURRENCY, async (m) => {
    try {
      const { data } = await axios.get(`${apiRoot}matches/${m.MatchID}`, {
        timeout: 8000, headers
      });
      return { listItem: m, detail: data };
    } catch (err) {
      console.warn(`[series-live] hopp över match ${m.MatchID}: ${err.message}`);
      return null;
    }
  });

  const matches = [];
  for (const item of detailed) {
    if (!item) continue;
    const { listItem, detail } = item;
    const period = extractPeriodFromIbis(detail);
    if (period == null) continue;       // ej startad eller redan färdig

    matches.push({
      matchId:    listItem.MatchID,
      homeTeam:   listItem.HomeTeam || detail.HomeTeam || '',
      awayTeam:   listItem.AwayTeam || detail.AwayTeam || '',
      homeGoals:  Number(detail.GoalsHomeTeam ?? listItem.GoalsHomeTeam ?? 0),
      awayGoals:  Number(detail.GoalsAwayTeam ?? listItem.GoalsAwayTeam ?? 0),
      status:     'Live',
      period,
      periodTime: extractPeriodTimeFromIbis(detail),
      lastGoal:   extractLastGoalFromIbis(detail)
    });
  }

  const payload = { matches };
  seriesLiveCache.set(cacheKey, { ts: Date.now(), payload });
  return filterExcludedFromLivePayload(payload, excludeMatchId);
}

// ── Socket-hantering ─────────────────────────────────────────────────────────
// safeOn() wrappar varje handler i try/catch så att en korrupt payload eller
// en oväntad runtime-bugg loggas i stället för att krascha hela processen.
// Async handlers stöds också – då fångas både synkrona kast och promise-rejects.
function safeOn(socket, event, handler) {
  socket.on(event, (...args) => {
    // Alla safeOn-händelser muterar matchstate → kräver inloggad socket.
    // Visningssidor (graphics/replay) tar bara emot emits och påverkas inte.
    if (AUTH_ENABLED && !socket.data.authed) {
      socket.emit('authError', { error: 'Ej inloggad' });
      return;
    }
    try {
      const ret = handler(...args);
      if (ret && typeof ret.catch === 'function') {
        ret.catch(err => console.error(`[socket:${event}]`, err && err.message || err));
      }
    } catch (err) {
      console.error(`[socket:${event}]`, err && err.message || err);
    }
  });
}

// Markera varje socket som inloggad eller ej redan vid handshake. Cookien följer
// med automatiskt (samma origin); en API-nyckel kan skickas via auth-payloaden.
io.use((socket, next) => {
  const h = socket.handshake;
  const fakeReq = {
    headers: h.headers,
    query:   h.query,
    get: (name) => h.headers[String(name).toLowerCase()]
  };
  socket.data.authed = isAuthed(fakeReq)
    || (!!API_KEY && !!h.auth && safeEqual(h.auth.key, API_KEY));
  next();
});

io.on('connection', (socket) => {
  console.log(`Klient ansluten: ${socket.id}`);

  // Ny klient får aktuellt state + vilken grafik som är aktiv + klock-status
  // så att en OBS Browser Source som laddas om mitt i matchen omedelbart får
  // rätt poäng, klocka, period, aktiv vy och clock-running-indikator.
  socket.emit('stateUpdate', matchState);
  socket.emit('graphicState', graphicState);
  socket.emit('clockStatus', { running: matchState.clockRunning });
  socket.emit('sponsorsUpdate', sponsorState);
  socket.emit('timeOutUpdate', { timeOut: matchState.timeOut });

  // ── Poängtavla ───────────────────────────────────────────────────────────
  safeOn(socket, 'updateNames', ({ teamA, teamB, teamAShort, teamBShort } = {}) => {
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

  safeOn(socket, 'updateScore', ({ team, delta } = {}) => {
    // Blockera manuella ändringar när IBIS-synk styr resultatet, annars
    // skulle en knapptryckning skrivas över vid nästa poll → flicker.
    if (matchState.scoreSyncMode === 'api') return;
    const d = parseInt(delta, 10);
    if (!Number.isFinite(d)) return;
    if (team === 'A') matchState.scoreA = Math.max(0, matchState.scoreA + d);
    if (team === 'B') matchState.scoreB = Math.max(0, matchState.scoreB + d);
    // Powerplay-mål: varje gjort mål (positivt delta) avslutar motståndarens
    // pågående 2-min om laget är i numerärt underläge. En 2+2 promotar då
    // automatiskt sin köade halva.
    if (d > 0 && (team === 'A' || team === 'B')) {
      const scoringTeam = team === 'A' ? 'home' : 'away';
      for (let i = 0; i < d; i++) endMinorForGoal(scoringTeam);
    }
    io.emit('stateUpdate', matchState);
  });

  // Växla mellan IBIS-synk och manuell hantering av resultatet. Default = 'api'.
  // I 'api'-mode startar pollern om en match-URL hämtats; annars väntar den
  // tills fetch_innebandy_all_data sätter syncMatchId.
  safeOn(socket, 'setScoreSyncMode', ({ mode } = {}) => {
    const next = mode === 'manual' ? 'manual' : 'api';
    if (matchState.scoreSyncMode === next) return;
    matchState.scoreSyncMode = next;
    // Pollen körs så länge minst en av score/period är i api-mode.
    if (next === 'api' || matchState.periodSyncMode === 'api') startScoreSyncPoll();
    else                                                       stopScoreSyncPoll();
    io.emit('stateUpdate', matchState);
  });

  // Växla mellan IBIS-synk och manuell hantering av period. Samma mönster som
  // score-synken — manuella period-knappar blockeras i 'api'-mode så att
  // nästa IBIS-poll inte skriver över.
  safeOn(socket, 'setPeriodSyncMode', ({ mode } = {}) => {
    const next = mode === 'manual' ? 'manual' : 'api';
    if (matchState.periodSyncMode === next) return;
    matchState.periodSyncMode = next;
    if (next === 'api' || matchState.scoreSyncMode === 'api') startScoreSyncPoll();
    else                                                      stopScoreSyncPoll();
    io.emit('stateUpdate', matchState);
  });

  safeOn(socket, 'clockStart', () => { startClock(); io.emit('clockStatus', { running: true }); });
  safeOn(socket, 'clockPause', () => { pauseClock(); io.emit('clockStatus', { running: false }); });
  safeOn(socket, 'clockReset', () => { resetClock(); io.emit('clockStatus', { running: false }); });

  // Manuell tidsjustering (±N sekunder eller sätt absolut MM:SS via sekunder)
  safeOn(socket, 'clockAdjust', ({ delta } = {}) => {
    const d = parseInt(delta, 10);
    if (!Number.isFinite(d)) return;
    setClockSeconds(elapsedSeconds + d);
  });
  safeOn(socket, 'clockSet', ({ seconds } = {}) => {
    const s = parseInt(seconds, 10);
    if (!Number.isFinite(s)) return;
    setClockSeconds(s);
  });

  // Period via socket (HTTP-rutter finns också för Stream Deck).
  // Blockeras när IBIS-synk styr perioden, annars skulle nästa poll
  // skriva över ändringen → flicker.
  safeOn(socket, 'periodNext', () => {
    if (matchState.periodSyncMode === 'api') return;
    matchState.period = Math.min(5, (matchState.period || 1) + 1);
    applyPeriodClockRule(matchState.period);
    io.emit('stateUpdate', matchState);
  });
  safeOn(socket, 'periodReset', () => {
    if (matchState.periodSyncMode === 'api') return;
    matchState.period = 1;
    applyPeriodClockRule(1);
    io.emit('stateUpdate', matchState);
  });

  // Dölj/visa klockan (period förblir alltid synlig)
  safeOn(socket, 'setClockVisibility', ({ visible } = {}) => {
    matchState.clockVisible = !!visible;
    io.emit('stateUpdate', matchState);
  });
  safeOn(socket, 'toggleClockVisibility', () => {
    matchState.clockVisible = !matchState.clockVisible;
    io.emit('stateUpdate', matchState);
  });

  // ── Laguppställningar & Tabell (data-uppdateringar) ──────────────────────
  // Ledare som kommer via socket (i normalfallet via fetch → formatPersons,
  // som redan normaliserar) – kör ändå normalizeRoleName som defensivt skydd
  // om en framtida integration skickar in raw IBIS-RoleName direkt.
  const normalizeLeaders = (arr) => arr.map(l => ({
    name: typeof l?.name === 'string' ? l.name : '',
    role: normalizeRoleName(typeof l?.role === 'string' ? l.role : '')
  }));
  safeOn(socket, 'updateLineups', ({ home, away, homeLeaders, awayLeaders } = {}) => {
    if (Array.isArray(home))         matchState.lineupHome        = home;
    if (Array.isArray(away))         matchState.lineupAway        = away;
    if (Array.isArray(homeLeaders))  matchState.lineupHomeLeaders = normalizeLeaders(homeLeaders);
    if (Array.isArray(awayLeaders))  matchState.lineupAwayLeaders = normalizeLeaders(awayLeaders);
    io.emit('stateUpdate', matchState);
  });

  safeOn(socket, 'updateTable', (payload) => {
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

  // Spelar-/ledar-lower-third (lower-third nere till vänster).
  // Payload kan vara null/{} för att rensa skylten, annars
  //   { team: 'home'|'away', teamName, number, name, role }
  safeOn(socket, 'updatePlayerLowerThird', (payload) => {
    if (payload == null) {
      matchState.playerLowerThird = null;
    } else {
      const team      = payload.team === 'away' ? 'away' : 'home';
      const teamName  = typeof payload.teamName === 'string' ? payload.teamName.trim() : '';
      const number    = typeof payload.number   === 'string' ? payload.number.trim()   : '';
      const name      = typeof payload.name     === 'string' ? payload.name.trim()     : '';
      const role      = typeof payload.role     === 'string' ? payload.role.trim()     : '';
      if (!name) {
        matchState.playerLowerThird = null;
      } else {
        // Slå upp foto-URL i den aktuella laguppställningen. Spelare matchas
        // i första hand på shirtNo (alltid unikt inom ett lag) och annars på
        // namn. Ledare har inget number → matchas på namn. Saknas träff blir
        // imageUrl = '' (graphics.js döljer img-elementet).
        const lineup = team === 'away' ? matchState.lineupAway : matchState.lineupHome;
        let imageUrl = '';
        if (Array.isArray(lineup) && lineup.length) {
          const match = lineup.find(p =>
            p && typeof p === 'object' &&
            ((number && String(p.shirtNo) === number) ||
             (!number && p.name === name))
          );
          imageUrl = match?.imageUrl || '';
        }
        matchState.playerLowerThird = { team, teamName, number, name, role, imageUrl };
      }
    }
    io.emit('stateUpdate', matchState);
  });

  // ── Övriga matcher – ticker ────────────────────────────────────────────
  // Testkort i settings.html skickar ett mockat mål-event per klick.
  // Vi relayar det till alla anslutna klienter. graphics.html köar och
  // visar en popup åt gången (5 s) så länge scoreboarden är aktiv.
  safeOn(socket, 'tickerTestGoal', (goal) => {
    if (!goal || typeof goal !== 'object') return;
    io.emit('tickerGoal', goal);
  });
  safeOn(socket, 'tickerTestClear', () => {
    io.emit('tickerClear');
  });

  // Kommentatorer (lower-third)
  safeOn(socket, 'updateCommentators', ({ name1, name2 } = {}) => {
    matchState.commentators = {
      name1: typeof name1 === 'string' ? name1.trim() : matchState.commentators.name1,
      name2: typeof name2 === 'string' ? name2.trim() : matchState.commentators.name2
    };
    io.emit('stateUpdate', matchState);
  });

  // Match-meta (venue + logos + matchstart) – kontrollpanelen pushar dessa
  // efter fetch så att användaren även kan redigera Venue innan visning.
  safeOn(socket, 'updateMatchMeta', ({ venue, homeLogo, awayLogo, matchStart } = {}) => {
    if (typeof venue      === 'string') matchState.venue      = venue.trim();
    if (typeof homeLogo   === 'string') matchState.homeLogo   = homeLogo;
    if (typeof awayLogo   === 'string') matchState.awayLogo   = awayLogo;
    if (typeof matchStart === 'string') matchState.matchStart = matchStart;
    io.emit('stateUpdate', matchState);
  });

  safeOn(socket, 'updateFixtures', (payload) => {
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
  safeOn(socket, 'switchGraphic', ({ to } = {}) => {
    // Acceptera även 'clear' som synonym för 'none' så att kontrollpanelens
    // "Dölj all grafik"-knapp (data-graphic="clear") fungerar – samma
    // beteende som HTTP-rutten /api/graphic/clear.
    const target = to === 'clear' ? 'none' : to;
    const allowed = ['scoreboard', 'lineupHome', 'lineupAway', 'table', 'fixtures',
                     'commentators', 'matchup', 'intermission', 'playerLowerThird',
                     'preGameStats', 'none'];
    if (!allowed.includes(target)) return;
    graphicState.activeGraphic = target;
    io.emit('switchGraphic', { to: target });
    console.log(`Grafik-byte → ${target}`);
  });

  // ── API: stats.innebandy.se – Allt på en gång (match + serietabell) ─────
  safeOn(socket, 'fetch_innebandy_all_data', async ({ url } = {}) => {
    if (!url) return;
    console.log(`Hämtar all data: ${url}`);
    try {
      const data = await fetchInnebandyAll(url);

      // Spegla in preGameStats i serverns state direkt – på samma sätt som
      // lineups/standings/fixtures – så ny OBS-anslutning eller producent
      // som öppnar kontrollpanelen efteråt får färska siffror utan refetch.
      matchState.preGameStats = data.preGameStats || null;

      // Spara match-ID:t så score-sync-pollern vet vilken match som ska
      // följas. Starta pollern direkt om vi står i API-mode.
      const idMatch = url.match(/\/match\/(\d+)/);
      if (idMatch) {
        matchState.syncMatchId = parseInt(idMatch[1], 10);
        if (matchState.scoreSyncMode === 'api') startScoreSyncPoll();
      }

      // Spara competitionId så grafiken kan polla live-status på omgångens
      // övriga matcher via /api/series/:competitionId/live.
      const compMatch = url.match(/\/(?:serie|turnering)\/(\d+)\//);
      matchState.fixturesCompetitionId = compMatch ? parseInt(compMatch[1], 10) : null;

      io.emit('stateUpdate', matchState);

      socket.emit('fetch_result_innebandy_all_data', data);

      const tabStatus = data.standings
        ? `${data.standings.length} lag (${data.standingsName})`
        : `EJ HÄMTAD (${data.standingsError})`;
      const preStatus = data.preGameStats
        ? 'OK'
        : `EJ HÄMTAD (${data.preGameStatsError})`;
      console.log(`  → ${data.match.homeTeam} (${data.match.homeRoster.length}) vs ${data.match.awayTeam} (${data.match.awayRoster.length}) | Tabell: ${tabStatus} | Pregame: ${preStatus}`);
    } catch (err) {
      console.error(`  → Fel: ${err.message}`);
      socket.emit('fetch_error', {
        context: 'innebandy_all',
        message: err.message || 'Okänt fel vid hämtning'
      });
    }
  });

  // ── Time-out ─────────────────────────────────────────────────────────────
  safeOn(socket, 'timeOutStart', ({ team } = {}) => {
    startTimeOut(team);
  });
  safeOn(socket, 'timeOutClear', () => {
    stopTimeOut();
  });

  // ── Utvisningar ──────────────────────────────────────────────────────────
  // 'penaltyAdd' med kind === 'double' = 2+2-utvisning (två 2-min, andra
  // alltid queued). Annars vanlig single-utvisning på `minutes` minuter.
  safeOn(socket, 'penaltyAdd', ({ team, minutes, jersey, kind } = {}) => {
    if (kind === 'double') {
      addDoubleMinor(team, jersey);
    } else {
      addPenalty(team, minutes, jersey);
    }
  });
  safeOn(socket, 'penaltyRemove', ({ team, id } = {}) => {
    removePenalty(team, id);
  });
  safeOn(socket, 'penaltyClear', ({ team } = {}) => {
    clearPenalties(team);
  });

  // ── Nollställ match (rensa all matchdata) ─────────────────────────────────
  safeOn(socket, 'resetMatchState', () => {
    resetMatchState();
  });

  // ── Periodlängd ──────────────────────────────────────────────────────────
  // Sätter hur många minuter en period är – matchklockan stoppas automatiskt
  // när elapsedSeconds når detta värde. Persisteras till data/settings.json
  // så att den överlever serverstart. Avvisar tysta värden utanför 1–99.
  safeOn(socket, 'setPeriodLength', ({ minutes } = {}) => {
    const m = clampPeriodLength(minutes);
    if (m == null) return;
    if (matchState.periodLengthMinutes === m) return;
    matchState.periodLengthMinutes = m;
    saveSettings();
    io.emit('stateUpdate', matchState);
    console.log(`Periodlängd satt till ${m} min`);
  });

  // ── Övertid ──────────────────────────────────────────────────────────────
  // Speglar setPeriodLength men för period 4 (övertid). Samma persistens
  // och samma 1–99-range. periodLimitSeconds() väljer automatiskt rätt
  // värde beroende på matchState.period.
  safeOn(socket, 'setOvertimeLength', ({ minutes } = {}) => {
    const m = clampPeriodLength(minutes);
    if (m == null) return;
    if (matchState.overtimeLengthMinutes === m) return;
    matchState.overtimeLengthMinutes = m;
    saveSettings();
    io.emit('stateUpdate', matchState);
    console.log(`Övertidslängd satt till ${m} min`);
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
  // Samma powerplay-regel som webb-kontrollpanelens updateScore: ett gjort mål
  // avslutar motståndarens pågående 2-min vid numerärt underläge.
  if (delta > 0 && (team === 'A' || team === 'B')) {
    endMinorForGoal(team === 'A' ? 'home' : 'away');
  }
  broadcastState();
  return { scoreA: matchState.scoreA, scoreB: matchState.scoreB };
}

// Stream Deck-rutterna blockeras också i API-mode så Stream Deck inte kan
// "kämpa mot" IBIS-pollern. Producenten måste aktivt växla till manuell-mode
// för att triggers ska kunna ändra poängen.
function rejectIfApiMode(res) {
  if (matchState.scoreSyncMode === 'api') {
    res.status(409).json({
      success: false,
      error: 'Resultatet styrs av IBIS-synk. Växla till manuell-mode i kontrollpanelen för att uppdatera poängen.'
    });
    return true;
  }
  return false;
}

app.get('/api/score/home/add', (_req, res) => {
  if (rejectIfApiMode(res)) return;
  res.json({ success: true, ...applyScore('A',  1) });
});
app.get('/api/score/home/sub', (_req, res) => {
  if (rejectIfApiMode(res)) return;
  res.json({ success: true, ...applyScore('A', -1) });
});
app.get('/api/score/away/add', (_req, res) => {
  if (rejectIfApiMode(res)) return;
  res.json({ success: true, ...applyScore('B',  1) });
});
app.get('/api/score/away/sub', (_req, res) => {
  if (rejectIfApiMode(res)) return;
  res.json({ success: true, ...applyScore('B', -1) });
});

// ── Utvisningar (penalties) ──────────────────────────────────────────────────
// Endast 2 och 5 minuter stöds (standard i innebandy). Andra värden avvisas
// så att Stream Deck får tydlig feedback istället för konstiga utvisningar.
const ALLOWED_PENALTY_MINUTES = new Set([2, 5]);

function penaltyArrayFor(team) {
  if (team === 'home' || team === 'A') return matchState.penaltiesHome;
  if (team === 'away' || team === 'B') return matchState.penaltiesAway;
  return null;
}

function broadcastPenalties() {
  io.emit('penaltiesUpdate', {
    penaltiesHome: matchState.penaltiesHome,
    penaltiesAway: matchState.penaltiesAway
  });
}

// addPenalty: forceQueued tvingar status='queued' oavsett aktivt-count
// (används för andra halvan av 2+2 så den hamnar bakom första 2-min:en).
// bypassCap hoppar över grupp-capen (addDoubleMinor gör en egen kontroll
// upfront och lägger två entries i samma grupp).
// Returnerar null om laget redan har MAX_PENALTIES_PER_TEAM grupper.
function addPenalty(team, minutes, jersey, forceQueued = false, bypassCap = false) {
  const arr = penaltyArrayFor(team);
  if (!arr) return null;
  if (!bypassCap && countGroups(arr) >= MAX_PENALTIES_PER_TEAM) return null;
  const m = parseInt(minutes, 10);
  if (!ALLOWED_PENALTY_MINUTES.has(m)) return null;

  const duration = m * 60;
  const isQueued = forceQueued || countActive(arr) >= MAX_ACTIVE_PENALTIES;
  const entry = {
    id:        ++penaltySeq,
    duration,
    // queued-poster startar inte ticka – vi sätter remaining till duration
    // när de promoteras (så de alltid får full tid när de aktiveras).
    remaining: duration,
    status:    isQueued ? 'queued' : 'active',
    jersey:    typeof jersey === 'string' ? jersey.trim().slice(0, 3) : ''
  };
  arr.push(entry);
  broadcastPenalties();
  return entry;
}

// 2+2-utvisning: två 2-min-poster där den ANDRA alltid är queued direkt.
// Båda får samma pairId så grafiken kan rendera dem sida vid sida och
// caps:en räknar dem som EN grupp. Kräver plats för en grupp till.
function addDoubleMinor(team, jersey) {
  const arr = penaltyArrayFor(team);
  if (!arr) return null;
  if (countGroups(arr) >= MAX_PENALTIES_PER_TEAM) return null;
  const first  = addPenalty(team, 2, jersey, false, true);
  if (!first) return null;
  const second = addPenalty(team, 2, jersey, true, true);
  if (second) {
    const pairId = `pair-${first.id}-${second.id}`;
    first.pairId  = pairId;
    second.pairId = pairId;
    broadcastPenalties();
  }
  return { first, second };
}

function removePenalty(team, id) {
  const arr = penaltyArrayFor(team);
  if (!arr) return false;
  const numId = parseInt(id, 10);
  if (!Number.isFinite(numId)) return false;
  const idx = arr.findIndex(p => p.id === numId);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  // Om vi tog bort en aktiv ska nästa queued promoteras direkt.
  promoteQueued(arr);
  broadcastPenalties();
  return true;
}

// Powerplay-mål: `scoringTeam` (home/away) gör mål. Om motståndaren spelar i
// numerärt underläge (fler aktiva utvisningar) avslutas motståndarens pågående
// MINDRE utvisning (2 min) med kortast återstående tid. 5-min (matchstraff)
// påverkas inte enligt regelverket, och vid lika numerär (t.ex. 4-mot-4)
// avslutar ett mål ingen utvisning. För en 2+2 tas den aktiva halvan bort –
// den köade halvan promotas då automatiskt (spelaren sitter kvar för andra
// 2-minutersperioden). Returnerar true om en utvisning avslutades.
function endMinorForGoal(scoringTeam) {
  const oppTeam = scoringTeam === 'home' ? 'away' : 'home';
  const oppArr  = penaltyArrayFor(oppTeam);
  const ownArr  = penaltyArrayFor(scoringTeam);
  if (!oppArr || !ownArr) return false;
  // Endast om motståndaren är i numerärt underläge gör målet att en
  // utvisning avslutas (powerplay-regeln).
  if (countActive(oppArr) <= countActive(ownArr)) return false;

  const MINOR_DURATION = 2 * 60;
  let target = null;
  for (const p of oppArr) {
    if (p.status !== 'active' || p.duration !== MINOR_DURATION) continue;
    if (!target || p.remaining < target.remaining) target = p;
  }
  if (!target) return false;
  oppArr.splice(oppArr.indexOf(target), 1);
  promoteQueued(oppArr);
  broadcastPenalties();
  return true;
}

function clearPenalties(team) {
  // team === 'all' eller saknat = nollställ båda lagen (mål-i-powerplay-fall
  // hanteras av kontrollpanelen som tar bort äldsta utvisningen per lag).
  if (!team || team === 'all') {
    matchState.penaltiesHome.length = 0;
    matchState.penaltiesAway.length = 0;
  } else {
    const arr = penaltyArrayFor(team);
    if (!arr) return false;
    arr.length = 0;
  }
  broadcastPenalties();
  return true;
}

// HTTP-rutter (Stream Deck-vänliga GET)
//   /api/penalty/home/add?minutes=2&jersey=17
//   /api/penalty/away/add?minutes=5
//   /api/penalty/home/remove?id=42
//   /api/penalty/home/clear
app.get('/api/penalty/:team/add', (req, res) => {
  const team   = req.params.team;
  const jersey = req.query.jersey;
  const arr    = penaltyArrayFor(team);
  if (!arr) {
    return res.status(400).json({ success: false, error: 'Ogiltigt lag. Använd team=home eller team=away.' });
  }
  if (req.query.kind === 'double') {
    if (arr.length + 2 > MAX_PENALTIES_PER_TEAM) {
      return res.status(409).json({
        success: false,
        error: `2+2 kräver två lediga platser – laget har redan ${arr.length}/${MAX_PENALTIES_PER_TEAM} utvisningar.`
      });
    }
    const pair = addDoubleMinor(team, jersey);
    return res.json({ success: true, penalties: [pair.first, pair.second] });
  }
  if (arr.length >= MAX_PENALTIES_PER_TEAM) {
    return res.status(409).json({
      success: false,
      error: `Max ${MAX_PENALTIES_PER_TEAM} utvisningar per lag. Vänta tills en löper ut.`
    });
  }
  const entry = addPenalty(team, req.query.minutes, jersey);
  if (!entry) {
    return res.status(400).json({
      success: false,
      error: 'Ogiltiga minuter. Använd minutes=2/5 (+ ev. kind=double).'
    });
  }
  res.json({ success: true, penalty: entry });
});

app.get('/api/penalty/:team/remove', (req, res) => {
  const team = req.params.team;
  const ok = removePenalty(team, req.query.id);
  if (!ok) {
    return res.status(400).json({
      success: false,
      error: 'Hittade ingen utvisning med det id:t för det laget.'
    });
  }
  res.json({ success: true });
});

app.get('/api/penalty/:team/clear', (req, res) => {
  const team = req.params.team;
  if (team !== 'home' && team !== 'away' && team !== 'all') {
    return res.status(400).json({ success: false, error: 'Använd team=home, away eller all.' });
  }
  clearPenalties(team);
  res.json({ success: true });
});

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
  // Av-toggle landar på 'none' så ingen annan grafik dyker upp automatiskt
  // (tidigare hoppade vi tillbaka till scoreboarden, vilket inte är önskvärt
  // när kommentator-skylten är en ren overlay som ska tas bort tyst).
  const target    = currently === 'commentators' ? 'none' : 'commentators';

  graphicState.activeGraphic = target;
  io.emit('switchGraphic', { to: target });
  io.emit('stateUpdate', matchState);
  console.log(`HTTP-toggle kommentatorer → ${target}`);
  res.json({ success: true, activeGraphic: target });
});

app.get('/api/graphic/:target', (req, res) => {
  const allowed = ['scoreboard', 'lineupHome', 'lineupAway', 'table', 'fixtures',
                   'commentators', 'matchup', 'intermission', 'preGameStats',
                   'clear'];
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
  if (to === 'preGameStats' && !matchState.preGameStats) {
    return res.status(400).json({
      success: false,
      error: 'Ingen statistik inför match lagrad. Hämta en match i kontrollpanelen först.'
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
  if (matchState.periodSyncMode === 'api') {
    return res.status(409).json({
      success: false,
      error: 'Period-synk är i IBIS-läge — växla till manuell för att stega period.'
    });
  }
  matchState.period = Math.min(5, (matchState.period || 1) + 1);
  applyPeriodClockRule(matchState.period);
  broadcastState();
  res.json({ success: true, period: matchState.period });
});

app.get('/api/period/reset', (_req, res) => {
  if (matchState.periodSyncMode === 'api') {
    return res.status(409).json({
      success: false,
      error: 'Period-synk är i IBIS-läge — växla till manuell för att återställa period.'
    });
  }
  matchState.period = 1;
  applyPeriodClockRule(1);
  broadcastState();
  res.json({ success: true, period: 1 });
});

// ── Nollställ match ──────────────────────────────────────────────────────────
app.get('/api/reset', (_req, res) => {
  resetMatchState();
  res.json({ success: true });
});

// ── Time-out (Stream Deck) ──────────────────────────────────────────────────
// /api/timeout/home/start  – startar 30s time-out för hemma + visar grafik
// /api/timeout/away/start  – samma för borta
// /api/timeout/clear       – avsluta och göm
app.get('/api/timeout/:team/start', (req, res) => {
  const team = req.params.team;
  if (team !== 'home' && team !== 'away') {
    return res.status(400).json({ success: false, error: 'Använd team=home eller team=away.' });
  }
  const t = startTimeOut(team);
  // Visa grafiken direkt så Stream Deck blir en one-click-knapp
  graphicState.activeGraphic = 'timeout';
  io.emit('switchGraphic', { to: 'timeout' });
  res.json({ success: true, timeOut: t });
});

app.get('/api/timeout/clear', (_req, res) => {
  stopTimeOut();
  if (graphicState.activeGraphic === 'timeout') {
    graphicState.activeGraphic = 'scoreboard';
    io.emit('switchGraphic', { to: 'scoreboard' });
  }
  res.json({ success: true });
});

// ── Sponsorer ────────────────────────────────────────────────────────────────
// Lista, ersätt och radera sponsorlogotyper. Filerna lagras i public/sponsors/
// och listan persisteras i data/sponsors.json så att de överlever serverstart.
// Settings-sidan POST:ar HELA listan (upp till SPONSORS_MAX) som en blandning
// av befintliga {id, url} och nya {dataUrl, name}-poster – servern diff:ar
// och tar bort filer som inte längre refereras.
app.get('/api/sponsors', (_req, res) => {
  res.json({ success: true, sponsors: sponsorState.sponsors });
});

app.post('/api/sponsors', (req, res) => {
  const incoming = Array.isArray(req.body?.sponsors) ? req.body.sponsors : null;
  if (!incoming) {
    return res.status(400).json({ success: false, error: 'Förväntade { sponsors: [...] }.' });
  }
  if (incoming.length > SPONSORS_MAX) {
    return res.status(400).json({
      success: false,
      error: `Max ${SPONSORS_MAX} sponsorer tillåts.`
    });
  }

  // Snabb-uppslag av befintliga poster (för att behålla deras filer)
  const existingById = new Map(sponsorState.sponsors.map(s => [s.id, s]));
  const keepIds      = new Set();
  const nextList     = [];

  try {
    for (const item of incoming) {
      if (item && item.id && existingById.has(item.id)) {
        // Befintlig sponsor – behåll filen, ev. uppdatera namn
        const existing = existingById.get(item.id);
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : existing.name;
        nextList.push({ ...existing, name });
        keepIds.add(item.id);
      } else if (item && typeof item.dataUrl === 'string') {
        // Ny sponsor – validera + skriv fil
        const parsed = parseDataUrl(item.dataUrl);
        if (!parsed) {
          return res.status(400).json({
            success: false,
            error: 'Ogiltig bildtyp. Stödda format: PNG, JPG, GIF, WEBP, SVG.'
          });
        }
        const entry = writeSponsorFile(parsed, item.name);
        nextList.push(entry);
        keepIds.add(entry.id);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Varje sponsor måste innehålla antingen id (befintlig) eller dataUrl (ny).'
        });
      }
    }

    // Ta bort filer för borttagna sponsorer
    for (const existing of sponsorState.sponsors) {
      if (!keepIds.has(existing.id)) deleteSponsorFile(existing.url);
    }

    sponsorState.sponsors = nextList;
    saveSponsorManifest();
    broadcastSponsors();
    res.json({ success: true, sponsors: sponsorState.sponsors });
  } catch (err) {
    console.error('[sponsors] POST misslyckades:', err);
    res.status(500).json({ success: false, error: err.message || 'Internt fel.' });
  }
});

app.delete('/api/sponsors/:id', (req, res) => {
  const id = req.params.id;
  const idx = sponsorState.sponsors.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Sponsorn hittades inte.' });
  }
  const [removed] = sponsorState.sponsors.splice(idx, 1);
  deleteSponsorFile(removed.url);
  saveSponsorManifest();
  broadcastSponsors();
  res.json({ success: true, sponsors: sponsorState.sponsors });
});

// ── Live-matcher i serien (övriga-matcher-tickern) ──────────────────────────
// Pollas av public/js/other-matches-ticker.js var 30:e sekund. Returnerar
// { matches: LiveMatch[] } i det format klienten väntar sig. Skicka
// ?currentMatchId=NNN för att server-side exkludera matchen som streamas.
app.get('/api/series/:competitionId/live', async (req, res) => {
  const competitionId = parseInt(req.params.competitionId, 10);
  if (!Number.isFinite(competitionId) || competitionId <= 0) {
    return res.status(400).json({ error: 'Ogiltigt competitionId' });
  }
  try {
    const payload = await fetchInnebandyLiveSeries(competitionId, {
      excludeMatchId: req.query.currentMatchId
    });
    res.json(payload);
  } catch (err) {
    console.warn('[series-live] fel:', err.message);
    res.status(502).json({ error: err.message || 'Kunde inte hämta live-matcher' });
  }
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
    activeGraphic: graphicState.activeGraphic,
    penaltiesHome: matchState.penaltiesHome,
    penaltiesAway: matchState.penaltiesAway,
    timeOut:       matchState.timeOut
  });
});

// ── Process-skydd: håll igång under sändning även vid oväntat fel ───────────
// Linux + Node 15+ kraschar default vid unhandledRejection. Under en live-
// sändning vill vi logga och fortsätta i stället för att tappa grafiken.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack || err);
});

// ── Starta server ────────────────────────────────────────────────────────────
// Honorera $PORT (Linux/CI/systemd) men fall tillbaka på 3000.
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} används redan. Stäng processen som lyssnar där eller starta med PORT=<annan port> npm start\n`);
  } else {
    console.error('[server.error]', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\n✅ Scoreboard-server igång (lyssnar på ${HOST}:${PORT})`);
  console.log(`   Grafik (OBS Browser Source): http://localhost:${PORT}/graphics.html`);
  console.log(`   Kontrollpanel:               http://localhost:${PORT}/control.html`);
  if (AUTH_ENABLED) {
    console.log(`   🔒 Inloggning aktiverad (APP_PASSWORD satt).\n`);
  } else {
    console.warn(`   ⚠️  OLÅST: APP_PASSWORD är inte satt – vem som helst kan ändra grafiken.`);
    console.warn(`       Sätt APP_PASSWORD för att skydda kontroll-/inställningssidorna.\n`);
  }
});
