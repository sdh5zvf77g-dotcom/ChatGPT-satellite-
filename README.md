# SatSky — Satellite Tracker for iPhone

An installable static web app for tracking satellite positions and exploring individual satellite profiles.

## Features
- Live sky position calculations using satellite.js / SGP4
- Search by satellite name or NORAD catalog ID; filter by catalog group and elevation
- Polar sky chart, current elevation/azimuth/range, and basic pass estimates
- Tap any listed satellite for a profile: mission/purpose where curated, orbit estimates, element epoch, raw TLE, data-quality notes and links to external tracking/catalog resources
- CelesTrak live catalog refresh across stations, visual, science, weather, GPS, amateur-radio and Starlink groups
- Optional full active catalogue load for broad object discovery (thousands of records may be returned)
- Searchable catalogue of all loaded objects, not just objects currently above the horizon
- Sort by name, NORAD ID, estimated altitude or period; save favourites on device
- Expanded profile cards with current look angles, TLE epoch/data age, raw TLE, mean motion, estimated orbital metrics and source-confidence labels
- IndexedDB cache and small offline seed catalog
- iPhone Add to Home Screen support

## Important accuracy note
The offline seed intentionally contains only two seed records. Older builds included fabricated orbital elements for many named satellites; those could produce plausible-looking but incorrect positions. Those synthetic records have been removed. A broad catalog requires a successful live CelesTrak fetch or a previously cached live catalog. Orbital elements become stale, so check the element epoch in each profile and verify important observations against an authoritative source.

Mission descriptions are curated summaries, not a complete spacecraft database. Object names are heuristically classified for usability; the category is not proof of operational status or exact mission purpose. For objects without curated mission metadata, the profile explicitly gives a category-level explanation and links to external records rather than inventing specifics. The full active catalogue can be large and depends on live CelesTrak access; this static app cannot guarantee that every catalogue field is available or that all external links are online. Orbit altitude and period are approximations derived from mean motion; position quality depends on element epoch and SGP4 assumptions.

## Deploy
Upload the contents of this folder to a GitHub repository and enable GitHub Pages. Open the published page on iPhone in Safari, choose Share, then Add to Home Screen. HTTPS is required for browser geolocation and service workers.
