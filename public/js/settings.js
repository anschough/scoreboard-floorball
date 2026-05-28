// settings.js – Hantering av sponsoruppladdning
// Sponsorlistan visas i ordning. Operatören kan lägga till, ta bort och
// flytta upp/ner. Spara skickar hela listan till servern som en mix av
// {id} (befintliga) och {dataUrl, name} (nya).

const MAX_SPONSORS = 15;
const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
]);

const socket = io();

// ── DOM-refs ─────────────────────────────────────────────────────────────────
const elFileInput     = document.getElementById('sponsorFiles');
const elList          = document.getElementById('sponsorList');
const elCount         = document.getElementById('sponsorCount');
const elSaveBtn       = document.getElementById('btnSaveSponsors');
const elStatus        = document.getElementById('sponsorStatus');
const elConnStatus    = document.getElementById('connection-status');
const elPreviewTrack  = document.getElementById('sponsorPreviewTrack');

// ── State (local working copy) ───────────────────────────────────────────────
// items: [{ id?, url?, name, dataUrl? }]
// - Befintliga sponsorer: { id, url, name }
// - Nya (ej sparade): { name, dataUrl }
let items = [];
let dirty = false;
let savedSponsors = [];   // Sista bekräftade listan från servern (för preview)

// ── Anslutningsstatus ────────────────────────────────────────────────────────
socket.on('connect', () => {
  elConnStatus.textContent = 'Server ansluten';
  elConnStatus.classList.remove('disconnected');
  elConnStatus.classList.add('connected');
});
socket.on('disconnect', () => {
  elConnStatus.textContent = 'Server frånkopplad';
  elConnStatus.classList.remove('connected');
  elConnStatus.classList.add('disconnected');
});

// Lyssna på sponsor-uppdateringar från servern (om andra klienter sparar)
socket.on('sponsorsUpdate', ({ sponsors } = {}) => {
  if (!Array.isArray(sponsors)) return;
  savedSponsors = sponsors;
  renderPreview();
  // Skriv bara över lokala items om operatören inte har osparade ändringar.
  if (!dirty) {
    items = sponsors.map(s => ({ id: s.id, url: s.url, name: s.name || '' }));
    render();
  }
});

// ── Filuppladdning ───────────────────────────────────────────────────────────
elFileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const free = MAX_SPONSORS - items.length;
  if (free <= 0) {
    setStatus(`Max ${MAX_SPONSORS} sponsorer tillåts. Ta bort en för att lägga till fler.`, 'error');
    elFileInput.value = '';
    return;
  }

  const accepted = [];
  const rejected = [];
  for (const file of files.slice(0, free)) {
    if (!ALLOWED_TYPES.has(file.type)) {
      rejected.push(`${file.name} (ogiltig filtyp)`);
      continue;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      accepted.push({ name: file.name, dataUrl });
    } catch (err) {
      rejected.push(`${file.name} (kunde inte läsas)`);
    }
  }

  if (accepted.length) {
    items.push(...accepted);
    dirty = true;
    render();
    setStatus(`${accepted.length} fil(er) tillagda – glöm inte att spara.`, 'loading');
  }
  if (rejected.length) {
    setStatus(`Hoppade över: ${rejected.join(', ')}`, 'error');
  }
  if (files.length > free) {
    setStatus(`Bara ${free} fil(er) fick plats (max ${MAX_SPONSORS} totalt).`, 'error');
  }

  elFileInput.value = ''; // Tillåt att ladda upp samma fil igen om den togs bort
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader fel'));
    reader.readAsDataURL(file);
  });
}

// ── Render listan ────────────────────────────────────────────────────────────
let dragFromIndex = null;

function render() {
  elList.innerHTML = '';

  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'sponsor-card';
    card.draggable = true;
    card.dataset.index = String(idx);

    // Synlig drag-handle som indikerar att kortet kan dras.
    const handle = document.createElement('div');
    handle.className = 'sponsor-card-handle';
    handle.title = 'Dra för att ändra ordning';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = '<span class="material-symbols-outlined">drag_indicator</span>';

    const preview = document.createElement('div');
    preview.className = 'sponsor-card-preview';
    const img = document.createElement('img');
    img.alt = item.name || 'Sponsor';
    img.src = item.dataUrl || item.url || '';
    preview.appendChild(img);

    const name = document.createElement('div');
    name.className = 'sponsor-card-name';
    name.textContent = item.name || (item.id ? `Sponsor ${idx + 1}` : 'Ny logotyp');
    name.title = name.textContent;

    const actions = document.createElement('div');
    actions.className = 'sponsor-card-actions';

    const upBtn = document.createElement('button');
    upBtn.className = 'sponsor-action';
    upBtn.type = 'button';
    upBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>';
    upBtn.title = 'Flytta upp';
    upBtn.setAttribute('aria-label', `Flytta ${name.textContent} uppåt`);
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => move(idx, idx - 1));

    const downBtn = document.createElement('button');
    downBtn.className = 'sponsor-action';
    downBtn.type = 'button';
    downBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">arrow_downward</span>';
    downBtn.title = 'Flytta ned';
    downBtn.setAttribute('aria-label', `Flytta ${name.textContent} nedåt`);
    downBtn.disabled = idx === items.length - 1;
    downBtn.addEventListener('click', () => move(idx, idx + 1));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'sponsor-action sponsor-action-remove';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
    removeBtn.title = 'Ta bort';
    removeBtn.setAttribute('aria-label', `Ta bort ${name.textContent}`);
    removeBtn.addEventListener('click', () => remove(idx));

    // Förhindra att drag startar när användaren tar tag i en knapp.
    [upBtn, downBtn, removeBtn].forEach(btn => {
      btn.draggable = false;
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
    });

    actions.append(upBtn, downBtn, removeBtn);
    card.append(handle, preview, name, actions);

    // ── Drag-and-drop ────────────────────────────────────────────────────
    card.addEventListener('dragstart', (e) => {
      dragFromIndex = idx;
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Vissa browsers kräver att vi sätter dataTransfer-payload för
        // att dragging ska initieras.
        e.dataTransfer.setData('text/plain', String(idx));
      }
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      elList.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
      dragFromIndex = null;
    });

    card.addEventListener('dragover', (e) => {
      if (dragFromIndex === null || dragFromIndex === idx) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      card.classList.add('is-drop-target');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('is-drop-target');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('is-drop-target');
      const from = dragFromIndex;
      const to = idx;
      dragFromIndex = null;
      if (from === null || from === to) return;
      move(from, to);
    });

    elList.appendChild(card);
  });

  elCount.textContent = `${items.length} av ${MAX_SPONSORS} uppladdade logotyper`;
  elCount.classList.toggle('sponsor-count-full', items.length >= MAX_SPONSORS);

  elSaveBtn.disabled = !dirty;
}

function move(from, to) {
  if (to < 0 || to >= items.length) return;
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  dirty = true;
  render();
}

function remove(idx) {
  items.splice(idx, 1);
  dirty = true;
  render();
}

// ── Spara ────────────────────────────────────────────────────────────────────
elSaveBtn.addEventListener('click', async () => {
  if (!dirty) return;
  elSaveBtn.disabled = true;
  setStatus('Sparar…', 'loading');

  const payload = {
    sponsors: items.map(it => {
      if (it.id) return { id: it.id, name: it.name || '' };
      return { dataUrl: it.dataUrl, name: it.name || '' };
    })
  };

  try {
    const res = await fetch('/api/sponsors', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    // Servern returnerar den nya listan med id+url för alla – synka local state
    items = data.sponsors.map(s => ({ id: s.id, url: s.url, name: s.name || '' }));
    savedSponsors = data.sponsors;
    dirty = false;
    render();
    renderPreview();
    setStatus(`✓ ${data.sponsors.length} sponsor(er) sparade.`, 'ok');
  } catch (err) {
    setStatus(`Sparning misslyckades: ${err.message}`, 'error');
    elSaveBtn.disabled = false;
  }
});

// ── Förhandsgranskning ───────────────────────────────────────────────────────
function renderPreview() {
  elPreviewTrack.innerHTML = '';
  if (!savedSponsors.length) return;

  // Duplicera listan så att animationen kan loopa sömlöst:
  // när vi har animerat track:en -50% har den andra halvan tagit den
  // första halvans plats och nästa iteration ser identisk ut.
  const cycle = [...savedSponsors, ...savedSponsors];
  cycle.forEach(s => {
    const img = document.createElement('img');
    img.src = s.url;
    img.alt = s.name || '';
    img.loading = 'lazy';
    elPreviewTrack.appendChild(img);
  });
}

// ── Statushjälp ──────────────────────────────────────────────────────────────
function setStatus(msg, kind) {
  elStatus.textContent = msg || '';
  elStatus.classList.remove('loading', 'ok', 'error');
  if (kind) elStatus.classList.add(kind);
}

// ── Periodlängd & övertid ────────────────────────────────────────────────────
// Båda inställningarna hanteras parallellt i en lista och delar en
// gemensam Spara-knapp. Värdena hämtas via socket('stateUpdate') från
// serverns matchState (default 20 min period / 5 min övertid). Spara
// emittar 'setPeriodLength' + 'setOvertimeLength'; servern persisterar
// till data/settings.json.
const PERIOD_LENGTH_MIN = 1;
const PERIOD_LENGTH_MAX = 99;

function clampPeriodLength(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(PERIOD_LENGTH_MIN, Math.min(PERIOD_LENGTH_MAX, n));
}

const periodLengthSettings = [
  {
    label:       'periodlängd',
    stateKey:    'periodLengthMinutes',
    socketEvent: 'setPeriodLength',
    input:  document.getElementById('periodLengthInput'),
    minus:  document.getElementById('btnPeriodLengthMinus'),
    plus:   document.getElementById('btnPeriodLengthPlus'),
    saved:  20
  },
  {
    label:       'övertidslängd',
    stateKey:    'overtimeLengthMinutes',
    socketEvent: 'setOvertimeLength',
    input:  document.getElementById('overtimeLengthInput'),
    minus:  document.getElementById('btnOvertimeLengthMinus'),
    plus:   document.getElementById('btnOvertimeLengthPlus'),
    saved:  5
  }
];

const elPeriodLengthSave   = document.getElementById('btnSavePeriodLength');
const elPeriodLengthStatus = document.getElementById('periodLengthStatus');

let periodLengthStatusTimer = null;
let pendingSave = false;   // true mellan klick och bekräftelse från servern

function currentValue(s) {
  return clampPeriodLength(s.input.value);
}

function isSettingDirty(s) {
  const v = currentValue(s);
  return v != null && v !== s.saved;
}

function refreshPeriodLengthUI() {
  let anyDirty = false;
  for (const s of periodLengthSettings) {
    const v = currentValue(s);
    if (isSettingDirty(s)) anyDirty = true;
    s.minus.disabled = v == null || v <= PERIOD_LENGTH_MIN;
    s.plus.disabled  = v == null || v >= PERIOD_LENGTH_MAX;
  }
  elPeriodLengthSave.disabled = !anyDirty;
}

function setPeriodLengthStatus(msg, kind) {
  elPeriodLengthStatus.textContent = msg || '';
  elPeriodLengthStatus.classList.remove('fetch-status-ok', 'fetch-status-error');
  if (kind === 'ok')    elPeriodLengthStatus.classList.add('fetch-status-ok');
  if (kind === 'error') elPeriodLengthStatus.classList.add('fetch-status-error');
  clearTimeout(periodLengthStatusTimer);
  if (msg && kind === 'ok') {
    periodLengthStatusTimer = setTimeout(() => {
      elPeriodLengthStatus.textContent = '';
      elPeriodLengthStatus.classList.remove('fetch-status-ok', 'fetch-status-error');
    }, 2400);
  }
}

for (const s of periodLengthSettings) {
  s.input.addEventListener('input', refreshPeriodLengthUI);
  s.input.addEventListener('blur', () => {
    // Korrigera olagliga värden vid blur så användaren ser vad som faktiskt
    // kommer sparas. Tom input → återgå till sparat värde.
    const v = clampPeriodLength(s.input.value);
    s.input.value = v != null ? v : s.saved;
    refreshPeriodLengthUI();
  });
  s.minus.addEventListener('click', () => {
    const v = currentValue(s) ?? s.saved;
    s.input.value = Math.max(PERIOD_LENGTH_MIN, v - 1);
    refreshPeriodLengthUI();
  });
  s.plus.addEventListener('click', () => {
    const v = currentValue(s) ?? s.saved;
    s.input.value = Math.min(PERIOD_LENGTH_MAX, v + 1);
    refreshPeriodLengthUI();
  });
}

elPeriodLengthSave.addEventListener('click', () => {
  // Validera båda först så att vi inte sparar halva i taget.
  const values = periodLengthSettings.map(s => ({ s, v: currentValue(s) }));
  if (values.some(x => x.v == null)) {
    setPeriodLengthStatus('Ange värden mellan 1 och 99.', 'error');
    return;
  }
  // Emit endast för de som faktiskt ändrats – servern är idempotent men
  // det sparar onödig stateUpdate-broadcast.
  let emittedAny = false;
  for (const { s, v } of values) {
    if (v !== s.saved) {
      socket.emit(s.socketEvent, { minutes: v });
      emittedAny = true;
    }
  }
  if (emittedAny) {
    pendingSave = true;
    setPeriodLengthStatus('Sparar…', 'loading');
  }
});

// Init: säkerställ att +/- får rätt disabled-state innan första stateUpdate
refreshPeriodLengthUI();

socket.on('stateUpdate', (state) => {
  if (!state) return;
  let savedChanged = false;
  for (const s of periodLengthSettings) {
    const raw = state[s.stateKey];
    if (typeof raw !== 'number') continue;
    const incoming = clampPeriodLength(raw);
    if (incoming == null) continue;
    if (incoming !== s.saved) savedChanged = true;
    s.saved = incoming;
    // Skriv bara över input om användaren inte håller på att redigera
    // ett osparat värde – annars förlorar de sin pågående ändring.
    const isDirty   = isSettingDirty(s);
    const isFocused = document.activeElement === s.input;
    if (!isDirty && !isFocused) {
      s.input.value = incoming;
    }
  }
  // Pågående spara avslutad – alla dirty inputs har nu matchande sparade
  // värden. Visa bekräftelse.
  if (pendingSave && savedChanged &&
      periodLengthSettings.every(s => !isSettingDirty(s))) {
    const summary = periodLengthSettings
      .map(s => `${s.label} ${s.saved} min`)
      .join(', ');
    setPeriodLengthStatus(`✓ Sparat (${summary}).`, 'ok');
    pendingSave = false;
  }
  refreshPeriodLengthUI();
});

// ── Init: hämta sparade sponsorer ────────────────────────────────────────────
(async () => {
  try {
    const res = await fetch('/api/sponsors');
    const data = await res.json();
    if (data.success && Array.isArray(data.sponsors)) {
      savedSponsors = data.sponsors;
      items = data.sponsors.map(s => ({ id: s.id, url: s.url, name: s.name || '' }));
      render();
      renderPreview();
    }
  } catch (err) {
    setStatus(`Kunde inte hämta sponsorer: ${err.message}`, 'error');
  }
})();
