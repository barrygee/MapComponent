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


async def resolve_domain_urls(domain: str, db: AsyncSession) -> tuple[str | None, str | None]:
    """Return (primary_url, fallback_url) for a given domain based on connectivity mode and override.

    Resolves effective mode:
      1. If {domain}.sourceOverride is 'online' or 'offline', use that.
      2. Otherwise, fall back to app.connectivityMode ('online' | 'offline', default 'online').

    When effective mode is 'online':  primary = online URL,  fallback = offline URL
    When effective mode is 'offline': primary = offline URL, fallback = online URL

    Args:
        domain: Domain namespace string, e.g. 'air' or 'space'.
        db:     Active async database session.
    """
    result = await db.execute(
        select(UserSettings).where(
            (UserSettings.namespace == domain) |
            ((UserSettings.namespace == "app") & (UserSettings.key == "connectivityMode"))
        )
    )
    rows = result.scalars().all()

    ns: dict[str, object] = {}
    for row in rows:
        compound_key = f"{row.namespace}.{row.key}"
        try:
            ns[compound_key] = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            ns[compound_key] = row.value

    # Resolve effective mode
    override = ns.get(f"{domain}.sourceOverride", "auto")
    if override in ("online", "offline"):
        effective_mode = override
    else:
        effective_mode = ns.get("app.connectivityMode", "online") or "online"

    online = _valid_url(ns.get(f"{domain}.onlineUrl"))

    # offlineSource is stored as {"url": "http://..."} by the frontend settings panel
    offline_raw = ns.get(f"{domain}.offlineSource")
    if isinstance(offline_raw, dict):
        offline = _valid_url(offline_raw.get("url"))
    else:
        offline = _valid_url(offline_raw)

    if effective_mode == "offline":
        return offline, online
    return online, offline
