import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { JSONFilePreset } from 'lowdb/node';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// 1. Comprehensive CORS Middleware Configuration
const corsOptions = {
  origin: '*', // Allows external HLS players from any domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
};

// Apply CORS to all routes
app.use(cors(corsOptions));

// Explicitly respond to OPTIONS preflight requests globally
app.options('/{*splat}', cors(corsOptions));

app.use(express.json());

// 2. Ensure storage directories exist
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const HLS_DIR = path.join(__dirname, 'hls');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR, { recursive: true });

// 3. Initialize Persistent JSON Database
const defaultData = { videos: [] };
const db = await JSONFilePreset('db.json', defaultData);

// 4. Serve static HLS output files with explicit CORS headers
app.use(
  '/hls',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
    next();
  },
  express.static(HLS_DIR)
);

// 5. Multer configuration for raw video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage });

// --- ROUTES ---

// GET: Fetch all videos
app.get('/api/videos', (req, res) => {
  res.json(db.data.videos);
});

// POST: Upload video & trigger background FFmpeg HLS transcoding
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const videoId = uuidv4();
  const rawFilePath = req.file.path;
  const videoHlsFolder = path.join(HLS_DIR, videoId);

  fs.mkdirSync(videoHlsFolder, { recursive: true });

  const newVideo = {
    id: videoId,
    title: req.file.originalname,
    status: 'transcoding',
    hls_url: `/hls/${videoId}/master.m3u8`,
  };

  db.data.videos.push(newVideo);
  await db.write();

  res.json(newVideo);

  const outputMasterPlaylist = path.join(videoHlsFolder, 'master.m3u8');
  const segmentFilenamePattern = path.join(videoHlsFolder, 'v%v_seq%03d.ts');
  const variantPlaylistPattern = path.join(videoHlsFolder, 'v%v.m3u8');

  const ffmpegCommand = `ffmpeg -i "${rawFilePath}" \
    -filter_complex "[0:v]split=2[v1][v2]; [v1]scale=w=1280:h=720[v1out]; [v2]scale=w=854:h=480[v2out]" \
    -map "[v1out]" -c:v:0 libx264 -b:v:0 2800k \
    -map "[v2out]" -c:v:1 libx264 -b:v:1 1400k \
    -map 0:a -c:a:0 aac -b:a:0 128k \
    -map 0:a -c:a:1 aac -b:a:1 96k \
    -f hls -hls_time 6 -hls_playlist_type vod \
    -hls_segment_filename "${segmentFilenamePattern}" \
    -master_pl_name master.m3u8 \
    -var_stream_map "v:0,a:0 v:1,a:1" \
    "${variantPlaylistPattern}"`;

  console.log(`🎬 Transcoding started for video: ${videoId}`);

  exec(ffmpegCommand, async (error) => {
    const videoInDb = db.data.videos.find((v) => v.id === videoId);
    if (!videoInDb) return;

    if (error) {
      console.error(`Transcoding failed for ${videoId}:`, error.message);
      videoInDb.status = 'failed';
    } else {
      console.log(`Transcoding finished for ${videoId}`);
      videoInDb.status = 'ready';
    }

    await db.write();
  });
});

app.listen(PORT, () => {
  console.log(`Express HLS Backend running on http://localhost:${PORT}`);
});
