# SatSky Pro — Intelligence Upgrade

A static, GitHub Pages-friendly satellite catalogue and sky-prediction app.

## Improvements in this build
- Detailed per-object profile: NORAD ID, source group/category, orbital-element epoch and age, mean motion, inclination, eccentricity, RAAN, argument of perigee, mean anomaly, approximate period and mean altitude.
- Current azimuth, elevation and slant range calculated from loaded TLEs and the observer's location.
- Pass scan handles a satellite already above the elevation threshold when scanning starts.
- External research links for CelesTrak, N2YO, NASA search, ESA search and broader mission research.
- Copyable raw TLE.
- TLE line length, satellite-ID consistency and checksum validation before accepting records.
- Deduplication by NORAD ID.
- HTML escaping for catalogue names and mission text inserted into the profile.
- Removed the misleading made-up brightness/magnitude estimate.
- Improved stale-element warning and versioned IndexedDB/service-worker caches.
- iPhone viewport no longer disables user zoom.

## Accuracy notes
- CelesTrak is the source for live GP/TLE groups. Network access and browser CORS behavior can affect loading.
- The offline seed is a fallback, not a substitute for fresh elements. Check the epoch age in each profile.
- Mean altitude and period are approximations derived from mean motion; SGP4 propagation is used for current look angles.
- Pass times are sampled every 30 seconds and are approximate, not authoritative guarantees.
- The app does not contain a complete verified mission-history database for every catalogued object. Where no curated mission note exists, it says so and supplies research links.
- No satellite optical magnitude is estimated: brightness depends on attitude, shape, phase angle, distance, illumination and other factors not available in these records.
- This is not a radio receiver or a live sensor.

## Deploy
Upload the contents of this folder to the root of your GitHub Pages repository. Keep all files together. Open the site in Safari and use Share → Add to Home Screen.

## Local test
Serve this folder over HTTP (for example `npx serve .`) rather than opening `index.html` as a `file://` URL, because geolocation, clipboard and service-worker features require a secure context.
