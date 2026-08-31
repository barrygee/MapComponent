/** True when lat/lon are finite numbers within valid geographic bounds. */
export function isValidLatLon(lat: number, lon: number): boolean {
  return !isNaN(lat) && lat >= -90 && lat <= 90 && !isNaN(lon) && lon >= -180 && lon <= 180
}

/**
 * Decimal places a coordinate is shown to on the map.
 *
 * Five is roughly a metre — fine enough to identify a spot, without implying
 * the sub-metre precision a beaconed position does not have.
 */
const COORDINATE_DECIMALS = 5

/**
 * A latitude as the map writes it, e.g. `54.95119° N`.
 *
 * Hemisphere letter rather than a minus sign: this is read off a map, where
 * "N/S" is unambiguous and a stray "-" is easy to miss. Shared so the Sentry
 * site markers and the right-click "SET LOCATION" menu read identically —
 * they sit on the same map, often at once.
 */
export function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(COORDINATE_DECIMALS)}° ${latitude >= 0 ? 'N' : 'S'}`
}

/** A longitude as the map writes it, e.g. `1.53300° W`. See {@link formatLatitude}. */
export function formatLongitude(longitude: number): string {
  return `${Math.abs(longitude).toFixed(COORDINATE_DECIMALS)}° ${longitude >= 0 ? 'E' : 'W'}`
}
