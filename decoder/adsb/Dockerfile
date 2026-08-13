# ADS-B decoder sidecar — builds readsb from source and feeds it the raw I/Q
# stream from a remote Sentry rtl_tcp port, publishing `aircraft.json` over HTTP
# for Sentinel's Off Grid air source.
#
# Why a build from source: no Debian package ships readsb, and no mainstream
# 1090 MHz decoder reads rtl_tcp natively — they expect either a local USB
# dongle or an already-demodulated Beast/SBS feed. readsb's `ifile` device type
# is the seam that makes a *remote* dongle usable: it reads raw samples from a
# file descriptor, which is exactly what an rtl_tcp socket is once its 12-byte
# header is stripped.
#
# RTL-SDR support is deliberately compiled OUT (`RTLSDR=no`). The dongle is on
# another machine, so linking libusb/librtlsdr here would pull in drivers this
# container can never use and enlarge the image for nothing.
#
# OPT-IN, like the other decoders: gated behind the `adsb` compose profile, so
# it is never built or started unless asked for. Unlike the voice decoder there
# is no patent concern here — readsb is GPL and 1090 MHz needs no vocoder — it
# is gated because it is a heavyweight sidecar most deployments (which use the
# online source) do not want running.

ARG READSB_REF=dev

# ── Stage 1: build readsb ─────────────────────────────────────────────────────
FROM debian:bookworm-slim AS build
ARG READSB_REF

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential pkg-config \
        libncurses-dev zlib1g-dev libzstd-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${READSB_REF}" \
        https://github.com/wiedehopf/readsb.git /src/readsb \
    && cd /src/readsb \
    && make RTLSDR=no OPTIMIZE="-O2" -j"$(nproc)" \
    && strip readsb

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# `socat` reads the rtl_tcp stream; `python3` runs the supervisor and serves the
# JSON. No compiler, no git, no build headers.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 socat ca-certificates \
        libncurses6 libncursesw6 libtinfo6 zlib1g libzstd1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin adsb

COPY --from=build /src/readsb/readsb /usr/local/bin/readsb
COPY entrypoint.py /app/entrypoint.py

# readsb writes `aircraft.json` here and the supervisor serves this directory.
RUN mkdir -p /run/adsb/data && chown -R adsb:adsb /run/adsb

USER adsb
WORKDIR /app

EXPOSE 8080

# No shell form: the supervisor must be PID 1 so it receives SIGTERM directly
# and can stop readsb rather than being killed alongside it.
ENTRYPOINT ["python3", "-u", "/app/entrypoint.py"]
