from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Path to the SQLite database file (relative to the project root)
    db_path: str = "backend/sentinel.db"

    # How long ADS-B aircraft data is considered fresh (5 seconds)
    adsb_ttl_ms: int = 5000
    # How long a stale ADS-B response can still be served if the upstream fails (30 seconds)
    adsb_stale_ms: int = 30000

    # How long a reverse-geocode result is considered fresh (10 minutes)
    geocode_ttl_ms: int = 600000
    # How long a stale geocode result can still be served if Nominatim is unavailable (1 hour)
    geocode_stale_ms: int = 3600000

    # Base URL for the airplanes.live ADS-B API
    adsb_upstream_base: str = "https://api.airplanes.live/v2"
    # Base URL for Nominatim reverse-geocoding
    nominatim_base: str = "https://nominatim.openstreetmap.org"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Singleton settings object — imported by all modules that need configuration
settings = Settings()
