import express from "express";
import cors from "cors";
import multer from "multer";
import sqlite3 from "sqlite3";
import { execFile } from "child_process";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

const execFileAsync = promisify(execFile);

const VIDEO_QUALITIES = [
  {
    name: "240p",
    height: 240,
    bitrate: "400k",
    maxrate: "450k",
    bufsize: "800k",
  },
  {
    name: "480p",
    height: 480,
    bitrate: "1000k",
    maxrate: "1100k",
    bufsize: "2000k",
  },
  {
    name: "720p",
    height: 720,
    bitrate: "2800k",
    maxrate: "3000k",
    bufsize: "5600k",
  },
  {
    name: "1080p",
    height: 1080,
    bitrate: "5000k",
    maxrate: "5500k",
    bufsize: "10000k",
  },
];

// ---------------------------------------------------------
// CORS
// ---------------------------------------------------------

const allowedOrigins = ["http://metube.nds", "https://metube.nds"];

const corsOptions = {
  origin: (origin, callback) => {
    // Also allow requests without an Origin header, such as curl.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS: Origin not allowed"));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Range"],
  exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
};

app.use(cors(corsOptions));
app.options("/{*splat}", cors(corsOptions));
app.use(express.json());

// ---------------------------------------------------------
// Directories
// ---------------------------------------------------------

const UPLOADS_DIR = path.join(__dirname, "uploads");
const HLS_DIR = path.join(__dirname, "hls");
const THUMBNAILS_DIR = path.join(__dirname, "thumbnails");
const DB_PATH = path.join(__dirname, "videos.db");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(HLS_DIR, { recursive: true });
fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

// ---------------------------------------------------------
// SQLite
// ---------------------------------------------------------

sqlite3.verbose();

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

await run(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    username TEXT NOT NULL,
    duration REAL NOT NULL,
    posted_at TEXT NOT NULL,
    status TEXT NOT NULL,
    hls_url TEXT NOT NULL,
    thumbnail_url TEXT
  )
`);

await run(`
  CREATE INDEX IF NOT EXISTS idx_videos_posted_at
  ON videos(posted_at)
`);

// ---------------------------------------------------------
// Static HLS files
// ---------------------------------------------------------

app.use(
  "/hls",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Range");
    res.header(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges",
    );
    next();
  },
  express.static(HLS_DIR),
);

app.use(
  "/thumbnails",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(THUMBNAILS_DIR),
);

// ---------------------------------------------------------
// Multer
// ---------------------------------------------------------

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname) || ".mp4";
    cb(null, `${createVideoId()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    // 2 GB maximum upload. Change this if the lab needs more.
    fileSize: 2 * 1024 * 1024 * 1024,
  },
});

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function createVideoId() {
  // 8 hexadecimal characters.
  return crypto.randomBytes(4).toString("hex");
}

function deleteFile(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Could not delete file ${filePath}:`, error.message);
  }
}

function deleteDirectory(directoryPath) {
  try {
    if (fs.existsSync(directoryPath)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(
      `Could not delete directory ${directoryPath}:`,
      error.message,
    );
  }
}

async function getVideoInfo(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath,
  ]);

  const data = JSON.parse(stdout);

  if (!data.streams || data.streams.length === 0) {
    throw new Error("Could not determine video dimensions");
  }

  const width = Number(data.streams[0].width);
  const height = Number(data.streams[0].height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Invalid video dimensions");
  }

  return {
    width,
    height,
  };
}

async function getVideoDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  const duration = Number.parseFloat(stdout.trim());

  if (!Number.isFinite(duration)) {
    throw new Error("Could not determine video duration");
  }

  return duration;
}

async function generateThumbnail(videoId, videoPath, duration) {
  const thumbnailPath = path.join(THUMBNAILS_DIR, `${videoId}.jpg`);

  // Avoid the very beginning and very end of the video.
  const minTime = Math.min(5, duration * 0.1);
  const maxTime = Math.max(minTime, duration - Math.min(5, duration * 0.1));

  const timestamp = minTime + Math.random() * (maxTime - minTime);

  console.log(
    `Generating thumbnail for ${videoId} at ${timestamp.toFixed(2)}s`,
  );

  await execFileAsync("ffmpeg", [
    "-ss",
    timestamp.toFixed(2),

    "-i",
    videoPath,

    "-frames:v",
    "1",

    "-q:v",
    "2",

    "-vf",
    "scale=w=640:h=-2",

    "-y",
    thumbnailPath,
  ]);

  return thumbnailPath;
}

// ---------------------------------------------------------
// Routes
// ---------------------------------------------------------

// GET: Fetch all videos
app.get("/api/videos", async (req, res) => {
  try {
    const videos = await all(`
      SELECT id, title, description, username, duration,
             posted_at, status, hls_url, thumbnail_url
      FROM videos
      ORDER BY posted_at DESC
    `);

    res.json(videos);
  } catch (error) {
    console.error("Could not fetch videos:", error);
    res.status(500).json({ error: "Could not fetch videos" });
  }
});

// GET: Fetch one video
app.get("/api/videos/:id", async (req, res) => {
  try {
    const video = await get(
      `
      SELECT id, title, description, username, duration,
             posted_at, status, hls_url, thumbnail_url
      FROM videos
      WHERE id = ?
    `,
      [req.params.id],
    );

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json(video);
  } catch (error) {
    console.error("Could not fetch video:", error);
    res.status(500).json({ error: "Could not fetch video" });
  }
});

// POST: Upload video
//
// multipart/form-data fields:
//   file        -> video file
//   title       -> video title
//   description -> short description
//   username    -> name entered by the uploader

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const username = String(req.body.username || "").trim();

  if (!title || !description || !username) {
    deleteFile(req.file.path);

    return res.status(400).json({
      error: "title, description and username are required",
    });
  }

  if (title.length > 150) {
    deleteFile(req.file.path);
    return res.status(400).json({ error: "Title is too long" });
  }

  if (description.length > 500) {
    deleteFile(req.file.path);
    return res.status(400).json({ error: "Description is too long" });
  }

  if (username.length > 80) {
    deleteFile(req.file.path);
    return res.status(400).json({ error: "Username is too long" });
  }

  const videoId = createVideoId();
  const rawFilePath = req.file.path;
  const videoHlsFolder = path.join(HLS_DIR, videoId);

  try {
    fs.mkdirSync(videoHlsFolder, { recursive: true });

    // Read video duration using ffprobe.
    const duration = await getVideoDuration(rawFilePath);
    const thumbnailUrl = `/thumbnails/${videoId}.jpg`;

    await generateThumbnail(videoId, rawFilePath, duration);

    const postedAt = new Date().toISOString();
    const hlsUrl = `/hls/${videoId}/master.m3u8`;

    await run(
      `
      INSERT INTO videos (
        id,
        title,
        description,
        username,
        duration,
        posted_at,
        status,
        hls_url,
        thumbnail_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        videoId,
        title,
        description,
        username,
        duration,
        postedAt,
        "transcoding",
        hlsUrl,
        thumbnailUrl,
      ],
    );

    const video = {
      id: videoId,
      title,
      description,
      username,
      duration,
      posted_at: postedAt,
      status: "transcoding",
      hls_url: hlsUrl,
      thumbnailUrl: thumbnailUrl,
    };

    // Respond immediately. Transcoding happens afterwards.
    res.status(202).json(video);

    // -----------------------------------------------------
    // FFmpeg / HLS
    // -----------------------------------------------------

    const videoInfo = await getVideoInfo(rawFilePath);

    console.log(`Source video: ${videoInfo.width}x${videoInfo.height}`);

    // Only generate qualities that the original video can actually support.
    const availableQualities = VIDEO_QUALITIES.filter(
      (quality) => videoInfo.height >= quality.height,
    );

    if (availableQualities.length === 0) {
      throw new Error(
        `Video is too small. Minimum supported resolution is ${VIDEO_QUALITIES[0].height}p`,
      );
    }

    console.log(
      `Available qualities: ${availableQualities
        .map((quality) => quality.name)
        .join(", ")}`,
    );

    const variantPlaylistPattern = path.join(videoHlsFolder, "v%v.m3u8");

    const segmentFilenamePattern = path.join(videoHlsFolder, "v%v_%03d.ts");

    // Build the video split filter dynamically.
    const splitOutputs = availableQualities
      .map((_, index) => `[v${index}]`)
      .join("");

    const splitFilter = `[0:v]split=${availableQualities.length}${splitOutputs}`;

    // Create one scale filter for each quality.
    const scaleFilters = availableQualities
      .map(
        (quality, index) =>
          `[v${index}]scale=w=trunc(oh*a/2)*2:h=${quality.height}[v${index}out]`,
      )
      .join(";");

    // Build the complete filter graph.
    const filterComplex = `${splitFilter};${scaleFilters}`;

    // Build video/audio mappings.
    const mapArgs = [];

    availableQualities.forEach((_, index) => {
      mapArgs.push("-map", `[v${index}out]`, "-map", "0:a:0");
    });

    // Build codec settings for every video stream.
    const codecArgs = [];

    availableQualities.forEach((quality, index) => {
      codecArgs.push(
        `-c:v:${index}`,
        "libx264",
        `-b:v:${index}`,
        quality.bitrate,
        `-maxrate:v:${index}`,
        quality.maxrate,
        `-bufsize:v:${index}`,
        quality.bufsize,
      );
    });

    // Build the HLS variant mapping.
    const varStreamMap = availableQualities
      .map(
        (_, index) =>
          `v:${index},a:${index},name:${availableQualities[index].name}`,
      )
      .join(" ");

    const ffmpegArgs = [
      "-i",
      rawFilePath,

      "-filter_complex",
      filterComplex,

      ...mapArgs,

      ...codecArgs,

      "-preset",
      "medium",

      "-c:a",
      "aac",
      "-b:a",
      "128k",

      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_playlist_type",
      "vod",

      "-hls_segment_filename",
      segmentFilenamePattern,

      "-master_pl_name",
      "master.m3u8",

      "-var_stream_map",
      varStreamMap,

      variantPlaylistPattern,
    ];

    console.log(`Transcoding started for video: ${videoId}`);
    console.log(
      `Qualities: ${availableQualities.map((q) => q.name).join(", ")}`,
    );

    try {
      await execFileAsync("ffmpeg", ffmpegArgs);

      await run(`UPDATE videos SET status = ? WHERE id = ?`, [
        "ready",
        videoId,
      ]);

      console.log(`Transcoding finished for video: ${videoId}`);
    } catch (error) {
      console.error(`Transcoding failed for ${videoId}:`, error.message);

      await run(`UPDATE videos SET status = ? WHERE id = ?`, [
        "failed",
        videoId,
      ]);

      deleteDirectory(videoHlsFolder);
    } finally {
      deleteFile(rawFilePath);
    }
  } catch (error) {
    console.error(`Could not process video ${videoId}:`, error);

    deleteFile(rawFilePath);
    deleteFile(path.join(THUMBNAILS_DIR, `${videoId}.jpg`));
    deleteDirectory(videoHlsFolder);

    try {
      await run(`DELETE FROM videos WHERE id = ?`, [videoId]);
    } catch (dbError) {
      console.error("Could not remove failed video from database:", dbError);
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: "Could not process video",
      });
    }
  }
});

// ---------------------------------------------------------
// RESET server
// ---------------------------------------------------------

app.delete("/api/reset", async (req, res) => {
  try {
    // Delete all database records
    await run("DELETE FROM videos");

    // Delete all uploaded original videos
    fs.rmSync(UPLOADS_DIR, {
      recursive: true,
      force: true,
    });

    // Delete all generated HLS files
    fs.rmSync(HLS_DIR, {
      recursive: true,
      force: true,
    });

    // Recreate empty directories
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.mkdirSync(HLS_DIR, { recursive: true });

    res.json({
      message: "Application state reset successfully",
    });
  } catch (error) {
    console.error("Could not reset application:", error);

    res.status(500).json({
      error: "Could not reset application",
    });
  }
});

// ---------------------------------------------------------
// Start server
// ---------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Express HLS backend running on http://localhost:${PORT}`);
  console.log("Allowed frontend domain: http://metube.nds");
});
