/**
 * One-time cleanup of localStorage keys written by features that no longer
 * exist.
 *
 * The SDR store caches its settings in localStorage so the first render is
 * correct before the async settings fetch resolves. When a feature is removed,
 * its cached keys stay in every browser that ever ran the old build — nothing
 * reads them, but they resurface in any manual inspection of the app's storage
 * and are indistinguishable there from live state. The backend counterpart is
 * `prune_removed_settings()` in `backend/database.py`, which drops the same
 * features' rows from the settings table.
 */

/** Keys removed features left behind. Add to this list when removing a feature. */
export const REMOVED_STORAGE_KEYS: readonly string[] = [
  // Trunk tracking (removed 2026-08-15, ADR-0004): the master feature flag and
  // the last-selected channel-map filename.
  'sdrTrunkTrackingEnabled',
  'sdrTrunkChannelMap',
]

/**
 * Delete every key in {@link REMOVED_STORAGE_KEYS} from localStorage.
 *
 * Called once at app startup. Safe to call repeatedly — removing an absent key
 * is a no-op — and safe where storage is unavailable (private mode, blocked by
 * policy): the stale keys are inert, so a failure to clear them is not worth
 * propagating into startup.
 */
export function clearRemovedStorageKeys(): void {
  try {
    REMOVED_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
  } catch {
    /* storage blocked — nothing reads these keys anyway */
  }
}
