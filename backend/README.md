
# MeTube backend

Express backend for video uploads, SQLite metadata and HLS streaming.

## Requirements

Install Node.js and FFmpeg.

FFmpeg must provide both:

- `ffmpeg`
- `ffprobe`

Check with:

```bash
ffmpeg -version
ffprobe -version
```

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The backend listens on:

```text
http://localhost:3001
```

The frontend is expected to use:

```text
http://metube.nds
```

CORS also accepts:

```text
https://metube.nds
```

## Upload

Send a `multipart/form-data` request to:

```text
POST /api/upload
```

Fields:

```text
file
title
description
username
```

Example with curl:

```bash
curl -X POST http://localhost:3001/api/upload \
  -F "file=@video.mp4" \
  -F "title=My video" \
  -F "description=A short description" \
  -F "username=Nathan"
```

The server returns `202` while the video is being transcoded.

Check:

```text
GET /api/videos/:id
```

The status will change from:

```text
transcoding
```

to:

```text
ready
```

The HLS master playlist is available at:

```text
/hls/<id>/master.m3u8
```

## SQLite

The database is automatically created as:

```text
videos.db
```

The `videos` table stores:

- `id`
- `title`
- `description`
- `username`
- `duration`
- `posted_at`
- `status`
- `hls_url`

The original uploaded video is stored temporarily in `uploads/` and deleted after FFmpeg finishes.

The generated HLS files remain in `hls/`.
