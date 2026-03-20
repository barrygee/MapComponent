import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from backend.database import create_tables, seed_default_settings
from backend.routers import air, space, sea, land, settings as settings_router


ROOT_DIR = Path(__file__).parent.parent
TEMPLATES_DIR = ROOT_DIR / "frontend" / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler — runs create_tables once on startup."""
    await create_tables()
    await seed_default_settings()
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


def _make_page_handler(domain: str):
    """Return a route handler that renders the template for the given domain."""
    async def handler(request: Request):
        return templates.TemplateResponse(f"{domain}/index.html", {"request": request, "domain": domain})
    handler.__name__ = f"{domain}_page"
    return handler


for _domain in ("air", "sea", "space", "land", "sdr"):
    app.add_api_route(f"/{_domain}/", _make_page_handler(_domain), methods=["GET"])


@app.get("/docs/")
async def docs_redirect():
    return RedirectResponse(url="/air/", status_code=302)


# ── Static files ───────────────────────────────────────────────────────────────
# Mount specific directories rather than "/" so page routes are never shadowed.
app.mount("/assets",   StaticFiles(directory=str(ROOT_DIR / "frontend" / "assets")),   name="assets")
app.mount("/frontend", StaticFiles(directory=str(ROOT_DIR / "frontend")),  name="frontend")
