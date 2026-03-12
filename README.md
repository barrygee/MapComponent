# SENTINEL

Interactive dark-themed situational awareness map for the UK and surrounding airspace, built with [MapLibre GL JS](https://maplibre.org/) and [PMTiles](https://protomaps.com/docs/pmtiles).

---

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [uv](https://docs.astral.sh/uv/) (for local development without Docker)

---

## Running

### Docker (recommended)

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| App (nginx) | http://localhost:8080 |
| API (FastAPI) | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

```bash
docker compose down
```

### Local development

Install dependencies and start the API with hot-reload:

```bash
cd backend
uv sync
uv run uvicorn backend.main:app --reload --port 8000
```

The API is available at http://localhost:8000 and serves static files (index.html, main.js) directly from the project root in dev mode.

> **After adding new models**, restart uvicorn — `create_tables()` runs on startup and will create any missing tables automatically.

#### Rebuilding Docker after code changes

The backend container bakes source code in at build time, so any changes to `backend/` require a rebuild:

```bash
docker compose up --build
```

Skipping `--build` will run the previously built image and new endpoints/models will not be available.

---

## Architecture

```
nginx (:8080)          — serves static files (index.html, main.js, assets)
  └── /api/* proxy ──→ FastAPI (:8000)
                           ├── GET  /api/air/adsb/point/{lat}/{lon}/{radius}
                           ├── GET  /api/air/geocode/reverse
                           ├── GET  /api/air/messages
                           ├── POST /api/air/messages
                           ├── DELETE /api/air/messages/{msg_id}
                           ├── DELETE /api/air/messages
                           ├── GET  /api/air/tracking
                           ├── POST /api/air/tracking
                           ├── DELETE /api/air/tracking/{hex}
                           ├── GET  /api/space/status
                           ├── GET  /api/sea/status
                           └── GET  /api/land/status
```

### Backend (`backend/`)

FastAPI application with SQLite caching.

| File | Purpose |
|------|---------|
| `main.py` | App factory, router mounts, `/health` endpoint, static file serving |
| `config.py` | Settings via `pydantic-settings` (TTLs, upstream URLs, DB path) |
| `database.py` | Async SQLAlchemy engine + session factory (aiosqlite) |
| `models.py` | `AdsbCache`, `GeocodeCache`, `AirMessage`, `AirTracking` ORM models |
| `cache.py` | TTL helpers (`is_fresh`, `is_within_stale`) |
| `routers/air.py` | ADS-B proxy, reverse geocode proxy, messages, tracking |
| `routers/space.py` | Space domain stub |
| `routers/sea.py` | Sea domain stub |
| `routers/land.py` | Land domain stub |
| `services/adsb.py` | httpx fetch from airplanes.live |
| `services/geocode.py` | httpx fetch from Nominatim |

#### Caching

| Endpoint | TTL | Stale window |
|----------|-----|-------------|
| ADS-B | 5 s | 30 s (served on upstream failure) |
| Geocode | 10 min | 1 hr |

Cache status is returned in the `X-Cache` response header: `HIT`, `MISS`, or `STALE`.

#### Air messages

`POST /api/air/messages` persists a notification (emergency squawk, system alert, etc.) to SQLite. The `msg_id` is client-generated and the endpoint is idempotent — duplicate posts return `{"status": "exists"}`. `DELETE /api/air/messages/{msg_id}` soft-dismisses a single message; `DELETE /api/air/messages` clears all. `GET /api/air/messages` returns non-dismissed messages newest-first.

#### Air tracking

`POST /api/air/tracking` adds an aircraft (ICAO hex + callsign + follow flag) to the tracked set. If the hex already exists, callsign and follow are updated. `DELETE /api/air/tracking/{hex}` removes it. `GET /api/air/tracking` lists all currently tracked aircraft.

#### Adding a dependency

```bash
cd backend
uv add <package>
```

---

## Data Sources

| Data | Source |
|------|--------|
| Live aircraft (ADS-B) | [airplanes.live](https://airplanes.live) public API — 250 nm radius, polled every 1 s |
| Reverse geocoding | [Nominatim](https://nominatim.openstreetmap.org) — throttled, cached 10 min |
| Map tiles (online) | [OpenFreeMap](https://openfreemap.org) vector tiles |
| Map tiles (offline) | Locally bundled PMTiles (`uk.pmtiles`, `surroundings.pmtiles`) |
| Airports, RAF bases, AARA, AWACS | Hardcoded GeoJSON in `main.js` |

Offline tiles cover approximately 20°W–32°E, 44°N–67°N. Download with `download-world-tiles.sh` or `download-world-tiles.py`.

---

## Features

- Dark vector map with online/offline tile switching
- Live ADS-B aircraft tracking with military detection, emergency squawk alerts, and trail history
- Civil airports, RAF/USAF bases, AARA zones, AWACS orbits
- Range rings (25–300 nm) centred on user location
- GPS geolocation with reverse geocode footer label
- Notifications and aircraft tracking panel
- 3D tilt mode
- Filter panel (callsign / ICAO / squawk search, ALL / CIVIL / MIL / HIDE modes)

---

## Testing Emergency Visuals

A dev helper (`squawk-test.js`) mocks the ADS-B feed to trigger emergency states.

Load it in the browser console:

```js
const s = document.createElement('script'); s.src = '/squawk-test.js'; document.head.appendChild(s);
sqkTest.help()
```

Key commands:

```js
sqkTest.enterEmergency('7700')   // trigger emergency aircraft
sqkTest.fullFlow('7700', 8000)   // full flow: emergency → hold 8s → clear
sqkTest.allCodes()               // test 7700, 7600, 7500 simultaneously
sqkTest.restore()                // restore real ADS-B feed
```

---

## Frontend TypeScript

The frontend source is written in TypeScript (`.ts` files). TypeScript compiles directly to sibling `.js` files — no bundler is used, and `index.html` loads the compiled `.js` files unchanged.

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ (via [nvm](https://github.com/nvm-sh/nvm) recommended)

### Install

```bash
npm install
```

### Build (compile all `.ts` → `.js`)

```bash
npm run build
```

### Watch mode (recompile on save)

```bash
npm run watch
```

### Type-check only (no output)

```bash
npm run typecheck
```

> Compiled `.js` files are written next to their `.ts` source. The `frontend/components/air/controls/adsb/adsb.js` entry point is loaded by `index.html`.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Map renderer | MapLibre GL JS |
| Tile format | PMTiles |
| Frontend | TypeScript (compiled to JS) / CSS |
| Backend | FastAPI + SQLite (aiosqlite / SQLAlchemy) |
| Package manager (frontend) | npm |
| Package manager (backend) | uv |
| Server | nginx + uvicorn (Docker) |
