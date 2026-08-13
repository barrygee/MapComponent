import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import {
  claimAdsbSource,
  releaseAdsbSource,
  type AdsbClaim,
  type AdsbClaimError,
} from '@/services/adsbSourceApi'

/**
 * Cadence for retrying before any claim has succeeded, when the server has not
 * yet had a chance to state its own. Matches the renewal interval it asks for
 * in practice, so the rhythm does not visibly change once a claim lands.
 */
const RETRY_INTERVAL_SECONDS = 30

/**
 * Holds the Sentry dongle behind Off Grid ADS-B for as long as AIR is watching.
 *
 * A dongle serves one tuned purpose at a time. While AIR is showing off-grid
 * aircraft it needs that purpose to be 1090 MHz, and it needs nothing else to
 * change it — so entering AIR takes a lease on the device and tunes it, and
 * leaving gives it back. See Sentinel ADR-0003.
 *
 * **Only off grid.** Online air data comes from airplanes.live and involves no
 * local dongle at all; claiming one then would take hardware away from whatever
 * legitimately wants it, to receive nothing.
 *
 * The lease has a TTL on Sentry's side, so this renews on a timer. That is what
 * makes a closed tab, a slept laptop or a crashed browser release the device
 * without having run any cleanup — the renewals simply stop, and Sentry lets
 * go. `release()` on unmount only makes it prompt.
 */
export function useAdsbSourceClaim() {
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()

  const claim = ref<AdsbClaim | null>(null)
  const error = ref<AdsbClaimError | null>(null)
  const isClaiming = ref(false)
  let renewalTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Whether AIR should be holding the device right now.
   *
   * The air domain's own `sourceOverride` wins over the app-wide mode, matching
   * how `resolve_domain_urls` decides which source to read from — the two must
   * agree, or Sentinel would claim a dongle while reading aircraft from the
   * internet, or read locally while holding nothing.
   */
  const shouldHold = computed(() => {
    const override = settingsStore.getSetting<string>('air', 'sourceOverride', 'auto')
    if (override === 'online') return false
    if (override === 'offgrid') return true
    return appStore.connectivityMode === 'offgrid' || !appStore.isOnline
  })

  function stopRenewals(): void {
    if (renewalTimer !== null) {
      clearInterval(renewalTimer)
      renewalTimer = null
    }
  }

  /**
   * Claim or renew, recording whichever of a lease or a reason came back.
   *
   * `force` is only ever passed by an operator acting on a `device_reserved`
   * message — never by the renewal timer, which must not quietly win a fight it
   * lost a moment ago.
   */
  async function acquire(force = false): Promise<void> {
    isClaiming.value = true
    const result = await claimAdsbSource(force)
    isClaiming.value = false

    if ('error' in result) {
      error.value = result.error
      claim.value = null
      // Keep trying. A device someone else is using, or a Pi that is rebooting,
      // usually becomes available again, and retrying picks it up without the
      // operator doing anything.
      //
      // The timer is (re)started here rather than only on success, because a
      // *first* attempt that fails would otherwise leave no timer at all — the
      // one case where retrying matters most is the one that would never retry.
      // The server's cadence is unknown until a claim succeeds, so this falls
      // back to the same interval the server asks for in practice.
      scheduleRenewals(claim.value?.renew_within_seconds ?? RETRY_INTERVAL_SECONDS)
      return
    }

    error.value = null
    claim.value = result.claim
    scheduleRenewals(result.claim.renew_within_seconds)
  }

  /**
   * (Re)start the renewal timer at the cadence the server asked for.
   *
   * The interval comes from the response rather than being hard-coded here,
   * because the TTL it has to stay inside is Sentry's, and a client guessing
   * would either renew pointlessly often or let the lease lapse.
   */
  function scheduleRenewals(seconds: number): void {
    stopRenewals()
    const interval = Math.max(5, seconds) * 1000
    renewalTimer = setInterval(() => {
      void acquire()
    }, interval)
  }

  /** Give the device back and stop renewing. */
  async function release(): Promise<void> {
    stopRenewals()
    claim.value = null
    error.value = null
    await releaseAdsbSource()
  }

  /** The operator's override, offered after a `device_reserved` refusal. */
  async function takeControl(): Promise<void> {
    await acquire(true)
  }

  watch(
    shouldHold,
    (holding, wasHolding) => {
      if (holding === wasHolding) return
      if (holding) {
        void acquire()
      } else {
        void release()
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    // A release fired from `beforeunload` is best-effort — the request uses
    // `keepalive` so the browser lets it out — but the lease's own expiry is
    // what actually guarantees the device comes back.
    window.addEventListener('beforeunload', releaseAdsbSource)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', releaseAdsbSource)
    stopRenewals()
    void releaseAdsbSource()
  })

  return {
    /** The live claim, or null when nothing is held. */
    claim,
    /** Why the last attempt failed, or null. */
    error,
    isClaiming,
    /** Whether AIR should be holding the device, given mode and override. */
    shouldHold,
    takeControl,
    release,
  }
}
