/**
 * SatSky – High-end offline-capable satellite sky tracker
 * Verified SGP4 core • Search • Filters • Pass predictions • IndexedDB cache
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DB_NAME = "satsky-v3";
const STORE = "catalog";

let observer = { lat: 18.7883, lon: 98.9853, alt: 0.3 };
let allSats = [];          // full loaded catalog with satrec
let visible = [];
let filterType = "all";
let minEl = 5;
let searchQ = "";
let dataSource = "bundled";
let updateTimer = null;
let catalogPage = 0;
const CATALOG_PAGE_SIZE = 40;
let favorites = new Set();
let favoritesOnly = false;
try { favorites = new Set(JSON.parse(localStorage.getItem("satsky-favorites-v1") || "[]").map(String)); } catch (_) {}

/* ---------- IndexedDB helpers ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e);
  });
}
async function saveCatalog(list) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ list, ts: Date.now() }, "latest");
  } catch (_) {}
}
async function loadCachedCatalog() {
  try {
    const db = await openDB();
    return new Promise(res => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("latest");
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch (_) { return null; }
}

/* ---------- Core orbital ---------- */
function buildRecords(rawList) {
  const out = [];
  for (const s of rawList) {
    try {
      const satrec = satellite.twoline2satrec(s.tle1, s.tle2);
      if (satrec && satrec.error === 0) {
        out.push({ ...s, satrec });
      }
    } catch (_) {}
  }
  return out;
}

function lookAngles(satrec, date, obs) {
  try {
    const gmst = satellite.gstime(date);
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const gd = { longitude: obs.lon * DEG2RAD, latitude: obs.lat * DEG2RAD, height: obs.alt };
    const la = satellite.ecfToLookAngles(gd, ecf);
    return {
      az: la.azimuth * RAD2DEG,
      el: la.elevation * RAD2DEG,
      range: la.rangeSat
    };
  } catch (_) { return null; }
}

function azDir(az) {
  const d = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}

/* ---------- Pass prediction (simple next rising) ---------- */
function nextPass(sat, hoursAhead = 12) {
  const now = new Date();
  const step = 60 * 1000; // 1 min
  let lastEl = -90;
  for (let t = 0; t < hoursAhead * 3600 * 1000; t += step) {
    const d = new Date(now.getTime() + t);
    const la = lookAngles(sat.satrec, d, observer);
    if (!la) continue;
    if (lastEl < 0 && la.el >= 10) {
      return { time: d, maxEl: la.el, az: la.az };
    }
    lastEl = la.el;
  }
  return null;
}

/* ---------- UI helpers ---------- */
function setStatus(msg, kind = "info") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status " + kind;
}
function setSource(src) {
  dataSource = src;
  document.getElementById("source-badge").textContent =
    src === "live" ? "Live data" : src === "cache" ? "Cached" : "Bundled core";
  document.getElementById("source-badge").className = "badge " + (src === "live" ? "online" : "offline");
}

/* ---------- Main update ---------- */
function refreshVisible() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toUTCString().replace("GMT","UTC");

  let list = allSats;
  if (filterType !== "all") list = list.filter(s => s.type === filterType);
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.norad).includes(q));
  }

  visible = [];
  for (const s of list) {
    const la = lookAngles(s.satrec, now, observer);
    if (la && la.el >= minEl) {
      visible.push({ ...s, ...la });
    }
  }
  visible.sort((a, b) => b.el - a.el);

  renderList();
  renderSky();
  renderCatalog();
  document.getElementById("vis-count").textContent = visible.length;
  document.getElementById("total-count").textContent = allSats.length;
  document.getElementById("catalog-count").textContent = filteredCatalog().length.toLocaleString();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));
}

function renderList() {
  const box = document.getElementById("list");
  if (visible.length === 0) {
    box.innerHTML = `<div class="empty">No satellites above ${minEl}° with current filters.<br>
      Try lowering the elevation filter or clearing search.</div>`;
    return;
  }
  const show = visible.slice(0, 60);
  box.innerHTML = show.map(s => `
    <button type="button" class="card" data-norad="${s.norad}" aria-label="Open details for ${esc(s.name)}">
      <div class="card-top">
        <span class="name">${esc(s.name)}</span>
        <span class="type">${esc(s.type)}</span>
      </div>
      <div class="metrics">
        <div><span class="lbl">El</span><span class="val">${s.el.toFixed(1)}°</span></div>
        <div><span class="lbl">Az</span><span class="val">${s.az.toFixed(0)}° ${azDir(s.az)}</span></div>
        <div><span class="lbl">Range</span><span class="val">${Math.round(s.range)} km</span></div>
      </div>
    </button>`).join("");
}

function filteredCatalog() {
  let list = allSats.slice();
  if (filterType !== "all") list = list.filter(s => s.type === filterType);
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.norad).includes(q));
  }
  if (favoritesOnly) list = list.filter(s => favorites.has(String(s.norad)));
  const sort = document.getElementById("catalog-sort")?.value || "name";
  if (sort === "norad") list.sort((a,b) => Number(a.norad)-Number(b.norad));
  else if (sort === "altitude") list.sort((a,b) => (orbitFacts(a).alt ?? Infinity) - (orbitFacts(b).alt ?? Infinity));
  else if (sort === "period") list.sort((a,b) => (orbitFacts(a).period ?? Infinity) - (orbitFacts(b).period ?? Infinity));
  else if (sort === "favorite") list.sort((a,b) => Number(favorites.has(String(b.norad)))-Number(favorites.has(String(a.norad))) || a.name.localeCompare(b.name));
  else list.sort((a,b) => a.name.localeCompare(b.name));
  return list;
}
function renderCatalog() {
  const box = document.getElementById("catalog-list");
  if (!box) return;
  const list = filteredCatalog();
  document.getElementById("catalog-count").textContent = list.length.toLocaleString();
  if (!list.length) {
    box.innerHTML = `<div class="empty">${favoritesOnly ? "No saved favourites match these filters." : "No objects match. Try another search or load live data."}</div>`;
    document.getElementById("btn-more").hidden = true;
    return;
  }
  const end = Math.min((catalogPage + 1) * CATALOG_PAGE_SIZE, list.length);
  box.innerHTML = list.slice(0,end).map(s => {
    const d = orbitFacts(s);
    const star = favorites.has(String(s.norad));
    return `<div class="catalog-card">
      <button type="button" class="catalog-open" data-norad="${esc(s.norad)}">
        <span class="catalog-name">${esc(s.name)}</span><span class="catalog-meta">${esc(s.type || "Satellite")} · NORAD ${esc(s.norad)}</span>
        <span class="catalog-meta">Approx. altitude ${Number.isFinite(d.alt) ? Math.round(d.alt).toLocaleString()+" km" : "—"} · Period ${d.period ? d.period.toFixed(1)+" min" : "—"}</span>
      </button>
      <button type="button" class="favorite-btn ${star ? "is-favorite" : ""}" data-favorite="${esc(s.norad)}" aria-label="${star ? "Remove from" : "Add to"} favourites">${star ? "★" : "☆"}</button>
    </div>`;
  }).join("");
  document.getElementById("btn-more").hidden = end >= list.length;
  document.getElementById("btn-more").textContent = `Show more objects (${Math.min(CATALOG_PAGE_SIZE,list.length-end)} of ${list.length-end} next)`;
}
function toggleFavorite(norad) {
  const id = String(norad);
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  try { localStorage.setItem("satsky-favorites-v1", JSON.stringify([...favorites])); } catch (_) {}
  renderCatalog();
  if (document.getElementById("detail-modal").hidden === false) openSatelliteDetail(norad);
}
function classifyObject(name, fallback) {
  const n = String(name || "").toUpperCase();
  if (/ISS|TIANGONG|CSS \(|TIANHE|ZVEZDA|ZARYA/.test(n)) return "Space Station";
  if (/STARLINK/.test(n)) return "Starlink";
  if (/NOAA|METEOR|GOES|METOP|HIMAWARI|WEATHER|FENGYUN|JPSS/.test(n)) return "Weather";
  if (/GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|COMPASS/.test(n)) return "Navigation";
  if (/HUBBLE|HST|JWST|TESS|KEPLER|CHANDRA|FERMI|SWIFT|LANDSAT|SENTINEL|AQUA|TERRA|SUOMI|ICESAT|EARTHCARE/.test(n)) return /LANDSAT|SENTINEL|AQUA|TERRA|SUOMI|ICESAT|EARTHCARE/.test(n) ? "Earth Observation" : "Science";
  if (/ONEWEB/.test(n)) return "Communications";
  if (/AMSAT|AO-|SO-50|ISS \(ZARYA\)/.test(n)) return "Amateur";
  return fallback || "Satellite";
}

function renderSky() {
  const c = document.getElementById("sky");
  const ctx = c.getContext("2d");
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = Math.min(cx,cy)-16;

  ctx.fillStyle = "#070b14";
  ctx.fillRect(0,0,w,h);

  // elevation rings
  ctx.strokeStyle = "#1a2744";
  ctx.lineWidth = 1;
  [0,30,60,90].forEach(el => {
    const rad = r * (1 - el/90);
    ctx.beginPath(); ctx.arc(cx,cy,rad,0,Math.PI*2); ctx.stroke();
  });

  // cardinals
  ctx.fillStyle = "#6b8cce";
  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy-r-4);
  ctx.fillText("S", cx, cy+r+14);
  ctx.fillText("E", cx+r+11, cy+4);
  ctx.fillText("W", cx-r-11, cy+4);

  // cross
  ctx.beginPath();
  ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy);
  ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r);
  ctx.stroke();

  // sats
  const toShow = visible.slice(0, 40);
  toShow.forEach(s => {
    const rad = r * (1 - s.el/90);
    const x = cx + rad * Math.sin(s.az * DEG2RAD);
    const y = cy - rad * Math.cos(s.az * DEG2RAD);
    const col = s.type === "Space Station" ? "#ff6b6b" :
                s.type === "Starlink" ? "#ffe66d" :
                s.type === "Navigation" ? "#a29bfe" :
                s.type === "Science" || s.type === "Bright" ? "#4ecdc4" : "#74b9ff";
    ctx.beginPath();
    ctx.arc(x,y, s.type==="Space Station"?7:4.5, 0, Math.PI*2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
    if (s.el > 40 || s.type === "Space Station") {
      ctx.fillStyle = "#e8eef8";
      ctx.font = "10px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(s.name.split(/[\s(]/)[0], x+8, y+3);
    }
  });

  // zenith
  ctx.beginPath(); ctx.arc(cx,cy,2.5,0,Math.PI*2);
  ctx.fillStyle = "#fff"; ctx.fill();
}

/* ---------- Pass panel ---------- */
function updatePasses() {
  const key = allSats.filter(s => s.type === "Space Station" || s.name.includes("ISS") || s.name.includes("HST"));
  const box = document.getElementById("passes");
  if (key.length === 0) { box.innerHTML = ""; return; }
  let html = "";
  key.slice(0,4).forEach(s => {
    const p = nextPass(s, 18);
    if (p) {
      const t = p.time.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
      html += `<div class="pass-row"><span class="pn">${s.name}</span>
        <span class="pt">${t}</span>
        <span class="pe">${p.maxEl.toFixed(0)}° ${azDir(p.az)}</span></div>`;
    }
  });
  box.innerHTML = html || "<div class='empty-sm'>No rising passes in the next 18 h for tracked stations.</div>";
}

/* ---------- Rich satellite profiles ---------- */
const SAT_FACTS = {
  "25544": { mission:"International Space Station", purpose:"A permanently crewed orbital laboratory used for scientific research, technology demonstrations, Earth observation and international cooperation.", operator:"NASA, Roscosmos, ESA, JAXA and CSA partner agencies", orbit:"Low Earth orbit (LEO)", note:"The ISS moves quickly across the sky. A pass can be visible to the naked eye when sunlight illuminates the station while the observer's sky is dark." },
  "20580": { mission:"Hubble Space Telescope", purpose:"A space observatory that studies stars, galaxies, nebulae, planets and the distant universe in ultraviolet, visible and near-infrared light.", operator:"NASA / ESA", orbit:"Low Earth orbit (LEO)", note:"Hubble is not normally as bright as the ISS; visibility depends on its orientation, illumination and local sky conditions." },
  "48274": { mission:"China Space Station – Tianhe core module", purpose:"Core module of China's Tiangong space station, supporting crew living, station control and orbital research.", operator:"China Manned Space Agency (CMSA)", orbit:"Low Earth orbit (LEO)", note:"This bundled app does not use fabricated orbital elements. A current position requires a live catalog update." }
};
const TYPE_FACTS = {
  "Space Station": ["Crewed orbital platform", "Supports human spaceflight, experiments, technology testing and long-duration missions."],
  "Science": ["Scientific spacecraft", "Studies space, the Sun, Earth, planets or the wider universe. Exact instruments and mission goals depend on the spacecraft."],
  "Weather": ["Weather and climate monitoring", "Measures atmospheric conditions, cloud systems, temperature, moisture or environmental indicators used in forecasts and climate records."],
  "Earth Observation": ["Earth observation", "Collects imagery or measurements of land, oceans, ice, vegetation, disasters or environmental change."],
  "Navigation": ["Navigation satellite", "Broadcasts precisely timed radio signals used by receivers to calculate position, navigation and timing. Most GNSS satellites are in medium Earth orbit."],
  "Communications": ["Communications satellite", "Relays voice, data or broadband traffic between ground stations, user terminals and networks."],
  "Starlink": ["Broadband communications constellation", "Part of a large low Earth orbit network designed to provide internet connectivity. The constellation and satellite status change frequently."],
  "Bright": ["Bright satellite / observer list", "A visibility-oriented catalog group. Membership does not itself establish the object's mission or guarantee naked-eye visibility."],
  "Amateur": ["Amateur radio satellite", "May provide amateur-radio communications, telemetry, experimentation or store-and-forward services; capabilities vary by spacecraft."],
  "Satellite": ["Artificial satellite", "A human-made object orbiting Earth. Mission-specific information should be verified against a trusted catalog."],
  "Active": ["Active catalog object", "An object included in the live active catalog; catalog membership alone is not a guarantee of operational status."]
};
function orbitFacts(s) {
  const l1 = s.tle1 || "", l2 = s.tle2 || "";
  const inc = Number(l2.slice(8,16)), ecc = Number("0." + l2.slice(26,33).trim()), mm = Number(l2.slice(52,63));
  const epochRaw = l1.slice(18,32).trim();
  let epoch = "Unavailable";
  if (/^\d{2}\d{3}\.\d+$/.test(epochRaw)) {
    const yy = Number(epochRaw.slice(0,2)), year = yy >= 57 ? 1900+yy : 2000+yy;
    const day = Number(epochRaw.slice(2)); epoch = new Date(Date.UTC(year,0,1) + (day-1)*86400000).toISOString().slice(0,16).replace("T"," ") + " UTC";
  }
  const period = mm > 0 ? 1440/mm : null;
  const a = mm > 0 ? Math.pow(398600.4418 / Math.pow(mm*2*Math.PI/86400,2), 1/3) : null;
  const alt = a ? a-6371 : null;
  const intl = l1.slice(9,17).trim() || "Unavailable";
  const objectClass = ({U:"Unclassified", C:"Classified", S:"Secret"})[l1.slice(7,8)] || "Unavailable";
  const bstarRaw = l1.slice(53,61).trim();
  const rev = l2.slice(63,68).trim();
  return { inc, ecc, mm, period, alt, epoch, intl, objectClass, bstarRaw, rev };
}
function openSatelliteDetail(norad) {
  const s = allSats.find(x => String(x.norad) === String(norad));
  if (!s) return;
  const d = orbitFacts(s), facts = SAT_FACTS[String(s.norad)] || {};
  const generic = TYPE_FACTS[s.type] || TYPE_FACTS.Satellite;
  const currentLook = lookAngles(s.satrec, new Date(), observer);
  const isFav = favorites.has(String(s.norad));
  const mission = facts.mission || s.name;
  const purpose = facts.purpose || generic[1];
  const orbital = facts.orbit || (Number.isFinite(d.alt) ? (d.alt > 2000 ? "Medium / high orbit (approx.)" : "Low Earth orbit (approx.)") : "Not calculated");
  const stat = (k,v) => `<div class="profile-stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  const section = (h,p) => `<section class="profile-section"><h3>${esc(h)}</h3><p>${esc(p)}</p></section>`;
  document.getElementById("detail-title").textContent = s.name;
  document.getElementById("detail-subtitle").textContent = `NORAD catalog ID ${s.norad} · ${s.type || "Satellite"}`;
  document.getElementById("detail-body").innerHTML = `
    <div class="profile-actions"><button type="button" class="profile-fav" data-profile-favorite="${esc(s.norad)}">${isFav ? "★ Saved to favourites" : "☆ Save to favourites"}</button><span class="confidence">${dataSource === "live" ? "LIVE CATALOGUE" : dataSource === "cache" ? "CACHED CATALOGUE" : "OFFLINE SEED"}</span></div>
    <div class="profile-grid">${stat("Current elevation", currentLook ? `${currentLook.el.toFixed(1)}°` : "Below horizon / unavailable")}${stat("Direction", currentLook ? `${currentLook.az.toFixed(1)}° ${azDir(currentLook.az)}` : "—")}${stat("Slant range", currentLook ? `${Math.round(currentLook.range).toLocaleString()} km` : "—")}${stat("Approx. orbital altitude", Number.isFinite(d.alt) ? `${Math.round(d.alt).toLocaleString()} km` : "—")}${stat("Orbital period", d.period ? `${d.period.toFixed(1)} minutes` : "—")}${stat("Inclination", Number.isFinite(d.inc) ? `${d.inc.toFixed(2)}°` : "—")}${stat("Eccentricity", Number.isFinite(d.ecc) ? d.ecc.toFixed(6) : "—")}${stat("Elements epoch", d.epoch)}${stat("Mean motion", Number.isFinite(d.mm) ? `${d.mm.toFixed(5)} rev/day` : "—")}${stat("International designator", d.intl)}${stat("TLE object class", d.objectClass)}${stat("Revolution at epoch", d.rev || "—")}${stat("BSTAR drag term", d.bstarRaw || "—")}${stat("Data age", d.epoch !== "Unavailable" && Number.isFinite(Date.parse(d.epoch)) ? `${Math.max(0,((Date.now()-Date.parse(d.epoch))/86400000)).toFixed(1)} days (approx.)` : "Unknown")}</div>
    ${section("What it is", `${mission}. ${generic[0]}.`)}
    ${section("Mission and purpose", purpose)}
    ${section("Operator / agency", facts.operator || "Operator and mission-specific agency details are not asserted from the orbital feed alone.")}
    ${section("Orbit and tracking", `${orbital}. Mean motion: ${Number.isFinite(d.mm) ? d.mm.toFixed(5)+" revolutions/day" : "unavailable"}. Orbital values are estimated from the loaded TLE/GP elements and are not a substitute for authoritative mission data.`)}
    ${section("Data quality", `Element epoch: ${d.epoch}. Orbital elements age over time; position accuracy degrades as they become stale. ${dataSource === "live" ? "The current catalog was loaded from CelesTrak in this session." : dataSource === "cache" ? "The current catalog is cached and may be out of date." : "This is the small offline seed catalog. Tap “Try live data” to load a broader current catalog."}`)}
    ${facts.note ? section("Visibility note", facts.note) : section("Visibility note", "A calculated position above the horizon does not mean the satellite is visible to the naked eye. Visibility depends on sunlight, clouds, light pollution, satellite attitude and the observer's location.")}
    <section class="profile-section"><h3>Raw orbital elements (TLE)</h3><p class="tle">${esc(s.tle1)}<br>${esc(s.tle2)}</p></section>`;
  document.getElementById("detail-links").innerHTML = `
    <a href="https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(s.norad)}" target="_blank" rel="noopener">CelesTrak record ↗</a>
    <a href="https://www.n2yo.com/satellite/?s=${encodeURIComponent(s.norad)}" target="_blank" rel="noopener">Live tracking ↗</a>
    <a href="https://satellitemap.space/" target="_blank" rel="noopener">Satellite map ↗</a>
    <a href="https://www.google.com/search?q=${encodeURIComponent(s.name+" satellite mission")}" target="_blank" rel="noopener">Mission research ↗</a>
    <a href="https://www.google.com/search?q=${encodeURIComponent("site:nasa.gov "+s.name+" spacecraft")}" target="_blank" rel="noopener">NASA sources ↗</a>
    <a href="https://www.google.com/search?q=${encodeURIComponent("site:esa.int "+s.name+" satellite")}" target="_blank" rel="noopener">ESA sources ↗</a>
    <a href="https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(s.norad)}&FORMAT=json" target="_blank" rel="noopener">CelesTrak GP JSON ↗</a>`;
  document.getElementById("detail-modal").hidden = false;
}
function closeSatelliteDetail() { document.getElementById("detail-modal").hidden = true; }

/* ---------- Loading paths ---------- */
async function loadBundled() {
  setStatus("Loading core catalog…");
  allSats = buildRecords(window.SAT_DATA.BUNDLED);
  setSource("bundled");
  setStatus(`Offline seed ready – ${allSats.length} objects. Tap “Try live data” for a real, larger catalog.`, "warn");
  refreshVisible();
  updatePasses();
}

async function tryLive(fullCatalog = false) {
  setStatus("Trying live Celestrak data…");
  const groups = fullCatalog ? ["active"] : ["stations", "visual", "science", "weather", "gps", "amateur", "starlink"];
  let collected = [];
  let ok = 0;
  for (const g of groups) {
    try {
      const info = window.SAT_DATA.groups[g];
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(info.url, { cache: "no-store", mode: "cors", signal: controller.signal });
      clearTimeout(to);
      if (!resp.ok) throw new Error(resp.status);
      const text = await resp.text();
      const parsed = window.SAT_DATA.parseTLE(text, info.type).map(s => ({ ...s, type: classifyObject(s.name, info.type) }));
      collected = collected.concat(parsed);
      ok++;
    } catch (e) {
      console.warn("Live group failed", g, e);
    }
  }
  if (ok > 0 && collected.length > 5) {
    const unique = new Map();
    for (const s of collected) if (s.norad && s.tle1 && s.tle2) unique.set(s.norad, s);
    collected = [...unique.values()];
    allSats = buildRecords(collected);
    setSource("live");
    setStatus(`Live data loaded – ${allSats.length.toLocaleString()} unique objects${fullCatalog ? " from the active catalogue" : " across selected groups"}`);
    await saveCatalog(collected);
    catalogPage = 0;
    refreshVisible();
    updatePasses();
    return true;
  }
  return false;
}

async function tryCache() {
  const cached = await loadCachedCatalog();
  if (cached && cached.list && cached.list.length > 5) {
    allSats = buildRecords(cached.list);
    setSource("cache");
    const age = Math.round((Date.now() - cached.ts) / 3600000);
    setStatus(`Using cached catalog (${age}h old) – ${allSats.length} sats`);
    refreshVisible();
    updatePasses();
    return true;
  }
  return false;
}

/* ---------- Location ---------- */
function getLoc() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: (pos.coords.altitude||0)/1000 };
        document.getElementById("loc").textContent = `${observer.lat.toFixed(3)}°, ${observer.lon.toFixed(3)}°`;
        resolve();
      },
      () => {
        document.getElementById("loc").textContent = "Default (Chiang Mai)";
        resolve();
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
    );
  });
}

/* ---------- Init ---------- */
async function init() {
  // Event bindings
  document.getElementById("list").addEventListener("click", e => {
    const card = e.target.closest("[data-norad]");
    if (card) openSatelliteDetail(card.dataset.norad);
  });
  document.getElementById("catalog-list").addEventListener("click", e => {
    const fav = e.target.closest("[data-favorite]");
    if (fav) { toggleFavorite(fav.dataset.favorite); return; }
    const card = e.target.closest("[data-norad]");
    if (card) openSatelliteDetail(card.dataset.norad);
  });
  document.getElementById("detail-body").addEventListener("click", e => {
    const fav = e.target.closest("[data-profile-favorite]");
    if (fav) toggleFavorite(fav.dataset.profileFavorite);
  });
  document.getElementById("catalog-sort").addEventListener("change", () => { catalogPage = 0; renderCatalog(); });
  document.getElementById("btn-favorites").addEventListener("click", e => {
    favoritesOnly = !favoritesOnly;
    e.currentTarget.setAttribute("aria-pressed", String(favoritesOnly));
    e.currentTarget.textContent = favoritesOnly ? "★ Showing favourites" : "☆ Favourites only";
    catalogPage = 0; renderCatalog();
  });
  document.getElementById("btn-more").addEventListener("click", () => { catalogPage++; renderCatalog(); });
  document.getElementById("btn-full-catalog").addEventListener("click", async e => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Loading full catalogue…";
    const ok = await tryLive(true);
    e.currentTarget.disabled = false; e.currentTarget.textContent = "Load full active catalogue";
    if (!ok) setStatus("Full catalogue could not be loaded. Check network access and try again.", "warn");
  });
  document.getElementById("detail-close").addEventListener("click", closeSatelliteDetail);
  document.getElementById("detail-modal").addEventListener("click", e => { if (e.target.dataset.close) closeSatelliteDetail(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSatelliteDetail(); });
  document.getElementById("search").addEventListener("input", e => {
    searchQ = e.target.value.trim();
    refreshVisible();
  });
  document.getElementById("type-filter").addEventListener("change", e => {
    filterType = e.target.value;
    refreshVisible();
  });
  document.getElementById("el-filter").addEventListener("input", e => {
    minEl = Number(e.target.value);
    document.getElementById("el-val").textContent = minEl + "°";
    refreshVisible();
  });
  document.getElementById("btn-refresh").addEventListener("click", async () => {
    await getLoc();
    refreshVisible();
    updatePasses();
  });
  document.getElementById("btn-live").addEventListener("click", async () => {
    const b = document.getElementById("btn-live"); b.disabled = true; b.textContent = "Loading live data…";
    const ok = await tryLive();
    b.disabled = false; b.textContent = "Try live data";
    if (!ok) setStatus("Live fetch failed – still using current catalogue. CelesTrak may be blocked by network/CORS or unavailable.", "warn");
  });

  await getLoc();

  // Reliable start: bundled core first, then try improve with cache/live
  await loadBundled();
  // Best-effort improvements (non-blocking)
  tryCache().then(ok => { if (ok) refreshVisible(); });
  // Live is available via the button


  updateTimer = setInterval(() => {
    refreshVisible();
  }, 5000);

  // canvas size
  const sky = document.getElementById("sky");
  function size() {
    const s = Math.min(sky.parentElement.clientWidth - 12, 340);
    sky.width = s; sky.height = s;
    renderSky();
  }
  window.addEventListener("resize", size);
  size();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
document.addEventListener("DOMContentLoaded", init);
