/**
 * ══════════════════════════════════════════════════════════════════════════
 *  OtherMatchesTicker
 *  Realtids-ticker för "övriga matcher" som spelas samtidigt.
 *
 *  Pollar en server-endpoint som proxar IBIS API (v2) var X:e sekund,
 *  jämför svar mot föregående snapshot och avfyrar en callback varje gång
 *  resultatet i en match ändras (= nytt mål). Den match som användaren
 *  själv streamar exkluderas via `currentMatchId`.
 *
 *  Designad för att vara lätt att koppla till ett DOM-element:
 *    const ticker = new OtherMatchesTicker({ ... });
 *    ticker.start();
 *    ticker.onGoal = (goal) => showPopupIn(document.getElementById('ticker'), goal);
 *
 *  Server-endpoint:
 *    GET /api/series/:competitionId/live
 *    Förväntat JSON-svar: { matches: LiveMatch[] }
 *
 *    LiveMatch = {
 *      matchId:     number,
 *      homeTeam:    string,
 *      awayTeam:    string,
 *      homeGoals:   number,
 *      awayGoals:   number,
 *      status:      'Live' | 'Scheduled' | 'Finished',
 *      period:      number | null,      // 1–5
 *      periodTime:  string | null,      // 'MM:SS' i pågående period
 *      lastGoal:    LastGoal | null     // senaste målet i matchen (kan vara null vid första svaret)
 *    }
 *
 *    LastGoal = {
 *      scoringTeam: 'home' | 'away',
 *      scorer:      { jersey: string, name: string },
 *      assist:      { jersey: string, name: string } | null,
 *      period:      number,
 *      periodTime:  string                 // 'MM:SS'
 *    }
 * ══════════════════════════════════════════════════════════════════════════
 */
class OtherMatchesTicker {
  /**
   * @param {object} options
   * @param {string}        options.endpoint        – URL till serie-poll-endpointen (utan querystring).
   * @param {number|string} options.currentMatchId  – Match-ID som ska exkluderas (matchen du själv streamar).
   * @param {number}        [options.intervalMs=30000] – Polling-intervall.
   * @param {(goal: GoalEvent) => void}   [options.onGoal]   – Triggas vid varje upptäckt nytt mål.
   * @param {(error: Error)    => void}   [options.onError]  – Triggas när polling misslyckas.
   * @param {(matches: LiveMatch[]) => void} [options.onUpdate] – Triggas efter varje lyckad poll (oavsett mål).
   */
  constructor(options) {
    if (!options || !options.endpoint) {
      throw new Error('OtherMatchesTicker: `endpoint` är obligatorisk.');
    }
    if (options.currentMatchId == null) {
      throw new Error('OtherMatchesTicker: `currentMatchId` är obligatorisk (matchen som ska exkluderas).');
    }

    this.endpoint       = options.endpoint;
    this.currentMatchId = String(options.currentMatchId);
    this.intervalMs     = Math.max(5_000, options.intervalMs ?? 30_000);

    this.onGoal   = options.onGoal   || (() => {});
    this.onError  = options.onError  || (() => {});
    this.onUpdate = options.onUpdate || (() => {});

    /** @type {Map<string, { homeGoals: number, awayGoals: number }>} */
    this._snapshot   = new Map();
    this._timerId    = null;
    this._abortCtrl  = null;
    this._isPolling  = false;
  }

  /* ── Publika metoder ─────────────────────────────────────────────────── */

  /** Starta polling. Första anropet körs direkt, därefter var `intervalMs`. */
  start() {
    if (this._timerId) return;                  // redan igång
    this._poll();                               // omedelbar första poll
    this._timerId = setInterval(() => this._poll(), this.intervalMs);
  }

  /** Stoppa polling och avbryt eventuellt pågående fetch. */
  stop() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }

  /** Tvinga en extra poll (utöver det vanliga intervallet). */
  async forcePoll() {
    await this._poll();
  }

  /* ── Internt ─────────────────────────────────────────────────────────── */

  async _poll() {
    if (this._isPolling) return;                // skydd mot överlappande requests
    this._isPolling = true;
    this._abortCtrl = new AbortController();

    try {
      const res = await fetch(this.endpoint, {
        method:  'GET',
        headers: { 'Accept': 'application/json' },
        signal:  this._abortCtrl.signal
      });

      if (!res.ok) {
        throw new Error(`Polling-fel: HTTP ${res.status} ${res.statusText}`);
      }

      const payload = await res.json();
      const all     = Array.isArray(payload?.matches) ? payload.matches : [];

      // Filtrering: bara live-matcher, exklusive den vi själv streamar.
      const live = all.filter(m =>
        m && m.status === 'Live' && String(m.matchId) !== this.currentMatchId
      );

      // Detektera nya mål genom att diffa mot förra snapshotten.
      const goals = this._detectGoals(live);

      // Uppdatera snapshot OCH avfyra callbacks.
      this._updateSnapshot(live);
      this.onUpdate(live);
      for (const g of goals) this.onGoal(g);

    } catch (err) {
      if (err.name === 'AbortError') return;    // user stoppade — inte ett fel
      this.onError(err);
    } finally {
      this._isPolling = false;
      this._abortCtrl = null;
    }
  }

  /**
   * Bygger en lista av målhändelser genom att jämföra `live` mot
   * `this._snapshot`. En match räknas som "nytt mål" om summan av mål ökat
   * sedan senaste anropet. Vi använder summan så att vi inte missar ett mål
   * även om svaret från IBIS tillfälligt skiftar order eller rapporterar
   * båda lagens mål samtidigt.
   *
   * @param {LiveMatch[]} live
   * @returns {GoalEvent[]}
   */
  _detectGoals(live) {
    const out = [];

    for (const m of live) {
      const key  = String(m.matchId);
      const prev = this._snapshot.get(key);

      // Första gången vi ser en match — ingen baseline ännu, så vi rapporterar
      // inte ett "nytt" mål för existerande resultat. Annars skulle vi spamma
      // popups med alla tidigare mål varje gång användaren laddar om sidan.
      if (!prev) continue;

      const prevTotal = (prev.homeGoals || 0) + (prev.awayGoals || 0);
      const nowTotal  = (m.homeGoals  || 0) + (m.awayGoals  || 0);
      if (nowTotal <= prevTotal) continue;

      // Härleda vilket lag som gjorde målet (om lastGoal saknas faller vi
      // tillbaka på diff:en mellan tidigare och nuvarande resultat).
      const scoringTeam =
        m.lastGoal?.scoringTeam
        || (m.homeGoals > prev.homeGoals ? 'home' : 'away');

      out.push({
        matchId:     m.matchId,
        homeTeam:    m.homeTeam,
        awayTeam:    m.awayTeam,
        scoringTeam,
        scorer:      m.lastGoal?.scorer     || null,
        assist:      m.lastGoal?.assist     || null,
        period:      m.lastGoal?.period     ?? m.period      ?? null,
        periodTime:  m.lastGoal?.periodTime ?? m.periodTime  ?? null,
        scoreHome:   m.homeGoals,
        scoreAway:   m.awayGoals
      });
    }

    return out;
  }

  /** Spara nuvarande mål-status per match-ID inför nästa diff. */
  _updateSnapshot(live) {
    this._snapshot.clear();
    for (const m of live) {
      this._snapshot.set(String(m.matchId), {
        homeGoals: m.homeGoals || 0,
        awayGoals: m.awayGoals || 0
      });
    }
  }
}


/**
 * ──────────────────────────────────────────────────────────────────────────
 *  Render-hjälpare: minimal popup i en ticker-container.
 *  Helt valfritt — om du hellre vill bygga din egen layout, hoppa över
 *  den här och hantera `onGoal` direkt i din egen kod.
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  HTML:
 *    <div id="ticker-container" aria-live="polite"></div>
 *
 *  CSS (exempel — lägg in i ditt egen stilark):
 *    .ticker-popup {
 *      position: relative;
 *      padding: 10px 14px;
 *      margin-top: 8px;
 *      border-radius: 8px;
 *      background: rgba(10, 16, 26, 0.92);
 *      color: #fff;
 *      font-family: 'Readex Pro', sans-serif;
 *      animation: tickerPopIn 0.35s cubic-bezier(.22,1,.36,1) both;
 *    }
 *    .ticker-popup.is-leaving { animation: tickerPopOut 0.25s ease-in both; }
 *    @keyframes tickerPopIn  { from { transform: translateY(-6px); opacity: 0; } }
 *    @keyframes tickerPopOut { to   { transform: translateY(-6px); opacity: 0; } }
 *
 *  Användning:
 *    const ticker = new OtherMatchesTicker({ ... });
 *    ticker.onGoal = (goal) => renderTickerPopup(
 *      document.getElementById('ticker-container'), goal
 *    );
 *    ticker.start();
 */
function renderTickerPopup(container, goal, { lifetimeMs = 7000 } = {}) {
  if (!container) return;

  const team   = goal.scoringTeam === 'home' ? goal.homeTeam : goal.awayTeam;
  const scorer = goal.scorer ? `${goal.scorer.jersey} ${goal.scorer.name}` : 'Mål';
  const assist = goal.assist ? `Pass: ${goal.assist.jersey} ${goal.assist.name}` : '';
  const time   = goal.periodTime ? `P${goal.period || '?'} · ${goal.periodTime}` : '';
  const score  = `${goal.homeTeam} ${goal.scoreHome}–${goal.scoreAway} ${goal.awayTeam}`;

  const el = document.createElement('div');
  el.className = 'ticker-popup';
  el.innerHTML = `
    <strong class="ticker-popup-team">⚽ ${escapeHtml(team)}</strong>
    <span class="ticker-popup-score">${escapeHtml(score)}</span>
    <span class="ticker-popup-scorer">${escapeHtml(scorer)}</span>
    ${assist ? `<span class="ticker-popup-assist">${escapeHtml(assist)}</span>` : ''}
    ${time   ? `<span class="ticker-popup-time">${escapeHtml(time)}</span>`   : ''}
  `;
  container.appendChild(el);

  // Auto-cleanup efter `lifetimeMs` – lägger på `is-leaving`-klass först
  // så CSS-transitionen får tid att köras innan vi tar bort noden.
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }, lifetimeMs);
}

/** Skydd mot XSS när team-/spelarnamn renderas in i innerHTML. */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}


/**
 * ──────────────────────────────────────────────────────────────────────────
 *  TickerQueue
 *  Visar EN popup åt gången. Inkommande mål köas; nästa visas först när
 *  den nuvarande har animerats ut. Använder renderTickerPopup() internt så
 *  layouten/animationen är samma som vid direkt anrop.
 *
 *  Exempel:
 *    const q = new TickerQueue(document.getElementById('ticker-container'));
 *    socket.on('tickerGoal', goal => q.enqueue(goal));
 *    socket.on('tickerClear', () => q.clear());
 * ──────────────────────────────────────────────────────────────────────────
 */
class TickerQueue {
  /**
   * @param {HTMLElement} container – DOM-element där popups renderas.
   * @param {object}  [options]
   * @param {number}  [options.popupMs=5000]   – Synlig tid per popup.
   * @param {number}  [options.gapMs=120]      – Liten paus mellan popups så
   *                                             ut-animationen hinner klart.
   */
  constructor(container, { popupMs = 5000, gapMs = 120 } = {}) {
    this.container = container;
    this.popupMs   = popupMs;
    this.gapMs     = gapMs;
    this.queue     = [];
    this.busy      = false;
    this._nextTimer = null;
  }

  /** Lägg ett mål sist i kön. Startar visningen om kön var tom. */
  enqueue(goal) {
    if (!goal) return;
    this.queue.push(goal);
    if (!this.busy) this._showNext();
  }

  /** Töm kön och animera ut det som visas just nu. */
  clear() {
    this.queue.length = 0;
    if (this._nextTimer) { clearTimeout(this._nextTimer); this._nextTimer = null; }
    if (!this.container) { this.busy = false; return; }
    this.container.querySelectorAll('.ticker-popup').forEach(el => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    });
    this.busy = false;
  }

  _showNext() {
    const goal = this.queue.shift();
    if (!goal) { this.busy = false; return; }
    this.busy = true;
    renderTickerPopup(this.container, goal, { lifetimeMs: this.popupMs });
    // popupMs synlig + 300 ms ut-animation + liten gap innan nästa
    this._nextTimer = setTimeout(() => {
      this._nextTimer = null;
      this._showNext();
    }, this.popupMs + 300 + this.gapMs);
  }
}


// Export-stil: stödjer både global window-användning (för enkel
// <script>-inkludering) och ESM-import om någon vill bunda upp koden.
if (typeof window !== 'undefined') {
  window.OtherMatchesTicker = OtherMatchesTicker;
  window.renderTickerPopup  = renderTickerPopup;
  window.TickerQueue        = TickerQueue;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OtherMatchesTicker, renderTickerPopup, TickerQueue };
}
