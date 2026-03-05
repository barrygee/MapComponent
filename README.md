# SENTINEL

An interactive dark-themed situational awareness map covering the UK and surrounding airspace, built with [MapLibre GL JS](https://maplibre.org/) and [PMTiles](https://protomaps.com/docs/pmtiles).

---

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

---

## Running the App

```bash
docker compose up --build
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

To stop:

```bash
docker compose down
```

---

## Features

### Map

- Dark-themed vector map rendered with MapLibre GL JS
- Tile data served via PMTiles (offline-capable)
- Covers the UK and surrounding regions

### Online / Offline Detection

The app continuously monitors network connectivity and automatically switches between two map styles:

- **Online** — full worldwide tile coverage with no bounds restriction
- **Offline** — locally bundled PMTiles covering the UK and surrounding areas (approximately 20°W–32°E, 44°N–67°N)

The current status is shown in the footer as `● ONLINE` or `● OFFLINE`.

### Navigation Header

The top navigation bar contains domain tabs: **AIR**, **SPACE**, **SEA**, **LAND**. The **AIR** domain is currently active.

### Map Overlays

All overlays are toggled via the control buttons on the right-hand side of the map. Active overlays are highlighted in yellow-green (`#c8ff00`); inactive overlays appear dimmed. Toggle states are persisted across sessions via `localStorage`.

| Button | Overlay | Description |
|--------|---------|-------------|
| `R` | Road network | Toggles road lines and road name labels. Visibility is also zoom-dependent. |
| `N` | Place names | Toggles city, town, village, country and water body labels. |
| `◎` | Range rings | Geodesic distance rings (25, 50, 100, 200, 300 nm) centred on the user's location or the map centre. Includes a north-bearing label line. |
| `=` | AAR zones | UK Air-to-Air Refuelling areas (AARA 1–14), shown as dashed lime outlines with zone name labels. |
| `○` | AWACS orbits | UK AWACS orbit areas, shown as solid lime outlines with a subtle fill. |
| `CVL` | Civil airports | Major civil airports across the UK and Ireland, shown as dots with ICAO code and airport name. |
| `RAF` | RAF bases | UK RAF and US co-located bases, shown as dots with ICAO code and base name. |

### Civil Airports

The following airports are plotted:

| ICAO | Name |
|------|------|
| EGLL | Heathrow |
| EGKK | Gatwick |
| EGGW | Luton |
| EGSS | Stansted |
| EGCC | Manchester |
| EGNT | Newcastle |
| EGPF | Glasgow |
| EGPK | Glasgow Prestwick |
| EGPH | Edinburgh |
| EGGD | Bristol |
| EGBB | Birmingham |
| EGAC | Belfast City |
| EGAA | Aldergrove |
| EGNV | Teesside |
| EGGP | Liverpool John Lennon |
| EGNH | Blackpool |
| EGNS | Isle of Man Ronaldsway |
| EGNM | Leeds Bradford |
| EIDW | Dublin |

### RAF & Co-located Bases

Includes all major UK RAF stations and USAF co-located bases:

Benson, Boulmer, Brize Norton, Coningsby, Cosford, Cranwell, Digby, Fylingdales, Honington, Leeming, Lossiemouth, Marham, Northolt, Odiham, Shawbury, Spadeadam, Valley, Waddington, Wittering, Woodvale, Wyton, Alconbury, Croughton, Fairford, Lakenheath, Mildenhall.

### Geolocation

When the browser grants location access, the app:

- Places a custom crosshair marker at the user's position showing latitude and longitude coordinates
- Centres the range rings on the user's location
- Reverse-geocodes the position and displays the country/region name in the footer
- Caches the last known location for up to 5 minutes so it is restored immediately on next load
- Continuously tracks position changes via `navigator.geolocation.watchPosition`

### Footer

The footer displays:

- **Left** — current active domain (`[AIR]`)
- **Right** — connectivity status (`● ONLINE` / `● OFFLINE`) and reverse-geocoded location name

---

## Data Sources

### Live Aircraft (ADS-B)

Live aircraft positions are fetched from the [airplanes.live](https://airplanes.live) public API:

```
https://api.airplanes.live/v2/point/{lat}/{lon}/250
```

The app queries a 250 nm radius around the user's location (or map centre) every second. No API key is required. Data includes position, altitude, heading, ground speed, squawk code, registration, aircraft type, and military classification.

### Map Tiles

| Mode | Source | Format |
|------|--------|--------|
| Online | [OpenFreeMap](https://openfreemap.org) (`tiles.openfreemap.org/planet`) | Vector tiles over HTTPS |
| Offline | Locally bundled PMTiles (`uk.pmtiles`, `surroundings.pmtiles`) | PMTiles (served by nginx) |

The offline tile files cover approximately 20°W–32°E, 44°N–67°N and must be downloaded separately using the provided `download-world-tiles.sh` / `download-world-tiles.py` scripts.

### Reverse Geocoding

The footer location label is resolved using the [Nominatim](https://nominatim.openstreetmap.org) reverse geocoding API (OpenStreetMap):

```
https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}
```

Requests are throttled to once every 2 minutes per the Nominatim usage policy.

### Connectivity Check

Network connectivity is probed every 2 seconds by sending a `HEAD` request to:

```
https://tile.openstreetmap.org/favicon.ico
```

This uses `mode: 'no-cors'` so any reachable response counts as online; a network failure triggers the offline style switch.

### Static Reference Data

The following data is bundled directly in the application (no external API):

| Dataset | Source / Notes |
|---------|---------------|
| Civil airports (26) | Hardcoded coordinates, ICAO/IATA codes, and ATC frequencies for major UK and Irish airports |
| RAF & co-located bases (24) | Hardcoded coordinates and ICAO codes for UK RAF stations and USAF co-located bases |
| UK Air-to-Air Refuelling Areas (AARA 1–14) | Hardcoded GeoJSON polygons for UK AARA zones |
| AWACS orbit areas | Hardcoded GeoJSON polygons |

---

## Testing Emergency Visuals

The app includes a dev helper (`squawk-test.js`) that mocks the ADS-B API feed so you can trigger emergency states without waiting for a real emergency squawk.

### Setup

1. Start the app and open it in the browser.
2. Open DevTools and load the script in the console:

```js
const s = document.createElement('script'); s.src = '/squawk-test.js'; document.head.appendChild(s);
```

The helper attaches itself to `window.sqkTest`. Confirm it loaded:

```js
sqkTest.help()
```

### Testing emergency colour behaviour (red icon, label, trail dots)

**Step 1 — trigger an emergency aircraft:**

```js
sqkTest.enterEmergency('7700')
```

The mock replaces the next ADS-B poll (runs every ~5 s) with a single aircraft (`TEST001`, squawk `7700`) near London. Once the poll fires you should see:

- A red blip + red bracket on the map
- A red emergency notification in the notifications panel

**Step 2 — select the aircraft:**

Click the red blip on the map. Verify:

- The data tag callsign (`TEST001`) is displayed in **red** (`#ff4040`)
- The bracket remains red

**Step 3 — enable tracking:**

Click the **TRACK** button in the data tag. Verify:

- The compact tracking tag callsign is **red**
- The status bar (tracking panel) callsign is **red**
- Trail dots appearing behind the aircraft are **red** (they appear after the aircraft moves; the mock aircraft is stationary so trails will only accumulate if you also run `sqkTest.fullFlow()` which moves it across poll cycles)

**Quick end-to-end flow:**

```js
sqkTest.fullFlow('7700', 8000)
```

This triggers emergency → holds 8 s (select and track during this window) → clears to squawk `1200`. After clearing, the icon, label, and trail dots should revert to white/lime.

**Test all three emergency codes simultaneously:**

```js
sqkTest.allCodes()
```

Places three aircraft (hex `test01`/`test02`/`test03`) each squawking `7700`, `7600`, `7500` in sequence over ~12 s.

**Check internal state at any time:**

```js
sqkTest.status()
```

**Restore real ADS-B feed when done:**

```js
sqkTest.restore()
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Map renderer | MapLibre GL JS |
| Tile format | PMTiles |
| Map style | Custom Fiord dark theme |
| Fonts | Barlow / Barlow Condensed (Google Fonts) |
| Server | Docker / nginx |
| ADS-B data | airplanes.live public API |
| Geocoding | Nominatim (OpenStreetMap) |
