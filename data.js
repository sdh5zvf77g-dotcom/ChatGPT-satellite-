/**
 * SatSky Pro – Data layer
 * Principle: never ship fabricated orbital elements.
 * Offline seed contains only verified TLEs. Everything else comes from live Celestrak or cache.
 */

// Verified real TLEs only (epochs ~ Oct 2026)
const SEED = [
  {
    name: "ISS (ZARYA)",
    norad: 25544,
    tle1: "1 25544U 98067A   26278.49823669  .00005123  00000+0  10196-3 0  9992",
    tle2: "2 25544  51.6314 114.1795 0006877 225.7345 134.3079 15.48742155588859",
    type: "Space Station",
    mission: "International Space Station – crewed laboratory in low Earth orbit. Continuously occupied since 2000.",
    confidence: "verified"
  },
  {
    name: "HST (Hubble)",
    norad: 20580,
    tle1: "1 20580U 90037B   26294.43963075  .00006976  00000-0  21165-3 0  9990",
    tle2: "2 20580  28.4737 296.8482 0002157 118.8821 241.1992 15.32029375807944",
    type: "Science",
    mission: "Hubble Space Telescope – optical/UV/near-IR observatory launched 1990. Still producing science.",
    confidence: "verified"
  }
];

const GROUPS = {
  stations: { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle", type: "Space Station", label: "Space Stations" },
  visual:   { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",   type: "Bright", label: "Brightest (~100)" },
  science:  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle", type: "Science", label: "Science" },
  weather:  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle", type: "Weather", label: "Weather" },
  gps:      { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle",  type: "Navigation", label: "GPS" },
  amateur:  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle", type: "Amateur", label: "Amateur Radio" },
  starlink: { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle", type: "Starlink", label: "Starlink", large: true },
  active:   { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",   type: "Active", label: "All Active", large: true }
};

// Curated mission notes for common objects (name match or NORAD)
const MISSIONS = {
  25544: "International Space Station – crewed laboratory in low Earth orbit.",
  20580: "Hubble Space Telescope – optical/UV/near-IR observatory.",
  48274: "Chinese Space Station (Tiangong) core module Tianhe.",
  // type-level fallbacks used when no specific note exists
};

function parseTLE(text, defaultType) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let name = "Unknown";
    if (lines[i] && !lines[i].startsWith("1 ") && !lines[i].startsWith("2 ")) {
      name = lines[i].replace(/^0 /, "").trim();
      i++;
    }
    if (i >= lines.length || !lines[i].startsWith("1 ")) { i++; continue; }
    const tle1 = lines[i++];
    if (i >= lines.length || !lines[i].startsWith("2 ")) continue;
    const tle2 = lines[i++];
    const norad = parseInt(tle1.substring(2, 7), 10) || 0;
    const mission = MISSIONS[norad] || null;
    out.push({
      name: name || `NORAD ${norad}`,
      norad,
      tle1,
      tle2,
      type: defaultType || "Satellite",
      mission,
      confidence: mission ? "curated" : "catalog"
    });
  }
  return out;
}

function tleEpochDate(tle1) {
  try {
    const yy = parseInt(tle1.substring(18, 20), 10);
    const year = yy >= 57 ? 1900 + yy : 2000 + yy;
    const day = parseFloat(tle1.substring(20, 32));
    const epoch = new Date(Date.UTC(year, 0, 1));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(day) - 1);
    epoch.setUTCHours(...fractionToHMS(day % 1));
    return epoch;
  } catch (_) { return null; }
}
function tleEpochAgeHours(tle1) {
  const epoch = tleEpochDate(tle1);
  return epoch ? (Date.now() - epoch.getTime()) / 3600000 : null;
}

function fractionToHMS(frac) {
  const totalSec = frac * 86400;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return [h, m, s];
}

function meanMotionToPeriodMin(mm) {
  if (!mm || mm <= 0) return null;
  return 1440 / mm;
}

function meanMotionToApproxAltKm(mm) {
  // Rough circular-orbit approximation
  if (!mm || mm <= 0) return null;
  const mu = 398600.4418; // km^3/s^2
  const n = mm * 2 * Math.PI / 86400; // rad/s
  const a = Math.pow(mu / (n * n), 1/3);
  return a - 6371;
}

window.SAT_DATA = { SEED, GROUPS, parseTLE, tleEpochDate, tleEpochAgeHours, meanMotionToPeriodMin, meanMotionToApproxAltKm, MISSIONS };
