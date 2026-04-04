import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import create_tables, get_db, seed_default_settings
from backend.models import UserSettings
from backend.routers import air, space, sea, land, settings as settings_router, sdr as sdr_router


ROOT_DIR = Path(__file__).parent.parent
TEMPLATES_DIR = ROOT_DIR / "frontend" / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

_DOMAIN_ORDER = ("air", "space", "sea", "land", "sdr")


async def _get_enabled_domains(db: AsyncSession) -> list[str]:
    """Return an ordered list of domain names whose 'enabled' setting is truthy."""
    result = await db.execute(
        select(UserSettings).where(
            UserSettings.namespace.in_(_DOMAIN_ORDER),
            UserSettings.key == "enabled",
        )
    )
    rows = result.scalars().all()
    enabled_set: set[str] = set()
    for row in rows:
        try:
            if json.loads(row.value):
                enabled_set.add(row.namespace)
        except (json.JSONDecodeError, TypeError):
            pass
    # Preserve display order; fall back to all domains if DB has no data yet
    ordered = [d for d in _DOMAIN_ORDER if d in enabled_set]
    return ordered if ordered else list(_DOMAIN_ORDER)


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
app.include_router(sdr_router.router)


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
async def root_redirect(db: AsyncSession = Depends(get_db)):
    enabled = await _get_enabled_domains(db)
    target = enabled[0] if enabled else "air"
    return RedirectResponse(url=f"/{target}/", status_code=302)


def _make_page_handler(domain: str):
    """Return a route handler that renders the template for the given domain."""
    async def handler(request: Request, db: AsyncSession = Depends(get_db)):
        enabled = await _get_enabled_domains(db)
        if domain not in enabled:
            target = enabled[0] if enabled else "air"
            return RedirectResponse(url=f"/{target}/", status_code=302)
        return templates.TemplateResponse(
            f"{domain}/index.html",
            {"request": request, "domain": domain, "enabled_domains": enabled},
        )
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
