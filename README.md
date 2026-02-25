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

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Map renderer | MapLibre GL JS |
| Tile format | PMTiles |
| Map style | Custom Fiord dark theme |
| Fonts | Barlow / Barlow Condensed (Google Fonts) |
| Server | Docker / nginx |
| Geocoding | Nominatim (OpenStreetMap) |
