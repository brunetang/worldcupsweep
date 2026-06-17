/* ============================================================
   World Cup '26 Sweep
   Vanilla JS. Data lives in data.json, synced to GitHub via PAT.
   ============================================================ */

// localStorage is shared across a whole origin, so two sweeps hosted under the
// same GitHub Pages account (username.github.io/a, username.github.io/b) would
// otherwise clobber each other's config. Namespace every key by the repo path
// segment so each hosted copy is isolated automatically — no editing needed.
const APP_NS  = (location.pathname.split('/')[1] || 'root');
const CFG_KEY = 'wcs_config:' + APP_NS;
const HOUSE = 'House';   // leftover teams (the pot) go here
const DREGS = 'Dregs';       // optional unowned bucket (out of the sweep)

// Seeding order by FIFA Men's World Ranking. Reference data baked in here and
// applied on every load, so it can never be lost by a data.json merge or an
// auto-update commit. Index 0 = top seed.
// Top 18 = current FIFA ranking order among qualified teams (France #1,
// Morocco #8, Senegal #13, Mexico #14, …); tail 19-48 by FIFA ranking.
const SEED_ORDER = ['fra', 'esp', 'arg', 'eng', 'por', 'bra', 'ned', 'mar', 'bel', 'ger', 'cro', 'col', 'sen', 'mex', 'usa', 'uru', 'jpn', 'sui', 'irn', 'aut', 'kor', 'ecu', 'aus', 'can', 'tur', 'pan', 'nor', 'swe', 'egy', 'par', 'alg', 'cze', 'sco', 'civ', 'tun', 'qat', 'uzb', 'rsa', 'irq', 'ksa', 'cod', 'jor', 'cpv', 'bih', 'gha', 'nzl', 'cur', 'hai'];
const SEED_INDEX = Object.fromEntries(SEED_ORDER.map((id, i) => [id, i + 1]));
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- default seed (used if data.json can't be fetched) ----
const SEED = {
  meta: { title: "World Cup '26 Sweep", subtitle: "Last team standing takes the pot", groupName: "", playerWord: "player", playerWordPlural: "players", hideSettingsTab: false, lastUpdated: null },
  teams: [],
  boys: [],
  draw: { completed: false, order: [], allocations: {} },
  champion: null
};

let DATA = null;     // current sweep state
let CFG  = null;     // github config
let skipDraw = false;

// ============================================================
//  Config (GitHub sync)
// ============================================================
// Fallback repo (used only when auto-detection can't run, e.g. local dev).
const DEFAULT_REPO = { owner: 'f1atty', repo: 'world-cup-26-sweep-app', branch: 'main', path: 'data.json' };
// On GitHub Pages a project site is served at <owner>.github.io/<repo>/, so we
// can read the repo straight off the URL. This means any copy of the template
// works out of the box — no code editing — once Pages is on. The admin only
// pastes a token; everyone else just views.
function detectRepo() {
  const host = location.hostname, seg = location.pathname.split('/')[1] || '';
  if (host.endsWith('.github.io') && seg) return { owner: host.split('.')[0], repo: seg };
  return null;
}
function loadCfg() {
  try { CFG = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
  catch { CFG = {}; }
  const det = detectRepo();
  CFG.owner  = CFG.owner  || (det && det.owner) || DEFAULT_REPO.owner;
  CFG.repo   = CFG.repo   || (det && det.repo)  || DEFAULT_REPO.repo;
  CFG.branch = CFG.branch || DEFAULT_REPO.branch;
  CFG.path   = CFG.path   || DEFAULT_REPO.path;
  CFG.token  = CFG.token  || '';
}
function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); }
const canEdit = () => !!(CFG && CFG.token && CFG.owner && CFG.repo);

// base64 that survives emoji / unicode
const b64encode = str => btoa(unescape(encodeURIComponent(str)));
const b64decode = b64 => decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));

// ============================================================
//  Load / save data
// ============================================================
async function loadData() {
  // The DRAW is authored by an admin and persisted to GitHub via a token (PAT) -
  // admins load the latest draw from GitHub, everyone else loads the committed
  // data.json. RESULTS are NOT stored here: they are fetched live from
  // openfootball in the browser and derived client-side (see refreshResults),
  // so a fresh copy of this template needs the token only to save its draw.
  let loaded = false;
  if (canEdit()) {
    try {
      const r = await fetch(ghContentsUrl(), { headers: ghHeaders(), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        DATA = normalise(JSON.parse(b64decode(j.content)));
        DATA.__sha = j.sha;
        loaded = true;
      }
    } catch (e) { console.warn('GitHub load failed, falling back to local file', e); }
  }
  if (!loaded) {
    try {
      const r = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { DATA = normalise(await r.json()); loaded = true; }
    } catch (e) { console.warn('local data.json load failed', e); }
  }
  if (!loaded) DATA = normalise(structuredClone(SEED));
  // Overlay live results (falls back to the last-good cache if openfootball is down).
  await refreshResults();
}

function normalise(d) {
  d = d || {};
  d.meta  = Object.assign({}, SEED.meta, d.meta);
  d.teams = Array.isArray(d.teams) ? d.teams : [];
  d.teams.forEach(t => {
    if (t.status !== 'out') t.status = 'alive';
    t.seed = SEED_INDEX[t.id] || 999;    // always apply FIFA seed (reference data)
  });
  d.boys  = Array.isArray(d.boys) ? d.boys : [];
  d.draw  = Object.assign({ completed: false, order: [], allocations: {}, locked: false }, d.draw);
  if (d.champion === undefined) d.champion = null;
  return d;
}

function ghContentsUrl() {
  return `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURIComponent(CFG.path).replace(/%2F/g, '/')}?ref=${CFG.branch}`;
}
function ghPutUrl() {
  return `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${encodeURIComponent(CFG.path).replace(/%2F/g, '/')}`;
}
function ghHeaders() {
  return { Authorization: `Bearer ${CFG.token}`, Accept: 'application/vnd.github+json' };
}

async function pushData(silent) {
  if (!canEdit()) { if (!silent) toast('Add a GitHub token in Settings first', true); return false; }
  DATA.meta.lastUpdated = new Date().toISOString();
  const payload = JSON.parse(JSON.stringify(DATA));
  delete payload.__sha;
  const body = {
    message: `Update sweep — ${new Date().toLocaleString('en-AU')}`,
    content: b64encode(JSON.stringify(payload, null, 2)),
    branch: CFG.branch
  };
  if (DATA.__sha) body.sha = DATA.__sha;
  try {
    const r = await fetch(ghPutUrl(), { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
    if (!r.ok) {
      // sha conflict -> refetch sha and retry once
      if (r.status === 409 || r.status === 422) {
        const g = await fetch(ghContentsUrl(), { headers: ghHeaders(), cache: 'no-store' });
        if (g.ok) { DATA.__sha = (await g.json()).sha; return pushData(silent); }
      }
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || r.status);
    }
    DATA.__sha = (await r.json()).content.sha;
    if (!silent) toast('Saved to GitHub ✓');
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) toast('GitHub save failed: ' + e.message, true);
    return false;
  }
}

// save locally-effective + push if possible
async function commit(msgSilent) { renderAll(); await pushData(msgSilent); }

// Viewers re-fetch openfootball periodically so standings track live results.
// Admins are skipped so a poll never re-renders over an in-progress draw edit.
async function pollData() {
  if (document.hidden || canEdit()) return;
  const changed = await refreshResults();
  if (changed) renderAll();
}

// ============================================================
//  Live results engine  (ported from scripts/update_results.py)
//
//  The browser derives the whole tournament state client-side: fixture structure
//  and knockout teams from openfootball, live scores overlaid from ESPN, then each
//  team alive/out and the champion. Results are a live read of someone else's
//  data, not a cache - nothing is written back. The draw is still saved to GitHub
//  (admin token); only results are live.
// ============================================================
const OPENFOOTBALL_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
// ESPN's public scoreboard: key-free, CORS-open (access-control-allow-origin: *),
// and near-live (updates within a minute or so) where openfootball's community feed
// can lag by hours or days. We take fixture STRUCTURE (knockout slot labels, bracket
// wiring) from openfootball and overlay live SCORES from ESPN on top. limit=200 so the
// whole tournament (104 matches) comes back in one request, not just the current day.
const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260720&limit=200';
const RESULTS_KEY = 'wcs_results:' + APP_NS;   // last-good cache (resilience only)

// openfootball name -> our team name (only where they differ)
const NAME_FIX = { 'Bosnia & Herzegovina': 'Bosnia and Herzegovina', 'USA': 'United States' };
// ESPN displayName -> our team name (only where they differ)
const ESPN_NAME_FIX = {
  'Czechia': 'Czech Republic', 'Türkiye': 'Turkey', 'Congo DR': 'DR Congo',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina', 'USA': 'United States',
};
// openfootball round label -> [our stage code, bracket numbering base]
const STAGE = {
  'Round of 32': ['R32', 73], 'Round of 16': ['R16', 89], 'Quarter-final': ['QF', 97],
  'Semi-final': ['SF', 101], 'Match for third place': ['3P', 103], 'Final': ['F', 104],
};

// openfootball stores venue-local time + offset, e.g. "13:00 UTC-6". Return the
// UTC instant as an ISO string (the frontend renders it in the viewer's zone).
function kickoffUtc(date, timeStr) {
  if (!date || !timeStr) return null;
  const mt = /^\s*(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})(?::(\d{2}))?/.exec(timeStr);
  if (!mt) return null;
  const hh = +mt[1], mm = +mt[2], oh = +mt[3], om = +(mt[4] || 0);
  const y = +date.slice(0, 4), mo = +date.slice(5, 7), d = +date.slice(8, 10);
  let offMin = Math.abs(oh) * 60 + om; if (oh < 0) offMin = -offMin;
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm) - offMin * 60000;
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// (s1, s2, p1, p2) from an openfootball match - extra time wins over full time.
function ofScores(m) {
  const sc = m.score || {};
  const base = sc.et || sc.ft;
  if (!base) return [null, null, null, null];
  const pn = sc.p;
  return [base[0], base[1], pn ? pn[0] : null, pn ? pn[1] : null];
}

// Index ESPN's scoreboard by team-pair so we can overlay live scores onto our
// schedule. Keyed by the sorted pair of OUR team ids; each value is a list (a pair
// could in theory meet twice, and ESPN's date is a UTC instant that can land a day
// off openfootball's venue-local date, so we disambiguate by nearest date later).
function espnScoreIndex(espn) {
  const nameToId = {}; DATA.teams.forEach(t => nameToId[t.name] = t.id);
  const idOf = nm => nameToId[ESPN_NAME_FIX[nm] || nm] || null;
  const idx = new Map();
  (espn.events || []).forEach(e => {
    const comp = (e.competitions || [])[0]; if (!comp) return;
    const cs = comp.competitors || []; if (cs.length < 2) return;
    const home = cs.find(c => c.homeAway === 'home') || cs[0];
    const away = cs.find(c => c.homeAway === 'away') || cs[1];
    const id1 = idOf(home.team && home.team.displayName);
    const id2 = idOf(away.team && away.team.displayName);
    if (!id1 || !id2) return;   // unresolved placeholder ("Group A Winner") -> skip
    const st = (e.status && e.status.type) || {};
    if (st.state !== 'in' && st.state !== 'post') return;   // not kicked off yet
    const s1 = parseInt(home.score, 10), s2 = parseInt(away.score, 10);
    if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;
    const p1 = home.shootoutScore != null ? +home.shootoutScore : null;
    const p2 = away.shootoutScore != null ? +away.shootoutScore : null;
    const rec = { id1, id2, s1, s2, p1, p2, finished: st.completed === true || st.state === 'post', date: (e.date || '').slice(0, 10) };
    const key = [id1, id2].sort().join('|');
    (idx.get(key) || idx.set(key, []).get(key)).push(rec);
  });
  return idx;
}

// Overlay ESPN scores onto the schedule built from openfootball. Only scores and the
// finished flag are touched; team resolution and bracket wiring stay openfootball's job.
function overlayEspnScores(idx) {
  (DATA.schedule || []).forEach(m => {
    if (!m.t1 || !m.t2) return;
    const recs = idx.get([m.t1, m.t2].sort().join('|'));
    if (!recs || !recs.length) return;
    const md = m.date || '';
    const e = recs.reduce((best, r) =>
      Math.abs(Date.parse(r.date) - Date.parse(md)) < Math.abs(Date.parse(best.date) - Date.parse(md)) ? r : best);
    // ESPN's home/away may be the reverse of our t1/t2 - align to our orientation.
    if (e.id1 === m.t1) { m.s1 = e.s1; m.s2 = e.s2; m.p1 = e.p1; m.p2 = e.p2; }
    else { m.s1 = e.s2; m.s2 = e.s1; m.p1 = e.p2; m.p2 = e.p1; }
    if (e.finished) m.status = 'finished';
  });
}

// Transform the openfootball feed into our schedule[] (same shape the Python emitted).
function buildSchedule(of) {
  const nameToId = {}; DATA.teams.forEach(t => nameToId[t.name] = t.id);
  const resolve = label => { if (!label) return null; return nameToId[NAME_FIX[label] || label] || null; };
  const out = [], counters = {}; let groupNo = 0;
  (of.matches || []).forEach(m => {
    const rnd = m.round || '', grp = String(m.group || '');
    const [s1, s2, p1, p2] = ofScores(m);
    const finished = s1 != null;
    if (grp.indexOf('Group') === 0) {
      groupNo++;
      out.push({ num: groupNo, stage: 'group', group: grp.split(' ')[1], date: m.date,
        kickoff: kickoffUtc(m.date, m.time), t1: resolve(m.team1), t2: resolve(m.team2),
        ref1: null, ref2: null, s1, s2, p1: null, p2: null,
        status: finished ? 'finished' : 'scheduled' });
    } else if (STAGE[rnd]) {
      const [code, base] = STAGE[rnd], n = counters[code] || 0; counters[code] = n + 1;
      const t1 = resolve(m.team1), t2 = resolve(m.team2);
      out.push({ num: base + n, stage: code, group: null, date: m.date,
        kickoff: kickoffUtc(m.date, m.time), t1, t2,
        ref1: t1 ? null : m.team1, ref2: t2 ? null : m.team2, s1, s2, p1, p2,
        status: finished ? 'finished' : 'scheduled' });
    }
  });
  return out;
}

// Set each team's status (alive/out) and the champion from the schedule.
function deriveStatus() {
  const sched = DATA.schedule || [], out = new Set(); let champion = null;
  sched.forEach(m => {
    if (['R32', 'R16', 'QF', 'SF', 'F'].includes(m.stage)) {
      const w = knockoutWinnerId(m);
      if (w) { const l = (w === m.t1) ? m.t2 : m.t1; if (l) out.add(l); if (m.stage === 'F') champion = w; }
    }
  });
  const groupMatches = sched.filter(m => m.stage === 'group');
  const groupDone = groupMatches.length > 0 && groupMatches.every(m => m.status === 'finished');
  if (groupDone) {
    const inKo = new Set();
    sched.forEach(m => { if (m.stage === 'R32') ['t1', 't2'].forEach(k => { if (m[k]) inKo.add(m[k]); }); });
    if (inKo.size) DATA.teams.forEach(t => { if (!inKo.has(t.id)) out.add(t.id); });
  }
  DATA.teams.forEach(t => t.status = out.has(t.id) ? 'out' : 'alive');
  DATA.champion = champion;
}

// Compact fingerprint of the live state, so a poll only re-renders on real change.
function resultsFingerprint() {
  return JSON.stringify({
    s: (DATA.schedule || []).map(m => [m.num, m.t1, m.t2, m.s1, m.s2, m.p1, m.p2, m.status]),
    t: DATA.teams.map(t => [t.id, t.status]),
    c: DATA.champion,
  });
}

// Rebuild schedule + statuses + champion: structure from openfootball, live scores
// overlaid from ESPN. Either source alone is enough to refresh; if both are
// unreachable, fall back to the last-good cache. Returns true if state changed.
async function refreshResults() {
  let ofOk = false, espnOk = false;

  // 1. Fixture structure (knockout slot labels, bracket wiring) from openfootball.
  try {
    const r = await fetch(OPENFOOTBALL_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { DATA.schedule = buildSchedule(await r.json()); ofOk = true; }
  } catch (e) { console.warn('openfootball fetch failed', e); }

  // 2. Live scores from ESPN, overlaid onto whatever schedule we now have.
  try {
    const r = await fetch(ESPN_URL + '&_=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { overlayEspnScores(espnScoreIndex(await r.json())); espnOk = true; }
  } catch (e) { console.warn('ESPN fetch failed', e); }

  if (ofOk || espnOk) {
    deriveStatus();
    const fp = resultsFingerprint();
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify({
        fp, schedule: DATA.schedule, status: DATA.teams.map(t => [t.id, t.status]), champion: DATA.champion,
      }));
    } catch {}
    DATA.meta.lastResultSync = fp;
    const changed = fp !== refreshResults._last; refreshResults._last = fp;
    return changed;
  }

  // openfootball unreachable - restore the last good results if we have them.
  try {
    const cached = JSON.parse(localStorage.getItem(RESULTS_KEY) || 'null');
    if (cached && cached.schedule) {
      DATA.schedule = cached.schedule;
      const sm = new Map(cached.status);
      DATA.teams.forEach(t => { if (sm.has(t.id)) t.status = sm.get(t.id); });
      DATA.champion = cached.champion;
      const changed = cached.fp !== refreshResults._last; refreshResults._last = cached.fp;
      return changed;
    }
  } catch {}
  return false;   // no live data and no cache - keep the static skeleton as-is
}

// ============================================================
//  Helpers
// ============================================================
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const teamById = id => DATA.teams.find(t => t.id === id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

// ---- branding / terminology (set in Settings, stored in data.json so every viewer sees it) ----
function brandGroup()  { return (DATA && DATA.meta && DATA.meta.groupName) || ''; }
function pWord()       { return (DATA && DATA.meta && DATA.meta.playerWord) || 'player'; }
function pWordPlural() { return (DATA && DATA.meta && DATA.meta.playerWordPlural) || 'players'; }
// Apply the group name + player wording to the static labels. Called on every render.
function applyBranding() {
  const g = brandGroup(), s = pWord(), P = pWordPlural();
  document.title = g ? `${g} — World Cup ’26 Sweep` : "World Cup ’26 Sweep";
  const set = (sel, txt) => { const e = $(sel); if (e) e.textContent = txt; };
  set('#kicker', `⚽ ${g ? g + ' · ' : ''}Sweepstake`);
  set('#enterTitle', `Enter the ${P}`);
  set('#addBoy', `+ Add a ${s}`);
  set('#editBoysBtn', `← Edit ${P} / redraw order`);
  set('#seedsHint', `Each ${s} is dealt one of the top seeded teams first, then the rest are random.`);
  const eh = $('#enterHint');
  if (eh) eh.innerHTML = `Add everyone playing. First we shuffle the running order, then the teams get dealt out. Every ${s} gets the same number of teams; any leftovers go to <b>${esc(HOUSE)}</b>.`;
}

function splitCounts(nBoys) {
  const T = DATA.teams.length;
  const per = Math.floor(T / nBoys);
  return { per, rem: T - per * nBoys, T };
}
function splitText(nBoys) {
  if (nBoys <= 0) return '';
  const { per, rem, T } = splitCounts(nBoys);
  const base = `${nBoys} ${pWordPlural()} → <b>${per} teams each</b>`;
  return rem === 0
    ? `${base} (${T} total, nothing spare)`
    : `${base} · <b>House gets ${rem}</b> (${T} total)`;
}

// ============================================================
//  Boys setup UI
// ============================================================
function renderBoysSetup() {
  const list = $('#boysList');
  list.innerHTML = '';
  const boys = DATA.boys.length ? DATA.boys : [''];
  boys.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'boy-row';
    row.innerHTML = `
      <span class="num">${i + 1}</span>
      <input type="text" value="${esc(name)}" placeholder="Name…" data-i="${i}" />
      <button class="x" data-i="${i}" title="Remove">✕</button>`;
    list.appendChild(row);
  });
  $$('#boysList input').forEach(inp => {
    inp.addEventListener('input', e => { DATA.boys[+e.target.dataset.i] = e.target.value; updateSplitChip(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { addBoy(); } });
  });
  $$('#boysList .x').forEach(btn => btn.addEventListener('click', e => {
    DATA.boys.splice(+e.target.dataset.i, 1);
    renderBoysSetup();
  }));
  // sync DATA.boys length with what's shown
  if (!DATA.boys.length) DATA.boys = [''];
  updateSplitChip();
}
function addBoy() { DATA.boys.push(''); renderBoysSetup(); $$('#boysList input').slice(-1)[0]?.focus(); }
function cleanBoys() { return DATA.boys.map(b => b.trim()).filter(Boolean); }
function updateSplitChip() {
  const n = cleanBoys().length;
  $('#splitChip').innerHTML = n ? splitText(n) : 'Add some names to see the split';
  const dupes = new Set();
  const seen = new Set();
  cleanBoys().forEach(b => { const k = b.toLowerCase(); if (seen.has(k)) dupes.add(b); seen.add(k); });
  const note = $('#setupNote');
  if (dupes.size) note.innerHTML = `⚠ Duplicate name(s): ${[...dupes].join(', ')} — make them unique.`;
  else note.innerHTML = '';
  $('#drawOrderBtn').disabled = n < 2 || dupes.size > 0;
}

// ============================================================
//  THE DRAW (animated)
// ============================================================
// ---- Draw 1 of 2: the running order ----
async function drawOrder() {
  const boys = cleanBoys();
  if (boys.length < 2) return;
  DATA.boys = boys;
  skipDraw = false;

  const stage = $('#stage');
  stage.classList.add('show');
  const phase = $('#stagePhase'), onClock = $('#stageOnClock'), bodyEl = $('#stageBody');

  const order = shuffle(boys);
  phase.textContent = 'Draw 1 of 2 · Shuffling the order';
  onClock.innerHTML = '';
  bodyEl.innerHTML = `<div class="order-reveal" id="orderReveal"></div>`;
  const orWrap = $('#orderReveal');

  if (!skipDraw) {
    for (let s = 0; s < 14 && !skipDraw; s++) {
      const r = shuffle(boys);
      orWrap.innerHTML = r.map((b, i) => `<div class="oi in" style="animation:none; opacity:1; transform:none;"><span class="pos">${i + 1}</span>${esc(b)}</div>`).join('');
      await sleep(70 + s * 14);
    }
  }
  orWrap.innerHTML = order.map((b, i) =>
    `<div class="oi" style="animation-delay:${i * 90}ms"><span class="pos">${i + 1}</span>${esc(b)}</div>`).join('');
  $$('#orderReveal .oi').forEach(el => el.classList.add('in'));
  await sleep(skipDraw ? 0 : order.length * 90 + 800);

  // order locked, teams still to come
  DATA.draw = { completed: false, order, allocations: {} };
  DATA.champion = null;
  DATA.teams.forEach(t => t.status = 'alive');

  onClock.innerHTML = `Order locked! <em>Teams next…</em>`;
  if (!skipDraw) await sleep(1100);

  stage.classList.remove('show');
  switchView('draw');
  renderAll();
  toast('Order drawn — saving…');
  await pushData(true);
  toast(canEdit() ? 'Order saved ✓ — now draw the teams' : 'Order set (local only)');
}

// ---- Draw 2 of 2: the team allocation (pokie machine) ----
const reelCellHTML = t => `<div class="reel-cell"><span class="rc-flag">${t.flag}</span><span class="rc-name">${esc(t.name)}</span></div>`;

async function spinReel(reel, picked, pool) {
  const cand = (pool && pool.length) ? pool : DATA.teams;   // only the teams in play this spin
  const K = 36;                                   // random cells before the winner (longer travel)
  const rnd = () => cand[Math.floor(Math.random() * cand.length)];
  const strip = [];
  for (let i = 0; i < K; i++) strip.push(rnd());
  strip.push(picked);                              // index K -> lands on the payline
  strip.push(rnd());                               // one below, to centre it
  reel.innerHTML = strip.map(reelCellHTML).join('');

  const cellH = reel.firstElementChild.getBoundingClientRect().height || 92;
  const finalY = -((K - 1) * cellH);               // centre the winner in the 3-cell window

  reel.style.transition = 'none';
  reel.style.transform = 'translateY(0)';
  reel.getBoundingClientRect();                    // force reflow

  if (skipDraw) { reel.style.transform = `translateY(${finalY}px)`; return; }

  reel.classList.add('spinning');
  reel.style.transition = 'transform 2.9s cubic-bezier(.16,.74,.16,1)';   // longer, more suspense
  reel.style.transform = `translateY(${finalY}px)`;
  setTimeout(() => reel.classList.remove('spinning'), 2450);
  await new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; reel.removeEventListener('transitionend', fin); res(); };
    reel.addEventListener('transitionend', fin);
    setTimeout(fin, 3050);
  });
}

// big "Round X" sweep between pots
async function showRoundBanner(big, sub) {
  const b = $('#roundBanner'); if (!b) return;
  $('#rbNum').textContent = big;
  $('#rbSub').textContent = sub || '';
  if (skipDraw) return;
  b.classList.add('show');
  await sleep(1700);
  b.classList.remove('show');
  await sleep(450);
}

async function drawTeams() {
  const order = (DATA.draw && DATA.draw.order) || [];
  if (order.length < 2) return;
  skipDraw = false;

  const stage = $('#stage');
  stage.classList.add('show');
  const phase = $('#stagePhase'), onClock = $('#stageOnClock'), bodyEl = $('#stageBody');
  phase.textContent = ''; onClock.innerHTML = '';

  const T = DATA.teams.length, n = order.length;
  const per = Math.floor(T / n), rem = T - per * n;   // equal per boy, rest to House
  const alloc = {}; order.forEach(b => alloc[b] = []);

  // Draw style: 'pots' = one team per ranking pot per boy, round by round;
  // 'seeds' = one top seed each then random; 'random' = fully random.
  const modeEl = document.querySelector('input[name="drawMode"]:checked');
  const mode = modeEl ? modeEl.value : 'pots';
  const bySeed = DATA.teams.slice().sort((a, b) => (a.seed || 999) - (b.seed || 999)).map(t => t.id);

  // left-hand panel of rows depends on the mode
  let panel;
  if (mode === 'potsplay') {
    const P = n + 1, remP = T - Math.floor(T / P) * P;
    const toDregs = $('#dregsBucketToggle') && $('#dregsBucketToggle').checked;
    panel = [...order, HOUSE];                          // House plays as a participant
    if (toDregs && remP > 0) panel.push(DREGS);         // separate unowned bucket card
  } else {
    panel = [...order];
    if (rem > 0) panel.push(HOUSE);                     // pots/seeds/random: House holds leftovers
  }
  const rowLabel = b => (b === HOUSE ? '🏠 ' : b === DREGS ? '🗑️ ' : '') + esc(b);

  bodyEl.innerHTML = `
    <div class="draw2">
      <div class="d2-boys" id="d2Boys">
        ${panel.map((b, i) => `
          <div class="d2-boy ${b === HOUSE ? 'is-house' : ''} ${b === DREGS ? 'is-dregs' : ''}" data-idx="${i}">
            <span class="d2-name">${rowLabel(b)}</span>
            <div class="d2-teams"></div>
          </div>`).join('')}
      </div>
      <div class="d2-machine">
        <div class="pokie" id="pokie">
          <div class="pokie-crown">
            <div class="bulbs">${'<i></i>'.repeat(9)}</div>
            <div class="pokie-name">${brandGroup() ? esc(brandGroup()) : 'The<br>Draw'}</div>
          </div>
          <div class="pokie-body">
            <div class="pokie-window">
              <div class="reel" id="reel"></div>
              <div class="payline"><span class="pl-a left">▶</span><span class="pl-a right">◀</span></div>
              <div class="pokie-glass"></div>
            </div>
            <div class="pokie-foot" id="pokieFoot">Pull the lever…</div>
            <div class="pokie-prog" id="pokieProg"></div>
            <div class="coin-slot"></div>
          </div>
          <div class="lever" id="lever"><div class="lever-rod"></div><div class="lever-ball"></div></div>
        </div>
      </div>
    </div>`;

  const reel = $('#reel');
  const rows = $$('#d2Boys .d2-boy');
  const foot = $('#pokieFoot'), prog = $('#pokieProg');
  const pokie = $('#pokie');

  let pCount = 0, spinTotal = T;
  const deal = async (boy, rowIdx, teamId, poolIds) => {
    const picked = teamById(teamId);
    const pool = (poolIds || []).map(teamById);     // teams still in play for this spin
    alloc[boy].push(picked.id);
    pCount++;
    prog.textContent = `Pick ${pCount} of ${spinTotal}`;
    foot.innerHTML = `🎰 <b>${boy === HOUSE ? 'House' : esc(boy)}</b> on the clock`;
    rows.forEach(r => r.classList.remove('on'));
    const row = rows[rowIdx];
    row.classList.add('on');
    if (!skipDraw) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (!skipDraw) { pokie.classList.add('pull'); setTimeout(() => pokie.classList.remove('pull'), 600); }
    await spinReel(reel, picked, pool);

    reel.classList.add('hit');
    pokie.classList.add('win');
    if (!skipDraw) await sleep(1300);              // sit on the winner for suspense
    reel.classList.remove('hit');
    pokie.classList.remove('win');

    const tdiv = row.querySelector('.d2-teams');
    tdiv.insertAdjacentHTML('beforeend',
      `<span class="d2-chip pop"><span class="fl">${picked.flag}</span>${esc(picked.name)}</span>`);
    if (!skipDraw) await sleep(380);
  };

  const houseIdx = panel.length - 1;

  const dropIn = (rowIdx, ids, alocKey) => {       // instant allocation, no slot spin
    alloc[alocKey] = alloc[alocKey] || [];
    const tdiv = rows[rowIdx].querySelector('.d2-teams');
    for (const id of ids) {
      alloc[alocKey].push(id);
      const t = teamById(id);
      tdiv.insertAdjacentHTML('beforeend', `<span class="d2-chip"><span class="fl">${t.flag}</span>${esc(t.name)}</span>`);
    }
  };

  if (mode === 'potsplay') {
    // House plays as a participant; pots sized (boys + 1). Lowest leftovers
    // go to House or a separate Dregs bucket.
    const P = n + 1;
    const perP = Math.floor(T / P), remP = T - perP * P;
    spinTotal = perP * P;
    const pots = [];
    for (let k = 0; k < perP; k++) pots.push(bySeed.slice(k * P, (k + 1) * P));
    const leftovers = bySeed.slice(perP * P);          // remP lowest
    const toDregs = $('#dregsBucketToggle') && $('#dregsBucketToggle').checked;
    const drawers = [...order, HOUSE];                 // panel indices 0..P-1
    drawers.forEach(d => alloc[d] = []);
    if (remP > 0 && toDregs) dropIn(panel.indexOf(DREGS), leftovers, DREGS);   // pre-fill Dregs card
    let round = 1;
    for (let p = perP - 1; p >= 0; p--) {              // lowest pot first, top pot last
      const lo = p * P + 1, hi = (p + 1) * P, final = p === 0;
      await showRoundBanner(final ? 'Final Round' : `Round ${round}`,
        final ? `🔥 The top ${P} 🔥` : `Pot · ranks ${lo}–${hi} · one each`);
      const potTeams = shuffle(pots[p]);
      for (let i = 0; i < P; i++) await deal(drawers[i], i, potTeams[i], potTeams.slice(i));
      round++;
    }
    if (remP > 0 && !toDregs) dropIn(panel.indexOf(HOUSE), leftovers, HOUSE);  // leftovers onto House
  } else if (mode === 'pots') {
    // pots of n by ranking; House gets the rem lowest. Reveal lowest pot first.
    const pots = [];
    for (let k = 0; k < per; k++) pots.push(bySeed.slice(k * n, (k + 1) * n));
    spinTotal = per * n;                                 // only the boy pots get spun

    // House dregs: auto-allocated instantly (no slot machine)
    if (rem > 0) {
      alloc[HOUSE] = [];
      const tdiv = rows[houseIdx].querySelector('.d2-teams');
      for (const id of bySeed.slice(per * n)) {
        alloc[HOUSE].push(id);
        const t = teamById(id);
        tdiv.insertAdjacentHTML('beforeend', `<span class="d2-chip"><span class="fl">${t.flag}</span>${esc(t.name)}</span>`);
      }
    }
    // boy pots, lowest first so the top n come out in the final round
    let round = 1;
    for (let p = per - 1; p >= 0; p--) {
      const lo = p * n + 1, hi = (p + 1) * n, final = p === 0;
      await showRoundBanner(final ? 'Final Round' : `Round ${round}`,
        final ? `🔥 The top ${n} 🔥` : `Pot · ranks ${lo}–${hi} · one each`);
      const potTeams = shuffle(pots[p]);                 // random which boy gets which from the pot
      // reel cycles only the teams still in play in this pot (potTeams[i..])
      for (let i = 0; i < n; i++) await deal(order[i], i, potTeams[i], potTeams.slice(i));
      round++;
    }
  } else {
    // seeds / random (with optional House-takes-the-dregs)
    const seedMode = mode === 'seeds';
    const houseLow = rem > 0 && $('#houseLowToggle') && $('#houseLowToggle').checked;
    const topSeeds  = seedMode ? bySeed.slice(0, n) : [];
    const houseTeams = houseLow ? bySeed.slice(48 - rem) : [];
    const reserved = new Set([...topSeeds, ...houseTeams]);
    const seedPool = shuffle(topSeeds);
    const housePool = shuffle(houseTeams);
    const restPool = shuffle(DATA.teams.map(t => t.id).filter(id => !reserved.has(id)));
    let rIdx = 0, hIdx = 0;
    for (let round = 0; round < per; round++) {
      for (let i = 0; i < n; i++) {
        if (seedMode && round === 0) {
          await deal(order[i], i, seedPool[i], seedPool.slice(i));      // remaining top seeds
        } else {
          await deal(order[i], i, restPool[rIdx], restPool.slice(rIdx)); // remaining random teams
          rIdx++;
        }
      }
    }
    if (rem > 0) {
      alloc[HOUSE] = [];
      for (let k = 0; k < rem; k++) {
        if (houseLow) { await deal(HOUSE, houseIdx, housePool[hIdx], housePool.slice(hIdx)); hIdx++; }
        else { await deal(HOUSE, houseIdx, restPool[rIdx], restPool.slice(rIdx)); rIdx++; }
      }
    }
  }

  DATA.draw = { completed: true, order, allocations: alloc };
  DATA.champion = null;
  DATA.teams.forEach(t => t.status = 'alive');

  rows.forEach(r => r.classList.remove('on'));
  foot.innerHTML = `That's the draw! Good luck ${pWordPlural()} ⚽`;
  prog.textContent = '';
  if (!skipDraw) { fireConfetti(); await sleep(1600); }

  stage.classList.remove('show');
  switchView('draw');
  renderAll();
  toast('Draw complete — saving…');
  await pushData(true);
  toast(canEdit() ? 'Draw saved to GitHub ✓' : 'Draw done (local only — add a token to share)');
}

// ============================================================
//  Results board + standings
// ============================================================
function aliveTeams(ids) { return ids.filter(id => teamById(id)?.status === 'alive'); }
function championOwner() {
  if (!DATA.champion) return null;
  // Dregs is an unowned bucket — it can't win the sweep
  return Object.keys(DATA.draw.allocations).filter(b => b !== DREGS)
    .find(b => DATA.draw.allocations[b].includes(DATA.champion)) || null;
}
// everyone holding teams: boys in drawn order, then House, then Dregs (if present)
function participants() {
  const a = DATA.draw.allocations || {};
  const list = (DATA.draw.order || []).slice();
  if ((a[HOUSE] || []).length) list.push(HOUSE);
  if ((a[DREGS] || []).length) list.push(DREGS);
  return list;
}

function boyCardHTML(boy, pos, opts = {}) {
  const ids = DATA.draw.allocations[boy] || [];
  const alive = aliveTeams(ids).length;
  const isWinner = championOwner() === boy;
  const isHouse = boy === HOUSE;
  const isDregs = boy === DREGS;
  const teamsHTML = ids.map(id => {
    const t = teamById(id); if (!t) return '';
    const isChamp = DATA.champion === id;
    const cls = isChamp ? 'champ' : (t.status === 'out' ? 'out' : '');
    return `<div class="team-pill ${cls}">
      <span class="fl">${t.flag}</span>
      <span class="name">${esc(t.name)}</span>
      ${isChamp ? '👑' : ''}
      <span class="grp">${t.group}</span></div>`;
  }).join('');
  const head = isDregs
    ? `<span class="bc-name">🗑️ Dregs<span class="house-sub">out of the sweep</span></span>`
    : `<span class="bc-name">${isHouse ? '🏠 ' : ''}${esc(boy)}${isHouse ? '<span class="house-sub">the pot</span>' : ''}</span>
       ${isWinner ? '<span class="crown">👑</span>' : `<span class="alive-badge ${alive === 0 ? 'zero' : ''}">${alive} alive</span>`}`;
  return `<div class="boy-card ${isWinner ? 'winner' : ''} ${isHouse ? 'house' : ''} ${isDregs ? 'dregs' : ''} ${!isDregs && alive === 0 && DATA.champion ? 'out' : ''}">
    <div class="bc-head">${head}</div>
    ${teamsHTML}
  </div>`;
}

function renderBoard() {
  const wrap = $('#board');
  if (!(DATA.draw.completed && DATA.draw.order.length)) {
    wrap.innerHTML = `<div class="empty">⚽ The draw hasn't been done yet — check back soon.</div>`;
    $('#boardSub').textContent = '';
    $('#winnerBannerSlot').innerHTML = '';
    return;
  }
  wrap.innerHTML = participants().map(b => boyCardHTML(b)).join('');
  const houseN = (DATA.draw.allocations[HOUSE] || []).length;
  $('#boardSub').textContent =
    `${DATA.draw.order.length} ${pWordPlural()} · ${DATA.teams.length} teams${houseN ? ` · ${houseN} to House` : ''} · whoever owns the champion wins`;
  renderWinnerBanner('#winnerBannerSlot');
}

function renderStandings() {
  const wrap = $('#standingsBoard');
  if (!DATA.draw.completed) {
    wrap.innerHTML = `<div class="empty">No draw yet. Head to <b>The Draw</b> tab to deal out the teams.</div>`;
    $('#standingsWinnerSlot').innerHTML = '';
    return;
  }
  const ranked = participants().filter(b => b !== DREGS).sort((a, b) =>
    aliveTeams(DATA.draw.allocations[b]).length - aliveTeams(DATA.draw.allocations[a]).length
  );
  wrap.innerHTML = ranked.map(b => boyCardHTML(b)).join('');
  renderWinnerBanner('#standingsWinnerSlot');
}

function renderWinnerBanner(sel) {
  const slot = $(sel);
  const owner = championOwner();
  if (!owner) { slot.innerHTML = ''; return; }
  const champ = teamById(DATA.champion);
  slot.innerHTML = `<div class="winner-banner">
    <span class="wb-trophy">🏆</span>
    <div>
      <div class="wb-label">Champions · Sweep Winner</div>
      <div class="wb-name">${esc(owner)}</div>
      <div class="wb-sub">won the pot with ${champ ? champ.flag + ' ' + esc(champ.name) : 'the champions'}</div>
    </div>
  </div>`;
}

// ============================================================
//  Teams admin
// ============================================================
function renderTeamsAdmin() {
  const wrap = $('#teamsAdmin');
  const editable = canEdit();
  $('#teamsHint').innerHTML = editable
    ? 'Tap ✕ to knock a team out, ↺ to revive it, 👑 to crown the champion. Changes save to GitHub.'
    : '🔒 Read-only. Add a GitHub token in <b>Settings</b> to record results.';

  const groups = [...new Set(DATA.teams.map(t => t.group))].sort();
  wrap.innerHTML = groups.map(g => {
    const teams = DATA.teams.filter(t => t.group === g);
    return `<div class="group-block">
      <h3>Group ${g}</h3>
      <div class="team-grid">
        ${teams.map(t => teamAdminHTML(t, editable)).join('')}
      </div></div>`;
  }).join('');

  if (editable) {
    $$('#teamsAdmin .mini').forEach(btn => btn.addEventListener('click', onTeamAction));
  }
}
function teamAdminHTML(t, editable) {
  const owner = ownerOf(t.id);
  const isChamp = DATA.champion === t.id;
  return `<div class="team-admin ${t.status === 'out' ? 'out' : ''}">
    <span class="fl">${t.flag}</span>
    <span class="nm">${esc(t.name)}</span>
    ${owner ? `<span class="owner">${esc(owner)}</span>` : ''}
    ${editable ? `<span class="acts">
      <button class="mini ${t.status === 'out' ? '' : 'on-out'}" data-act="toggle" data-id="${t.id}" title="${t.status === 'out' ? 'Revive' : 'Knock out'}">${t.status === 'out' ? '↺' : '✕'}</button>
      <button class="mini ${isChamp ? 'on-champ' : ''}" data-act="champ" data-id="${t.id}" title="Crown champion">👑</button>
    </span>` : (isChamp ? '<span class="crown">👑</span>' : t.status === 'out' ? '<span class="owner" style="color:var(--magenta)">OUT</span>' : '')}
  </div>`;
}
function ownerOf(teamId) {
  if (!DATA.draw.completed) return null;
  return Object.keys(DATA.draw.allocations).find(b => DATA.draw.allocations[b].includes(teamId)) || null;
}
async function onTeamAction(e) {
  const id = e.currentTarget.dataset.id, act = e.currentTarget.dataset.act;
  const t = teamById(id);
  if (act === 'toggle') {
    t.status = t.status === 'out' ? 'alive' : 'out';
    if (t.status === 'out' && DATA.champion === id) DATA.champion = null;
  } else if (act === 'champ') {
    if (DATA.champion === id) { DATA.champion = null; }
    else { DATA.champion = id; t.status = 'alive'; fireConfetti(); }
  }
  renderAll();
  await pushData(true);
  toast(canEdit() ? 'Saved ✓' : 'Updated locally');
}

// ============================================================
//  Trade teams (admin) — swap one team between two owners
// ============================================================
// Every team that belongs to a real owner. Excludes the Dregs bucket (it's
// explicitly out of the sweep), but includes the pot (House) — trading
// to/from the pot is a legit admin move.
function ownedTeamOptions() {
  return participants().filter(b => b !== DREGS).flatMap(owner =>
    (DATA.draw.allocations[owner] || []).map(id => ({ id, owner, team: teamById(id) }))
  ).filter(o => o.team);
}

// Swap idA (owned by A) with idB (owned by B), in place so slot order is kept.
function swapTeams(idA, idB) {
  const alloc = DATA.draw.allocations;
  const oa = ownerOf(idA), ob = ownerOf(idB);
  if (!oa || !ob || oa === ob) return false;
  const ia = alloc[oa].indexOf(idA), ib = alloc[ob].indexOf(idB);
  if (ia < 0 || ib < 0) return false;
  alloc[oa][ia] = idB;
  alloc[ob][ib] = idA;
  return true;
}

function renderTradePanel() {
  const panel = $('#tradePanel'); if (!panel) return;
  const ready = DATA.draw.completed && (DATA.draw.order || []).length;
  // admin-only class already hides it from spectators; also hide before the draw.
  panel.style.display = ready ? '' : 'none';
  if (!ready) return;
  const opts = ownedTeamOptions();
  const owners = [...new Set(opts.map(o => o.owner))];
  const optionsHTML = owners.map(owner => {
    const items = opts.filter(o => o.owner === owner)
      .map(o => `<option value="${o.id}">${o.team.flag} ${esc(o.team.name)}</option>`).join('');
    return `<optgroup label="${esc(owner)}">${items}</optgroup>`;
  }).join('');
  const selA = $('#tradeA'), selB = $('#tradeB');
  const prevA = selA.value, prevB = selB.value;
  selA.innerHTML = `<option value="">Team to give…</option>` + optionsHTML;
  selB.innerHTML = `<option value="">Team to get…</option>` + optionsHTML;
  if (opts.some(o => o.id === prevA)) selA.value = prevA;
  if (opts.some(o => o.id === prevB)) selB.value = prevB;
  updateTradeBtn();
}

function updateTradeBtn() {
  const a = $('#tradeA').value, b = $('#tradeB').value;
  const oa = a ? ownerOf(a) : null, ob = b ? ownerOf(b) : null;
  const btn = $('#tradeBtn'), msg = $('#tradeMsg');
  let ok = false, note;
  if (!a || !b) note = 'Pick a team from each side.';
  else if (oa === ob) note = 'Both teams belong to the same owner — pick from two different owners.';
  else {
    ok = true;
    const ta = teamById(a), tb = teamById(b);
    note = `${esc(oa)} gives ${ta.flag} ${esc(ta.name)} → gets ${tb.flag} ${esc(tb.name)} from ${esc(ob)}.`;
  }
  btn.disabled = !ok;
  if (!tradeArmed) msg.innerHTML = note;   // don't clobber an active "tap to confirm"
}

// Two-tap confirm instead of window.confirm(): in-app browser webviews (links
// opened from WhatsApp/Instagram/Messenger) silently block confirm(), so the
// first tap of Swap appeared to do nothing. First tap arms, second tap commits.
let tradeArmed = false, tradeArmTimer = null;
function disarmTrade() {
  tradeArmed = false;
  if (tradeArmTimer) { clearTimeout(tradeArmTimer); tradeArmTimer = null; }
  const btn = $('#tradeBtn');
  if (btn) { btn.classList.remove('armed'); btn.textContent = 'Swap'; }
}
function onTradeSelectChange() { disarmTrade(); updateTradeBtn(); }

async function onTradeSwap() {
  const a = $('#tradeA').value, b = $('#tradeB').value;
  const oa = ownerOf(a), ob = ownerOf(b);
  if (!a || !b || !oa || !ob || oa === ob) return;
  const ta = teamById(a), tb = teamById(b);
  const btn = $('#tradeBtn');
  if (!tradeArmed) {                        // first tap: arm and ask for a second tap
    tradeArmed = true;
    btn.classList.add('armed');
    btn.textContent = 'Confirm swap';
    $('#tradeMsg').innerHTML = `Tap again to confirm: ${ta.flag} ${esc(ta.name)} ↔ ${tb.flag} ${esc(tb.name)}.`;
    tradeArmTimer = setTimeout(disarmTrade, 4000);
    return;
  }
  disarmTrade();                            // second tap: do it
  if (!swapTeams(a, b)) { toast('Swap failed', true); return; }
  $('#tradeA').value = ''; $('#tradeB').value = '';
  renderAll();
  await pushData(true);
  toast(canEdit() ? `Traded ✓ — ${ta.name} ↔ ${tb.name}` : 'Traded (local only)');
}

// ============================================================
//  Schedule · Groups · Knockout
// ============================================================
const schedule = () => Array.isArray(DATA.schedule) ? DATA.schedule : [];

function boyColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 72% 62%)`;
}
function ownerTag(teamId) {
  const o = ownerOf(teamId);
  if (!o) return '';
  return `<span class="otag" style="--oc:${boyColor(o)}" title="${esc(o)}">${esc(o)}</span>`;
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
// kickoff rendered in Sydney time for every viewer, wherever they are
function fmtKick(m, withTime) {
  const iso = m && m.kickoff;
  if (iso) {
    const dt = new Date(iso);
    if (!isNaN(dt)) {
      const opts = { timeZone: displayZone(), weekday: 'short', day: 'numeric', month: 'short' };
      if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit', hour12: true });
      return dt.toLocaleString('en-AU', opts).replace(/,/g, '');
    }
  }
  return fmtDate(m && m.date);
}
function prettyRef(r) {
  if (!r) return 'TBD';
  if (/^1[A-L]$/.test(r)) return 'Winner Grp ' + r[1];
  if (/^2[A-L]$/.test(r)) return 'Runner-up Grp ' + r[1];
  if (/^3/.test(r))       return '3rd: ' + r.slice(1);
  if (/^W\d+/.test(r))    return 'Winner M' + r.slice(1);
  if (/^L\d+/.test(r))    return 'Loser M' + r.slice(1);
  return r;
}

// ---- group standings ----
function computeGroup(letter) {
  const row = {};
  DATA.teams.filter(t => t.group === letter)
    .forEach(t => row[t.id] = { id: t.id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
  schedule()
    .filter(m => m.stage === 'group' && m.group === letter && m.status === 'finished' && m.t1 && m.t2 && m.s1 != null)
    .forEach(m => {
      const a = row[m.t1], b = row[m.t2]; if (!a || !b) return;
      a.p++; b.p++; a.gf += m.s1; a.ga += m.s2; b.gf += m.s2; b.ga += m.s1;
      if (m.s1 > m.s2) { a.w++; b.l++; a.pts += 3; }
      else if (m.s1 < m.s2) { b.w++; a.l++; b.pts += 3; }
      else { a.d++; b.d++; a.pts++; b.pts++; }
    });
  Object.values(row).forEach(r => r.gd = r.gf - r.ga);
  return Object.values(row).sort((x, y) =>
    y.pts - x.pts || y.gd - x.gd || y.gf - x.gf ||
    teamById(x.id).name.localeCompare(teamById(y.id).name));
}

function renderGroups() {
  const grid = $('#groupsGrid'); if (!grid) return;
  const groups = [...new Set(DATA.teams.map(t => t.group))].sort();
  const gm = schedule().filter(m => m.stage === 'group');
  const played = gm.filter(m => m.status === 'finished').length;
  $('#groupsProgress').innerHTML = `<b>${played}</b> / ${gm.length} played`;
  grid.className = 'groups-grid';
  grid.innerHTML = groups.map(groupCardHTML).join('');
}
function groupCardHTML(g) {
  const rows = computeGroup(g);
  const trs = rows.map((r, i) => {
    const t = teamById(r.id);
    const qual = i < 2 ? 'qual' : (i === 2 ? 'third' : '');
    const dead = t.status === 'out' ? 'dead' : '';
    return `<tr class="${qual} ${dead}">
      <td class="pos">${i + 1}</td>
      <td class="tm"><span class="fl">${t.flag}</span><span class="nm">${esc(t.name)}</span>${ownerTag(t.id)}</td>
      <td>${r.p}</td><td class="hs">${r.w}</td><td class="hs">${r.d}</td><td class="hs">${r.l}</td>
      <td class="hs">${r.gf}</td><td class="hs">${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`;
  }).join('');
  const fx = schedule().filter(m => m.stage === 'group' && m.group === g).map(fixtureRowHTML).join('');
  return `<div class="group-card">
    <h3>Group ${g}</h3>
    <table class="standings-tbl">
      <thead><tr><th></th><th></th><th>P</th><th class="hs">W</th><th class="hs">D</th><th class="hs">L</th><th class="hs">GF</th><th class="hs">GA</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
    <details class="fixtures"><summary>Fixtures (${schedule().filter(m => m.stage === 'group' && m.group === g).length})</summary>${fx}</details>
  </div>`;
}
function sideLabel(m, s) {
  const id = m['t' + s];
  if (id) { const t = teamById(id); return `<span class="fl">${t.flag}</span> ${esc(t.name)}`; }
  return `<span class="ref">${esc(prettyRef(m['ref' + s]))}</span>`;
}
function pen(m) { return m.p1 != null ? ` <span class="kp">(pens ${m.p1}-${m.p2})</span>` : ''; }
function fixtureRowHTML(m) {
  const mid = m.status === 'finished'
    ? `<b>${m.s1}-${m.s2}</b>${pen(m)}`
    : `<span class="v">v</span>`;
  return `<div class="fx">
    <div class="fx-when">${fmtKick(m, true)}</div>
    <div class="fx-row"><span class="fa">${sideLabel(m, '1')}</span><span class="fm">${mid}</span><span class="fb">${sideLabel(m, '2')}</span></div>
  </div>`;
}

// ---- knockout bracket ----
function knockoutWinnerId(m) {
  if (m.status !== 'finished' || !m.t1 || !m.t2) return null;
  let a = m.s1, b = m.s2;
  if (m.p1 != null && a === b) { a = m.p1; b = m.p2; }
  if (a === b) return null;
  return a > b ? m.t1 : m.t2;
}
function bracketOrder() {
  const by = {}; schedule().forEach(m => by[m.num] = m);
  const order = { R32: [], R16: [], QF: [], SF: [], F: [] };
  const kids = m => [m.ref1, m.ref2].filter(r => r && /^W\d+/.test(r)).map(r => +r.slice(1));
  const seen = new Set();
  (function visit(num) {
    const m = by[num]; if (!m || seen.has(num)) return; seen.add(num);
    kids(m).forEach(visit);
    if (order[m.stage]) order[m.stage].push(num);
  })((schedule().find(m => m.stage === 'F') || {}).num);
  // fallback for any round the tree-walk missed
  ['R32', 'R16', 'QF', 'SF', 'F'].forEach(st => {
    if (!order[st].length)
      order[st] = schedule().filter(m => m.stage === st).sort((a, b) => a.num - b.num).map(m => m.num);
  });
  return { order, by };
}
function renderKnockout() {
  const wrap = $('#bracket'); if (!wrap) return;
  const { order, by } = bracketOrder();
  const ko = schedule().filter(m => ['R32', 'R16', 'QF', 'SF', 'F'].includes(m.stage));
  const played = ko.filter(m => m.status === 'finished').length;
  $('#knockoutProgress').innerHTML = `<b>${played}</b> / ${ko.length} ties played`;
  const cols = [['R32', 'Round of 32'], ['R16', 'Round of 16'], ['QF', 'Quarter-finals'], ['SF', 'Semi-finals'], ['F', 'Final']];
  wrap.innerHTML = cols.map(([st, label]) =>
    `<div class="bcol">
       <div class="bcol-h">${label}</div>
       <div class="bcol-body">${(order[st] || []).map(n => koMatchHTML(by[n])).join('')}</div>
     </div>`).join('');
  const tp = schedule().find(m => m.stage === '3P');
  $('#thirdPlaceSlot').innerHTML = tp
    ? `<div class="panel third-place"><h3>Third-place play-off</h3>${koMatchHTML(tp, true)}</div>` : '';
}
function koMatchHTML(m, flat) {
  if (!m) return '';
  const w = knockoutWinnerId(m);
  const champ = m.stage === 'F' && w;
  return `<div class="ko ${flat ? 'ko-flat' : ''}">
    ${koSideHTML(m, '1', w, champ)}
    ${koSideHTML(m, '2', w, champ)}
    <span class="ko-num">M${m.num} · ${fmtKick(m, true)}</span>
  </div>`;
}
function koSideHTML(m, s, w, champ) {
  const id = m['t' + s];
  const isW = id && id === w;
  const score = m.status === 'finished' ? (s === '1' ? m.s1 : m.s2) : '';
  const penTxt = m.p1 != null ? ` <span class="kp">(${s === '1' ? m.p1 : m.p2})</span>` : '';
  let inner;
  if (id) { const t = teamById(id); inner = `<span class="fl">${t.flag}</span><span class="nm">${esc(t.name)}</span>${ownerTag(id)}`; }
  else inner = `<span class="ref">${esc(prettyRef(m['ref' + s]))}</span>`;
  return `<div class="ko-side ${isW ? 'win' : ''} ${id && w && !isW ? 'lose' : ''}">
    <span class="ko-team">${inner}${isW && champ ? ' <span class="kc">👑</span>' : ''}</span>
    <span class="ko-score">${score}${score !== '' ? penTxt : ''}</span>
  </div>`;
}

// ============================================================
//  Match Centre (FotMob-style day-by-day)
// ============================================================
let mcDate = null;   // selected day key 'YYYY-MM-DD' (Sydney)

// Per-viewer display timezone. 'local' resolves to the viewer's own device zone.
const TZ_KEY = 'wcs_tz';
const TZS = [
  { id: 'local',            label: 'My device' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'Europe/London',    label: 'UK / London' },
  { id: 'America/New_York', label: 'US East / New York' },
];
let tzId = 'local';
try { const s = localStorage.getItem(TZ_KEY); if (s && TZS.some(z => z.id === s)) tzId = s; } catch {}
const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'; } catch { return 'Australia/Sydney'; } })();
function displayZone()      { return tzId === 'local' ? DEVICE_TZ : tzId; }
function displayZoneLabel() { return (TZS.find(z => z.id === tzId) || TZS[0]).label; }
function setDisplayZone(id) { if (TZS.some(z => z.id === id)) { tzId = id; try { localStorage.setItem(TZ_KEY, id); } catch {} } }
function sydKey(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: displayZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function sydTime(iso) {
  return new Date(iso).toLocaleString('en-AU', { timeZone: displayZone(), hour: 'numeric', minute: '2-digit', hour12: true });
}
function todayKey() { return sydKey(new Date().toISOString()); }
function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(key) {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, 1)) return 'Tomorrow';
  if (key === addDays(t, -1)) return 'Yesterday';
  return new Date(key + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long' });
}
function prettyDay(key) {
  return new Date(key + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long' });
}
function dayKeys() {
  return [...new Set(schedule().filter(m => m.kickoff).map(m => sydKey(m.kickoff)))].sort();
}
function isLive(m) {
  if (m.status === 'finished' || !m.kickoff) return false;
  const k = new Date(m.kickoff).getTime();
  const now = Date.now();
  return now >= k && now < k + 2.5 * 3600 * 1000;
}
const STAGE_LABEL = {
  group: 'Group Stage', R32: 'Round of 32', R16: 'Round of 16',
  QF: 'Quarter-finals', SF: 'Semi-finals', '3P': 'Third-place play-off', F: 'Final'
};

function mcInit() {
  const keys = dayKeys();
  const t = todayKey();
  if (keys.includes(t)) mcDate = t;
  else mcDate = keys.find(k => k >= t) || keys[keys.length - 1] || t;
}

function mcSideHTML(m, s, align) {
  const id = m['t' + s];
  const name = id ? esc(teamById(id).name) : `<span class="ref">${esc(prettyRef(m['ref' + s]))}</span>`;
  const flag = id ? teamById(id).flag : '⚽';
  const tag = id ? ownerTag(id) : '';
  return align === 'home'
    ? `<span class="mc-team">${name}</span>${tag}<span class="fl">${flag}</span>`
    : `<span class="fl">${flag}</span><span class="mc-team">${name}</span>${tag}`;
}
// One owner chip for the mobile owners row (mirrors the inline .otag used on desktop)
function mcOwnerChip(teamId, side) {
  const o = teamId ? ownerOf(teamId) : null;
  return o
    ? `<span class="mc-owner-chip mc-owner-${side}" style="--oc:${boyColor(o)}" title="${esc(o)}">${esc(o)}</span>`
    : `<span class="mc-owner-chip mc-owner-${side} mc-owner-none">—</span>`;
}
// Owners footer: only meaningful once the draw has allocated teams to boys.
// Hidden on desktop (owners show inline next to the team name); shown on a phone.
function mcOwnersHTML(m) {
  if (!ownerOf(m.t1) && !ownerOf(m.t2)) return '';
  return `<div class="mc-owners">
    ${mcOwnerChip(m.t1, 'home')}
    <span class="mc-owner-sep">owners</span>
    ${mcOwnerChip(m.t2, 'away')}
  </div>`;
}
function mcRowHTML(m) {
  const live = isLive(m);
  const done = m.status === 'finished';
  const status = done ? 'FT' : (live ? '<span class="mc-live">LIVE</span>' : '');
  const mid = (done || live)
    ? `${m.s1}-${m.s2}${m.p1 != null ? `<span class="mc-pen">p${m.p1}-${m.p2}</span>` : ''}`
    : `<span class="mc-time">${m.kickoff ? sydTime(m.kickoff) : ''}</span>`;
  return `<div class="mc-row ${live ? 'live' : ''}">
    <span class="mc-status">${status}</span>
    <span class="mc-side home">${mcSideHTML(m, '1', 'home')}</span>
    <span class="mc-score">${mid}</span>
    <span class="mc-side away">${mcSideHTML(m, '2', 'away')}</span>
    ${mcOwnersHTML(m)}
  </div>`;
}
function renderMatchCentre() {
  const wrap = $('#mcList'); if (!wrap) return;
  if (!mcDate) mcInit();
  const tzSel = $('#mcTz'); if (tzSel) tzSel.value = tzId;
  const tzNote = $('#mcTzNote');
  if (tzNote) tzNote.textContent = `All times in ${displayZoneLabel()}.`;
  const keys = dayKeys();
  $('#mcLabel').textContent = dayLabel(mcDate);
  $('#mcDate').textContent = prettyDay(mcDate);
  $('#mcPrev').disabled = keys.length ? mcDate <= keys[0] : true;
  $('#mcNext').disabled = keys.length ? mcDate >= keys[keys.length - 1] : true;
  $('#mcToday').style.display = (mcDate === todayKey()) ? 'none' : '';

  const day = schedule().filter(m => m.kickoff && sydKey(m.kickoff) === mcDate)
    .sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : a.num - b.num));
  if (!day.length) {
    wrap.innerHTML = `<div class="empty">No games on this day. Use the arrows to find the next match day.</div>`;
    return;
  }
  // group by stage, preserving first-kickoff order
  const order = [], buckets = {};
  day.forEach(m => { if (!buckets[m.stage]) { buckets[m.stage] = []; order.push(m.stage); } buckets[m.stage].push(m); });
  wrap.innerHTML = order.map(st =>
    `<div class="mc-group">
       <div class="mc-group-h">🏆 FIFA World Cup · ${STAGE_LABEL[st] || st}</div>
       ${buckets[st].map(mcRowHTML).join('')}
     </div>`).join('');
}
function mcStep(n) {
  if (!mcDate) mcInit();
  mcDate = addDays(mcDate, n);
  renderMatchCentre();
}

// ============================================================
//  View routing
// ============================================================
const VIEW_KEY = 'wcs_view:' + APP_NS;
function switchView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  try { localStorage.setItem(VIEW_KEY, name); } catch {}
}
function drawPhase() {
  if (DATA.draw.completed && DATA.draw.order.length) return 'done';
  if ((DATA.draw.order || []).length) return 'ordered';   // order drawn, teams pending
  return 'setup';
}
function renderDrawTab() {
  const phase = drawPhase();
  const admin = canEdit();
  // Admin drives the two-step setup; everyone else just sees the board
  // (with a friendly "not done yet" message until the teams are drawn).
  const showSetup = admin && phase !== 'done';
  $('#drawSetup').style.display   = showSetup ? 'block' : 'none';
  $('#drawResults').style.display = showSetup ? 'none' : 'block';
  if (!showSetup) { renderBoard(); return; }

  const ordered = phase === 'ordered';
  $('#setupEntry').style.display   = ordered ? 'none' : 'block';
  $('#setupOrdered').style.display = ordered ? 'block' : 'none';
  if (ordered) {
    const nB = DATA.draw.order.length;
    const { per, rem } = splitCounts(nB);
    $('#orderedHint').innerHTML =
      `This is the running order. Each ${pWord()} gets <b>${per} teams</b>${rem ? ` and <b>House</b> gets the spare <b>${rem}</b>` : ''}. Now deal them out.`;
    $('#orderLocked').innerHTML = DATA.draw.order
      .map(b => `<li><span class="ol-pos"></span>${esc(b)}</li>`).join('');
    if ($('#potsHint')) {
      const ranges = Array.from({ length: per }, (_, k) => `${k * nB + 1}-${(k + 1) * nB}`).join(', ');
      $('#potsHint').textContent =
        `${nB} ${pWordPlural()} → ${per} pots of ${nB} (ranks ${ranges})${rem ? `; House gets the ${rem} lowest` : ''}. Lowest pot drawn first, top ${nB} last.`;
    }
    if (rem > 0 && $('#houseLowToggleHint'))
      $('#houseLowToggleHint').textContent =
        `House gets the ${rem} lowest FIFA-ranked teams instead of random ones.`;
    if ($('#potsPlayHint')) {
      const P = nB + 1, perP = Math.floor(48 / P), remP = 48 - perP * P;
      const ranges = Array.from({ length: perP }, (_, k) => `${k * P + 1}-${(k + 1) * P}`).join(', ');
      $('#potsPlayHint').textContent =
        `${nB} ${pWordPlural()} + House = ${P} in the draw → ${perP} pots of ${P} (ranks ${ranges})${remP ? `; ${remP} lowest spare` : ''}. Everyone draws one per pot.`;
    }
    if ($('#dregsBucketHint')) {
      const remP = 48 - Math.floor(48 / (nB + 1)) * (nB + 1);
      $('#dregsBucketHint').textContent =
        `The ${remP} lowest go to a separate Dregs card (owned by no one) instead of to House.`;
    }
    updateDrawModeUI();
  } else {
    renderBoysSetup();
  }
}
// show the right sub-toggle for the selected mode
function updateDrawModeUI() {
  const n = (DATA.draw.order || []).length;
  const T = DATA.teams.length;
  const rem  = n >= 2 ? T - Math.floor(T / n) * n : 0;            // boys-only modes
  const remP = n >= 1 ? T - Math.floor(T / (n + 1)) * (n + 1) : 0; // House-plays mode
  const modeEl = document.querySelector('input[name="drawMode"]:checked');
  const mode = modeEl ? modeEl.value : 'pots';
  const show = (id, on) => { const e = $('#' + id); if (e) e.style.display = on ? 'flex' : 'none'; };
  show('houseLowToggleWrap', (mode === 'seeds' || mode === 'random') && rem > 0);
  show('dregsBucketWrap', mode === 'potsplay' && remP > 0);
}

function updateLockUI() {
  const done = !!(DATA.draw.completed && DATA.draw.order.length);
  const locked = done && !!DATA.draw.locked;
  const set = (id, show) => { const e = $('#' + id); if (e) e.style.display = show ? '' : 'none'; };
  set('lockBadge', locked);
  set('lockDraw', done && !locked);
  set('unlockDraw', locked);
  set('redraw', done && !locked);   // hide re-run while locked
}

function renderAll() {
  document.body.classList.toggle('spectator', !canEdit());
  applyBranding();
  $('#subtitle').textContent = DATA.meta.subtitle || '';
  renderDrawTab();
  updateLockUI();
  renderMatchCentre();
  renderGroups();
  renderKnockout();
  renderStandings();
  renderTeamsAdmin();
  renderTradePanel();
  renderSyncStatus();
  updateSettingsTab();
}

// The Settings tab can be hidden from the wider group (a shared flag in
// data.json). It still shows for an admin (their browser holds a token) and can
// be re-opened by anyone via the #settings URL — visibility is convenience, not
// security; the token is the real gate.
function settingsHidden()   { return !!(DATA && DATA.meta && DATA.meta.hideSettingsTab); }
function adminHashOpen()    { return /(?:settings|admin)/i.test(location.hash || ''); }
function settingsTabVisible(){ return !settingsHidden() || canEdit() || adminHashOpen(); }
function updateSettingsTab() {
  const b = $('#tabSettings'); if (b) b.style.display = settingsTabVisible() ? '' : 'none';
  const btn = $('#toggleSettingsTab'); if (btn) btn.textContent = settingsHidden() ? 'Show Settings tab to everyone' : 'Hide Settings tab';
  const note = $('#settingsVisNote');
  if (note) note.innerHTML = settingsHidden()
    ? 'Currently <b>hidden</b> from the group. Re-open it anytime via <code>#settings</code> in the URL.'
    : 'Currently <b>visible</b> to everyone.';
}
function renderSyncStatus() {
  const dot = $('#syncDot'), label = $('#syncLabel');
  dot.className = 'dot';
  if (canEdit()) { dot.classList.add('edit'); label.textContent = 'Admin · synced'; }
  else if (CFG.owner && CFG.repo) { dot.classList.add('live'); label.textContent = 'Live · view only'; }
  else { label.textContent = 'Local only'; }
}

// ============================================================
//  Confetti (lightweight)
// ============================================================
function fireConfetti() {
  const colors = ['#c6ff3d', '#ff2e74', '#2fe3d6', '#ffce3a', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    const dur = 1.8 + Math.random() * 1.6;
    c.style.transition = `transform ${dur}s linear, top ${dur}s linear, opacity ${dur}s`;
    document.body.appendChild(c);
    requestAnimationFrame(() => {
      c.style.top = (90 + Math.random() * 10) + 'vh';
      c.style.transform = `translateX(${(Math.random() - 0.5) * 240}px) rotate(${Math.random() * 720}deg)`;
      c.style.opacity = '0';
    });
    setTimeout(() => c.remove(), dur * 1000 + 200);
  }
}

// ============================================================
//  Toast
// ============================================================
let toastT;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

// ============================================================
//  Settings wiring
// ============================================================
function fillCfgInputs() {
  $('#cfgOwner').value  = CFG.owner;
  $('#cfgRepo').value   = CFG.repo;
  $('#cfgBranch').value = CFG.branch;
  $('#cfgPath').value   = CFG.path;
  $('#cfgToken').value  = CFG.token;
}
function readCfgInputs() {
  CFG.owner  = $('#cfgOwner').value.trim();
  CFG.repo   = $('#cfgRepo').value.trim();
  CFG.branch = $('#cfgBranch').value.trim() || 'main';
  CFG.path   = $('#cfgPath').value.trim() || 'data.json';
  CFG.token  = $('#cfgToken').value.trim();
}
// Branding lives in DATA.meta (synced via GitHub), not in the local CFG.
function fillBrandingInputs() {
  if (!DATA || !DATA.meta) return;
  const v = (id, val) => { const e = $('#' + id); if (e) e.value = val || ''; };
  v('cfgGroupName', DATA.meta.groupName);
  v('cfgSubtitle', DATA.meta.subtitle);
  v('cfgPlayerWord', DATA.meta.playerWord);
  v('cfgPlayerWordPlural', DATA.meta.playerWordPlural);
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ============================================================
//  Init
// ============================================================
async function init() {
  loadCfg();
  fillCfgInputs();
  await loadData();
  renderAll();
  fillBrandingInputs();
  setInterval(pollData, 90000);   // viewers refresh live results (skipped for admins)

  // tabs — restore whichever tab was open before a refresh
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  let saved = 'matches';
  try { saved = localStorage.getItem(VIEW_KEY) || 'matches'; } catch {}
  if (saved === 'settings' && !settingsTabVisible()) saved = 'matches';
  if ($('#view-' + saved)) switchView(saved);
  // #settings (or #admin) deep-link: reveal + open Settings, even when hidden
  if (adminHashOpen()) switchView('settings');
  window.addEventListener('hashchange', () => { updateSettingsTab(); if (adminHashOpen()) switchView('settings'); });
  $('#toggleSettingsTab') && $('#toggleSettingsTab').addEventListener('click', async () => {
    DATA.meta.hideSettingsTab = !settingsHidden();
    renderAll();
    const ok = await pushData(false);
    toast(ok ? (settingsHidden() ? 'Settings tab hidden ✓' : 'Settings tab shown ✓') : 'Saved locally — add a token to share');
  });

  // draw setup — two steps: draw the order, then draw the teams
  $('#addBoy').addEventListener('click', addBoy);
  $('#drawOrderBtn').addEventListener('click', drawOrder);
  $('#drawTeamsBtn').addEventListener('click', drawTeams);
  $$('input[name="drawMode"]').forEach(r => r.addEventListener('change', updateDrawModeUI));
  $('#editBoysBtn').addEventListener('click', () => {
    // back to the entry step, keeping the names so they can tweak and redraw the order
    DATA.boys = DATA.draw.order.length ? DATA.draw.order.slice() : DATA.boys;
    DATA.draw = { completed: false, order: [], allocations: {} };
    DATA.champion = null;
    DATA.teams.forEach(t => t.status = 'alive');
    renderDrawTab();
  });
  $('#redraw').addEventListener('click', () => {
    if (DATA.draw.locked) { toast('Draw is locked 🔒 — unlock it first', true); return; }
    if (!confirm('Re-run the draw? This wipes the current allocations and any results.')) return;
    DATA.boys = DATA.draw.order.length ? DATA.draw.order.slice() : DATA.boys;
    DATA.draw = { completed: false, order: [], allocations: {} };
    DATA.champion = null;
    DATA.teams.forEach(t => t.status = 'alive');
    renderDrawTab();
    switchView('draw');
  });
  $('#lockDraw').addEventListener('click', async () => {
    if (!(DATA.draw.completed && DATA.draw.order.length)) return;
    if (!confirm('Lock the draw? It will be protected from re-running, resetting or wiping until you unlock it.')) return;
    DATA.draw.locked = true;
    renderAll(); await pushData(true); toast('Draw locked 🔒');
  });
  $('#unlockDraw').addEventListener('click', async () => {
    if (!confirm('Unlock the official draw? This removes the protection so it can be changed or deleted.')) return;
    if (!confirm('Are you sure? Only unlock if you really mean to change the official draw.')) return;
    DATA.draw.locked = false;
    renderAll(); await pushData(true); toast('Draw unlocked 🔓');
  });
  $('#stageSkip').addEventListener('click', () => { skipDraw = true; });

  $('#tradeA').addEventListener('change', onTradeSelectChange);
  $('#tradeB').addEventListener('change', onTradeSelectChange);
  $('#tradeBtn').addEventListener('click', onTradeSwap);

  // match centre day navigation
  $('#mcPrev').addEventListener('click', () => mcStep(-1));
  $('#mcNext').addEventListener('click', () => mcStep(1));
  $('#mcToday').addEventListener('click', () => { mcDate = todayKey(); renderMatchCentre(); });
  const tzSel = $('#mcTz');
  if (tzSel) tzSel.addEventListener('change', e => {
    setDisplayZone(e.target.value);
    mcDate = null; mcInit();   // day boundaries shift with the zone, so re-pick the day
    renderAll();               // also refreshes Groups/Knockout kick-off times
  });

  // settings
  $('#cfgSave').addEventListener('click', () => { readCfgInputs(); saveCfg(); renderAll(); toast('Config saved'); $('#cfgStatus').textContent = 'Config saved to this browser.'; });
  $('#cfgPull').addEventListener('click', async () => { readCfgInputs(); saveCfg(); $('#cfgStatus').textContent = 'Loading…'; await loadData(); renderAll(); toast('Loaded from GitHub'); $('#cfgStatus').textContent = 'Loaded latest data from GitHub.'; });
  $('#cfgPush').addEventListener('click', async () => { readCfgInputs(); saveCfg(); const ok = await pushData(false); $('#cfgStatus').textContent = ok ? 'Pushed to GitHub.' : 'Push failed — check token & repo.'; });

  // branding (group name + player wording) — stored in DATA.meta and synced
  $('#cfgBrandingSave').addEventListener('click', async () => {
    DATA.meta.groupName        = $('#cfgGroupName').value.trim();
    DATA.meta.subtitle         = $('#cfgSubtitle').value.trim() || 'Last team standing takes the pot';
    DATA.meta.playerWord       = $('#cfgPlayerWord').value.trim() || 'player';
    DATA.meta.playerWordPlural = $('#cfgPlayerWordPlural').value.trim() || 'players';
    renderAll();
    const ok = await pushData(false);
    toast(ok ? 'Branding saved ✓' : 'Saved locally — add a token to share it');
  });

  // backup
  $('#exportJson').addEventListener('click', () => {
    const out = JSON.parse(JSON.stringify(DATA)); delete out.__sha;
    download('world-cup-sweep.json', JSON.stringify(out, null, 2));
  });
  $('#importJsonBtn').addEventListener('click', () => $('#importJson').click());
  $('#importJson').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { DATA = normalise(JSON.parse(rd.result)); renderAll(); switchView('draw'); toast('Imported'); } catch { toast('Invalid JSON file', true); } };
    rd.readAsText(f);
  });

  // danger
  $('#resetDraw').addEventListener('click', async () => {
    if (DATA.draw.locked) { toast('Draw is locked 🔒 — unlock it first (Draw tab)', true); return; }
    if (!confirm(`Reset the draw? Keeps the ${pWordPlural()} and teams, clears allocations and results.`)) return;
    DATA.draw = { completed: false, order: [], allocations: {} };
    DATA.champion = null;
    DATA.teams.forEach(t => t.status = 'alive');
    renderAll(); switchView('draw'); await pushData(true); toast('Draw reset');
  });
  $('#resetAll').addEventListener('click', async () => {
    if (DATA.draw.locked) { toast('Draw is locked 🔒 — unlock it first (Draw tab)', true); return; }
    if (!confirm(`Wipe everything back to a fresh tournament (teams stay, all teams alive, ${pWordPlural()} cleared)?`)) return;
    DATA.boys = []; DATA.draw = { completed: false, order: [], allocations: {} };
    DATA.champion = null; DATA.teams.forEach(t => t.status = 'alive');
    renderAll(); switchView('draw'); await pushData(true); toast('Wiped');
  });
}

document.addEventListener('DOMContentLoaded', init);
