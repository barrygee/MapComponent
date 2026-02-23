#!/bin/bash
# Downloads Natural Earth raster tiles (zoom 0-6) from OpenFreeMap
# Stores them at assets/tiles/world/{z}/{x}/{y}.png

BASE_URL="https://tiles.openfreemap.org/natural_earth/ne2sr"
OUT_DIR="$(dirname "$0")/assets/tiles/world"
CONCURRENCY=8

download_tile() {
    local z=$1 x=$2 y=$3
    local dir="$OUT_DIR/$z/$x"
    local file="$dir/$y.png"
    [ -f "$file" ] && return 0
    mkdir -p "$dir"
    curl -sf --retry 3 --retry-delay 1 \
        "$BASE_URL/$z/$x/$y.png" -o "$file"
}

export -f download_tile
export BASE_URL OUT_DIR

echo "Downloading world tiles (zoom 0-6)..."

for z in $(seq 0 6); do
    max=$(( (1 << z) - 1 ))
    total=$(( (max + 1) * (max + 1) ))
    echo "Zoom $z — $total tiles"
    for x in $(seq 0 $max); do
        for y in $(seq 0 $max); do
            echo "$z $x $y"
        done
    done
done | xargs -P "$CONCURRENCY" -n 3 bash -c 'download_tile "$@"' _

echo "Done. $(find "$OUT_DIR" -name '*.png' | wc -l | tr -d ' ') tiles saved to $OUT_DIR"
