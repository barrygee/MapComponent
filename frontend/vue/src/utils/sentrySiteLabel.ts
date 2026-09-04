import type { SentrySite } from '@/services/sentryApi'

/**
 * What to call a Sentry site: its name if it has one, otherwise where it
 * answers. A host is registered by address and named later, so the address is
 * the only label some sites ever have.
 *
 * Lives here rather than beside the map markers because the range-ring origin
 * picker names the same sites in a plain Vue panel, and must not pull a
 * MapLibre control (and with it maplibre-gl) in to do it.
 */
export function siteLabel(site: SentrySite): string {
  return site.name?.trim() || `${site.address}:${site.port}`
}
