# 0003. Lock and tune a Sentry SDR when AIR runs off grid

Date: 2026-08-13
Status: proposed

## Context

Off Grid air data now has a decoder (`decoder/adsb`, readsb) that pulls raw I/Q
from a Sentry `rtl_tcp` port and publishes `aircraft.json`. The pipeline is
proven end to end, and decodes nothing, because the dongle it reads is not tuned
to 1090 MHz.

Tuning it by hand in Sentry's console works but is the wrong shape for three
reasons:

- **It is invisible.** Nothing in Sentinel says the map is empty because a
  dongle 40 metres away is sitting on the wrong frequency. The failure looks
  identical to "no aircraft in range".
- **It is not exclusive.** A Sentry dongle is a single physical resource with
  several possible consumers — Sentinel's AIR, its voice decoder, its APRS
  decoder, a second Sentinel, or an operator in Sentry's own UI. Any of them
  can retune it out from under the others at any moment, and the one that
  loses simply stops decoding without being told why.
- **It does not survive.** A dongle replugged, a Pi rebooted, or a config
  imported can silently reset the tuning that AIR depends on.

The requirement is therefore: **entering AIR while off grid should claim the
source SDR and tune it**, and hold that claim for as long as AIR is the active
view.

Two facts found while investigating constrain the whole design.

### Sentinel cannot currently authenticate to Sentry at all

`backend/services/sentry_client.py:155` sends `Authorization: Bearer <token>`.
Sentry **never reads that header** — ADR-0010 (Sentry) replaced `SENTRY_AUTH_TOKEN`
with a console password proved by a signed `sentry_session` cookie, and
`app/backend/security.py` checks the cookie and nothing else.

So against a password-protected Sentry — which the deployed Pi is — *every*
management call Sentinel makes already fails with 401: device records, device
patches, serial flash. Only `GET /api/health` and `GET /api/v1/sdrs`, which are
deliberately unauthenticated, work. This is a live bug, not merely a blocker
for this feature, and nothing here can work until it is fixed.

### Sentinel does not know which SDR feeds AIR

Off Grid is configured as a *URL* (`air.offgridDataSourceURL`) pointing at a
decoder. Nothing records which **Sentry device** produced the samples behind
that URL, so there is no identity to lock or tune. The decoder container is told
its `rtl_tcp` host and port by environment variable, which is a third place the
same fact is written down.

## Decision

### 1. Sentinel authenticates to Sentry with the console password

Replace the ignored bearer token with the mechanism Sentry actually implements:
`POST /api/auth/login {password}` → store the returned `sentry_session` cookie →
send it on subsequent calls → re-login once on any 401.

The `SentryHost.auth_token` column becomes `console_password` in meaning. It is
already write-only and never returned by Sentinel's API, so its handling does
not change; only what it is and what is done with it.

Rejected: **adding machine tokens back to Sentry.** ADR-0010 removed them
deliberately, and a second credential type would have to be issued, stored,
rotated and revoked. A cookie is a header like any other — an HTTP client can
hold one perfectly well, and the only thing that made cookies awkward for Sentry
(`EventSource` cannot set headers) does not apply to a server-side client.

### 2. Sentry gains a device reservation ("lock")

A reservation is a **lease**, not a flag. The holder identifies itself, states
why, and the lease expires unless renewed.

New columns on `sdr_devices`:

| Column | Meaning |
| --- | --- |
| `reserved_by` | Opaque holder id, e.g. `sentinel:<instance-uuid>` |
| `reserved_label` | Operator-facing, e.g. `Sentinel — AIR (ADS-B)` |
| `reserved_at` | Unix ms the lease was taken |
| `reserved_expires_at` | Unix ms it lapses unless renewed |

New routes, all session-gated:

- `POST /api/devices/{id}/reservation` — acquire or renew. Body carries
  `holder`, `label`, `ttl_seconds`, and optionally the `tuning` to apply
  atomically with the claim. `409 device_reserved` when another holder's lease
  is live, naming the holder and its expiry.
- `DELETE /api/devices/{id}/reservation` — release. Idempotent.

**A lease has a TTL and must be renewed.** This is the single most important
property: without it, a closed browser tab, a crashed container or an unplugged
network cable would lock a dongle until someone found the row in the database.
Proposed 120 s lease, renewed every 30 s — four missed renewals before release,
which tolerates a poll or two being lost without holding the device for minutes
after its consumer has gone.

**Enforcement, not advice.** `PATCH /api/devices/{id}` rejects tuning changes
from anyone but the holder while a lease is live (`409 device_reserved`).
Sentry's own UI shows the holder and offers an explicit override — an operator
standing at the machine must always be able to take their own hardware back, but
should have to mean it.

`GET /api/v1/sdrs` gains `reserved_by`/`reserved_until` on each item, so a
*second* Sentinel can see a device is taken before trying to claim it. Additive,
so it needs no `api_version` bump.

Rejected: **locking by convention** (a notes field, or Sentinel simply not
retuning devices it thinks are busy). The failure this prevents is two consumers
disagreeing, and a lock only the polite participants respect prevents nothing.

Rejected: **permanent locks released only explicitly.** Every distributed
release path — tab closed, laptop asleep, container killed, network partitioned
— fails open into "locked forever".

### 3. The air source names a Sentry device, not just a URL

`air.offgridDataSourceURL` (the decoder's URL) is joined by
`air.offgridSdrSource`: `{sentry_host_id, sentry_device_id}`, chosen from a
picker in Settings → AIR that lists the devices Sentinel already knows about
from its Sentry hosts.

The decoder stops being told its source by environment variable and instead
polls `GET /api/sdr/adsb/config` for the `rtl_tcp` host and port — the pattern
the voice decoder already uses (`CONFIG_URL`). One fact, one place, and changing
the source device in the UI reconfigures the decoder without editing compose.

### 4. AIR claims on entry, renews while open, releases on leave

On entering AIR with effective mode `offgrid` and an `offgridSdrSource` set:

1. Acquire the reservation with the tuning applied atomically —
   `center_hz: 1_090_000_000`, `sample_rate: 2_400_000`, `gain_auto: true`.
2. Renew every 30 s while AIR is the active view.
3. Release on leaving AIR, and on page unload as a best effort; the TTL is what
   actually guarantees release, the explicit call only makes it prompt.

Tuning is applied **with** the claim rather than after it, so there is no window
in which the device is claimed but still on the wrong frequency, and no second
request that can fail on its own.

**Failures surface in the UI, they do not fail silently.** A 409 shows who holds
the device with an override; a 401 says the Sentry host needs its password
setting; an unreachable host says so. The current behaviour — an empty map — is
what this whole ADR exists to stop.

**The previous tuning is not restored on release.** Restoring it sounds tidy but
is the wrong default: an operator who watched AIR, left, and found their dongle
back on 162 MHz would rightly call that a bug, and the value is stale the moment
anyone else touches the device. Whoever wants a frequency claims it.

## Consequences

- Sentinel↔Sentry management calls start working for the first time against a
  protected Sentry. Everything already built on `sentry_client` — device
  records, patches, serial flash — is fixed by the same change.
- Sentry gains a concept it does not have: a device that is *busy*. Its UI must
  show it, and its config import must not stamp over a live lease.
- A dongle can serve exactly one tuned purpose at a time. That is physical
  reality, not a limitation introduced here, but it becomes visible: AIR and the
  voice decoder cannot share one dongle, and the UI must say so rather than
  letting them fight.
- The `sdr_devices` table needs a migration, and `SdrExportItem` grows two
  fields.

## Open questions

1. **Lease TTL and renewal interval** — 120 s / 30 s proposed. Shorter frees a
   dongle faster after a crash; longer tolerates a flakier network.
2. **Override semantics in Sentry's UI** — does taking a device from Sentinel
   notify Sentinel (it will discover the 409 on its next renewal), or is
   discovering it enough?
3. **Multiple receivers.** readsb accepts several feeds via `--net-connector`.
   If AIR is later fed by two dongles, the reservation becomes one-per-source
   and the config endpoint returns a list. Nothing here forecloses that, but it
   is not designed for yet.
