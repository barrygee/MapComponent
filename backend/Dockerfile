FROM python:3.12-slim
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install dependencies
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# We still COPY for production-readiness, 
# but the Compose Volume will override this during dev
COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN mkdir -p /app/data

# Default command (no --reload here to keep production safe, 
# we override this in docker-compose.yml for dev)
CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]



# NO HOT RELOAD

# FROM python:3.12-slim

# WORKDIR /app

# # Install uv
# COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# # Install dependencies via uv sync (uses lockfile for reproducible builds)
# COPY backend/pyproject.toml backend/uv.lock ./
# RUN uv sync --frozen --no-dev --no-install-project

# # Copy backend code
# COPY backend/ ./backend/

# # Copy static files so FastAPI can serve them
# COPY frontend/ ./frontend/

# RUN mkdir -p /app/data

# CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
