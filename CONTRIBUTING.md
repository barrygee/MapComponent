# Contributing to Sentinel

Thanks for working on Sentinel. This guide covers how to set up the project, the
two npm contexts you'll meet, how to run the test/lint gates, and the commit/PR
conventions. The goal is that a newcomer can go from clone to a green pull
request without tribal knowledge.

For *what the project is* and how to run it day-to-day, see the
[README](README.md). For working-on-the-code architecture notes, see
[CLAUDE.md](CLAUDE.md).

---

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | latest | Python/backend dependency + venv management |
| Python | 3.12+ | Backend (managed by uv) |
| Node.js | 20–22 (`nvm use` — see `.nvmrc`) | Frontend SPA + root helper tests; CI pins Node 22 |
| Docker + Docker Compose | latest | Containerised run/build (optional for local dev) |

You do **not** need a global Python or pytest install — always invoke Python
tooling through `uv run --project backend …` so it resolves the backend venv (see
[Two npm — and one uv — contexts](#two-npm--and-one-uv--contexts)).

**Match the CI Node version.** Both npm contexts pin Node 20–22 / npm 10 via
`engines` + an `engine-strict` `.npmrc`, and CI reads the version from `.nvmrc`.
Run `nvm use` (or `nvm install`) before `npm install` so your locally generated
`package-lock.json` matches what CI's `npm ci` expects — installing under a newer
Node/npm (e.g. Node 24+/npm 11) is rejected with `EBADENGINE` rather than
silently writing a lockfile CI can't install.

---

## First-time setup

```bash
git clone <repo-url> Sentinel
cd Sentinel

# Backend deps (creates the backend venv)
uv sync --project backend

# Frontend SPA deps + git hooks (root `prepare` installs husky)
npm install                       # root context — also runs `husky` to install hooks
npm install --prefix frontend/vue # the Vue SPA context
```

Installing the root dependencies runs the `prepare` script, which installs the
**husky** pre-commit hook. If you cloned without running `npm install`, the hook
won't be active — run `npm install` (or `npx husky`) once to enable it.

There are no secrets required to run the app. Backend config is read from the
environment / an optional root `.env` (see [Configuration in the
README](README.md#configuration)); never commit a `.env` or any secret.

---

## Two npm — and one uv — contexts

Sentinel has **three** distinct dependency/tooling contexts. Running a command in
the wrong one is the most common newcomer mistake.

| Context | Location | What it is | Tooling |
|---|---|---|---|
| **Vue SPA** | `frontend/vue/` | The real application | Vite · Vue 3 · Pinia · vue-router · **vitest** · ESLint · Prettier · `vue-tsc` |
| **Root tooling** | repo root `package.json` | Repo-root TypeScript — config files + the full-stack e2e specs in `tests/e2e/`; also hosts husky/lint-staged — **not** the app build | ESLint · Prettier · Playwright (full-stack e2e) |
| **Backend** | `backend/` (`pyproject.toml`) | FastAPI Python app, managed by uv | **pytest** · **ruff** (check + format) · mypy (informational) |

Two rules that follow from this:

- **The Vue SPA is the application.** When the task is "the frontend", you almost
  always mean `frontend/vue/`. The root `package.json` only exists for repo-root
  tooling (ESLint/Prettier, husky/lint-staged, and the full-stack e2e specs).
- **Always run `uv` from the repo root with `--project backend`.** The Python
  project's `pyproject.toml` lives in `backend/`, so a bare `uv run` from the root
  resolves the wrong interpreter. Tests also need `pythonpath=.` (set in
  `pytest.ini`), which only holds when you run from the root.

---

## Running the app

The fast feedback loop is the README's
[Local development (hot reload)](README.md#local-development-hot-reload) — backend
on `:8080`, Vite dev server on `:5173`. In short:

```bash
# Terminal 1 — backend on :8080
docker compose up
#   …or without Docker, from the repo root:
#   uv run --project backend uvicorn backend.main:app --reload --port 8080

# Terminal 2 — Vite dev server with hot module reload
cd frontend/vue && npm run dev    # http://localhost:5173
```

> The backend serves the **pre-built** SPA from `frontend/spa-dist/` (which is
> committed) outside the Vite dev server. If your change touches the frontend and
> needs to ship in the served bundle, rebuild it with
> `npm run build --prefix frontend/vue` and commit the regenerated
> `frontend/spa-dist/`. A hard browser refresh picks it up; no backend restart
> needed.

---

## Quality gates — run these before you push

CI (`.github/workflows/ci.yml`) runs the same checks on every PR and on pushes to
`main`. Run them locally first so the PR goes green on the first try. The
**husky pre-commit hook** runs lint/format on *staged* files automatically, but
it does not run the full test suites or typecheck — do that yourself.

### Backend (Python)

```bash
uv run --project backend ruff check backend         # lint (gating)
uv run --project backend ruff format --check backend # format check (gating)
uv run --project backend pytest                      # tests
```

- **`ruff format` is the single source of Python formatting truth** (adopted in
  the linting retrofit — see [`cliff.toml`](cliff.toml) / `backend/pyproject.toml`
  `[tool.ruff.format]`). CI runs `ruff format --check`; run `ruff format backend`
  to auto-fix. The ruff *lint* ruleset is intentionally conservative (`E,F,I,UP,B`).
- **mypy is informational, not gating** (~90 known SQLAlchemy-typing errors).
  `uv run --project backend mypy backend` if you want to see it.

### Vue SPA (`frontend/vue/`)

```bash
cd frontend/vue
npm run lint          # ESLint + Prettier --check (gating)
npm run typecheck     # vue-tsc --noEmit (gating)
npm run test:coverage # vitest with the 100% coverage gate (gating)
npm run build         # Vite production build (gating)
npm run test:e2e      # live axe-core a11y audit in a browser (NOT gating — see below)
```

Use `npm run lint:fix` / `npm run format` to auto-fix lint and formatting.

`npm run test:e2e` is the **live accessibility audit** (Playwright + axe-core). It
runs the real axe engine in a browser over every domain view, catching the
layout-dependent WCAG rules jsdom-based `jest-axe` can't (colour contrast,
target size). It needs a browser binary (`npx playwright install chromium`, or
`PLAYWRIGHT_CHANNEL=chrome` to use system Chrome). It **runs in CI and gates every
PR and push to `main`** (the `frontend-vue` job installs Chromium and runs it
after the build); run it locally first to catch failures early. Full
instructions, including how to audit against the live backend with
`A11Y_BASE_URL`, are in the
[README](README.md#live-accessibility-audit-playwright--axe-core).

### Root tooling (repo root)

```bash
npm run lint      # ESLint + Prettier --check (gating)
npm run typecheck # tsc --noEmit over tsconfig.json (gating)
```

The root `tsconfig.json` covers the same surface the root lint run does — the
repo-root config files plus the full-stack e2e specs in `tests/e2e/`. Keep its
`include` in step with the `lint` script's globs so a file can't be linted but
never type-checked. Nothing is emitted from this context (`noEmit`); the app
build is `build:spa`.

---

## The 100% coverage gate

**New frontend code ships with tests that bring it to 100% coverage** — this is
not aspirational, it's enforced. `frontend/vue/vitest.config.ts` sets all four
coverage thresholds (lines / functions / branches / statements) to **100**, so CI
fails on *any* drop. The whole Vue SPA is currently at 100%; adding untested code
turns the build red.

Guidance for keeping the gate green:

- **Write the tests alongside the code**, covering edge cases deliberately —
  empty/null, boundaries, invalid input, error branches — not just the happy path.
- Every component ships an **accessibility test** (`jest-axe` via
  `expect(await axe(wrapper.html())).toHaveNoViolations()`) alongside its unit
  tests — WCAG 2.2 AA is the bar, not a follow-up.
- For a **genuinely unreachable** defensive branch, use
  `/* v8 ignore start */ … /* v8 ignore stop */` with a one-line reason. (Note:
  the single-line `/* v8 ignore next */` form is **not** honoured in this vitest
  setup — only the start/stop pair works.)
- Verify a test would actually fail if the code were wrong before relying on it.

Backend code follows the same spirit (cover new code with pytest, including
negative/auth tests for security-relevant paths), though there is no numeric
backend coverage gate.

---

## Commits

Sentinel uses **[Conventional Commits](https://www.conventionalcommits.org)** —
the changelog is generated from them automatically (see below), so the format is
load-bearing, not cosmetic.

```
type(scope): short imperative subject

optional body explaining the why
```

**Types** (these map to the changelog sections in
[`cliff.toml`](cliff.toml)):

| Type | Goes to changelog as | Use for |
|---|---|---|
| `feat` | Features | a user-facing capability |
| `fix` | Bug Fixes | a bug fix |
| `perf` | Performance | a performance improvement |
| `refactor` | Refactoring | behaviour-preserving restructuring |
| `docs` | Documentation | docs only |
| `test` | Tests | adding/fixing tests |
| `build` | Build System | build/tooling/deps mechanics |
| `ci` | Continuous Integration | CI workflow changes |
| `style` | Styling | formatting-only changes |
| `chore` | Chores | misc maintenance (`chore(deps)` → Dependencies) |
| `revert` | Reverts | reverting a prior commit |

- Keep commits **atomic** — one logical change each; don't bundle an unrelated
  refactor into a feature commit.
- Write the subject in the **imperative mood** ("add", not "added"/"adds").
- For a breaking change, add `!` after the type/scope (`feat!:`) or a
  `BREAKING CHANGE:` footer.
- End AI-assisted commits with the `Co-Authored-By` trailer if you use one.

### Branches

- **Never commit directly to `main`.** Branch off the latest `main` for every
  change.
- Name branches `type/short-kebab-description`, mirroring the commit type — e.g.
  `feat/sdr-scanner`, `fix/adsb-filter-flash`, `docs/contributing`,
  `test/space-passes-coverage`.

---

## Pull requests

- **One focused change per PR.** Smaller PRs review faster and revert cleanly.
- Open the PR against `main`. Write a description with: a **summary**, the **why**,
  how you **tested** it, and any **breaking changes** or screenshots for UI work.
- **Self-review the diff first** — read it as if you were the reviewer.
- All CI gates above must pass. New code must be covered (100% on the frontend).
- **The CHANGELOG updates itself** — a GitHub Action (git-cliff,
  `.github/workflows/changelog.yml`) regenerates `CHANGELOG.md` from the repo's
  Conventional Commits **after each merge to `main`** and commits it back to
  `main`. It deliberately does **not** touch your PR branch, so your local
  checkout never falls behind a bot commit. Don't hand-edit `CHANGELOG.md`; just
  write good commit messages. (Its commit is marked `[skip ci]`, so it won't
  loop.)

---

## What's enforced where (summary)

| Gate | Pre-commit hook (staged files) | CI (every PR + push to `main`) |
|---|---|---|
| Prettier format | ✅ auto-write | ✅ `--check` |
| ESLint | ✅ `--fix` (root `tests/`) | ✅ |
| ruff check + format | ✅ `--fix` + format (backend) | ✅ check + `--check` |
| vue-tsc typecheck | — | ✅ |
| vitest (100% coverage, incl. jest-axe) | — | ✅ |
| live a11y audit (Playwright + axe-core) | — | ✅ (`frontend-vue` job) |
| pytest (backend) | — | ✅ |
| CHANGELOG regenerate | — | ✅ (changelog workflow, push to `main` only) |

The pre-commit hook is a fast mirror of the formatting/lint gates on *staged*
files only (two `lint-staged` passes — one in `frontend/vue/`, one at the root —
because each npm context has its own config). The full test, typecheck, build,
and coverage gates run in CI; run them locally before pushing to avoid a red PR.
