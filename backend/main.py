import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import create_tables
from backend.routers import air, space, sea, land


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler — runs create_tables once on startup."""
    await create_tables()
    yield  # application runs here; nothing needed on shutdown


app = FastAPI(
    title="SENTINEL API",
    version="1.0.0",
    lifespan=lifespan,
)

# Register routers for each surveillance domain
app.include_router(air.router)
app.include_router(space.router)
app.include_router(sea.router)
app.include_router(land.router)


@app.get("/health")
async def health_check():
    """Simple liveness probe — returns status and current server timestamp."""
    return JSONResponse({"status": "ok", "timestamp": int(time.time() * 1000)})


# Serve the project root as static files (dev convenience — nginx handles this in production)
app.mount("/", StaticFiles(directory=".", html=True), name="static")
