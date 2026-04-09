![Sentinel logo](frontend/assets/logo.svg)

Sentinel is a real-time multi-domain surveillance dashboard for tracking activity across Air, Space, Sea, Land, and SDR domains. It combines a FastAPI backend with a MapLibre GL browser client to display live data on interactive maps.

The application is designed for offline-first operation: every domain supports configurable online and offline data sources, with automatic fallback when connectivity changes. A global connectivity mode and per-domain source overrides allow fine-grained control.

---

## Quick Start

**Docker (recommended)**

```bash
git clone <repo-url> Sentinel
cd Sentinel
docker compose up --build
```

Open `http://localhost`. The database is created and seeded with defaults on first run.

**Local development**

```bash
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -e "backend[dev]"
uvicorn backend.main:app --reload --port 8000
```

App: `http://localhost:8000` — Swagger UI: `http://localhost:8000/docs`

Once running, open **Settings** (gear icon, bottom-right) and set *My Location* to your latitude/longitude.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12+, FastAPI, SQLAlchemy (async), aiosqlite |
| Frontend | TypeScript, Vanilla JS (compiled), Jinja2 templates |
| Maps | MapLibre GL JS, PMTiles (offline vector tiles) |
| Database | SQLite via aiosqlite |
| Satellite | sgp4 (TLE propagation), Celestrak TLE feeds |
| Reverse proxy | nginx (Docker deployment) |

---

## Architecture

### Directory Layout

```
Sentinel/
├── backend/                 FastAPI application
│   ├── main.py              App factory, lifespan, page routes
│   ├── config.py            Pydantic settings (TTLs, upstream URLs)
│   ├── database.py          SQLAlchemy engine, session factory, seed data
│   ├── models.py            ORM models (AdsbCache, TleCache, UserSettings …)
│   ├── cache.py             TTL helpers (now_ms, is_fresh, is_within_stale)
│   ├── utils.py             resolve_domain_urls — online/offline URL logic
│   ├── routers/
│   │   ├── air.py           ADS-B proxy, messages, tracking
│   │   ├── space.py         ISS, day/night, TLE management
│   │   ├── settings.py      User preferences (namespace/key/value store)
│   │   ├── sea.py           Stub (not yet implemented)
│   │   └── land.py          Stub (not yet implemented)
│   └── services/
│       ├── adsb.py          httpx client → airplanes.live
│       ├── satellite.py     TLE parsing, satellite catalogue management
│       ├── tle.py           TLE cache fetch and refresh logic
│       └── daynight.py      Day/night terminator calculation
│
├── frontend/
│   ├── templates/           Jinja2 HTML templates (extend base.html)
│   │   ├── base.html        Shared nav, footer, script/CSS includes
│   │   ├── air/index.html
│   │   ├── space/index.html
│   │   └── docs/index.html
│   ├── assets/              Static assets (MapLibre, PMTiles, fonts, sprites)
│   └── components/
│       ├── shared/          Shared UI components (settings, map, notifications…)
│       ├── air/             AIR-domain components (adsb controls, overlay, init)
│       ├── space/           SPACE-domain components
│       └── docs/            Docs page CSS + JS
│
├── docker-compose.yml       nginx + FastAPI services
├── Dockerfile               FastAPI container
└── nginx.conf               Reverse proxy config
```

### Request Flow

All HTTP traffic enters via nginx (port 80/443 in Docker) which proxies to uvicorn on port 8000. Static assets are served directly by nginx from the `/frontend/assets` and `/frontend/components` directories. Page requests hit FastAPI which renders Jinja2 templates. API requests are handled by domain routers.

```
Browser → nginx → uvicorn (FastAPI)
                  ↓
            Page route → Jinja2 template → HTML
            API route  → Router handler → JSON
            /assets    → StaticFiles mount
```

### Database

SQLite is used for all persistence. Tables are created automatically on startup via `create_tables()`. Default settings are seeded on first run via `seed_default_settings()`.

| Table | Purpose |
|---|---|
| `adsb_cache` | Write-through cache for ADS-B API responses (keyed by lat/lon/radius) |
| `tle_cache` | Cached TLE elements from Celestrak or manual uploads |
| `satellite_catalogue` | Permanent satellite identity records (name, NORAD ID, category) |
| `air_messages` | Notification messages (emergencies, squawks, system alerts) |
| `air_tracking` | Currently tracked aircraft (ICAO hex, callsign, follow mode) |
| `user_settings` | User preferences stored as namespace / key / JSON-value triples |

### Connectivity Model

Each domain has two data source slots — online and offline. A global `connectivityMode` setting (online/offline) selects which slot is active. Individual domains can override this with a per-domain `sourceOverride` (auto / online / offline). `resolve_domain_urls()` in `utils.py` encapsulates this logic and returns the effective *(primary_url, fallback_url)* pair for any request.

---

## Domains

### AIR

Real-time ADS-B aircraft tracking powered by the [airplanes.live](https://airplanes.live) API. The backend proxies requests to the upstream and caches responses in SQLite to reduce upstream calls (5 s TTL, 30 s stale window).

Aircraft are rendered as icons on a MapLibre map. Clicking an aircraft opens a detail panel with callsign, altitude, speed, and heading. Aircraft can be added to the tracking list which persists across sessions.

Notification messages (emergencies, special squawks) are stored in `air_messages` and displayed in the notification panel.

### SPACE

Satellite tracking using SGP4 propagation from Two-Line Element (TLE) data. The ISS is tracked by default. TLE data is fetched from Celestrak and cached for 6 hours (stale window: 12 hours).

The day/night terminator is rendered as a GeoJSON overlay. TLE data can be managed via the Settings panel: fetch from a URL, upload a .txt file, assign categories to satellites, and clear the database.

Satellite categories: `space_station`, `amateur`, `weather`, `military`, `navigation`, `science`, `cubesat`, `active`, `unknown`.

### SEA / LAND / SDR

These domains are currently stubs — the routing, template, and settings infrastructure is in place but data source integration is not yet implemented. The source override and URL settings are available and will be respected when functionality is added.

---

## API Reference

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness probe — returns `{"status":"ok","timestamp":…}` |

### Settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | All settings grouped by namespace `{"app":{"connectivityMode":"online",…}}` |
| GET | `/api/settings/{namespace}` | Settings for one namespace as `{"key": value}` |
| PUT | `/api/settings/{namespace}/{key}` | Upsert a setting. Body: `{"value": any}` |
| GET | `/api/settings/config/preview` | Current settings as a downloadable JSON config file |

### AIR — ADS-B

| Method | Path | Description |
|---|---|---|
| GET | `/api/air/adsb/point/{lat}/{lon}/{radius}` | Aircraft within *radius* nm of a point. Cached 5 s. Returns `X-Cache: HIT\|MISS\|STALE`. |

### AIR — Messages

| Method | Path | Description |
|---|---|---|
| GET | `/api/air/messages` | List non-dismissed messages, newest first |
| POST | `/api/air/messages` | Create a message. Body: `{"msg_id","type","title","detail","ts"}`. Idempotent. |
| DELETE | `/api/air/messages/{msg_id}` | Soft-delete (dismiss) a single message |
| DELETE | `/api/air/messages` | Dismiss all messages |

### AIR — Tracking

| Method | Path | Description |
|---|---|---|
| GET | `/api/air/tracking` | List tracked aircraft, most recently added first |
| POST | `/api/air/tracking` | Track aircraft. Body: `{"hex","callsign","follow"}`. Updates if already tracked. |
| DELETE | `/api/air/tracking/{hex}` | Stop tracking an aircraft by ICAO hex |

### SPACE — Satellites & Day/Night

| Method | Path | Description |
|---|---|---|
| GET | `/api/space/iss` | Current ISS position, ground track (±2 orbits), and visibility footprint |
| GET | `/api/space/iss/passes?lat=&lon=` | Predicted ISS passes over an observer location |
| GET | `/api/space/satellite/{norad_id}` | Position, ground track, and footprint for any satellite by NORAD ID |
| GET | `/api/space/satellite/{norad_id}/passes?lat=&lon=` | Predicted passes for any satellite over an observer location |
| GET | `/api/space/daynight` | Day/night terminator as GeoJSON polygon |

### SPACE — TLE Management

| Method | Path | Description |
|---|---|---|
| GET | `/api/space/tle/status` | TLE database summary — counts, per-category last-updated times |
| GET | `/api/space/tle/list` | Full satellite catalogue ordered by name |
| GET | `/api/space/tle/uncategorised` | Satellites with no assigned category |
| POST | `/api/space/tle/fetch` | Fetch TLE data from a URL. Body: `{"url": str, "category": str\|null}` |
| POST | `/api/space/tle/manual` | Store TLE from raw text. Body: `{"text": str, "category": str\|null}` |
| PATCH | `/api/space/tle/category` | Assign categories in bulk. Body: `{"assignments": [{"norad_id": str, "category": str}]}` |
| PATCH | `/api/space/tle/satellite` | Update name/category for one satellite. Body: `{"norad_id": str, "name": str\|null, "category": str\|null}` |
| DELETE | `/api/space/tle?confirm=true` | Clear all TLE data. Requires `confirm=true` query param. |

---

## Settings

Open the Settings panel using the gear icon in the bottom-right footer. Settings are saved to the backend database and synchronised with `localStorage` for instant load on next visit. Changes in the panel are staged until you click **APPLY CHANGES**.

### App Settings

| Setting | Description |
|---|---|
| Connectivity Mode | Global toggle between *online* and *offline* data sources across all domains. |
| Connectivity Probe URL | A URL polled every 2 seconds to detect internet access. A failed fetch switches the indicator to offline. |
| My Location | Fixed latitude/longitude used as the map centre and for range queries. Dispatches a `sentinel:setUserLocation` event on change. |

### Domain Settings (AIR / SEA / LAND)

| Setting | Description |
|---|---|
| Source Override | *Auto* — follow app-level connectivity mode. *Online* or *Offline* — force a specific source regardless of app mode. |
| Online Data Source | Base URL for the live upstream data feed. |
| Offline Data Source | Base URL for a local network server (e.g. a self-hosted feed on `http://192.168.1.x:port`). |

### SPACE Settings

| Setting | Description |
|---|---|
| Online Data Source | Celestrak TLE feed URL. Select a category and click *UPDATE TLE* to fetch. |
| TLE Import | Upload a `.txt` file of TLE data (standard two-line or three-line format). |
| TLE Database | Summary of all loaded TLE data — satellite counts and per-category last-updated timestamps. Includes a *CLEAR ALL* button. |
| Uncategorised Satellites | List of satellites imported without a category. Assign categories individually or in bulk. |

### Settings Storage

| Tier | When used |
|---|---|
| localStorage | Instant read on page load — avoids a network round-trip for every render. |
| Backend (SQLite) | Persisted server-side — survives browser cache clears and syncs across devices/tabs. |
| Reconciliation | On panel open, backend values are fetched and used to fill empty local fields. |

---

## Configuration

Backend configuration is handled by Pydantic Settings in `backend/config.py`. All values can be overridden via environment variables or a `.env` file in the project root.

### Config Options

| Variable | Default | Description |
|---|---|---|
| `db_path` | `backend/sentinel.db` | Path to the SQLite database file |
| `adsb_ttl_ms` | `5000` | ADS-B cache TTL — how long a cached response is considered fresh (ms) |
| `adsb_stale_ms` | `30000` | How long a stale ADS-B response can still be served if upstream fails (ms) |
| `adsb_upstream_base` | `https://api.airplanes.live/v2` | Default ADS-B upstream base URL |
| `tle_ttl_ms` | `21600000` (6 h) | TLE cache TTL — Celestrak updates daily so 6 h is sufficient |
| `tle_stale_ms` | `43200000` (12 h) | Stale TLE window — serve old data if Celestrak is unreachable |
| `tle_manual_ttl_ms` | `2592000000` (30 d) | TTL for manually-uploaded TLE data |
| `celestrak_iss_url` | `celestrak.org/NORAD/elements/gp.php?…` | Default Celestrak TLE feed URL |

### Default Settings (seeded on first run)

| Namespace | Key | Default value |
|---|---|---|
| `app` | `connectivityProbeUrl` | `https://tile.openstreetmap.org/favicon.ico` |
| `app` | `connectivityMode` | `online` |
| `air` | `sourceOverride` | `auto` |
| `air` | `onlineUrl` | `https://api.airplanes.live/v2` |
| `space` | `sourceOverride` | `auto` |
| `space` | `onlineUrl` | Celestrak active satellites TLE feed |
| `sea` | `sourceOverride` | `auto` |
| `land` | `sourceOverride` | `auto` |

---

## Offline Maps

Sentinel uses [PMTiles](https://protomaps.com) vector tile archives for offline map rendering. Two files are required, placed in `frontend/assets/tiles/`:

| File | Coverage | Approx. size |
|---|---|---|
| `surroundings.pmtiles` | Global — zoom levels 0–6 (world overview) | ~44 MB |
| `uk.pmtiles` | United Kingdom — zoom levels 0–14 (street level) | ~1.3 GB |

### Prerequisites

Install the `pmtiles` CLI:

```bash
brew install protomaps/homebrew-tap/pmtiles
```

Or download a binary from the [go-pmtiles releases page](https://github.com/protomaps/go-pmtiles/releases).

### Downloading the Tiles

Both files are extracted from the Protomaps daily planet build. Replace `YYYYMMDD` with the current date — builds are published at `https://build.protomaps.com/YYYYMMDD.pmtiles`.

```bash
mkdir -p frontend/assets/tiles
```

**Global overview (`surroundings.pmtiles`) — ~44 MB**

Covers the entire world at zoom levels 0–6 for continent/country context when zoomed out.

```bash
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles \
  frontend/assets/tiles/surroundings.pmtiles \
  --maxzoom=6
```

**UK detail (`uk.pmtiles`) — ~1.3 GB**

Covers the United Kingdom at zoom levels 0–14 (street level). Takes 5–15 minutes depending on connection speed.

```bash
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles \
  frontend/assets/tiles/uk.pmtiles \
  --bbox=-8.65,49.84,1.77,60.86 \
  --maxzoom=14
```

The `--bbox` parameter is `west,south,east,north` in decimal degrees.

### Custom Regions

To cover a different region, adjust `--bbox` and `--maxzoom`. Common extracts at z0–z14:

| Region | Bounding box | Approx. size |
|---|---|---|
| United Kingdom | `-8.65,49.84,1.77,60.86` | ~1.3 GB |
| Ireland | `-10.56,51.39,-5.97,55.43` | ~150 MB |
| France | `-5.14,41.33,9.56,51.09` | ~3–4 GB |
| Germany | `5.87,47.27,15.04,55.06` | ~3–4 GB |
| Northern Europe | `-25.0,44.0,35.0,72.0` | ~10–15 GB |

Beyond the configured bounding box, only the global z0–z6 data from `surroundings.pmtiles` renders.

### Switching to Offline Mode

Once the tile files are in place, switch via **Settings → Connectivity Mode → Offline**, or Sentinel will switch automatically when it detects lost connectivity (probes every 2 seconds).

---

## Deployment

### Docker (recommended)

The project ships with a `docker-compose.yml` that runs nginx as a reverse proxy in front of the FastAPI container.

```bash
docker compose up --build
```

The app will be available at `http://localhost` (port 80). nginx serves static files directly and proxies all other requests to uvicorn on port 8000.

### Local Development

Run the FastAPI backend with hot-reload:

```bash
cd /path/to/Sentinel
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -e "backend[dev]"
uvicorn backend.main:app --reload --port 8000
```

The app will be available at `http://localhost:8000`. FastAPI's interactive API docs (Swagger UI) are at `http://localhost:8000/docs`.

### Frontend Build

TypeScript source files in `frontend/components/` are compiled to plain JavaScript. The compiled `.js` files are committed alongside the `.ts` sources.

```bash
# One-time build
npm run build

# Watch mode (recompiles on save)
npm run watch

# Type-check only
npm run typecheck
```

### nginx Config

`nginx.conf` proxies all requests to uvicorn. Static files under `/assets/` are served directly with long cache headers. The proxy passes standard forwarding headers (`X-Real-IP`, `X-Forwarded-For`).

### Environment Variables

All `backend/config.py` settings can be overridden at runtime via environment variables (uppercase, same name) or a `.env` file. For Docker deployments, set them in `docker-compose.yml` under the `environment:` key.

```bash
# Example .env
ADSB_UPSTREAM_BASE=https://my-custom-feed.example.com/v2
DB_PATH=/data/sentinel.db
TLE_TTL_MS=3600000
```
