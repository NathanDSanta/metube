#!/bin/bash

set -e

DB="videos.db"
HLS_DIR="hls"
THUMBNAILS_DIR="thumbnails"

mkdir -p "$THUMBNAILS_DIR"

echo "Generating thumbnails from HLS videos..."
echo

sqlite3 -separator '|' "$DB" \
    "SELECT id, duration FROM videos WHERE thumbnail_url IS NULL OR thumbnail_url = '';" |
while IFS='|' read -r id duration; do

    echo "Processing: $id"

    VIDEO_DIR="$HLS_DIR/$id"

    if [ ! -d "$VIDEO_DIR" ]; then
        echo "  WARNING: HLS directory not found: $VIDEO_DIR"
        continue
    fi

    # Prefer the highest available quality.
    input=""

    for quality in v1080p v720p v480p v240p; do
        if [ -f "$VIDEO_DIR/$quality.m3u8" ]; then
            input="$VIDEO_DIR/$quality.m3u8"
            break
        fi
    done

    if [ -z "$input" ]; then
        echo "  WARNING: No HLS playlist found"
        continue
    fi

    # Pick a random point between 10% and 90% of the video.
    timestamp=$(awk -v duration="$duration" 'BEGIN {
        min = duration * 0.10
        max = duration * 0.90

        srand()
        print min + rand() * (max - min)
    }')

    output="$THUMBNAILS_DIR/$id.jpg"

    echo "  Source: $input"
    echo "  Timestamp: ${timestamp}s"

    ffmpeg \
        -ss "$timestamp" \
        -i "$input" \
        -frames:v 1 \
        -q:v 2 \
        -vf "scale=w=640:h=-2" \
        -y \
        "$output" \
        -loglevel error

    if [ -f "$output" ]; then

        sqlite3 "$DB" \
            "UPDATE videos
             SET thumbnail_url='/thumbnails/$id.jpg'
             WHERE id='$id';"

        echo "  ✓ Thumbnail created: $output"

    else
        echo "  ✗ Failed to create thumbnail"
    fi

    echo

done

echo "Done!"
