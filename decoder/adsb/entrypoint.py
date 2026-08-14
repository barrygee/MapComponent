#!/usr/bin/env python3
"""ADS-B decoder sidecar supervisor.

Pulls the raw I/Q stream from a remote Sentry `rtl_tcp` port, feeds it to
readsb, and serves the resulting ``aircraft.json`` over HTTP for Sentinel's Off
Grid air source to poll.

The pipeline, and why each piece is there::

    socat TCP:<sentry>:<port>  →  strip 12-byte RTL0 header  →  readsb (ifile)
                                                                     ↓
                                          /run/adsb/aircraft.json  →  HTTP

``rtl_tcp`` opens every connection with a 12-byte header — the magic ``RTL0``,
then the tuner type and gain-stage count. readsb's ``ifile`` mode expects
nothing but samples, so those 12 bytes have to go: left in place they are read
as I/Q and put a burst of nonsense at the head of the stream.

**This container never tunes the dongle.** An rtl_tcp client normally sets the
centre frequency and sample rate itself over the same socket, but on a Sentry
those are the operator's own per-device settings and a client that quietly
retuned them would be changing what another consumer is receiving. The dongle
must therefore already be set to **1090 MHz at 2.4 MSPS** in Sentry; anything
else decodes to silence, which is why that is checked and logged at startup
rather than left to be discovered from an empty map.

Uses only the Python standard library so the runtime image stays minimal.

Environment:
    CONFIG_URL                    Sentinel's `/api/sdr/adsb/config`, polled for the
                                  rtl_tcp endpoint. Preferred over RTL_TCP_HOST/PORT
    RTL_TCP_HOST / RTL_TCP_PORT   static fallback when CONFIG_URL is unset or silent
    JSON_DIR                      where readsb writes aircraft.json
    HTTP_PORT                     port this process serves JSON_DIR on
    SENTRY_API_BASE               optional; polled once at startup to report
                                  what the source device is tuned to
    READSB_EXTRA_ARGS             optional extra readsb args (space-separated)
"""

from __future__ import annotations

import functools
import json
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RTL_TCP_HEADER_BYTES = 12
"""`rtl_tcp`'s greeting: b"RTL0" + tuner type (4 bytes) + gain count (4 bytes)."""

EXPECTED_CENTRE_HZ = 1_090_000_000
EXPECTED_SAMPLE_RATE = 2_400_000

RESTART_DELAY_SECONDS = 5
"""Pause before relaunching the pipeline, so a hard-down Sentry is not hammered."""


def log(message: str) -> None:
    """Timestamped line on stdout, which is where compose collects logs."""
    print(f"[adsb] {message}", flush=True)


def _environment_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        log(f"{name} is not a number; using {default}")
        return default


def resolve_source(config_url: str, fallback: tuple[str, int]) -> tuple[str, int] | None:
    """Ask Sentinel where this decoder's I/Q lives, falling back to the environment.

    The source belongs to the operator's choice in Sentinel, not to this
    container's environment: pointing AIR at a different dongle should not mean
    editing compose and recreating a container. Polling for it keeps the fact in
    one place and lets the change take effect on the next reconnect.

    Falls back rather than failing when Sentinel cannot be reached or has no
    source configured. A decoder that refused to start until a settings page had
    been visited would be hard to diagnose from the outside — and a static
    `RTL_TCP_HOST` remains a perfectly good way to run this thing standalone.
    """
    if not config_url:
        return fallback if fallback[0] else None
    try:
        with urllib.request.urlopen(config_url, timeout=5) as response:
            payload = json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as error:
        log(f"could not read {config_url} ({error})")
        return fallback if fallback[0] else None

    endpoint = payload.get("rtl_tcp") or {}
    host = endpoint.get("host")
    port = endpoint.get("port")
    if payload.get("configured") and isinstance(host, str) and isinstance(port, int):
        return host, port

    log("Sentinel has no ADS-B source configured yet (Settings → AIR)")
    return fallback if fallback[0] else None


def report_source_tuning(api_base: str, rtl_tcp_port: int) -> None:
    """Log what the Sentry device on this port is tuned to, if it will say.

    Advisory only, and deliberately non-fatal: `/api/v1/sdrs` is unauthenticated
    (Sentry ADR-0010) but reports no centre frequency, and `/api/devices`, which
    does, needs a console session this container has no business holding. So
    this reports what it can and stays quiet about the rest — the value is in
    turning "no aircraft, no idea why" into a first log line that names the
    likely cause.
    """
    try:
        with urllib.request.urlopen(f"{api_base.rstrip('/')}/api/v1/sdrs", timeout=5) as response:
            payload = json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as error:
        log(f"could not read Sentry's device list ({error}); continuing")
        return

    for device in payload.get("sdrs", []):
        if device.get("port") != rtl_tcp_port:
            continue
        sample_rate = device.get("bandwidth")
        log(f"source device: {device.get('name')!r} state={device.get('state')}")
        if sample_rate is None:
            log(
                "  WARNING: this device has no sample rate set in Sentry. ADS-B needs "
                f"{EXPECTED_SAMPLE_RATE} with a centre frequency of {EXPECTED_CENTRE_HZ}; "
                "until both are set nothing will decode."
            )
        elif sample_rate != EXPECTED_SAMPLE_RATE:
            log(
                f"  WARNING: sample rate is {sample_rate}, not {EXPECTED_SAMPLE_RATE}. "
                "ADS-B will not decode at this rate."
            )
        return

    log(f"no Sentry device is publishing on port {rtl_tcp_port}; is it enabled and public?")


def build_pipeline(host: str, port: int, json_dir: str) -> subprocess.Popen[bytes]:
    """Start `socat | tail | readsb` and return the process group's handle.

    A shell pipeline rather than three `Popen`s wired together: the middle stage
    is a single `tail -c`, and reimplementing the plumbing in Python would add a
    copy of every byte through the interpreter — 4.8 MB/s of it — to save
    nothing.

    `set -o pipefail` so the whole pipeline reports failure when *any* stage
    dies, not just the last: without it a dropped connection at `socat` leaves
    readsb reading an empty stdin and looking healthy for ever.
    """
    readsb_arguments = [
        "readsb",
        "--device-type",
        "ifile",
        "--ifile",
        "/dev/stdin",
        "--iformat",
        "uc8",
        "--write-json",
        json_dir,
        "--write-json-every",
        "1",
        "--quiet",
        *shlex.split(os.environ.get("READSB_EXTRA_ARGS", "")),
    ]
    pipeline = (
        f"socat -u TCP:{shlex.quote(host)}:{port} - "
        f"| tail -c +{RTL_TCP_HEADER_BYTES + 1} "
        f"| {' '.join(shlex.quote(argument) for argument in readsb_arguments)}"
    )
    log(f"starting pipeline from {host}:{port}")
    return subprocess.Popen(["/bin/bash", "-o", "pipefail", "-c", pipeline])


def serve_json(json_dir: str, http_port: int) -> ThreadingHTTPServer:
    """Serve `json_dir` read-only on `http_port`, in a background thread.

    readsb writes the file; this only publishes it. A directory handler rather
    than a bespoke endpoint so the layout matches every other readsb deployment
    — Sentinel's Off Grid URL is then the same `/data/aircraft.json` an operator
    would type for a tar1090 box, and nothing has to learn a Sentinel-specific
    path.
    """

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            """Silence the per-request log: Sentinel polls this every few seconds."""

        def end_headers(self) -> None:
            # The file is rewritten every second; a cached copy would freeze the
            # map at whatever the first poll saw.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    handler = functools.partial(QuietHandler, directory=json_dir)
    server = ThreadingHTTPServer(("0.0.0.0", http_port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"serving {json_dir} on :{http_port} (aircraft.json)")
    return server


def main() -> int:
    fallback = (os.environ.get("RTL_TCP_HOST", ""), _environment_int("RTL_TCP_PORT", 2345))
    config_url = os.environ.get("CONFIG_URL", "")
    json_dir = os.environ.get("JSON_DIR", "/run/adsb/data")
    http_port = _environment_int("HTTP_PORT", 8080)
    api_base = os.environ.get("SENTRY_API_BASE", "")

    if not config_url and not fallback[0]:
        log("neither CONFIG_URL nor RTL_TCP_HOST is set; nothing to decode")
        return 1

    os.makedirs(json_dir, exist_ok=True)
    # Served from the parent so the file lands at `/data/aircraft.json`, the
    # path every readsb/tar1090 deployment uses — an operator pointing Sentinel
    # at this decoder types the same URL they would for any other receiver.
    serve_json(os.path.dirname(json_dir.rstrip("/")) or "/", http_port)

    stopping = threading.Event()

    def handle_signal(signal_number: int, _frame: object) -> None:
        log(f"signal {signal_number}; stopping")
        stopping.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    # Relaunched rather than exited-on, because the far end is a Raspberry Pi
    # across a network: a reboot, a replugged dongle or a brief drop should
    # heal by itself instead of needing the container restarted.
    reported_for_port: int | None = None
    while not stopping.is_set():
        # Re-resolved on every attempt, so changing the source in Sentinel takes
        # effect at the next reconnect instead of needing the container restarted.
        resolved = resolve_source(config_url, fallback)
        if resolved is None:
            log(f"no source to read; retrying in {RESTART_DELAY_SECONDS}s")
            stopping.wait(RESTART_DELAY_SECONDS)
            continue
        host, port = resolved

        # Once per source, not per reconnect: a mis-tuned dongle is worth saying
        # loudly, and worth saying only once rather than every five seconds.
        if api_base and reported_for_port != port:
            report_source_tuning(api_base, port)
            reported_for_port = port

        process = build_pipeline(host, port, json_dir)
        while not stopping.is_set() and process.poll() is None:
            time.sleep(0.5)
        if stopping.is_set():
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
            break
        log(f"pipeline exited ({process.returncode}); retrying in {RESTART_DELAY_SECONDS}s")
        stopping.wait(RESTART_DELAY_SECONDS)

    return 0


if __name__ == "__main__":
    sys.exit(main())
