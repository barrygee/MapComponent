#!/usr/bin/env python3
"""
Fetch and build UK aeronautical chart data for offline use.

Produces three GeoJSON files in frontend/assets/:
  gb_airways.geojson   — IFR airway segments (LineString) from X-Plane earth_awy.dat
  gb_navaids.geojson   — VOR / VOR-DME / TACAN / NDB / DME from OpenAIP
  gb_airports_aero.geojson — All UK airfields (chart-style, not just 26 major ones) from OpenAIP

Sources:
  X-Plane earth_awy.dat  (GPL v3) — https://github.com/mcantsin/x-plane-navdata
  OpenAIP GeoJSON         (CC BY-NC 4.0) — https://www.openaip.net

Usage:
  python3 fetch-gb-aero.py
"""

import json, urllib.request, os, sys
from collections import defaultdict

ASSETS = os.path.join(os.path.dirname(__file__), "frontend", "assets")

AWY_URL = "https://raw.githubusercontent.com/mcantsin/x-plane-navdata/master/earth_awy.dat"
NAV_URL = "https://storage.googleapis.com/29f98e10-a489-4c82-ae5e-489dbcd4912f/gb_nav.geojson"
APT_URL = "https://storage.googleapis.com/29f98e10-a489-4c82-ae5e-489dbcd4912f/gb_apt.geojson"

# UK bounding box (generous — includes Channel Islands, N Ireland, Shetland)
UK_LAT = (49.0, 61.5)
UK_LON = (-9.5, 2.5)

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def fetch(url, label):
    print(f"  Fetching {label} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "sentinel-aero-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    print(f"  {label}: {len(data):,} bytes")
    return data

def in_uk(lat, lon):
    return UK_LAT[0] <= lat <= UK_LAT[1] and UK_LON[0] <= lon <= UK_LON[1]

def save(path, geojson):
    with open(path, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))
    kb = os.path.getsize(path) // 1024
    print(f"  Saved {os.path.basename(path)}: {len(geojson['features'])} features ({kb} KB)")

# ------------------------------------------------------------------
# Airways — X-Plane earth_awy.dat
# ------------------------------------------------------------------
# Format (space-separated):
#   FROM_FIX FROM_LAT FROM_LON TO_FIX TO_LAT TO_LON TYPE BASE_FL TOP_FL AIRWAY_NAMES
# TYPE: 1=low (below FL245), 2=high (FL245+)
# AIRWAY_NAMES: hyphen-separated list, e.g. "L9-M604"
# ------------------------------------------------------------------

def build_airways():
    print("\nBuilding airways ...")
    raw = fetch(AWY_URL, "earth_awy.dat").decode("utf-8", errors="replace")

    # Group segments by airway name, keeping only those touching UK
    # Each segment: (from_fix, from_lat, from_lon, to_fix, to_lat, to_lon, type, base, top)
    awy_segments = defaultdict(list)

    for line in raw.splitlines():
        line = line.strip()
        if not line or line[0] in ("I", "A") or line.isdigit():
            continue
        parts = line.split()
        if len(parts) < 10:
            continue
        try:
            from_fix = parts[0]
            from_lat = float(parts[1])
            from_lon = float(parts[2])
            to_fix   = parts[3]
            to_lat   = float(parts[4])
            to_lon   = float(parts[5])
            awy_type = int(parts[6])   # 1=low, 2=high
            base_fl  = int(parts[7])   # hundreds of feet
            top_fl   = int(parts[8])   # hundreds of feet
            names    = parts[9]
        except (ValueError, IndexError):
            continue

        # Include segment if either endpoint is in UK
        if not (in_uk(from_lat, from_lon) or in_uk(to_lat, to_lon)):
            continue

        for name in names.split("-"):
            name = name.strip()
            if name:
                awy_segments[name].append({
                    "from_fix": from_fix,
                    "from_lat": from_lat,
                    "from_lon": from_lon,
                    "to_fix":   to_fix,
                    "to_lat":   to_lat,
                    "to_lon":   to_lon,
                    "type":     "high" if awy_type == 2 else "low",
                    "base_ft":  base_fl * 100,
                    "top_ft":   top_fl  * 100,
                })

    # Emit one Feature per segment (simpler for MapLibre filtering/labelling)
    features = []
    for name, segs in sorted(awy_segments.items()):
        for seg in segs:
            features.append({
                "type": "Feature",
                "properties": {
                    "name":    name,
                    "level":   seg["type"],        # "low" or "high"
                    "base_ft": seg["base_ft"],
                    "top_ft":  seg["top_ft"],
                    "from":    seg["from_fix"],
                    "to":      seg["to_fix"],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [seg["from_lon"], seg["from_lat"]],
                        [seg["to_lon"],   seg["to_lat"]],
                    ],
                },
            })

    print(f"  Airways: {len(awy_segments)} unique names, {len(features)} segments")
    return {"type": "FeatureCollection", "features": features}


# ------------------------------------------------------------------
# Navaids — OpenAIP gb_nav.geojson
# ------------------------------------------------------------------
# OpenAIP navaid type codes:
#   0=DME, 1=TACAN, 2=NDB, 3=VOR, 4=VOR-DME, 5=VORTAC, 6=DVOR, 7=DVOR-DME, 8=DVORTAC
# Frequency unit codes: 1=kHz (NDB), 2=MHz (VOR/DME)
# ------------------------------------------------------------------

NAVAID_TYPE = {
    0: "DME",
    1: "TACAN",
    2: "NDB",
    3: "VOR",
    4: "VOR-DME",
    5: "VORTAC",
    6: "DVOR",
    7: "DVOR-DME",
    8: "DVORTAC",
}

def build_navaids():
    print("\nBuilding navaids ...")
    raw  = fetch(NAV_URL, "gb_nav.geojson")
    data = json.loads(raw)

    features = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        geom  = feat.get("geometry", {})
        if not geom or geom.get("type") != "Point":
            continue

        type_code = props.get("type")
        nav_type  = NAVAID_TYPE.get(type_code, "UNKNOWN")
        freq_obj  = props.get("frequency") or {}
        freq_val  = freq_obj.get("value", "")
        freq_unit = "kHz" if freq_obj.get("unit") == 1 else "MHz"

        features.append({
            "type": "Feature",
            "properties": {
                "identifier": props.get("identifier", ""),
                "name":       props.get("name", ""),
                "navType":    nav_type,
                "frequency":  str(freq_val),
                "freqUnit":   freq_unit,
            },
            "geometry": geom,
        })

    return {"type": "FeatureCollection", "features": features}


# ------------------------------------------------------------------
# Airports — OpenAIP gb_apt.geojson
# ------------------------------------------------------------------
# Airport type codes:
#   0=Airport, 1=Glider, 2=Airfield Civil, 3=International Airport,
#   4=Heliport Military, 5=Military Aerodrome, 6=ULM, 7=Heliport Civil,
#   8=Closed, 9=IFR Airfield
# ------------------------------------------------------------------

AIRPORT_TYPE = {
    0: "AIRPORT",
    1: "GLIDER",
    2: "AIRFIELD",
    3: "INTL_AIRPORT",
    4: "HELI_MIL",
    5: "MIL",
    6: "ULM",
    7: "HELI",
    8: "CLOSED",
    9: "IFR",
   11: "STRIP",
   12: "STRIP",
}

def build_airports():
    print("\nBuilding airports ...")
    raw  = fetch(APT_URL, "gb_apt.geojson")
    data = json.loads(raw)

    features = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        geom  = feat.get("geometry", {})
        if not geom or geom.get("type") != "Point":
            continue

        # Skip closed airports
        if props.get("type") == 8:
            continue

        type_code = props.get("type", 2)
        apt_type  = AIRPORT_TYPE.get(type_code, "AIRFIELD")

        elev_obj = props.get("elevation") or {}
        elev_ft  = None
        if isinstance(elev_obj, dict):
            v = elev_obj.get("value")
            u = elev_obj.get("unit", "m")
            if v is not None:
                elev_ft = int(float(v) * 3.28084) if u == "m" else int(float(v))

        features.append({
            "type": "Feature",
            "properties": {
                "icao":    props.get("icaoCode", ""),
                "name":    props.get("name", ""),
                "aptType": apt_type,
                "elevFt":  elev_ft,
                "ppr":     props.get("ppr", False),
                "private": props.get("private", False),
                "military": apt_type in ("MIL", "HELI_MIL"),
            },
            "geometry": geom,
        })

    return {"type": "FeatureCollection", "features": features}


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main():
    print("=== Sentinel Aeronautical Chart Data Fetch ===\n")

    airways  = build_airways()
    navaids  = build_navaids()
    airports = build_airports()

    print("\nSaving ...")
    save(os.path.join(ASSETS, "gb_airways.geojson"),       airways)
    save(os.path.join(ASSETS, "gb_navaids.geojson"),       navaids)
    save(os.path.join(ASSETS, "gb_airports_aero.geojson"), airports)

    print("\nDone.")

if __name__ == "__main__":
    main()
