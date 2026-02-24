# MapComponent

An interactive dark-themed map of the UK and surrounding areas, built with MapLibre GL and PMTiles.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

## Running the App

```bash
docker compose up --build
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

To stop the server:

```bash
docker compose down
```

## Controls

| Button | Action |
|--------|--------|
| `+` / `−` | Zoom in / out |
| `R` | Toggle road network |
| `N` | Toggle place name labels |

