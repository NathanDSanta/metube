#!/usr/bin/env python3
"""
Plot MeTube ABR results in readable chunks so quality/network changes are easier
to compare.

Examples:
  # One page/image per 10-minute elapsed-time chunk:
  python plot_abr_profiles.py results.csv 70min.csv --chunk-minutes 10

  # Save every chunk as PNG and one multi-page PDF:
  python plot_abr_profiles.py results.csv 70min.csv \
      --chunk-minutes 10 --out-dir abr-chunks --pdf abr-chunks.pdf

  # Use media time rather than elapsed recording time:
  python plot_abr_profiles.py results.csv 70min.csv --chunk-minutes 10 --x-axis media
"""
import argparse
import csv
import math
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.backends.backend_pdf import PdfPages


def load_profiles(path):
    profiles = []
    with open(path, "r", encoding="utf-8-sig") as f:
        f.readline()  # header
        for line_no, line in enumerate(f, start=2):
            line = line.strip()
            if not line:
                continue
            parts = line.split(",", 2)  # labels can contain commas
            if len(parts) < 3:
                raise ValueError(f"{path}:{line_no}: expected duration,rate,label")
            try:
                duration = float(parts[0].strip())
                rate = float(parts[1].strip())
            except ValueError as exc:
                raise ValueError(f"{path}:{line_no}: invalid duration or rate") from exc
            start = sum(p["duration"] for p in profiles)
            profiles.append({
                "start": start, "end": start + duration,
                "duration": duration, "rate": rate, "label": parts[2].strip()
            })
    if not profiles:
        raise ValueError(f"No profiles found in {path}")
    return profiles


def style():
    plt.rcParams.update({
        "figure.facecolor": "#111318", "axes.facecolor": "#111318",
        "savefig.facecolor": "#111318", "text.color": "#e6e6e6",
        "axes.labelcolor": "#e6e6e6", "xtick.color": "#c8cbd0",
        "ytick.color": "#c8cbd0", "axes.edgecolor": "#555b66",
        "grid.color": "#343944", "font.size": 9,
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results_csv")
    parser.add_argument("profiles_csv")
    parser.add_argument("--chunk-minutes", type=float, default=10,
                        help="Length of each graph chunk in minutes (default: 10)")
    parser.add_argument("--out-dir", default="abr-chunks",
                        help="Directory for per-chunk PNG files")
    parser.add_argument("--pdf", default="abr-chunks.pdf",
                        help="Multi-page PDF output; use --pdf '' to disable")
    parser.add_argument("--x-axis", choices=["elapsed", "media"], default="elapsed",
                        help="elapsed aligns with profile schedule; media shows video position")
    parser.add_argument("--full-range", action="store_true",
                        help="Do not clip throughput spikes; can flatten the other lines")
    args = parser.parse_args()

    if args.chunk_minutes <= 0:
        parser.error("--chunk-minutes must be greater than zero")

    results = pd.read_csv(args.results_csv)
    required = {"event_type", "elapsed_s", "media_time_s", "download_bps", "height",
                "level_bitrate_bps", "hls_bandwidth_estimate_bps",
                "fast_ewma_bps", "slow_ewma_bps"}
    missing = required - set(results.columns)
    if missing:
        raise ValueError("Results CSV missing columns: " + ", ".join(sorted(missing)))

    df = results[results["event_type"].eq("segment")].copy()
    if df.empty:
        raise ValueError("No event_type='segment' rows found in results CSV")
    numeric = ["elapsed_s", "media_time_s", "download_bps", "height",
               "level_bitrate_bps", "hls_bandwidth_estimate_bps",
               "fast_ewma_bps", "slow_ewma_bps"]
    for col in numeric:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    xcol = "elapsed_s" if args.x_axis == "elapsed" else "media_time_s"
    df = df.dropna(subset=[xcol]).sort_values(xcol)
    df["x"] = df[xcol]
    for col in ["download_bps", "level_bitrate_bps",
                "hls_bandwidth_estimate_bps", "fast_ewma_bps", "slow_ewma_bps"]:
        df[col.replace("_bps", "_mbps")] = df[col] / 1_000_000

    profiles = load_profiles(args.profiles_csv)
    chunk_seconds = args.chunk_minutes * 60
    max_x = float(df["x"].max())
    chunk_count = max(1, math.ceil((max_x + 1e-9) / chunk_seconds))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = args.pdf.strip() if args.pdf else ""

    style()
    colors = plt.rcParams["axes.prop_cycle"].by_key()["color"]

    pdf = PdfPages(pdf_path) if pdf_path else None
    try:
        for chunk_idx in range(chunk_count):
            start = chunk_idx * chunk_seconds
            end = min((chunk_idx + 1) * chunk_seconds, max_x + 1)
            part = df[(df["x"] >= start) & (df["x"] < end)].copy()
            if part.empty:
                continue

            measured = part["download_mbps"].clip(lower=0)
            positive = measured[measured > 0]
            p90 = float(positive.quantile(0.90)) if not positive.empty else 10.0
            if not p90 or pd.isna(p90):
                p90 = 10.0
            clipped_count = int((measured > p90).sum())
            display_measured = measured if args.full_range else measured.clip(upper=p90)

            fig, (ax1, ax2, ax3) = plt.subplots(
                3, 1, figsize=(14, 9), sharex=True,
                gridspec_kw={"height_ratios": [1.4, 0.8, 0.8], "hspace": 0.16}
            )
            title_time = "elapsed time" if args.x_axis == "elapsed" else "media time"
            fig.suptitle(
                f"MeTube ABR — chunk {chunk_idx + 1}/{chunk_count} "
                f"({start/60:.0f}–{end/60:.1f} min {title_time})",
                fontsize=14, y=0.98
            )

            # Show scheduled profile bands in each chunk. Profile time is elapsed time.
            if args.x_axis == "elapsed":
                for i, profile in enumerate(profiles):
                    left = max(start, profile["start"])
                    right = min(end, profile["end"])
                    if left < right:
                        for ax in (ax1, ax2, ax3):
                            ax.axvspan(left, right, color=colors[i % len(colors)],
                                       alpha=0.10, linewidth=0)
                        # Keep the graph uncluttered: show only the configured rate.
                        ax3.text((left + right) / 2, 0.96,
                                 f'{profile["rate"]:g} Mbps',
                                 transform=ax3.get_xaxis_transform(),
                                 ha="center", va="top", fontsize=8, rotation=0,
                                 color="#e6e6e6", clip_on=True)

            x = part["x"]
            ax1.plot(x, display_measured, linewidth=1.0,
                     label=("Measured segment throughput" if args.full_range else
                            f"Measured throughput (clipped at P90 {p90:.2f} Mbps)"))
            ax1.plot(x, part["fast_ewma_mbps"], linewidth=1.5, label="Fast EWMA")
            ax1.plot(x, part["slow_ewma_mbps"], linewidth=1.5, label="Slow EWMA")
            ax1.plot(x, part["hls_bandwidth_estimate_mbps"], linewidth=1.2,
                     label="hls.js estimate")
            ax1.set_ylabel("Mbps")
            if not args.full_range:
                ax1.set_ylim(bottom=0, top=max(p90 * 1.12, 1))
            ax1.grid(True, alpha=0.8)
            ax1.legend(loc="upper right", ncol=2, fontsize=8, framealpha=0.85)
            if not args.full_range:
                ax1.text(0.01, 0.96,
                         f"{clipped_count}/{len(part)} throughput samples clipped for display",
                         transform=ax1.transAxes, va="top", fontsize=8)

            ax2.step(x, part["height"], where="post", linewidth=1.3,
                     label="Selected video height")
            ax2.set_ylabel("Resolution (p)")
            heights = sorted(part["height"].dropna().unique())
            ax2.set_yticks(heights)
            ax2.grid(True, alpha=0.8)
            ax2.legend(loc="upper right", fontsize=8, framealpha=0.85)

            ax3.step(x, part["level_bitrate_mbps"], where="post", linewidth=1.3,
                     label="Selected rendition nominal bitrate")
            ax3.set_ylabel("Rendition\nMbps")
            ax3.set_ylim(bottom=0)
            ax3.grid(True, alpha=0.8)
            ax3.legend(loc="upper right", fontsize=8, framealpha=0.85)
            ax3.set_xlabel("Elapsed time (seconds)" if args.x_axis == "elapsed"
                           else "Video media time (seconds)")

            fig.text(0.01, 0.015,
                     f"Segments in chunk: {len(part)} · recording elapsed: "
                     f"{part['elapsed_s'].min():.0f}–{part['elapsed_s'].max():.0f}s",
                     fontsize=8, color="#c8cbd0")
            fig.subplots_adjust(top=0.91, bottom=0.08, left=0.08, right=0.98)

            png_path = out_dir / f"chunk-{chunk_idx + 1:02d}-{start/60:.0f}min.png"
            fig.savefig(png_path, dpi=180, bbox_inches="tight")
            if pdf:
                pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)
            print(f"Wrote {png_path}")

        # Add a separate profile schedule page to the PDF, keeping descriptive
        # labels out of the graph panels.
        schedule_df = pd.DataFrame([
            {
                "Profile": p["label"],
                "Rate (Mbps)": p["rate"],
                "Start (min)": p["start"] / 60,
                "End (min)": p["end"] / 60,
                "Duration (min)": p["duration"] / 60,
            }
            for p in profiles
        ])
        schedule_csv = out_dir / "profile-schedule.csv"
        schedule_df.to_csv(schedule_csv, index=False)

        if pdf:
            fig, ax = plt.subplots(figsize=(11, max(4, 0.42 * len(profiles) + 1.8)))
            ax.axis("off")
            ax.set_title("Network profile schedule", fontsize=15, pad=18)
            table = ax.table(
                cellText=[
                    [
                        f'{i + 1}',
                        p["label"],
                        f'{p["rate"]:g} Mbps',
                        f'{p["start"]/60:.1f}',
                        f'{p["end"]/60:.1f}',
                        f'{p["duration"]/60:.1f}',
                    ]
                    for i, p in enumerate(profiles)
                ],
                colLabels=["#", "Profile", "Rate", "Start (min)", "End (min)", "Duration (min)"],
                cellLoc="left", colLoc="left", loc="center",
                colWidths=[0.05, 0.49, 0.13, 0.11, 0.11, 0.11],
            )
            table.auto_set_font_size(False)
            table.set_fontsize(8)
            table.scale(1, 1.45)
            fig.tight_layout()
            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

    finally:
        if pdf:
            pdf.close()

    if pdf_path:
        print(f"Wrote {pdf_path}")
    print(f"Wrote {out_dir / 'profile-schedule.csv'}")
    print(f"Total segments: {len(df)}")
    print(f"Chunks of {args.chunk_minutes:g} minutes; x-axis: {args.x_axis}")


if __name__ == "__main__":
    main()
