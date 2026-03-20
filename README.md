![Sentinel logo](frontend/assets/logo-readme.png)

Interactive dark-themed situational awareness OS for the UK and surrounding airspace, built with [MapLibre GL JS](https://maplibre.org/) and [PMTiles](https://protomaps.com/docs/pmtiles).

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
                           ├── GET  /api/settings
                           ├── GET  /api/settings/{namespace}
                           ├── PUT  /api/settings/{namespace}/{key}
                           ├── GET  /api/space/status  (stub — not called by frontend)
                           ├── GET  /api/sea/status    (stub — not called by frontend)
                           └── GET  /api/land/status   (stub — not called by frontend)
```

### Backend (`backend/`)

FastAPI application with SQLite caching.

| File | Purpose |
|------|---------|
| `main.py` | App factory, router mounts, `/health` endpoint, static file serving |
| `config.py` | Settings via `pydantic-settings` (TTLs, upstream URLs, DB path) |
| `database.py` | Async SQLAlchemy engine + session factory (aiosqlite) |
| `models.py` | `AdsbCache`, `GeocodeCache`, `AirMessage`, `AirTracking`, `UserSettings` ORM models |
| `cache.py` | TTL helpers (`is_fresh`, `is_within_stale`) |
| `routers/air.py` | ADS-B proxy, reverse geocode proxy, messages, tracking |
| `routers/settings.py` | User settings persistence (read/write `user_settings` table) |
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

#### User settings

User preferences are persisted to the `user_settings` SQLite table across browser sessions. Settings are keyed by `(namespace, key)` — one row per setting — and values are stored as JSON strings, supporting booleans, strings, and objects.

| Namespace | Purpose |
|-----------|---------|
| `app` | Application-wide prefs — currently `theme` (`"light"` / `"dark"`) |
| `air` | Air domain prefs — e.g. `overlayStates` (object of toggle booleans) |
| `space`, `sea`, `land`, `sdr` | Reserved for future domain settings |

`GET /api/settings` returns all settings grouped by namespace as `{ namespace: { key: value } }`. `GET /api/settings/{namespace}` returns a single namespace. `PUT /api/settings/{namespace}/{key}` upserts a value with body `{ "value": <any> }`.

The frontend (`window._SettingsAPI`) calls these endpoints fire-and-forget — backend errors are logged to the console but never interrupt the UI.

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
| Map tiles (online) | [OpenFreeMap](https://openfreemap.org) vector tiles |
| Map tiles (offline) | Locally bundled PMTiles (`uk.pmtiles`, `surroundings.pmtiles`) |
| World overview tiles | Natural Earth raster tiles downloaded via `download-world-tiles.py` |
| Airports, Military bases, AARA, AWACS | Hardcoded GeoJSON in `main.js` |

Offline tiles cover approximately 20°W–32°E, 44°N–67°N.

---

## Downloading World Overview Tiles

SENTINEL uses Natural Earth raster tiles (zoom 0–6) as a world-overview background layer. These are not bundled in the repo and must be downloaded separately before running offline.

```bash
python3 download-world-tiles.py
```

This downloads **5,461 PNG tiles** from [OpenFreeMap](https://openfreemap.org) (Natural Earth 2 with shading/relief) and saves them to `assets/tiles/world/{z}/{x}/{y}.png`.

- Skips tiles that already exist — safe to re-run if interrupted
- Uses 6 parallel workers
- Prints progress every 200 tiles

**You only need to run this once.** The tiles are static and do not change.

> Requires Python 3 (stdlib only — no pip installs needed).

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

## Testing

The test suite uses [Jest](https://jestjs.io/) with [ts-jest](https://kulshekhar.github.io/ts-jest/) (TypeScript transpilation) and [jest-environment-jsdom](https://jestjs.io/docs/configuration#testenvironment-string) (browser-like DOM environment).

### Prerequisites

Node.js v18+ must be installed (see Frontend TypeScript → Prerequisites above).
Run `npm install` once to install all dev dependencies including Jest.

### Run all tests

```bash
npm test
```

### Run tests with coverage report

```bash
npm run test:coverage
```

### Test files

Tests are split into two subdirectories:

```
tests/
├── frontend/   — TypeScript / DOM logic (Jest + jsdom)
└── backend/    — FastAPI endpoints and helpers (pytest — coming soon)
```

#### `tests/frontend/`

| File | What it tests |
|------|---------------|
| `tests/frontend/geometry-helpers.test.ts` | `generateGeodesicCircle`, `buildRingsGeoJSON`, `computeCentroid`, `computeTextRotate`, `computeLongestEdge`, `RING_DISTANCES_NM` — all pure geometry helpers from `frontend/components/shared/map/map.ts` |
| `tests/frontend/notification-helpers.test.ts` | `_formatTimestamp` (timestamp → `HH:MM LOCAL`) and `_getLabelForType` (type string → display label) from `frontend/components/shared/notifications/notifications.ts` |
| `tests/frontend/filter-search.test.ts` | `_matchesQuery` (case-insensitive substring matching) and the full search logic from `frontend/components/air/air-filter/air-filter.ts` covering aircraft, airports, and military bases |
| `tests/frontend/sentinel-control-base.test.ts` | `SentinelControlBase.onAdd`, `onRemove`, `setButtonActive`, button click delegation, and hover event visual feedback from `frontend/components/air/controls/sentinel-control-base/sentinel-control-base.ts` |
| `tests/frontend/overlay-state.test.ts` | `OVERLAY_DEFAULTS` values, `loadOverlayStates` (merge over defaults, partial saves, malformed JSON recovery), and JSON round-trips from `frontend/components/air/overlay/overlay-state.ts` |
| `tests/frontend/user-location-cache.test.ts` | GPS 5-minute cache expiry, manual-pin persistence, `shouldGpsUpdateBeBlocked`, storage payload JSON structure, and coordinate display formatting from `frontend/components/air/user-location/user-location.ts` |

#### `tests/backend/`

Backend tests (pytest) will go here.

### Configuration

| File | Purpose |
|------|---------|
| `jest.config.js` | Jest configuration — `ts-jest` preset, `jsdom` environment, `tests/**/*.test.ts` glob |
| `tsconfig.test.json` | TypeScript config for tests — `CommonJS` module output required by Jest's Node runtime |

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
