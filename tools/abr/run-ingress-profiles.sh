#!/usr/bin/env bash
# Shape incoming traffic on a dedicated Linux test machine using an IFB device.
# WARNING: this script temporarily replaces qdiscs on the selected interface and
# removes them on exit. Use only on a disposable/test interface with no existing
# traffic-control configuration. It does not attempt to reconstruct prior qdiscs.
set -Eeuo pipefail

usage() {
  echo "Usage: sudo $0 <network-interface> <profiles.csv> --i-understand"
  echo "CSV columns: duration_seconds,rate_mbit,label; use 'unlimited' for no cap."
}

[[ $# -eq 3 && "$3" == "--i-understand" ]] || { usage; exit 2; }
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
IFACE=$1
PROFILE_FILE=$2
IFB=ifb-abr

ip link show "$IFACE" >/dev/null 2>&1 || { echo "Unknown interface: $IFACE" >&2; exit 1; }
[[ -r "$PROFILE_FILE" ]] || { echo "Cannot read profiles: $PROFILE_FILE" >&2; exit 1; }
command -v tc >/dev/null || { echo "Install iproute2 (tc)." >&2; exit 1; }

cleanup() {
  echo "Cleaning up ABR traffic shaping..."
  tc qdisc del dev "$IFACE" ingress 2>/dev/null || true
  tc qdisc del dev "$IFB" root 2>/dev/null || true
  ip link set "$IFB" down 2>/dev/null || true
  ip link del "$IFB" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Do not silently overwrite existing shaping rules.
if tc qdisc show dev "$IFACE" | grep -qE ' (ingress|clsact|htb|tbf|cake|fq_codel|netem)'; then
  echo "The interface already has a qdisc. Inspect 'tc qdisc show dev $IFACE' first." >&2
  echo "Choose a dedicated interface or remove the existing rules manually." >&2
  exit 1
fi

modprobe ifb numifbs=1
ip link add "$IFB" type ifb 2>/dev/null || true
ip link set "$IFB" up

# Redirect ingress packets to IFB, where egress shaping applies to received traffic.
tc qdisc add dev "$IFACE" handle ffff: ingress
tc filter add dev "$IFACE" parent ffff: protocol all u32 match u32 0 0 \
  action mirred egress redirect dev "$IFB"

echo "Interface: $IFACE (incoming traffic redirected to $IFB)"
echo "Started: $(date --iso-8601=seconds)"

tail -n +2 "$PROFILE_FILE" | while IFS=, read -r duration rate label; do
  [[ -n "${duration//[[:space:]]/}" ]] || continue
  [[ "$duration" =~ ^[0-9]+$ ]] || { echo "Invalid duration: $duration" >&2; exit 1; }
  echo "$(date --iso-8601=seconds),$label,$rate,$duration" | tee -a abr-profile-log.csv

  if [[ "$rate" == "unlimited" ]]; then
    tc qdisc del dev "$IFB" root 2>/dev/null || true
    echo "Profile '$label': no artificial rate cap for ${duration}s"
  else
    # TBF burst is large enough for normal packet bursts but bounded for repeatability.
    tc qdisc replace dev "$IFB" root tbf rate "${rate}mbit" burst 512kb latency 150ms
    echo "Profile '$label': ${rate} Mbit/s for ${duration}s"
  fi
  sleep "$duration"
done

echo "Profiles completed: $(date --iso-8601=seconds)"
