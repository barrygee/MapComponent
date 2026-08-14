/**
 * Shared `document` `CustomEvent` names for the SDR devices/Sentry-hosts
 * settings surface. Kept in one small module (rather than exported from a
 * `.vue` SFC) so both `SentryHostsControl.vue` and `SdrDevicesControl.vue`
 * import the same string without either depending on the other's component
 * module.
 */

/** Fired after any Sentinel radio is added/edited/deleted. Pre-dates this
 * feature — several components already listen for it (e.g. `SdrPanel.vue`,
 * `SdrDeviceSelector.vue`'s host store reload). */
export const RADIOS_CHANGED_EVENT = 'sdr:radios-changed'

/** Fired after a Sentry host is added/edited/deleted, so `SdrDevicesControl`
 * (which groups radios by Sentry host) reloads its host list. */
export const SENTRY_HOSTS_CHANGED_EVENT = 'sdr:sentry-hosts-changed'
