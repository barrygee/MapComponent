<img width="1891" height="1063" alt="sentinel-contour-logo-background-large" src="https://github.com/user-attachments/assets/98d0566d-fde8-42ca-bb24-9cc06ce8f882" />


# Sentinel

Sentinel is a real-time, multi-domain surveillance dashboard that tracks aircraft, satellites, and the radio spectrum on a single interactive map. A **FastAPI** backend serves a **Vue 3** single-page app that renders live data on **MapLibre GL** maps.

It is built **offline-first**: each domain has online and offline data sources with automatic failover, and offline vector map tiles (**PMTiles**) mean the map keeps working when the internet doesn't.

---

## Domains

| Domain | Status | What it does |
|---|---|---|
| **AIR** | ✅ Live | Real-time ADS-B aircraft tracking, flight replay, military/civil filtering, airports & airspace overlays |
| **SPACE** | ✅ Live | SGP4 satellite propagation, ground tracks & footprints, pass prediction, day/night terminator, TLE management, satellite-radio auto-tune |
| **SDR** | ✅ Live | Live RTL-SDR spectrum + waterfall over `rtl_tcp`, tuning, audio demod, frequency groups, frequency search, recordings |
| **SEA** | 🚧 Stub | Routing/settings scaffolding only — no data integration yet |
| **LAND** | 🚧 Stub | Routing/settings scaffolding only — no data integration yet |

### AIR
ADS-B aircraft from the [airplanes.live](https://airplanes.live) API are proxied through the backend and cached in SQLite (10 s fresh TTL, 60 s stale window) to limit upstream load. Aircraft render as oriented icons; clicking one opens a detail panel and lets you track it. Map controls add airports (with frequencies), military bases, AWACS lobes, range rings, roads, an overhead-alert zone, and live labels.

Optional **Off Grid** mode decodes 1090 MHz from one of your own SDRs instead, via a separate readsb `adsb-decoder` container — Sentinel claims the dongle and tunes it while AIR is open. See [Off Grid ADS-B](#off-grid-ads-b-optional).

Optional **flight replay** (off by default, behind `air.replayEnabled`) records periodic snapshots into SQLite so past flights can be browsed by date and replayed on the map.

### SPACE
Satellites are propagated from TLE data using **SGP4**. The default view tracks the ISS; any catalogued satellite can be selected by NORAD ID to show its current position, multi-orbit ground track, and visibility footprint. Pass prediction lists upcoming passes over your location, with heads-up notifications and optional **auto-tune** that drives the SDR to a satellite's downlink frequency during a pass. A day/night terminator overlay and full **TLE database management** (fetch from Celestrak, upload `.txt`, categorise, clear) are built in.

### SDR
Each configured radio connects to a remote **`rtl_tcp`** daemon. The backend runs one IQ broadcaster per radio and fans computed FFT frames out to all subscribed WebSocket clients, which render a live **spectrum + waterfall**. You can tune, set bandwidth/gain, demodulate audio, organise frequencies into colour-coded groups, run a frequency **search** across ranges, overlay a band plan, and **record** audio (WAV) and raw IQ clips for later playback. An optional **digital decode** mode (P25/DMR/NXDN/D-STAR/YSF via a separate `dsd-fme` container) surfaces decoded call metadata and voice — see [Digital decoding](#digital-decoding-optional). An optional **APRS decode** mode (via a separate Direwolf `aprs-decoder` container) plots received stations on the Land map and lists packets below the waterfall — see [APRS decoding](#aprs-decoding-optional). A third sidecar decodes **ADS-B** for the AIR map's Off Grid mode — see [Off Grid ADS-B](#off-grid-ads-b-optional). All three can run concurrently, but each needs **its own dongle**: a receiver serves one tuned purpose at a time, and Sentinel takes an enforced lease on the one it is using.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2.0 (async), aiosqlite |
| Frontend | Vue 3 + TypeScript, Pinia, Vue Router, Vite |
| Maps | MapLibre GL JS, PMTiles (offline vector tiles) |
| Spectrum | sigplot (waterfall), NumPy (FFT) |
| Satellites | sgp4 (TLE propagation), Celestrak feeds |
| SDR | `rtl_tcp` over raw asyncio TCP, WebSocket streaming |
| Database | SQLite (aiosqlite) |
| Packaging | uv (Python), Docker / Docker Compose |

---

## Architecture

FastAPI is the only server. It exposes the JSON API and SDR WebSockets, serves the static map assets, and serves the built Vue SPA, falling back to the SPA's `index.html` so Vue Router can handle client-side routes.

```
Browser ──┬─► /api/**            → domain routers (air, space, settings, sdr)
          ├─► /ws/sdr/{id}[/iq]  → SDR spectrum / raw-IQ WebSocket stream
          ├─► /assets/**         → map tiles, PMTiles, sprites, fonts
          ├─► /spa-assets/**     → hashed Vue JS/CSS bundle
          └─► /{any}             → SPA index.html (Vue Router)
```

**Connectivity model.** Each domain has online + offline data-source slots. A global `connectivityMode` (online/offline) plus a per-domain `sourceOverride` (auto/online/offline) decide which is active; a probe URL is polled to auto-switch on connectivity loss.

**Caching.** Upstream responses are write-through cached in SQLite with a *fresh* TTL and a longer *stale* window — stale data is served if the upstream is unreachable. ADS-B responses carry an `X-Cache: HIT|MISS|STALE` header.

**Persistence.** SQLite via SQLAlchemy async. The schema is created from the ORM models on startup, and defaults plus SDR/satellite reference data are seeded from `backend/data/*.json`. User preferences live in `user_settings` as `namespace / key / JSON-value` triples.

### Project layout

```
Sentinel/
├── backend/                  FastAPI application (uv-managed)
│   ├── main.py               App, lifespan, static mounts, SPA catch-all
│   ├── config.py             Pydantic settings (TTLs, upstream URLs)
│   ├── database.py           Engine, table creation, seeders, migrations
│   ├── models.py             SQLAlchemy ORM models
│   ├── routers/              air.py · space.py · land.py · sdr.py · sentry.py
│   │                         · adsb_source.py · settings.py
│   ├── services/             adsb · adsb_source · satellite · tle · daynight · sdr
│   │                         · sdr_data · sdr_decode · sat_radio · flight_history
│   │                         · json_store
│   │                         · sentry_client · sentry_fleet
│   ├── cache.py              Fresh/stale SQLite write-through cache helpers
│   └── data/                 Seed JSON (bandplan, frequencies, satellite/amateur radio)
│
├── frontend/
│   ├── vue/                  Vue 3 + Vite SPA (the application)
│   │   └── src/              components/<domain>/ · stores/ · router/ · services/
│   ├── assets/               Map tiles, PMTiles, sprites, fonts, logos
│   └── spa-dist/             Built SPA bundle (served by the backend; committed)
│
├── decoder/                  Opt-in sidecars, each behind its own compose profile
│   ├── entrypoint.py         Digital voice (dsd-fme)        — profile: decoder
│   ├── aprs/                 APRS packet (Direwolf)         — profile: aprs
│   └── adsb/                 1090 MHz ADS-B (readsb)        — profile: adsb
│
├── tests/                    pytest (backend) + Playwright (full-stack e2e)
├── docs/adr/                 Architecture decision records
├── docker-compose.yml        App service + the three decoder sidecars (host :8080)
└── backend/Dockerfile        Multi-stage build (SPA + backend)
```

---

## Getting started

### Run with Docker (simplest)

```bash
docker compose up --build      # app on http://localhost:8080
```

The multi-stage build compiles the Vue SPA and packages the backend. The SQLite database is created and seeded on first run and persisted in the `sentinel_db` volume. You only need `--build` again when dependencies change.

### Local development (hot reload)

Two terminals. The Vite dev server proxies `/api`, `/ws`, and `/assets` to the backend on port **8080**, so run the backend there:

```bash
# Terminal 1 — backend on :8080 (Docker, code volume-mounted with --reload)
docker compose up
#   …or without Docker, from the repo root:
#   cd backend && uv sync
#   uv run --project backend uvicorn backend.main:app --reload --port 8080

# Terminal 2 — Vite dev server with hot module reload
cd frontend/vue
npm install
npm run dev                    # open http://localhost:5173
```

Backend edits hot-reload via `uvicorn --reload`; Vue edits via Vite HMR.

### Building the SPA for deployment

```bash
cd frontend/vue
npm run build                  # outputs to ../../frontend/spa-dist (committed, served by the backend)
```

> Outside the Vite dev server, the backend serves the **pre-built** bundle from `frontend/spa-dist/`. Rebuild (and commit) it when shipping a frontend change — a hard browser refresh then picks it up; no backend restart needed.

Once running, open **Settings** (gear icon, bottom-right) and set *My Location* to your latitude/longitude.

### Digital decoding (optional)

Decoding digital voice modes (P25, DMR, NXDN, D-STAR, YSF, M17, …) runs
in a **separate, opt-in `dsd-fme` container**. It is **never built by default or
in CI** because `dsd-fme` requires the patent-encumbered **`mbelib`** vocoder to
compile — building the decoder is a deliberate local action that compiles
`mbelib` on your own machine. The image is never published.

```bash
# build + run the app WITH the decoder (the --profile flag is the opt-in)
docker compose --profile decoder up -d --build     # app on :8080 + decoder sidecar

# follow the decoder as it starts dsd-fme and connects
docker compose --profile decoder logs -f decoder

# then, in the SDR view: start a radio, tune a digital channel, click DIGITAL.
# Decoded call metadata appears in the decode panel and voice audio plays.

# revert to app-only (decoder never starts without the profile):
docker compose --profile decoder down && docker compose up -d
```

**No configuration is required.** The decoder's ingest secret is auto-generated
by the backend and shared with the decoder via a Docker volume — you do **not**
set `SENTINEL_DECODER_SECRET` (it exists only as an optional override). Your
normal `docker compose up --build` is unchanged and never builds or starts the
decoder.

Notes when trying it:

- **The first build is slow** — it compiles `mbelib` + `dsd-fme` from source in
  the decoder image (several minutes, needs internet). Later runs are cached.
- **You need a real digital signal.** With no DMR/P25/etc. transmission tuned in,
  the panel just shows "no sync" — that's expected, not a fault.
- A `401` in the decoder logs means the shared secret didn't sync: make sure the
  `app` container started first (it writes the secret), then
  `docker compose --profile decoder restart decoder`.

See [`decoder/README.md`](decoder/README.md) for the full rationale, the
hardware-AMBE-dongle alternative, and more troubleshooting.

### APRS decoding (optional)

Decoding **APRS** — the 1200-baud AFSK/AX.25 packet mode (144.800 MHz in Europe,
144.390 MHz in North America) — runs in its **own separate, opt-in
`aprs-decoder` container** built around **Direwolf**. Received stations are
**plotted on the Land map** and shown in the **panels below the waterfall**, in
the same layout as digital voice. Direwolf is plain GPL software (no
patent-encumbered vocoder), but the image is still opt-in so it is only built/run
when you want it, and **never built in CI**.

Because APRS decode is independent of digital voice, the two can run **at the
same time on two different dongles** — pass both profiles together.

```bash
# build + run the app WITH the APRS decoder (the --profile flag is the opt-in)
docker compose --profile aprs up -d --build         # app on :8080 + aprs-decoder sidecar

# concurrent digital voice + APRS on two dongles: pass both profiles
docker compose --profile decoder --profile aprs up -d --build

# follow the APRS decoder as it starts Direwolf and connects
docker compose --profile aprs logs -f aprs-decoder

# then, in the SDR view: select the radio/dongle tuned to your local APRS
# frequency and click APRS. Decoded packets appear in the panel and stations
# plot on the Land map. APRS runs in the background — it keeps feeding the map
# even while you view another radio — and resumes on restart.

# revert to app-only (the sidecar never starts without the profile):
docker compose --profile aprs down && docker compose up -d
```

**No configuration is required** — the APRS decoder reuses the same
auto-generated ingest secret as the digital decoder (shared via a Docker volume),
so your normal `docker compose up --build` is unchanged and never builds or starts
either sidecar.

Notes when trying it:

- **The Land domain must be enabled** (Settings → domains) for the Land map — and
  therefore the plotted stations — to be reachable.
- **You need a real APRS signal.** With nothing tuned in, the panel and map stay
  empty — that's expected, not a fault.
- A `401` in the decoder logs means the shared secret didn't sync: make sure the
  `app` container started first (it writes the secret), then
  `docker compose --profile aprs restart aprs-decoder`.

See [`decoder/aprs/README.md`](decoder/aprs/README.md) for the full data-flow and
troubleshooting.

### Off Grid ADS-B (optional)

By default the AIR map gets aircraft from **airplanes.live** over the internet.
**Off Grid** mode instead decodes 1090 MHz locally from one of your own SDRs, in
its **own opt-in `adsb-decoder` container** built around **readsb**.

The dongle stays on the Sentry Pi; the decoder runs beside Sentinel and reads the
raw I/Q over the network from Sentry's `rtl_tcp` port. No mainstream 1090 MHz
decoder reads `rtl_tcp` natively — they expect a local USB dongle or an
already-demodulated feed — so the sidecar strips `rtl_tcp`'s 12-byte `RTL0`
header and feeds readsb through its `ifile` input.

> **Bandwidth.** This pulls raw samples across your LAN: roughly **38 Mbps
> sustained** at 2.4 MSPS. Running a decoder *on the Pi* and sending decoded JSON
> instead would cost a few KB/s. The arrangement here is deliberate — it keeps
> every decoder in one stack — but it is the wrong trade on a constrained link.

```bash
# build + run the app WITH the ADS-B decoder (the --profile flag is the opt-in)
docker compose --profile adsb up -d --build         # app on :8080 + adsb-decoder sidecar

# rebuild only what changed, leaving the voice/APRS sidecars running
docker compose --profile adsb up -d --build app adsb-decoder

# follow the decoder as it resolves its source and starts readsb
docker compose --profile adsb logs -f adsb-decoder

# the decoded aircraft file it serves, for checking by hand
curl -s localhost:8090/data/aircraft.json | head

# revert to app-only (the sidecar never starts without the profile):
docker compose --profile adsb down && docker compose up -d
```

Then, in the UI:

1. **Settings → SDR** — add the Sentry host, entering its **console password**
   (Sentry has no API tokens; Sentinel signs in and holds a session cookie).
2. **Settings → AIR → Off Grid SDR** — pick which of that Sentry's dongles
   receives ADS-B.
3. **Settings → AIR → Off Grid Data Source** — set
   `http://adsb-decoder:8080/data/aircraft.json` (or the host's address and
   published port `8090` from outside the compose network).
4. Switch to **Off Grid** and open **AIR**.

Opening AIR off grid **claims that dongle and tunes it to 1090 MHz at 2.4 MSPS**,
renews the claim while the view is open, and releases it on the way out. The
claim is a *lease* with a TTL, so a closed tab or a crashed browser releases the
device by itself. Tuning is re-applied on every renewal, which makes it
self-healing: a replugged dongle or a Sentry restart comes back to 1090 MHz
within about thirty seconds.

While AIR holds the dongle, Sentry refuses tuning changes to it from anything
else — its own console included, which shows who has it and offers an explicit
override. Nothing else can retune the receiver out from under the map.

Notes when trying it:

- **A dongle serves one purpose at a time.** AIR and the voice/APRS decoders
  cannot share one — give each its own, or expect them to take it in turns.
- **Until you pick a source**, the decoder retries every few seconds and logs
  that none is configured. That is the correct state, not a fault.
- **If the map stays empty, the notice at the top of AIR says why** — no source
  picked, another consumer holding the device, a wrong console password, or an
  unreachable Pi. Only the second offers a *Take control* button, because it is
  the only one taking the device would fix.
- The device must be **enabled and published** on the Sentry side to appear in
  the picker.

See [`decoder/adsb/README.md`](decoder/adsb/README.md) for the data flow and
troubleshooting, and
[`docs/adr/0003-sentry-sdr-lock-and-tune.md`](docs/adr/0003-sentry-sdr-lock-and-tune.md)
for the lease design and why the source is named rather than merely pointed at.

---

## Testing & quality gates

Sentinel has three tooling contexts — the **backend** (uv/pytest/ruff), the **Vue SPA** (`frontend/vue/`: vitest/ESLint/`vue-tsc`), and **root-level tooling** (ESLint/Prettier over config files and the full-stack e2e specs). CI (`.github/workflows/ci.yml`) runs every gate below on each pull request and on pushes to `main`.

**Backend** — run from the repo **root**, passing `--project backend` so `uv` uses the backend virtualenv (the Python project's `pyproject.toml` lives in `backend/`):

```bash
uv run --project backend pytest                  # backend tests
uv run --project backend pytest tests/backend/test_routers_air.py::test_name   # single test
uv run --project backend ruff check backend      # lint (gating)
uv run --project backend ruff format --check backend   # format check (gating)
```

**Vue SPA** (`frontend/vue/`) — the application:

```bash
cd frontend/vue
npm run lint          # ESLint + Prettier --check
npm run typecheck     # vue-tsc --noEmit
npm run test:coverage # vitest — gated at 100% coverage (CI fails on any drop)
```

Every component also ships an in-process **`jest-axe`** accessibility test that runs as part of `npm run test:coverage`. Because jsdom does not compute layout, those tests cannot evaluate layout-dependent WCAG rules (colour contrast, target size). The **live accessibility audit** below covers that gap by running the real **axe-core** engine in a real browser.

#### Live accessibility audit (Playwright + axe-core)

`npm run test:e2e` (config: `frontend/vue/playwright.config.ts`, specs in `frontend/vue/e2e/`) drives the running app in Chromium, runs axe-core (WCAG 2.0/2.1/2.2 **Level AA**) over every domain view, and checks the keyboard fundamentals (skip link, route-change focus move + page title). Real-browser rendering catches what jsdom can't — colour-contrast and **target-size (2.5.8)** failures, and accessible-name gaps that only appear once CSS (`display:none` on collapsed labels) is actually applied.

One-time browser install (downloads the Playwright-bundled Chromium):

```bash
cd frontend/vue
npm ci                          # if you haven't installed deps yet
npx playwright install chromium
```

> No bundled browser? Set `PLAYWRIGHT_CHANNEL=chrome` to drive a system-installed Google Chrome instead, e.g. `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

**Self-contained run (no backend needed).** Audits the committed SPA bundle served by `vite preview` — enough for the structural audit (landmarks, headings, names/roles, focus, contrast, target size are all client-rendered). Playwright starts and stops the preview server for you:

```bash
cd frontend/vue
npm run build        # only if you've changed source since the last build
npm run test:e2e     # builds nothing itself — serves frontend/spa-dist via vite preview
npm run test:e2e:report   # open the HTML report from the last run
```

**Full live pass against the real backend (live map tiles + data).** Start the app, then point the audit at it with `A11Y_BASE_URL` (Playwright then skips its own preview server):

```bash
# 1. start the app — Docker:
docker compose up -d                       # app on http://localhost:8080
#    …or non-Docker (from the repo root):
uv run --project backend uvicorn backend.main:app --port 8080

# 2. run the audit against it (from frontend/vue):
A11Y_BASE_URL=http://localhost:8080 npm run test:e2e
```

This suite **runs in CI** (`.github/workflows/ci.yml` — the `frontend-vue` job installs Chromium and runs it after the build), so it **gates every pull request and push to `main`** alongside lint/typecheck/coverage. Run it locally before pushing UI changes to catch failures early, and pair it with a manual screen-reader pass for anything axe can't assert (a *wrong* label, an illogical focus order).

**Root tooling** — ESLint/Prettier over the repo-root TypeScript (config files and the full-stack e2e specs in `tests/e2e/`):

```bash
npm run lint          # ESLint + Prettier --check
```

Tooling in place: **ESLint + Prettier** (JS/TS/Vue) and **ruff** — including `ruff format` as the source of Python formatting — for linting/formatting; a **husky** pre-commit hook that mirrors the format/lint gates on staged files; the **vitest 100% coverage gate**; **mypy** (informational, not gating); and an automated **CHANGELOG** that regenerates from Conventional Commits on every merge to `main`. New code is expected to ship at 100% coverage. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, commit/PR conventions, and the two npm contexts.

---

## Configuration

Backend settings live in `backend/config.py` (Pydantic Settings) and can be overridden via environment variables or a `.env` file in the repo root.

| Variable | Default | Description |
|---|---|---|
| `DB_PATH` | `backend/sentinel.db` | SQLite database file path |
| `ADSB_TTL_MS` | `10000` | ADS-B cache fresh window (ms) |
| `ADSB_STALE_MS` | `60000` | ADS-B stale window — serve old data if upstream fails (ms) |
| `ADSB_UPSTREAM_BASE` | `https://api.airplanes.live/v2` | ADS-B upstream base URL |
| `TLE_TTL_MS` | `21600000` (6 h) | TLE cache fresh window |
| `TLE_STALE_MS` | `43200000` (12 h) | TLE stale window |
| `TLE_MANUAL_TTL_MS` | `2592000000` (30 d) | TTL for manually-uploaded TLE data |
| `CELESTRAK_ISS_URL` | Celestrak active-satellites TLE feed | Default TLE feed URL |

`config.py` also defines the optional **digital-decode** settings (`DECODER_*`, `SDR_RELAY_CONTROL_*`) used by the `dsd-fme` sidecar, and the **APRS-decode** settings (`APRS_DECODER_*`, `APRS_STATION_TTL_MS`) used by the Direwolf sidecar. These are auto-wired by `docker-compose.yml` — see [Digital decoding](#digital-decoding-optional) and [APRS decoding](#aprs-decoding-optional) — and normally need no manual configuration.

In Docker, set these under `environment:` in `docker-compose.yml`.

---

## API reference

Interactive docs are available at `/api/docs` (Swagger) and `/api/redoc` when the app is running. `GET /health` is a liveness probe.

### AIR — `/api/air`
| Method | Path | Description |
|---|---|---|
| GET | `/adsb/point/{lat}/{lon}/{radius}` | Aircraft within *radius* nm of a point (cached) |
| GET · POST · DELETE | `/messages` · `/messages/{id}` | List / create / dismiss notification messages |
| GET · POST · DELETE | `/tracking` · `/tracking/{hex}` | List / add / remove tracked aircraft |
| GET | `/recordings/available-dates` | Dates with recorded flight snapshots |
| GET | `/snapshots` | Aircraft snapshots for replay |
| GET · DELETE | `/flights` · `/flights/{registration}[/{flight_id}]` | Recorded flight history |

### SPACE — `/api/space`
| Method | Path | Description |
|---|---|---|
| GET | `/iss` | ISS position, ground track, footprint |
| GET | `/satellite/{norad_id}` | Position, ground track, footprint for any satellite |
| GET | `/iss/passes` · `/satellite/{norad_id}/passes` · `/passes` | Pass predictions over an observer location |
| GET | `/daynight` | Day/night terminator as GeoJSON |
| GET | `/tle/status` · `/tle/list` · `/tle/uncategorised` | TLE database summaries |
| POST | `/tle/fetch` · `/tle/manual` | Import TLEs from a URL or raw text |
| PATCH | `/tle/category` · `/tle/satellite` | Categorise / edit satellites |
| DELETE | `/tle` | Clear TLE data (`?confirm=true`) |
| GET · POST | `/radio/file` | Satellite-radio frequency data |

### SDR — `/api/sdr`
| Method | Path | Description |
|---|---|---|
| GET · POST · PUT · DELETE | `/radios[/{id}]` | Manage configured radios |
| GET · POST · PUT · DELETE | `/groups[/{id}]` · `/frequencies[/{id}]` · `/search-ranges[/{id}]` | Manage frequency groups, stored frequencies, search ranges |
| GET · POST | `/data/frequencies` · `/data/bandplan` | Bulk import/export of SDR data |
| GET · POST · PATCH · DELETE | `/recordings[...]` | List recordings; `/recordings/start` · `/recordings/stop`; rename/delete; `/recordings/{id}/file` (WAV) and `/{id}/iq` (raw IQ) download |
| POST | `/connect` · `/disconnect` | Open/close a radio's `rtl_tcp` connection |
| GET | `/status/{radio_id}` | Connection state |
| POST · GET | `/decode/ingest` · `/decode/config` · `/decode/status/{radio_id}` | `dsd-fme` decode ingest, config, and per-radio decode state |
| WS | `/ws/sdr/{radio_id}` · `/ws/sdr/{radio_id}/iq` | Spectrum frames / raw IQ stream |
| WS | `/ws/sdr/{radio_id}/decode` · `/decode/audio` | Decoded call metadata / decoded voice audio |

### Settings — `/api/settings`
| Method | Path | Description |
|---|---|---|
| GET | `/` · `/{namespace}` | All settings, or one namespace as `{key: value}` |
| PUT · DELETE | `/{namespace}/{key}` | Upsert / delete a setting |
| GET | `/config/preview` | Current settings as a downloadable config JSON |
| POST | `/config/upload` | Replace settings from an uploaded config JSON |

---

## Offline maps

Sentinel renders offline from [PMTiles](https://protomaps.com) vector archives placed in `frontend/assets/tiles/`:

| File | Coverage |
|---|---|
| `surroundings.pmtiles` | Global overview (zoom 0–6) |
| `uk.pmtiles` | Regional detail (e.g. UK, zoom 0–14) |

Install the `pmtiles` CLI (`brew install protomaps/homebrew-tap/pmtiles`) and extract a region from a Protomaps planet build:

```bash
mkdir -p frontend/assets/tiles
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles \
  frontend/assets/tiles/surroundings.pmtiles --maxzoom=6
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles \
  frontend/assets/tiles/uk.pmtiles --bbox=-8.65,49.84,1.77,60.86 --maxzoom=14
```

`--bbox` is `west,south,east,north` in decimal degrees. With the files in place, switch via **Settings → Connectivity Mode → Offline**, or let Sentinel fail over automatically when it loses connectivity.

---

## Database

SQLite tables are created automatically from the ORM models on startup:

`adsb_cache` · `tle_cache` · `satellite_catalogue` · `air_messages` · `air_tracking` · `air_aircraft` · `air_flights` · `air_snapshots` · `sdr_radios` · `sdr_frequency_groups` · `sdr_stored_frequencies` · `sdr_frequency_group_links` · `sdr_search_ranges` · `sdr_recordings` · `user_settings`

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for first-time setup, the three tooling contexts, the lint/format/test gates, the 100% coverage expectation for new code, and the commit/branch/PR conventions. In short: branch off `main`, use [Conventional Commits](https://www.conventionalcommits.org) (the changelog is generated from them), ship new code with its tests, and make the CI gates pass before opening a PR.
