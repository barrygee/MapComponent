# ── Stage 1: Build Vue SPA ────────────────────────────────────────────────────
FROM node:24-alpine AS spa-builder
WORKDIR /repo/frontend/vue
COPY frontend/vue/package.json frontend/vue/package-lock.json ./
RUN npm ci
COPY frontend/vue/ ./
# template.css is imported via ../../../../frontend/assets/template.css
COPY frontend/assets/ /repo/frontend/assets/
# outDir is ../../frontend/spa-dist — resolves to /repo/frontend/spa-dist
RUN npm run build

# ── Stage 2: Python backend ───────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_HTTP_TIMEOUT=120

COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --no-install-project

COPY backend/ ./backend/
COPY frontend/assets/ ./frontend/assets/
COPY --from=spa-builder /repo/frontend/spa-dist/ ./frontend/spa-dist/

RUN mkdir -p /app/data

CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
