#!/usr/bin/env python3
import os, urllib.request, concurrent.futures

BASE_URL = "https://tiles.openfreemap.org/natural_earth/ne2sr"
OUT_DIR  = os.path.join(os.path.dirname(__file__), "assets", "tiles", "world")
MAX_ZOOM = 6
WORKERS  = 6

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; map-tile-downloader/1.0)"
}

def download(z, x, y):
    path = os.path.join(OUT_DIR, str(z), str(x), str(y) + ".png")
    if os.path.exists(path):
        return "skip"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = f"{BASE_URL}/{z}/{x}/{y}.png"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        with open(path, "wb") as f:
            f.write(data)
        return "ok"
    except Exception as e:
        # Clean up empty file if created
        if os.path.exists(path) and os.path.getsize(path) == 0:
            os.remove(path)
        return f"err:{e}"

tasks = [(z, x, y)
         for z in range(MAX_ZOOM + 1)
         for x in range(1 << z)
         for y in range(1 << z)]

total = len(tasks)
done = skipped = errors = 0

print(f"Downloading {total} tiles (zoom 0–{MAX_ZOOM}) …")
with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futs = {ex.submit(download, z, x, y): (z, x, y) for z, x, y in tasks}
    for f in concurrent.futures.as_completed(futs):
        r = f.result()
        if r == "ok":     done    += 1
        elif r == "skip": skipped += 1
        else:             errors  += 1
        n = done + skipped + errors
        if n % 200 == 0 or n == total:
            print(f"  {n}/{total}  ok={done} skip={skipped} err={errors}", flush=True)

print(f"\nDone. ok={done} skipped={skipped} errors={errors}")
