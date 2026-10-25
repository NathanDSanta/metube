#!/usr/bin/env python3
"""Render MeTube ABR recorder CSV to a publication-ready PNG and PDF.

Only the Python standard library and matplotlib are required. The input CSV is
created by the dedicated /experiment/:id frontend route.
"""
from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle


def number(row: dict, key: str) -> float | None:
    try:
        value = float(row.get(key, ""))
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def read_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="CSV exported by the MeTube ABR lab")
    parser.add_argument("--out", type=Path, help="Output basename (without extension); defaults beside CSV")
    parser.add_argument("--title", help="Optional graph title")
    args = parser.parse_args()

    rows = read_rows(args.csv)
    rows = [r for r in rows if number(r, "media_time_s") is not None and number(r, "segment_duration_s") is not None]
    if not rows:
        raise SystemExit("No segment rows found. Record a playback experiment first.")

    output = args.out or args.csv.with_suffix("")
    output.parent.mkdir(parents=True, exist_ok=True)

    # The quality metadata is repeated per segment so the CSV remains self-contained.
    levels_by_index: dict[int, dict] = {}
    for row in rows:
        level = number(row, "level")
        bitrate = number(row, "level_bitrate_bps")
        if level is None or bitrate is None or bitrate <= 0:
            continue
        levels_by_index[int(level)] = {
            "level": int(level),
            "height": number(row, "height") or 0,
            "bitrate": bitrate,
        }
    levels = sorted(levels_by_index.values(), key=lambda item: item["bitrate"])
    if not levels:
        raise SystemExit("No rendition bitrate metadata found in the CSV.")

    # Create bitrate bands using midpoints between neighboring rendition bitrates.
    # The outer bands extend to zero and a little above the highest rendition.
    centers = [item["bitrate"] / 1_000_000 for item in levels]
    boundaries = [0.0]
    boundaries.extend((a + b) / 2 for a, b in zip(centers, centers[1:]))
    boundaries.append(max(centers[-1] * 1.25, centers[-1] + 0.5))

    fig, ax = plt.subplots(figsize=(16, 8.5), constrained_layout=True)
    ax.set_facecolor("#08090d")
    fig.patch.set_facecolor("#08090d")
    for spine in ax.spines.values():
        spine.set_color("#777982")
    ax.tick_params(colors="#e4e5eb", labelsize=9)
    ax.xaxis.label.set_color("#e4e5eb")
    ax.yaxis.label.set_color("#e4e5eb")
    ax.grid(True, color="#42444d", linewidth=0.65, alpha=0.75)
    ax.set_axisbelow(True)

    # Build segment columns from all distinct media start times. Each column
    # spans the actual EXTINF duration and contains a cell for every rendition.
    for row in rows:
        start = number(row, "media_time_s")
        duration = number(row, "segment_duration_s")
        level = number(row, "level")
        if start is None or duration is None or level is None:
            continue
        level_index = int(level)
        if level_index not in [item["level"] for item in levels]:
            continue
        pos = next(i for i, item in enumerate(levels) if item["level"] == level_index)
        x0 = start
        width = max(duration, 0.05)
        for band_index, band in enumerate(levels):
            y0, y1 = boundaries[band_index], boundaries[band_index + 1]
            # Keep a thin black grid between adjacent cells.
            ax.add_patch(Rectangle(
                (x0, y0), width, y1 - y0,
                facecolor="#15161c", edgecolor="#030407", linewidth=1.0, zorder=1
            ))
        played = str(row.get("played", "")).lower() in ("true", "1", "yes")
        buffered = str(row.get("buffered", "")).lower() in ("true", "1", "yes")
        color = "#ed1c2b" if played else ("#00a6df" if buffered else None)
        if color:
            ax.add_patch(Rectangle(
                (x0, boundaries[pos]), width, boundaries[pos + 1] - boundaries[pos],
                facecolor=color, edgecolor="#030407", linewidth=0.7, alpha=0.94, zorder=2
            ))

    # Throughput samples are associated with the media start of each segment.
    # Curves are plotted in Mbps on the same bitrate axis as rendition bands.
    def curve(column: str, label: str, color: str, width: float = 1.8, alpha: float = 1.0):
        points = sorted(
            (number(r, "media_time_s"), number(r, column) / 1_000_000)
            for r in rows
            if number(r, "media_time_s") is not None and number(r, column) is not None
            and number(r, column) >= 0
        )
        if points:
            ax.plot([p[0] for p in points], [p[1] for p in points],
                    label=label, color=color, linewidth=width, alpha=alpha, zorder=5)

    curve("download_bps", "Measured segment throughput", "#a6e22e", 1.8, 0.95)
    curve("fast_ewma_bps", "Fast EWMA (3 s half-life)", "#ffb86c", 1.7, 0.95)
    curve("slow_ewma_bps", "Slow EWMA (9 s half-life)", "#bd93f9", 2.0, 0.95)
    curve("hls_bandwidth_estimate_bps", "hls.js estimate", "#f8f8f2", 1.25, 0.75)

    title = args.title or f"MeTube ABR experiment — {rows[0].get('video_title', args.csv.stem)}"
    ax.set_title(title, color="#f4f4f6", fontsize=14, pad=14)
    ax.set_xlabel("Video media time (seconds)")
    ax.set_ylabel("Bitrate / measured throughput (Mbps)")
    ax.set_xlim(left=0)
    ax.set_ylim(bottom=0)
    ax.set_yticks(centers)
    ax.set_yticklabels([
        f"{int(level['height'])}p  ({level['bitrate']/1_000_000:.2f} Mbps)"
        for level in levels
    ])
    ax.legend(loc="upper right", framealpha=0.88, facecolor="#171820",
              edgecolor="#444650", labelcolor="#f4f4f6", fontsize=9)
    fig.text(0.01, 0.01,
             "Red = segment played · Blue = downloaded and buffered but not observed playing · "
             "EWMAs are companion estimates computed from segment throughput.",
             color="#c4c5cd", fontsize=8)

    png = output.with_suffix(".png")
    pdf = output.with_suffix(".pdf")
    fig.savefig(png, dpi=220, facecolor=fig.get_facecolor())
    fig.savefig(pdf, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"Wrote {png}")
    print(f"Wrote {pdf}")


if __name__ == "__main__":
    main()
