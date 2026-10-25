# MeTube ABR experiment tools

This folder contains an isolated experiment route, a CSV-to-figure script, and an optional Linux ingress shaper. The ordinary MeTube watch route does not enable recording or change its hls.js configuration.

## Included changes

- `frontend/src/AbrExperimentPage.jsx` — a dedicated player at `/experiment/:id`, event recording, CSV export, and automatic download at end-of-playback.
- `frontend/src/abr-lab.css` — isolated styling for the experiment route.
- `frontend/src/App.jsx` — route registration and a link from the normal watch page.
- `tools/abr/plot_abr.py` — offline renderer that produces PNG and PDF from the exported CSV.
- `tools/abr/run-ingress-profiles.sh` — optional Linux `tc`/IFB script to apply staged incoming bandwidth limits.
- `tools/abr/profiles/example-profiles.csv` — example 10-minute profiles.

## Frontend installation

1. Copy the changed frontend files into the same paths in your repository.
2. From `frontend/`, run `npm install` if needed and `npm run build`.
3. Start MeTube normally. Open a ready video and click **Open ABR experiment lab**, or visit `/experiment/VIDEO_ID`.
4. In the lab, click **Start / restart recording**. It resets the lab player to the beginning and starts playback. The normal `/watch/:id` route is not instrumented.
5. Let the video finish to download the CSV automatically. You can disable automatic download, stop recording manually, or download the current data at any time.

The CSV has one row per completed main-video HLS fragment. It records media start/end, rendition index/resolution/advertised bitrate, download timing/bytes/throughput, buffering/played flags, the exposed hls.js bandwidth estimate when available, and two companion EWMA curves. The `network_profile` value is the label selected in the lab when that fragment completes; change the label when the shaper enters a new phase.

### Interpreting the curves

- `download_bps` is bytes loaded divided by the fragment's measured loading time. It is a per-fragment throughput sample, not a continuous physical-layer bandwidth measurement.
- `fast_ewma_bps` and `slow_ewma_bps` are transparent companion estimates with 3 s and 9 s half-lives, computed from those samples. They are **not claimed to be the private internal fast/slow estimator values inside hls.js**.
- `hls_bandwidth_estimate_bps` records the aggregate estimate exposed by the installed hls.js version, if available.
- `played=true` means the playback head was observed within that segment's media interval. `buffered=true` means hls.js reported the fragment as buffered. A segment can be buffered before it is played.
- Browser download prompts are controlled by the browser. Automatic export is attempted at the `ended` event; if the browser blocks it, use **Download CSV now**.

## Offline graph generation

Python 3 and Matplotlib are required. From this directory:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -r tools/abr/plot-requirements.txt
python tools/abr/plot_abr.py /path/to/metube-abr-video-YYYY-MM-DDTHH-MM-SS.csv
```

This creates a same-basename `.png` (220 DPI) and `.pdf` next to the input. The x-axis is media time; segment rectangles span the playlist segment duration. Rendition bands are derived from the advertised bitrates in the CSV. Red means observed played, blue means buffered but not observed playing. Bandwidth and EWMA curves are drawn over the same bitrate axis. Curves are associated with the segment's media start, which is useful for visualizing adaptation across the content timeline; retain `elapsed_s`/download timestamps for wall-clock analyses.

## Optional bandwidth shaping (Linux)

**Caution:** this script temporarily replaces traffic-control rules on the selected interface and deletes its temporary rules on exit. It deliberately refuses to run if it detects an existing nontrivial qdisc. Use a dedicated test interface or disposable test machine; do not run on a production/server interface or over a connection you cannot afford to interrupt. It does not restore custom qdiscs that were present before execution.

Install `iproute2` (for `tc`) and ensure the kernel supports IFB. Edit a copy of the profile CSV so that each row contains `duration_seconds,rate_mbit,label`. Rates are in Mbit/s; use `unlimited` for a phase without an artificial cap.

```bash
sudo tools/abr/run-ingress-profiles.sh enp3s0 tools/abr/profiles/example-profiles.csv --i-understand
```

Replace `enp3s0` with the interface receiving the video traffic. The script logs phase start timestamps to `abr-profile-log.csv` in its current directory. Run the browser experiment on the same machine whose incoming traffic is shaped. If MeTube is hosted on the same machine, verify the route/interface first; traffic that stays on loopback or an unshaped local bridge will not be limited by this script.

For repeatable research, note the video ID, browser, hls.js version, machine/interface, profile file, and experiment date. Repeat each profile sequence more than once if you plan to compare results.

## Limitations / scientific notes

- The frontend route records HLS.js fragment events. Native browser HLS playback (commonly Safari) is not instrumented by this hls.js event recorder; use a browser where `Hls.isSupported()` is true.
- Download throughput varies with segment size, HTTP overhead, caching, server load, and concurrent traffic. Treat it as a measured application-layer sample.
- The plotter expects segment rows from this CSV schema. If the CSV schema changes, update `CSV_COLUMNS` and the plotting script together.
