# ADS-B decoder sidecar (readsb)

Decodes 1090 MHz ADS-B for the AIR map's **Off Grid** mode, from a dongle that
lives on a **remote Sentry**, and publishes the result as `aircraft.json`.

Opt-in: it only builds and runs behind the `adsb` compose profile, so a normal
`docker compose up --build` never touches it.

## Why it is built this way

No mainstream 1090 MHz decoder reads `rtl_tcp`. They expect either a local USB
dongle or an already-demodulated Beast/SBS feed, and here the dongle is on
another machine entirely. readsb's `ifile` device type is the seam that makes a
*remote* dongle usable: it reads raw samples from a file descriptor, which is
exactly what an `rtl_tcp` socket is once its greeting is out of the way.

```
socat TCP:<sentry>:<port>  →  strip 12-byte RTL0 header  →  readsb (ifile)
                                                                 ↓
                                      /run/adsb/data/aircraft.json  →  HTTP :8080
```

`rtl_tcp` opens every connection with 12 bytes — the magic `RTL0`, the tuner
type, and the gain-stage count. readsb's `ifile` input expects nothing but
samples, so those bytes are dropped; left in place they are read as I/Q and put
a burst of nonsense at the head of the stream.

readsb is built from source with `RTLSDR=no`. The dongle is on another machine,
so linking libusb/librtlsdr would pull in drivers this container can never use.

## Bandwidth

This pulls **raw samples** across the network: about **4.8 MB/s — 38 Mbps —
sustained** at 2.4 MSPS, continuously, for as long as it runs.

Decoding on the Pi itself and sending JSON instead would cost a few KB/s. The
arrangement here is a deliberate trade to keep every decoder in one stack; on a
constrained or metered link it is the wrong one.

## Configuration

| Variable | Meaning |
| --- | --- |
| `CONFIG_URL` | Sentinel's `/api/sdr/adsb/config`, polled for the rtl_tcp endpoint. Preferred |
| `RTL_TCP_HOST` / `RTL_TCP_PORT` | Static fallback, for running standalone |
| `SENTRY_API_BASE` | Optional. Read once per source to warn about a mis-tuned dongle |
| `JSON_DIR` | Where readsb writes `aircraft.json` (default `/run/adsb/data`) |
| `HTTP_PORT` | Port this container serves that directory on (default `8080`) |

The source is **re-resolved on every reconnect**, so changing the Off Grid SDR in
Sentinel's settings takes effect at the next attempt rather than needing the
container recreated.

## This container never tunes the dongle

An `rtl_tcp` client normally sets the centre frequency and sample rate itself
over the same socket. This one deliberately does not: on a Sentry those are the
operator's own per-device settings, and a client that quietly retuned them would
change what every other consumer is receiving.

Tuning is Sentinel's job, and it does it properly — it takes an enforced lease on
the device and applies **1090 MHz at 2.4 MSPS** with the claim, then renews both
for as long as AIR is open. See
[`docs/adr/0003-sentry-sdr-lock-and-tune.md`](../../docs/adr/0003-sentry-sdr-lock-and-tune.md).

If the dongle is on the wrong frequency, this container says so once per source
in its logs rather than leaving you to infer it from an empty map.

## Troubleshooting

```bash
docker compose --profile adsb logs -f adsb-decoder
curl -s localhost:8090/data/aircraft.json | head
```

- **`no source to read; retrying`** — nothing is picked in Settings → AIR, and
  no `RTL_TCP_HOST` fallback is set. Expected before first configuration.
- **`"messages": 0` and an empty `aircraft` list** — the stream is arriving but
  decoding nothing. Almost always the dongle is not on 1090 MHz: open AIR off
  grid so Sentinel claims and tunes it, or check the warning this container logs
  at startup.
- **`Broken pipe` from socat** — readsb exited; the line above it says why. The
  supervisor relaunches the whole pipeline every few seconds, so a Sentry reboot
  or a briefly-dropped network heals by itself.
- **Nothing at `/data/aircraft.json`** — readsb has not written a file yet.
  It appears within a second or two of the pipeline starting.
