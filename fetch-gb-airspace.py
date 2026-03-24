#!/usr/bin/env python3
"""
Fetch and transform UK airspace GeoJSON from OpenAIP.
Adds upperLimit and lowerLimit altitude data to each feature.

Source: https://storage.googleapis.com/29f98e10-a489-4c82-ae5e-489dbcd4912f/gb_asp.geojson
Output: frontend/assets/gb_airspace.geojson
"""

import json, urllib.request, os

SOURCE_URL = "https://storage.googleapis.com/29f98e10-a489-4c82-ae5e-489dbcd4912f/gb_asp.geojson"
OUT_PATH   = os.path.join(os.path.dirname(__file__), "frontend", "assets", "gb_airspace.geojson")

# OpenAIP numeric type code -> our internal type string
TYPE_MAP = {
    4:  "CTR",         # Controlled Tower Region
    7:  "TMA",         # Terminal Maneuvering Area
    26: "TMA",         # Control Area (CTA) -> TMA
    13: "ATZ",         # Airport Traffic Zone
    14: "MATZ",        # Military ATZ
    2:  "DANGER",      # Danger
    18: "DANGER",      # Warning Area
    21: "DANGER",      # Gliding Sector
    28: "DANGER",      # Aerial Sporting / Recreational
    1:  "RESTRICTED",  # Restricted
    3:  "PROHIBITED",  # Prohibited
    5:  "RMZ",         # Transponder Mandatory Zone (TMZ)
    6:  "RMZ",         # Radio Mandatory Zone
    0:  "RESTRICTED",  # Other
}

# OpenAIP numeric ICAO class code -> string
ICAO_CLASS_MAP = {
    0: "A",
    1: "B",
    2: "C",
    3: "D",
    4: "E",
    5: "F",
    6: "G",
    8: "UNCLASSIFIED",
}

# Unit codes
UNIT_METER = 0
UNIT_FEET  = 1
UNIT_FL    = 6

# Reference datum codes
DATUM_GND = 0
DATUM_MSL = 1
DATUM_STD = 2   # Standard pressure (used for FL)

def format_limit(limit):
    """Return a human-readable altitude string e.g. 'FL105', '2500ft MSL', 'GND'."""
    if limit is None:
        return None
    v    = limit.get("value", 0)
    unit = limit.get("unit", UNIT_FEET)
    ref  = limit.get("referenceDatum", DATUM_MSL)

    if unit == UNIT_FL:
        return f"FL{v:03d}"
    if ref == DATUM_GND and v == 0:
        return "GND"
    unit_str = "m" if unit == UNIT_METER else "ft"
    ref_str  = "AGL" if ref == DATUM_GND else "MSL"
    return f"{v}{unit_str} {ref_str}"

def limit_to_feet(limit):
    """Convert a limit object to an approximate feet value (for FL-range filtering)."""
    if limit is None:
        return None
    v    = limit.get("value", 0)
    unit = limit.get("unit", UNIT_FEET)
    if unit == UNIT_FL:
        return v * 100
    if unit == UNIT_METER:
        return int(v * 3.28084)
    return v

def main():
    print(f"Downloading from {SOURCE_URL} ...")
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "sentinel-airspace-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    print(f"Downloaded {len(raw):,} bytes")

    data = json.loads(raw)
    features_in = data.get("features", [])
    print(f"Input features: {len(features_in)}")

    features_out = []
    skipped_types = {}

    for feat in features_in:
        props    = feat.get("properties", {})
        raw_type = props.get("type")
        mapped   = TYPE_MAP.get(raw_type)

        if mapped is None:
            skipped_types[raw_type] = skipped_types.get(raw_type, 0) + 1
            continue

        upper = props.get("upperLimit")
        lower = props.get("lowerLimit")

        icao_code = props.get("icaoClass")
        icao_str  = ICAO_CLASS_MAP.get(icao_code, "UNCLASSIFIED")

        new_props = {
            "name":         props.get("name", ""),
            "type":         mapped,
            "icaoClass":    icao_str,
            "upperLimit":   format_limit(upper),
            "lowerLimit":   format_limit(lower),
            "upperLimitFt": limit_to_feet(upper),
            "lowerLimitFt": limit_to_feet(lower),
        }

        features_out.append({
            "type":       "Feature",
            "properties": new_props,
            "geometry":   feat["geometry"],
        })

    result = {"type": "FeatureCollection", "features": features_out}

    with open(OUT_PATH, "w") as f:
        json.dump(result, f, separators=(",", ":"))

    print(f"Output features: {len(features_out)}")
    if skipped_types:
        print(f"Skipped type codes: {skipped_types}")
    print(f"Written to {OUT_PATH}")

    # Print a sample
    if features_out:
        print(f"\nSample feature properties:\n{json.dumps(features_out[0]['properties'], indent=2)}")

if __name__ == "__main__":
    main()
