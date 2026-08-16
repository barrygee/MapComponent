/**
 * Client-side checks for the Settings > My Location fields, mirroring the
 * backend's `_validated_location` (backend/routers/settings.py) and the
 * equivalent panel in Sentry so both consoles reject the same input with the
 * same wording.
 *
 * Advisory only — the server re-validates every PUT. Validating here at all
 * matters because a mistyped coordinate is otherwise silent: a longitude
 * entered where a latitude belongs is a perfectly valid number that pins your
 * position somewhere you are not, on every map in the app.
 */

export const MINIMUM_LATITUDE = -90
export const MAXIMUM_LATITUDE = 90
export const MINIMUM_LONGITUDE = -180
export const MAXIMUM_LONGITUDE = 180

/**
 * Parse a typed coordinate.
 *
 * Returns `null` for an empty field — a *valid* value here, meaning "no fixed
 * position, fall back to browser geolocation" — and `NaN` for text that is not
 * a number at all, so a caller can tell "left blank" from "typed nonsense".
 * `Number()` rather than `parseFloat`: `parseFloat('54.9 north')` happily
 * returns `54.9`, and silently accepting half an entry is the failure mode this
 * module exists to stop.
 */
export function parseCoordinate(rawValue: string): number | null {
  const trimmed = rawValue.trim()
  if (trimmed === '') {
    return null
  }
  return Number(trimmed)
}

/** Validate a latitude, or `null` for an empty field. Returns an error message or `null`. */
export function validateLatitude(value: number | null): string | null {
  return validateCoordinate(value, MINIMUM_LATITUDE, MAXIMUM_LATITUDE, 'Latitude')
}

/** Validate a longitude, or `null` for an empty field. Returns an error message or `null`. */
export function validateLongitude(value: number | null): string | null {
  return validateCoordinate(value, MINIMUM_LONGITUDE, MAXIMUM_LONGITUDE, 'Longitude')
}

/**
 * Enforce the backend's both-or-neither rule before a round trip.
 *
 * Half a position cannot be plotted, so it is never a state worth storing —
 * and catching it here names the empty field instead of surfacing a 400 that
 * talks about the pair.
 */
export function validateCoordinatePair(
  latitude: number | null,
  longitude: number | null,
): string | null {
  if (latitude === null && longitude !== null) {
    return 'Enter a latitude too, or clear both to remove your position.'
  }
  if (longitude === null && latitude !== null) {
    return 'Enter a longitude too, or clear both to remove your position.'
  }
  return null
}

function validateCoordinate(
  value: number | null,
  minimum: number,
  maximum: number,
  fieldName: string,
): string | null {
  if (value === null) {
    return null
  }
  if (!Number.isFinite(value)) {
    return `${fieldName} must be a number in decimal degrees, e.g. 54.95149.`
  }
  if (value < minimum || value > maximum) {
    return `${fieldName} must be between ${minimum} and ${maximum}.`
  }
  return null
}
