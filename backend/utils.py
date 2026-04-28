"""
Shared utilities used across multiple routers.
"""

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import UserSettings


def _valid_url(url: object) -> str | None:
    """Return a cleaned URL string, or None if the value is empty/placeholder."""
    if url and isinstance(url, str) and url.strip() not in ("https://", "http://localhost", ""):
        return url.strip().rstrip("/")
    return None


async def resolve_domain_urls(
    domain: str,
    db: AsyncSession,
    online_default: str | None = None,
) -> tuple[str | None, str | None]:
    """Return (primary_url, fallback_url) for a given domain based on connectivity mode and override.

    Resolves effective mode:
      1. If {domain}.sourceOverride is 'online' or 'offgrid', use that.
      2. Otherwise, fall back to app.connectivityMode ('online' | 'offgrid', default 'online').

    When effective mode is 'online':   primary = online URL,   fallback = offgrid URL
    When effective mode is 'offgrid':  primary = offgrid URL,  fallback = online URL

    Args:
        domain:         Domain namespace string, e.g. 'air' or 'space'.
        db:             Active async database session.
        online_default: Fallback online URL used when the DB has no onlineUrl configured.
    """
    result = await db.execute(
        select(UserSettings).where(
            (UserSettings.namespace == domain) |
            ((UserSettings.namespace == "app") & (UserSettings.key == "connectivityMode"))
        )
    )
    rows = result.scalars().all()

    settings_map: dict[str, object] = {}
    for row in rows:
        namespaced_key = f"{row.namespace}.{row.key}"
        try:
            settings_map[namespaced_key] = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            settings_map[namespaced_key] = row.value

    # Resolve effective mode
    override = settings_map.get(f"{domain}.sourceOverride", "auto")
    if override in ("online", "offgrid"):
        effective_mode = override
    else:
        effective_mode = settings_map.get("app.connectivityMode", "online") or "online"

    _online_key  = {"air": "onlineDataSourceURL"}.get(domain, "onlineUrl")
    _offgrid_key = {"air": "offgridDataSourceURL"}.get(domain, "offgridSource")

    online = _valid_url(settings_map.get(f"{domain}.{_online_key}")) or _valid_url(online_default)

    # offgrid source is stored as {"url": "http://..."} by the frontend settings panel
    offgrid_raw = settings_map.get(f"{domain}.{_offgrid_key}")
    if isinstance(offgrid_raw, dict):
        offgrid = _valid_url(offgrid_raw.get("url"))
    else:
        offgrid = _valid_url(offgrid_raw)

    if effective_mode == "offgrid":
        return offgrid, online
    return online, offgrid
