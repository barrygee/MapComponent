// ============================================================
// SENTINEL — Shared TypeScript interfaces
// Referenced by all .ts files via triple-slash or tsc's auto-include.
// This file is NOT loaded in index.html — it produces no JS output.
// ============================================================

/// <reference types="maplibre-gl" />

// ----- Coordinate primitives -----
type LngLat = [number, number];
type LngLatBounds = [number, number, number, number]; // [w, s, e, n]

// ----- Overlay state -----
interface OverlayStates {
    roads:      boolean;
    names:      boolean;
    rings:      boolean;
    aar:        boolean;
    awacs:      boolean;
    airports:   boolean;
    militaryBases: boolean;
    adsb:       boolean;
    adsbLabels: boolean;
}

// ----- Airport / Military base data -----
interface AirportFrequencies {
    tower:    string;
    radar:    string;
    approach: string;
    atis:     string;
}

interface AirportProperties {
    icao:   string;
    iata:   string;
    name:   string;
    bounds: LngLatBounds;
    freqs:  AirportFrequencies;
}

interface MilitaryBaseProperties {
    icao:   string;
    name:   string;
    bounds: LngLatBounds;
}

interface ZoneProperties {
    name: string;
}

// ----- ADS-B aircraft data -----
/** Shape returned by the airplanes.live API v2 (and the backend proxy). */
interface AircraftApiEntry {
    hex:               string;
    flight?:           string;
    lat?:              number;
    lon?:              number;
    alt_baro?:         number | 'ground';
    alt_geom?:         number | null;
    gs?:               number;
    ias?:              number | null;
    mach?:             number | null;
    track?:            number;
    baro_rate?:        number | null;
    nav_altitude_mcp?: number | null;
    nav_altitude_fms?: number | null;
    nav_heading?:      number | null;
    squawk?:           string;
    category?:         string;
    t?:                string;
    military?:         boolean;
    r?:                string;
    type?:             string;
    emergency?:        string;
    rssi?:             number | null;
    seen_pos?:         number;
}

/** GeoJSON feature properties for a rendered aircraft icon. */
interface AircraftProperties {
    hex:          string;
    flight:       string;
    alt_baro:     number;
    alt_geom?:    number | null;
    gs:           number;
    ias?:         number | null;
    mach?:        number | null;
    track:        number;
    baro_rate?:   number | null;
    nav_altitude?: number | null;
    nav_heading?:  number | null;
    squawk:       string;
    squawkEmerg?: 0 | 1;
    emergency?:   string;
    category:     string;
    t:            string;
    military:     boolean;
    r:            string;
    rssi?:        number | null;
    stale?:       number;
    icon?:        string;
}

/** Per-hex dead-reckoning state stored in _lastPositions. */
interface LastPosition {
    lon:      number;
    lat:      number;
    gs:       number;
    track:    number | null;
    lastSeen: number;
}

// ----- Notification system -----
type NotificationType =
    | 'flight' | 'departure' | 'system' | 'message'
    | 'tracking' | 'track' | 'notif-off' | 'emergency' | 'squawk-clr';

interface NotificationAction {
    label:    string;
    callback: () => void;
}

interface NotificationAddOptions {
    type:         NotificationType;
    title:        string;
    detail?:      string;
    action?:      NotificationAction;
    clickAction?: () => void;
}

interface NotificationUpdateOptions {
    id:      string;
    type?:   NotificationType;
    title?:  string;
    detail?: string;
    action?: NotificationAction | null;
}

interface StoredNotificationItem {
    id:     string;
    type:   NotificationType;
    title:  string;
    detail: string;
    ts:     number;
}

interface NotificationsAPI {
    add(opts: NotificationAddOptions): string;
    update(opts: NotificationUpdateOptions): void;
    dismiss(id: string): void;
    clearAll(): void;
    render(forceIds?: string[]): void;
    toggle(): void;
    init(): void;
    repositionBar(): void;
}

// ----- Tracking panel -----
interface TrackingAPI {
    openPanel(): void;
    closePanel(): void;
    toggle(): void;
    setCount(n: number): void;
    init(): void;
}

// ----- Filter panel -----
interface FilterPanelAPI {
    init(): void;
    toggle(): void;
    open(): void;
    close(): void;
    reposition(): void;
}

// ----- Map component -----
interface RingsGeoJSON {
    lines:  GeoJSON.FeatureCollection<GeoJSON.LineString>;
    labels: GeoJSON.FeatureCollection<GeoJSON.Point>;
}

interface MapComponentAPI {
    map:                maplibregl.Map;
    onStyleLoad(fn: () => void): void;
    isOnline():         boolean;
    buildRingsGeoJSON(lng: number, lat: number): RingsGeoJSON;
    generateGeodesicCircle(lng: number, lat: number, radiusNm: number): LngLat[];
    computeCentroid(coordinates: number[][][]): LngLat;
    computeTextRotate(coordinates: number[][][]): number;
    computeLongestEdge(coordinates: number[][][]): [LngLat, LngLat];
    RING_DISTANCES_NM:  readonly number[];
}
