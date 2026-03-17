import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from backend.database import create_tables
from backend.routers import air, space, sea, land, sdr, settings as settings_router


ROOT_DIR = Path(__file__).parent.parent
TEMPLATES_DIR = ROOT_DIR / "frontend" / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


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
app.include_router(sdr.router)
app.include_router(settings_router.router)


@app.get("/health")
async def health_check():
    """Simple liveness probe — returns status and current server timestamp."""
    return JSONResponse({"status": "ok", "timestamp": int(time.time() * 1000)})


# ── Root-level static files ────────────────────────────────────────────────────

@app.get("/favicon.ico")
async def favicon_ico():
    return FileResponse(ROOT_DIR / "frontend" / "assets" / "favicon.ico", media_type="image/x-icon")


# ── Page routes ────────────────────────────────────────────────────────────────

@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/air/", status_code=302)


@app.get("/air/")
async def air_page(request: Request):
    return templates.TemplateResponse("air/index.html", {"request": request, "domain": "air"})


@app.get("/sea/")
async def sea_page(request: Request):
    return templates.TemplateResponse("sea/index.html", {"request": request, "domain": "sea"})


@app.get("/space/")
async def space_page(request: Request):
    return templates.TemplateResponse("space/index.html", {"request": request, "domain": "space"})


@app.get("/land/")
async def land_page(request: Request):
    return templates.TemplateResponse("land/index.html", {"request": request, "domain": "land"})


@app.get("/sdr/")
async def sdr_page(request: Request):
    return templates.TemplateResponse("sdr/index.html", {"request": request, "domain": "sdr"})


# ── Static files ───────────────────────────────────────────────────────────────
# Mount specific directories rather than "/" so page routes are never shadowed.
app.mount("/assets",   StaticFiles(directory=str(ROOT_DIR / "frontend" / "assets")),   name="assets")
app.mount("/frontend", StaticFiles(directory=str(ROOT_DIR / "frontend")),  name="frontend")
