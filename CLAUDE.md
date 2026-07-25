# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sentinel is a real-time, offline-capable multi-domain surveillance dashboard (Air, Space, Sea, Land, SDR): a **FastAPI** backend serving a **Vue 3 SPA** that renders live data on **MapLibre GL** maps (**PMTiles** for offline tiles). The real frontend is the Vue SPA in `frontend/vue/`. `README.md` is current — it covers user-facing setup/features; this file covers working-on-the-code details.

## Develop & deploy

**Dev loop (hot reload — use this for frontend work).** Two terminals:
```bash
# 1. backend on :8080 (the port Vite's proxy expects — see frontend/vue/vite.config.ts)
docker compose up                 # dockerized backend, code volume-mounted, on :8080
#   …or local, no Docker (from repo root):  uv run --project backend uvicorn backend.main:app --reload --port 8080

# 2. Vite dev server with Vue HMR — open http://localhost:5173
cd frontend/vue && npm run dev    # proxies /api, /ws, /assets to :8080
```
Backend changes hot-reload via `uvicorn --reload`; Vue changes via Vite HMR. No rebuilds.

**Deploy.** One command builds everything (multi-stage: compiles the SPA, packages the backend):
```bash
docker compose up --build -d      # app on http://localhost:8080
```
You only need `--build` when **dependencies** change (`pyproject.toml` / `package.json`). For plain code changes the volume mounts pick up backend edits live, and `cd frontend/vue && npm run build` regenerates the served `frontend/spa-dist/` (hard-reload the browser — no Docker restart).

Note: `frontend/spa-dist/` (the built bundle) **is committed** and is what the backend serves in production — rebuild and commit it when shipping a frontend change.

## Test & lint
Run backend commands from the repo **root** (tests need `pythonpath=.`), and pass `--project backend` so uv uses the backend venv — the project's `pyproject.toml` lives in `backend/`, so a bare `uv run` from the root resolves to the wrong interpreter (an unrelated `~/.venv` / system pytest). If you get `ERROR: Missing required plugins: pytest-asyncio`, that is the guard in `pytest.ini` telling you pytest is running outside the backend venv — fix the interpreter rather than installing the plugin globally.
```bash
# Backend (root)
uv run --project backend pytest                                  # all backend tests
uv run --project backend pytest tests/backend/test_routers_air.py::test_name   # single test
uv run --project backend ruff check backend                      # lint (conservative: E,F,I,UP,B) — GATING
uv run --project backend ruff format --check backend             # format check — GATING (ruff format is the Python formatter)
uv run --project backend mypy backend                            # informational only, NOT gating (~90 known errors)

# Vue SPA (run from frontend/vue/) — the application
cd frontend/vue && npm run lint                                  # ESLint + Prettier --check
cd frontend/vue && npm run typecheck                             # vue-tsc --noEmit
cd frontend/vue && npm run test:coverage                         # vitest — GATED AT 100% coverage (CI fails on any drop)
cd frontend/vue && npm run test:e2e                              # Playwright + axe-core (frontend/vue/e2e/) — GATING
cd frontend/vue && npx playwright test e2e/sdr.spec.ts            # single e2e spec
cd frontend/vue && npm run test:e2e:report                       # open the last HTML report

# Root tooling
npm run lint                                                     # ESLint + Prettier over root config files + tests/e2e specs
npm run typecheck                                                # tsc --noEmit over the same surface (root tsconfig.json)
```
All of the above run in CI (`.github/workflows/ci.yml`) on every PR and push to `main`; ruff check + `ruff format --check` + pytest (backend), ESLint/Prettier + vue-tsc + vitest@100% + Vite build + **Playwright/axe e2e** (SPA), and ESLint/Prettier + `tsc` (root) are gating.

**Don't forget the e2e suite.** `npm run test:coverage` passing is NOT enough to know CI will be green — the `frontend-vue / a11y (Playwright + axe-core)` job is a separate gate, and UI restructuring (renaming a rail tab, moving a section between a pane and an accordion, adding an ARIA live region) breaks it while every vitest spec still passes. Run `npm run test:e2e` before pushing any UI change. Two gotchas that cost real time: Playwright's **strict mode** fails a bare locator that matches more than one element, so adding a second `[role="status"]` region breaks an unrelated shell spec — use `.first()` when the intent is "at least one"; and the suite serves the **committed** `frontend/spa-dist/` bundle via `npm run preview`, so `npm run build` first or you are testing stale code. mypy is not. A **husky** pre-commit hook (`.husky/pre-commit` + `.lintstagedrc.json`) mirrors the format/lint gates on staged files across both npm contexts. `CHANGELOG.md` is regenerated automatically from Conventional Commits on every push to `main` (`.github/workflows/changelog.yml`, git-cliff), and committed back to `main` with `[skip ci]` — it never touches feature branches, so local checkouts don't diverge. Don't hand-edit it. See `CONTRIBUTING.md` for the full contributor workflow and conventions; new code is expected to ship at 100% frontend coverage.

## Two npm contexts — don't confuse them
- **`frontend/vue/`** — the real app (Vite + Vue 3 + Pinia + vue-router); tested with **vitest** (100% coverage gate) + ESLint/Prettier + `vue-tsc`, **plus the Playwright/axe e2e suite in `frontend/vue/e2e/`**.
- **Repo-root `package.json`** — root-level tooling only: ESLint/Prettier over config files + the full-stack e2e specs in `tests/e2e/`, plus husky/lint-staged. Not the app build.

## Two SEPARATE e2e suites — check both
There are two, in different directories, run by different tooling. Finding one and assuming it is the only one is a live trap:
- **`frontend/vue/e2e/`** — the big one (10 spec files, ~93 tests: shell, sdr, air, space, sidebar, settings, notifications, connectivity, scaffolding, a11y). Playwright + `@axe-core/playwright`, config `frontend/vue/playwright.config.ts`, run via `npm run test:e2e` from `frontend/vue/`. **This is the gating CI job**, and it is where UI-structure assertions live (rail tab ids and counts, `aria-controls` targets, live regions).
- **`tests/e2e/`** — one full-stack smoke spec, config `playwright.fullstack.config.ts` at the repo root, driven by the root `package.json`.

## Architecture

**Serving model (`backend/main.py`).** FastAPI is the only server. Route order: `/api/**` (routers `air`, `space`, `settings`, `sdr`) → `/ws/sdr/{id}` → `/assets/**` (tiles/sprites/fonts) → `/spa-assets/**` + `/fonts/**` (hashed Vue bundle) → `/{full_path:path}` catch-all serving SPA `index.html` (`no-cache`, so it never pins a stale bundle) for vue-router. `lifespan` creates tables, runs migrations/seeders, starts a 24h cleanup loop, and **chains SIGTERM/SIGINT** to wake SDR WS queues before uvicorn shuts down — without it, long-lived SDR WS tasks deadlock `--reload`. Don't remove that.

**Domains.** `air` (ADS-B), `space` (SGP4 + day/night terminator), `sdr` (RTL-SDR spectrum) are implemented; `sea`/`land` are scaffolding only. vue-router gates routes by `appStore.enabledDomains`.

**Connectivity.** Each domain has online + offline source slots; a global `connectivityMode` plus per-domain `sourceOverride` (auto/online/offline) select the active one. `resolve_domain_urls()` in `backend/utils.py` centralises this and returns `(primary, fallback)`.

**Caching.** `backend/cache.py` (`now_ms`/`is_fresh`/`is_within_stale`): SQLite write-through with a fresh TTL and a longer stale window (serve old data if upstream fails). ADS-B returns `X-Cache: HIT|MISS|STALE`. TTLs in `backend/config.py` (Pydantic Settings, env/`.env` overridable).

**Persistence.** SQLite + SQLAlchemy 2.0 async. Schema built from ORM models on startup; defaults and SDR band-plan/frequency/satellite-radio data seeded from `backend/data/*.json`. Prefs live in `user_settings` as `namespace/key/JSON-value`. Tests use an in-memory StaticPool engine, override `get_db`, and skip lifespan (`conftest.py`).

**SDR pipeline (`backend/services/sdr.py`).** Each radio connects to a remote `rtl_tcp` over raw asyncio TCP. **One broadcaster task per radio** reads IQ and fans FFT frames to all subscribed WS queues — avoids the `readexactly()` concurrent-reader error. Reads are sized **by time (~40ms ≈ 25fps)**, not sample count, so frame rate is stable when bandwidth changes. `rtl_tcp` cmd frame = 5 bytes `[cmd][big-endian uint32]`. FFT size clamped 1024–32768 (read the comments before changing).

**Frontend (`frontend/vue/src/`).** Pinia `stores/` hold domain + cross-cutting state; `_persist.ts` backs selected state with localStorage, reconciled against the backend on load. **State that must survive teleport remounts (pane/tab selection) belongs in the store, not component refs.** Map features are class-based MapLibre `IControl`s under `components/<domain>/controls/<feature>/` extending a shared base — add features as controls, not inline in the view.

## Conventions
- **Always work on a feature branch — never commit directly to `main`.** Before starting any new feature, fix, or edit (frontend, backend, or project config), create a branch off `main` (e.g. `feat/sdr-recording`, `fix/adsb-filter`, `chore/update-deps`). One branch per logical change; open a PR to merge back. This applies to every change, however small.
- Run all `uv` commands from the **repo root** with `--project backend` (see Test & lint for why).
- ruff lint is intentionally minimal (`E,F,I,UP,B`); `ruff format` IS gating; mypy is informational, not CI-gating.
- Frontend coverage is gated at **100%** (`frontend/vue/vitest.config.ts`) — new SPA code ships with tests that keep every threshold at 100, and every component ships a `jest-axe` accessibility test. Use `/* v8 ignore start … stop */` (not the single-line `next` form, which this vitest setup ignores) for genuinely unreachable defensive branches, with a reason.
- Conventional Commits are load-bearing: `CHANGELOG.md` is generated from them — don't hand-edit it. Branch off `main`; never commit to `main`. See `CONTRIBUTING.md`.
