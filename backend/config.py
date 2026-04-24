from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Path to the SQLite database file (relative to the project root)
    db_path: str = "backend/sentinel.db"

    # How long ADS-B aircraft data is considered fresh (10 seconds — matches airplanes.live rate limit)
    adsb_ttl_ms: int = 10000
    # How long a stale ADS-B response can still be served if the upstream fails (60 seconds)
    adsb_stale_ms: int = 60000

    # Base URL for the airplanes.live ADS-B API
    adsb_upstream_base: str = "https://api.airplanes.live/v2"

    # TLE data TTL — 6 hours (TLE changes slowly; Celestrak updates daily)
    tle_ttl_ms: int = 21_600_000
    # Stale window for TLE — 12 hours (serve old TLE if Celestrak is unreachable)
    tle_stale_ms: int = 43_200_000
    # TTL for manually-entered TLE data — 30 days (user explicitly provided it)
    tle_manual_ttl_ms: int = 2_592_000_000
    # Celestrak TLE URL for the ISS (NORAD ID 25544)
    celestrak_iss_url: str = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Singleton settings object — imported by all modules that need configuration
settings = Settings()
