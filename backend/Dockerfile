FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install dependencies via uv sync (uses lockfile for reproducible builds)
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

# Copy backend code
COPY backend/ ./backend/

# Copy static files so FastAPI can serve them in dev mode
COPY index.html main.js style.css ./
COPY assets/ ./assets/

RUN mkdir -p /app/data

CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
