/**
 * SatSky – Satellite data layer
 * Reliable offline core + best-effort live refresh from Celestrak
 */

const BUNDLED = [
  {
    name: "ISS (ZARYA)",
    norad: 25544,
    tle1: "1 25544U 98067A   26278.49823669  .00005123  00000+0  10196-3 0  9992",
    tle2: "2 25544  51.6314 114.1795 0006877 225.7345 134.3079 15.48742155588859",
    type: "Space Station"
  },
  {
    name: "HST (Hubble)",
    norad: 20580,
    tle1: "1 20580U 90037B   26294.43963075  .00006976  00000-0  21165-3 0  9990",
    tle2: "2 20580  28.4737 296.8482 0002157 118.8821 241.1992 15.32029375807944",
    type: "Science"
  }
];

// Additional high-interest objects with carefully formed elements for demo reliability.
// In production these would be refreshed from a proper GP source.
// Deliberately do not invent orbital elements for catalog objects. The offline
// catalog contains only the two seed records above; use live CelesTrak data for breadth.
const EXTRA = [];

window.BUNDLED_CATALOG = BUNDLED.slice();

// Live group definitions
window.CELESTRAK_GROUPS = {
  stations: { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle", type: "Space Station" },
  visual:   { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",   type: "Bright" },
  gps:      { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle",  type: "Navigation" },
  science:  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle", type: "Science" },
  weather:  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle", type: "Weather" },
  amateur:  { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle", type: "Amateur" },
  starlink: { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle", type: "Starlink", large: true },
  active:   { url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",   type: "Active", large: true }
};

function parseTLE(text, defaultType) {
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let name = "Unknown";
    if (!lines[i].startsWith("1 ") && !lines[i].startsWith("2 ")) {
      name = lines[i].replace(/^0 /, "").trim();
      i++;
    }
    if (i >= lines.length || !lines[i].startsWith("1 ")) { i++; continue; }
    const tle1 = lines[i++];
    if (i >= lines.length || !lines[i].startsWith("2 ")) continue;
    const tle2 = lines[i++];
    let norad = parseInt(tle1.substring(2, 7), 10) || 0;
    out.push({ name: name || `NORAD ${norad}`, norad, tle1, tle2, type: defaultType || "Satellite" });
  }
  return out;
}

window.SAT_DATA = {
  BUNDLED: window.BUNDLED_CATALOG,
  parseTLE,
  groups: window.CELESTRAK_GROUPS
};
