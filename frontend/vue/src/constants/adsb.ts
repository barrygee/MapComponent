/**
 * Shared polling cadence for the ADS-B feed.
 *
 * The backend caches upstream aircraft data for `adsb_ttl_ms` (10s, see
 * `backend/config.py`) and rate limits outbound calls to one per
 * `adsb_min_request_interval_ms` (5s). Polling faster than the TTL cannot
 * surface newer aircraft — it only returns the same cached payload — while
 * every extra poller competes for the same upstream call slots, so a burst of
 * them makes some requests fall back to older cached data.
 *
 * Aligning every client poller to the TTL means each request has a real chance
 * of carrying new data. Motion between polls is covered by the map control's
 * own interpolation, so a slower poll does not make aircraft move less smoothly.
 */
export const ADSB_POLL_INTERVAL_MS = 10000

/**
 * How recent a fetch has to be for a newly-started poller to skip its immediate
 * first fetch and wait for the next tick instead.
 *
 * Slightly under a full interval, so restarting a poller (a pane remount, an
 * overlay toggle) does not fire an extra upstream-bound request on the back of
 * one that just happened, but a genuinely stale view still refreshes at once.
 */
export const ADSB_REFETCH_GUARD_MS = ADSB_POLL_INTERVAL_MS - 1000
