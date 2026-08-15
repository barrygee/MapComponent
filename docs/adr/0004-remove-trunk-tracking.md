# 0004. Remove trunk tracking

Date: 2026-08-15
Status: accepted

## Context

Trunk tracking followed trunked-radio systems by their control channel: `dsd-fme`
decoded the control channel and, on each call grant, retuned to the assigned
voice channel and back. Sentinel shipped it as an opt-in feature behind a master
flag (`sdr.trunkTrackingEnabled`, default OFF).

Supporting it cost a vertical slice through every layer of the app, out of
proportion to a feature that was off by default:

- **A rigctld server in the backend** (`backend/services/sdr_rigctl.py`).
  `dsd-fme` drives retunes over Hamlib's rigctl protocol as the *client*, and
  normally the server is GQRX or SDR++. Sentinel's backend owns the single
  `rtl_tcp` connection and demodulates one channel for the decoder, so `dsd-fme`
  could not tune the hardware itself — the backend had to *be* the rigctld
  server, implementing the command subset `dsd-fme` sends and translating each
  requested frequency into either an in-span demod offset shift or a hardware
  retune.
- **A channel-map store** (`backend/services/sdr_channel_maps.py`) holding JSON
  in the database and rendering it to the CSV files `dsd-fme` loads, plus two
  route groups to edit and list them.
- **A localhost rigctl forwarder in the decoder container**, because `dsd-fme`'s
  rigctl client only ever dials `localhost` while the rigctld server lived in
  the app container.
- **A relaunch path**: `dsd-fme`'s trunking flags are fixed at launch, so
  toggling trunk mode had to bounce the decoder's PCM connection to force the
  sidecar to relaunch it (`DigitalDecodeBridge.bounce_decoder()`).
- **UI in three places**: the panel's TRUNK section, the decode dock's follow
  indicator, and two Settings rows (the master toggle plus a JSON channel-map
  editor gated behind it).

The feature also demanded per-system data Sentinel cannot obtain for the user:
DMR (Tier III / Capacity-Plus / Connect-Plus) and EDACS never transmit their
logical-channel → frequency mapping, so every user had to hand-build a channel
map before trunk tracking could work at all.

## Decision

Remove trunk tracking entirely, rather than keep it behind its flag.

Everything that existed only to serve it goes with it: the rigctld server and
channel-map service, the `trunk_decode` control-socket command, the
`/api/sdr/data/channel-maps` and `/api/sdr/trunk/channel-maps` routes, the
rigctl/channel-map settings, the decoder's `-T/-U/-C/-G` launch flags and rigctl
forwarder, the `decoder/channel-maps` mount, and the panel/dock/Settings UI.

`GET /api/sdr/decode/config` survives in reduced form — it now reports only
`{"active": …}`, which is what the sidecar supervisor gates dsd-fme launches on.

Three removals follow from the above rather than being separately motivated, and
are recorded here so a later reader does not read them as unrelated:

- `DigitalDecodeBridge.bounce_decoder()` and the `connection` /
  `current_offset_hz` accessors — the relaunch path and the values the rigctld
  server read.
- `SettingsPanel`'s `isSettingVisible()` — the channel-map editor was the only
  feature-flag-gated row.
- The `settings-item--wide` grid modifier and its CSS — that editor was its only
  user.

Digital voice decoding itself is untouched: conventional (non-trunked) P25, DMR,
NXDN, D-STAR and YSF decode exactly as before.

## Consequences

- **Breaking for API clients.** `GET`/`POST /api/sdr/data/channel-maps` and
  `GET /api/sdr/trunk/channel-maps` no longer exist, and the SDR control socket
  rejects `trunk_decode`.
- **Existing databases carry dead rows.** `sdr.trunkTrackingEnabled` and
  `sdr.channel_maps` are deleted on startup by `prune_removed_settings()` in
  `backend/database.py`, which is the pattern to extend when a later removal
  strands its own keys. The browser-side caches (`sdrTrunkTrackingEnabled`,
  `sdrTrunkChannelMap`) are cleared once in `main.ts` for the same reason.
- **Operators must update their compose overrides.** `RIGCTL_HOST`,
  `RIGCTL_PORT`, `DECODER_RIGCTL_PORT` and `CHANNEL_MAPS_DIR` are gone, as is
  the `decoder/channel-maps` volume; any existing CSVs are no longer read and
  can be deleted.
- **The decoder container gets simpler**: no forwarder thread, no socket
  plumbing, and a launch command that depends only on the environment.
- **Reinstating trunk tracking means rebuilding the rigctld server**, not
  flipping a flag back on. The design constraint that forced it — the backend
  owning the single `rtl_tcp` connection — has not changed, so this ADR's
  Context is the starting point if that is ever revisited.
- ADR-0002's B-series inventory references `SdrTrunkSection`, one of the five
  pickers that motivated `BaseSelectMenu`. That component no longer exists; see
  the amendment note in ADR-0002.
