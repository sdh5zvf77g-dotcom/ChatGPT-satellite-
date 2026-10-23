/**
 * SatSky Pro
 * Higher standard: verified elements only • full catalogue intelligence • favourites • profiles
 */

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const DB = "satsky-pro-v2", STORE = "catalog";

let observer = { lat: 18.7883, lon: 98.9853, alt: 0.3 };
let records = [];          // {…sat, satrec}
let visible = [];
let filterType = "all";
let minEl = 5;
let searchQ = "";
let source = "seed";
let sortMode = "el";
let favOnly = false;
let favorites = new Set(JSON.parse(localStorage.getItem("satsky-fav") || "[]"));
let selected = null;
let timer = null;

/* ---------- persistence ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror = rej;
  });
}
async function cacheSave(list) {
  try {
    const db = await openDB();
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ list, ts: Date.now() }, "latest");
  } catch (_) {}
}
async function cacheLoad() {
  try {
    const db = await openDB();
    return new Promise(r => {
      const q = db.transaction(STORE, "readonly").objectStore(STORE).get("latest");
      q.onsuccess = () => r(q.result || null);
      q.onerror = () => r(null);
    });
  } catch (_) { return null; }
}
function saveFav() {
  localStorage.setItem("satsky-fav", JSON.stringify([...favorites]));
}

/* ---------- orbital core ---------- */
function tleChecksumOK(line) {
  if (!line || line.length < 69 || !/^[12] /.test(line)) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    if (/[0-9]/.test(line[i])) sum += Number(line[i]);
    else if (line[i] === "-") sum++;
  }
  return sum % 10 === Number(line[68]);
}
function validTLE(s) {
  return s && Number(s.norad) > 0 && s.tle1 && s.tle2 &&
    s.tle1.startsWith("1 ") && s.tle2.startsWith("2 ") &&
    Number(s.tle1.slice(2,7)) === Number(s.norad) &&
    Number(s.tle2.slice(2,7)) === Number(s.norad) &&
    tleChecksumOK(s.tle1) && tleChecksumOK(s.tle2);
}
function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function build(list) {
  const out = [], seen = new Set();
  for (const s of list || []) {
    try {
      if (!validTLE(s) || seen.has(Number(s.norad))) continue;
      const satrec = satellite.twoline2satrec(s.tle1, s.tle2);
      if (satrec && satrec.error === 0) { out.push({...s, norad:Number(s.norad), satrec}); seen.add(Number(s.norad)); }
    } catch (_) {}
  }
  return out;
}
function look(satrec, date, obs) {
  try {
    const gmst = satellite.gstime(date);
    const pv = satellite.propagate(satrec, date);
    if (!pv?.position) return null;
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const gd = { longitude: obs.lon * D2R, latitude: obs.lat * D2R, height: obs.alt };
    const la = satellite.ecfToLookAngles(gd, ecf);
    return { az: la.azimuth * R2D, el: la.elevation * R2D, range: la.rangeSat };
  } catch (_) { return null; }
}

function azDir(az) {
  const d = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}

function nextPass(sat, hours = 18) {
  const now = Date.now(), step = 30000, threshold = Math.max(10, minEl);
  let inPass = false, rise = null, maxEl = -99, maxAz = 0, maxTime = null;
  const first = look(sat.satrec, new Date(now), observer);
  if (first && first.el >= threshold) {
    inPass = true; rise = new Date(now); maxEl = first.el; maxAz = first.az; maxTime = rise;
  }
  for (let t = step; t <= hours * 3600000; t += step) {
    const la = look(sat.satrec, new Date(now + t), observer);
    if (!la) continue;
    if (!inPass && la.el >= threshold) { inPass = true; rise = new Date(now+t); maxEl=la.el; maxAz=la.az; maxTime=rise; }
    if (inPass) {
      if (la.el > maxEl) { maxEl=la.el; maxAz=la.az; maxTime=new Date(now+t); }
      if (la.el < threshold) {
        const setTime = new Date(now+t);
        return {rise,maxEl,maxAz,maxTime,setTime,durMin:Math.max(0,Math.round((setTime-rise)/60000)),ongoing:rise.getTime()===now};
      }
    }
  }
  return rise ? {rise,maxEl,maxAz,maxTime,setTime:null,durMin:null,ongoing:rise.getTime()===now} : null;
}


function orbitalMetrics(sat) {
  const mm = parseFloat(sat.tle2.substring(52, 63));
  return {
    period: window.SAT_DATA.meanMotionToPeriodMin(mm),
    alt: window.SAT_DATA.meanMotionToApproxAltKm(mm),
    ageH: window.SAT_DATA.tleEpochAgeHours(sat.tle1),
    meanMotion:mm, inclination:Number(sat.tle2.substring(8,16)),
    raan:Number(sat.tle2.substring(17,25)),
    eccentricity:Number("0."+sat.tle2.substring(26,33).trim()),
    argPerigee:Number(sat.tle2.substring(34,42)),
    meanAnomaly:Number(sat.tle2.substring(43,51)),
    epoch:window.SAT_DATA.tleEpochDate(sat.tle1)
  };
}

/* ---------- UI state ---------- */
function setStatus(msg, kind = "") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status " + kind;
}
function setSource(s) {
  source = s;
  const b = document.getElementById("src");
  b.textContent = s === "live" ? "Live" : s === "cache" ? "Cached" : "Offline seed";
  b.className = "badge " + (s === "live" ? "live" : s === "cache" ? "cache" : "seed");
}

/* ---------- rendering ---------- */
function refresh() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toUTCString().replace("GMT", "UTC");

  let list = records;
  if (filterType !== "all") list = list.filter(s => s.type === filterType);
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.norad).includes(q));
  }
  if (favOnly) list = list.filter(s => favorites.has(String(s.norad)));

  visible = [];
  for (const s of list) {
    const la = look(s.satrec, now, observer);
    if (la && la.el >= minEl) visible.push({ ...s, ...la });
  }

  if (sortMode === "el") visible.sort((a, b) => b.el - a.el);
  else if (sortMode === "name") visible.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortMode === "range") visible.sort((a, b) => a.range - b.range);

  renderSky();
  renderVisible();
  renderCatalog(list);
  renderPasses();
  document.getElementById("vcount").textContent = visible.length;
  document.getElementById("tcount").textContent = records.length;
}

function renderSky() {
  const c = document.getElementById("sky");
  const ctx = c.getContext("2d");
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = Math.min(cx, cy) - 18;

  ctx.fillStyle = "#060a12";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#18233a";
  ctx.lineWidth = 1;
  [0, 30, 60, 90].forEach(el => {
    const rad = r * (1 - el/90);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI*2); ctx.stroke();
  });

  ctx.fillStyle = "#6b8cce";
  ctx.font = "bold 11px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy - r - 5);
  ctx.fillText("S", cx, cy + r + 13);
  ctx.fillText("E", cx + r + 10, cy + 3);
  ctx.fillText("W", cx - r - 10, cy + 3);

  ctx.beginPath();
  ctx.moveTo(cx-r, cy); ctx.lineTo(cx+r, cy);
  ctx.moveTo(cx, cy-r); ctx.lineTo(cx, cy+r);
  ctx.stroke();

  visible.slice(0, 50).forEach(s => {
    const rad = r * (1 - s.el/90);
    const x = cx + rad * Math.sin(s.az * D2R);
    const y = cy - rad * Math.cos(s.az * D2R);
    const col = s.type === "Space Station" ? "#ff6b6b" :
                s.type === "Starlink" ? "#ffe66d" :
                s.type === "Navigation" ? "#a29bfe" :
                s.type === "Science" || s.type === "Bright" ? "#4ecdc4" : "#74b9ff";
    ctx.beginPath();
    ctx.arc(x, y, s.type === "Space Station" ? 6.5 : 4, 0, Math.PI*2);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
    if (s.el > 35 || s.type === "Space Station") {
      ctx.fillStyle = "#e8eef8";
      ctx.font = "10px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(s.name.split(/[\s(]/)[0], x + 8, y + 3);
    }
  });

  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI*2);
  ctx.fillStyle = "#fff"; ctx.fill();
}

function renderVisible() {
  const box = document.getElementById("visible");
  if (!visible.length) {
    box.innerHTML = `<div class="empty">No satellites above ${minEl}° with current filters.</div>`;
    return;
  }
  box.innerHTML = visible.slice(0, 40).map(s => cardHTML(s, true)).join("");
  box.querySelectorAll(".card").forEach(el => {
    el.onclick = () => openProfile(el.dataset.norad);
  });
}

function renderCatalog(list) {
  const box = document.getElementById("catalog");
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (!sorted.length) {
    box.innerHTML = `<div class="empty">Catalogue empty for this filter.</div>`;
    return;
  }
  box.innerHTML = sorted.slice(0, 80).map(s => {
    const isFav = favorites.has(String(s.norad));
    return `<div class="cat-row" data-norad="${s.norad}">
      <button class="fav ${isFav?"on":""}" data-norad="${s.norad}" aria-label="Favourite">${isFav?"★":"☆"}</button>
      <div class="cat-main">
        <span class="cat-name">${s.name}</span>
        <span class="cat-meta">${s.type} · ${s.norad}</span>
      </div>
      <button class="profile-btn" data-norad="${s.norad}">Profile</button>
    </div>`;
  }).join("");

  box.querySelectorAll(".fav").forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const id = b.dataset.norad;
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      saveFav();
      refresh();
    };
  });
  box.querySelectorAll(".profile-btn, .cat-row").forEach(el => {
    el.onclick = e => {
      if (e.target.classList.contains("fav")) return;
      openProfile(el.dataset.norad || el.closest("[data-norad]")?.dataset.norad);
    };
  });
}

function cardHTML(s, showLook) {
  const isFav = favorites.has(String(s.norad));
  return `<div class="card" data-norad="${s.norad}">
    <div class="card-top">
      <span class="name">${escapeHTML(s.name)}</span>
      <span class="type">${escapeHTML(s.type)}</span>
    </div>
    ${showLook ? `<div class="metrics">
      <div><span class="lbl">El</span><span class="val">${s.el.toFixed(1)}°</span></div>
      <div><span class="lbl">Az</span><span class="val">${s.az.toFixed(0)}° ${azDir(s.az)}</span></div>
      <div><span class="lbl">Range</span><span class="val">${Math.round(s.range)} km</span></div>
    </div>` : ""}
    <div class="card-foot">
      <span class="norad">#${s.norad}</span>
      <span class="fav-ind">${isFav ? "★" : ""}</span>
    </div>
  </div>`;
}

function renderPasses() {
  const key = records.filter(s => s.type === "Space Station" || s.norad === 20580 || s.norad === 25544);
  const box = document.getElementById("passes");
  if (!key.length) { box.innerHTML = ""; return; }
  let html = "";
  key.slice(0, 6).forEach(s => {
    const p = nextPass(s, 18);
    if (p) {
      const riseStr = p.ongoing ? "In progress" : p.rise.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      const maxStr = p.maxEl.toFixed(0) + "° " + azDir(p.maxAz);
      const dur = p.durMin != null ? p.durMin + " min" : "ongoing / beyond window";
      html += `<div class="pass">
        <span class="pn">${escapeHTML(s.name)}</span>
        <span class="pt">${riseStr}</span>
        <span class="pe">peak ${maxStr} · ${dur}</span>
      </div>`;
    }
  });
  box.innerHTML = html || `<div class="empty-sm">No rising passes ≥10° in the next 18 h for tracked stations.</div>`;
}

/* ---------- profile drawer ---------- */
function openProfile(norad) {
  const sat = records.find(s => String(s.norad) === String(norad));
  if (!sat) return;
  selected = sat;
  const m = orbitalMetrics(sat);
  const nowLook = look(sat.satrec, new Date(), observer);
  const isFav = favorites.has(String(sat.norad));
  const ageWarn = m.ageH != null && m.ageH > 72 ? `<div class="age-warn">⚠ Orbital elements are ${m.ageH.toFixed(1)} hours old. Prediction quality may be degraded; refresh live data.</div>` : "";
  const epochText = m.epoch ? m.epoch.toISOString().replace("T", " ").slice(0,19) + " UTC" : "Unavailable";
  const dataQuality = m.ageH == null ? "Unknown" : m.ageH < 24 ? "Recent (<24 h)" : m.ageH < 72 ? "Aging (1–3 days)" : "Stale (>3 days)";

  document.getElementById("drawer-title").textContent = sat.name;
  document.getElementById("drawer-body").innerHTML = `
    <div class="prof-type">${escapeHTML(sat.type)} · NORAD ${sat.norad}</div>
    <p class="prof-mission">${escapeHTML(sat.mission || "No curated mission note is available for this object. The category reflects its source catalogue group, not a verified mission classification.")}</p>
    ${ageWarn}
    <div class="prof-grid">
      <div><span class="lbl">Record confidence</span><span class="val">${escapeHTML(sat.confidence || "catalogue only")}</span></div>
      <div><span class="lbl">Element freshness</span><span class="val">${dataQuality}</span></div>
      <div><span class="lbl">Element epoch</span><span class="val">${epochText}</span></div>
      <div><span class="lbl">Orbital period</span><span class="val">${m.period ? m.period.toFixed(2)+" min" : "—"}</span></div>
      <div><span class="lbl">Approx. mean altitude</span><span class="val">${m.alt != null ? Math.round(m.alt)+" km" : "—"}</span></div>
      <div><span class="lbl">Inclination</span><span class="val">${Number.isFinite(m.inclination)?m.inclination.toFixed(4)+"°":"—"}</span></div>
      <div><span class="lbl">Eccentricity</span><span class="val">${Number.isFinite(m.eccentricity)?m.eccentricity.toFixed(7):"—"}</span></div>
      <div><span class="lbl">RAAN</span><span class="val">${Number.isFinite(m.raan)?m.raan.toFixed(4)+"°":"—"}</span></div>
      <div><span class="lbl">Argument of perigee</span><span class="val">${Number.isFinite(m.argPerigee)?m.argPerigee.toFixed(4)+"°":"—"}</span></div>
      <div><span class="lbl">Mean anomaly</span><span class="val">${Number.isFinite(m.meanAnomaly)?m.meanAnomaly.toFixed(4)+"°":"—"}</span></div>
      <div><span class="lbl">Mean motion</span><span class="val">${Number.isFinite(m.meanMotion)?m.meanMotion.toFixed(8)+" rev/day":"—"}</span></div>
      ${nowLook ? `
      <div><span class="lbl">Current elevation</span><span class="val">${nowLook.el.toFixed(1)}°</span></div>
      <div><span class="lbl">Current azimuth</span><span class="val">${nowLook.az.toFixed(0)}° ${azDir(nowLook.az)}</span></div>
      <div><span class="lbl">Slant range</span><span class="val">${Math.round(nowLook.range)} km</span></div>` : `<div class="span2"><span class="lbl">Current</span><span class="val">Below horizon or unavailable</span></div>`}
    </div>
    <div class="tle-block">
      <div class="lbl">Raw TLE</div>
      <pre>${escapeHTML(sat.tle1)}\n${escapeHTML(sat.tle2)}</pre>
      <button id="copy-tle" class="sec-btn" type="button">Copy TLE</button>
    </div>
    <div class="prof-actions">
      <button id="toggle-fav">${isFav ? "★ Remove favourite" : "☆ Add favourite"}</button>
      <a class="ext" href="https://celestrak.org/satcat/search.php?CATNR=${sat.norad}" target="_blank" rel="noopener">CelesTrak catalogue</a>
      <a class="ext" href="https://www.n2yo.com/satellite/?s=${sat.norad}" target="_blank" rel="noopener">N2YO tracking</a>
      <a class="ext" href="https://www.google.com/search?q=${encodeURIComponent(sat.name+" satellite mission "+sat.norad)}" target="_blank" rel="noopener">Mission research</a>
      <a class="ext" href="https://www.google.com/search?q=${encodeURIComponent("site:nasa.gov "+sat.name+" satellite")}" target="_blank" rel="noopener">NASA search</a>
      <a class="ext" href="https://www.google.com/search?q=${encodeURIComponent("site:esa.int "+sat.name+" satellite")}" target="_blank" rel="noopener">ESA search</a>
    </div>
    <p class="note">Altitude and period are derived approximations from mean motion. Orbital elements are predictions, not direct observations. Visibility depends on location, element freshness, terrain and lighting. This app does not receive radio signals.</p>
  `;
  document.getElementById("drawer").classList.add("open");
  const copyTLE = document.getElementById("copy-tle");
  if (copyTLE) copyTLE.onclick = async () => {
    try { await navigator.clipboard.writeText(`${sat.name} (NORAD ${sat.norad})\\n${sat.tle1}\\n${sat.tle2}`); setStatus("TLE copied"); }
    catch (_) { setStatus("Clipboard unavailable in this browser", "warn"); }
  };
  document.getElementById("toggle-fav").onclick = () => {
    const id = String(sat.norad);
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFav();
    openProfile(norad);
    refresh();
  };
}

/* ---------- data loading ---------- */
async function loadSeed() {
  records = build(window.SAT_DATA.SEED);
  setSource("seed");
  setStatus(`Offline seed ready · ${records.length} objects (ISS + Hubble; check element age)`);
  refresh();
}

async function tryCache() {
  const c = await cacheLoad();
  if (c?.list?.length > 2) {
    records = build(c.list);
    setSource("cache");
    const age = Math.round((Date.now() - c.ts) / 3600000);
    setStatus(`Cached catalogue · ${records.length} objects · ${age}h old`);
    refresh();
    return true;
  }
  return false;
}

async function loadGroup(key) {
  const g = window.SAT_DATA.GROUPS[key];
  if (!g) return;
  if (g.large && !confirm(`Load ${g.label}? This can be thousands of objects and may slow the device.`)) return;

  setStatus(`Fetching ${g.label}…`);
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 18000);
    let resp;
    try { resp = await fetch(g.url, { cache: "no-store", mode: "cors", signal: ctrl.signal }); }
    finally { clearTimeout(to); }
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const text = await resp.text();
    const parsed = window.SAT_DATA.parseTLE(text, g.type).filter(validTLE);
    if (parsed.length < 1) throw new Error("No valid checksum-correct TLE records returned");

    // merge by norad
    const map = new Map(records.map(r => [r.norad, r]));
    for (const p of parsed) {
      try {
        const satrec = satellite.twoline2satrec(p.tle1, p.tle2);
        if (satrec?.error === 0) map.set(p.norad, { ...p, satrec });
      } catch (_) {}
    }
    records = [...map.values()];
    setSource("live");
    setStatus(`Live catalogue · ${records.length} unique valid objects; loaded ${g.label} (${parsed.length} records)`);
    await cacheSave(records.map(r => ({ name: r.name, norad: r.norad, tle1: r.tle1, tle2: r.tle2, type: r.type, mission: r.mission, confidence: r.confidence })));
    refresh();
  } catch (e) {
    setStatus(`Failed to load ${g.label}: ${e.message}`, "warn");
  }
}

async function loadDefaults() {
  // Try stations + visual quickly
  for (const key of ["stations", "visual"]) {
    await loadGroup(key);
  }
}

/* ---------- location ---------- */
function getLoc() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: (pos.coords.altitude || 0)/1000 };
        document.getElementById("loc").textContent = `${observer.lat.toFixed(3)}°, ${observer.lon.toFixed(3)}°`;
        resolve();
      },
      () => { document.getElementById("loc").textContent = "Default (Chiang Mai)"; resolve(); },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
    );
  });
}


function copyVisibleList() {
  if (!visible.length) { setStatus("Nothing visible to copy", "warn"); return; }
  const lines = visible.slice(0, 30).map(s => {
    return `${s.name} (NORAD ${s.norad})  El ${s.el.toFixed(1)}°  Az ${s.az.toFixed(0)}° ${azDir(s.az)}  range ${Math.round(s.range)} km`;
  });
  const text = `SatSky Pro — visible above ${minEl}°\n` + lines.join("\n");
  navigator.clipboard.writeText(text).then(() => setStatus("Visible list copied to clipboard")).catch(() => setStatus("Copy failed", "warn"));
}

/* ---------- init ---------- */
async function init() {
  // controls
  document.getElementById("search").oninput = e => { searchQ = e.target.value.trim(); refresh(); };
  document.getElementById("type").onchange = e => { filterType = e.target.value; refresh(); };
  document.getElementById("el").oninput = e => {
    minEl = +e.target.value;
    document.getElementById("elval").textContent = minEl + "°";
    refresh();
  };
  document.getElementById("sort").onchange = e => { sortMode = e.target.value; refresh(); };
  document.getElementById("favonly").onclick = () => {
    favOnly = !favOnly;
    document.getElementById("favonly").classList.toggle("on", favOnly);
    refresh();
  };
  document.getElementById("btn-loc").onclick = async () => { await getLoc(); refresh(); };
  document.getElementById("btn-live").onclick = () => loadDefaults();
  const copyBtn = document.getElementById("btn-copy");
  if (copyBtn) copyBtn.onclick = copyVisibleList;
  document.getElementById("drawer-close").onclick = () => document.getElementById("drawer").classList.remove("open");

  document.querySelectorAll("[data-group]").forEach(b => {
    b.onclick = () => loadGroup(b.dataset.group);
  });

  await getLoc();
  await loadSeed();                 // always start with verified data
  await tryCache();                 // improve if we have a previous live pull
  // live is explicit via buttons – never block startup

  timer = setInterval(refresh, 5000);

  const sky = document.getElementById("sky");
  function size() {
    const s = Math.min(sky.parentElement.clientWidth - 8, 340);
    sky.width = s; sky.height = s;
    renderSky();
  }
  window.addEventListener("resize", size);
  size();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
document.addEventListener("DOMContentLoaded", init);
