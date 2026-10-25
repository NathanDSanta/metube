import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Hls from 'hls.js';
import { getHlsUrl, getVideo } from './api';
import './abr-lab.css';

const CSV_COLUMNS = [
  'event_type', 'elapsed_s', 'media_time_s', 'segment_end_s',
  'level', 'height', 'level_bitrate_bps', 'segment_duration_s',
  'download_start_s', 'download_end_s', 'bytes_loaded', 'download_bps',
  'buffered_end_s', 'playing', 'played', 'buffered',
  'hls_bandwidth_estimate_bps', 'fast_ewma_bps', 'slow_ewma_bps',
  'network_profile', 'segment_sn', 'video_id', 'video_title'
];

const csvEscape = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function downloadCsv(rows, filename) {
  const csv = [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvEscape(row[column])).join(','))
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function estimateEwma(previous, sample, durationSeconds, halfLifeSeconds) {
  if (!Number.isFinite(sample) || sample <= 0) return previous;
  if (!Number.isFinite(previous) || previous <= 0) return sample;
  // Exponential decay weighted by sample duration. These are companion estimates,
  // not hls.js's private estimator state; see the documentation for that distinction.
  const alpha = 1 - Math.exp((-Math.LN2 * Math.max(durationSeconds, 0.001)) / halfLifeSeconds);
  return previous + alpha * (sample - previous);
}

function safeSlug(value) {
  return String(value || 'video').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video';
}

export default function AbrExperimentPage() {
  const { id } = useParams();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const segmentsRef = useRef(new Map());
  const startRef = useRef(0);
  const fastRef = useRef(null);
  const slowRef = useRef(null);
  const profileRef = useRef('unspecified');
  const autoDownloadRef = useRef(true);
  const startedRef = useRef(false);
  const downloadedRef = useRef(false);

  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('Load a video and press Start experiment.');
  const [rowCount, setRowCount] = useState(0);
  const [profile, setProfile] = useState('baseline');
  const [autoDownload, setAutoDownload] = useState(true);
  const [manualDownloadReady, setManualDownloadReady] = useState(false);

  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { autoDownloadRef.current = autoDownload; }, [autoDownload]);

  useEffect(() => {
    let cancelled = false;
    getVideo(id).then((item) => {
      if (!cancelled) setVideo(item);
    }).catch((err) => {
      if (!cancelled) setError(err.message || 'Could not load video.');
    });
    return () => { cancelled = true; };
  }, [id]);

  function elapsed() {
    return startRef.current ? (performance.now() - startRef.current) / 1000 : 0;
  }

  function markPlayed() {
    const mediaTime = videoRef.current?.currentTime ?? 0;
    // A segment is marked played once the playback head enters its media interval.
    for (const segment of segmentsRef.current.values()) {
      if (mediaTime >= segment.media_time_s && mediaTime < segment.segment_end_s) {
        segment.played = true;
      }
    }
  }

  function snapshotRows() {
    return Array.from(segmentsRef.current.values()).map((segment) => ({
      event_type: 'segment',
      ...segment,
      buffered_end_s: segment.buffered_end_s ?? (videoRef.current?.buffered?.length
        ? videoRef.current.buffered.end(videoRef.current.buffered.length - 1) : ''),
      playing: segment.playing ?? Boolean(videoRef.current && !videoRef.current.paused && !videoRef.current.ended),
      network_profile: segment.network_profile || profileRef.current,
      video_id: video?.id || id,
      video_title: video?.title || ''
    })).sort((a, b) => Number(a.download_end_s) - Number(b.download_end_s));
  }

  function exportCsv(auto = false) {
    const rows = snapshotRows();
    if (!rows.length) {
      setStatus('No completed HLS segments have been recorded yet.');
      return;
    }
    const name = `metube-abr-${safeSlug(video?.title)}-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`;
    downloadCsv(rows, name);
    downloadedRef.current = true;
    setManualDownloadReady(true);
    setStatus(`${rows.length} segment records exported${auto ? ' automatically at end of playback' : ''}.`);
  }

  function finishRecording({ autoExport = false } = {}) {
    markPlayed();
    const rows = snapshotRows();
    setRecording(false);
    startedRef.current = false;
    setStatus(`Recording stopped. ${rows.length} segment records captured.`);
    setManualDownloadReady(rows.length > 0);
    if (autoExport && autoDownloadRef.current && rows.length && !downloadedRef.current) {
      exportCsv(true);
    }
  }

  function startRecording() {
    segmentsRef.current.clear();
    fastRef.current = null;
    slowRef.current = null;
    startedRef.current = true;
    downloadedRef.current = false;
    startRef.current = performance.now();
    setRowCount(0);
    setManualDownloadReady(false);
    setRecording(true);
    setStatus('Recording HLS segment downloads. Play normally; CSV downloads when playback ends.');
    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.currentTime = 0;
      videoElement.play().catch(() => setStatus('Recording started. Press Play in the video controls to begin playback.'));
    }
  }

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video?.hls_url || !Hls.isSupported()) return undefined;

    const hls = new Hls({
      enableWorker: true,
      capLevelToPlayerSize: false,
      startLevel: -1,
      // Keep the player defaults: the lab observes ABR rather than forcing quality.
    });
    hlsRef.current = hls;
    hls.loadSource(getHlsUrl(video.hls_url));
    hls.attachMedia(element);

    const onFragmentLoaded = (_, data) => {
      if (!startedRef.current || !data.frag || data.frag.type !== 'main') return;
      const frag = data.frag;
      const stats = frag.stats || data.stats || {};
      const loading = stats.loading || {};
      const startMs = Number(loading.start);
      const endMs = Number(loading.end);
      const loadedBytes = Number(stats.loaded || stats.total || 0);
      if (!(loadedBytes > 0) || !Number.isFinite(endMs) || !Number.isFinite(startMs) || endMs <= startMs) return;

      const duration = Number(frag.duration || 0);
      const seconds = (endMs - startMs) / 1000;
      const throughput = (loadedBytes * 8) / seconds;
      fastRef.current = estimateEwma(fastRef.current, throughput, seconds, 3);
      slowRef.current = estimateEwma(slowRef.current, throughput, seconds, 9);
      const level = hls.levels[frag.level] || {};
      const segment = {
        elapsed_s: Number(((endMs - startRef.current) / 1000).toFixed(3)),
        media_time_s: Number(frag.start || 0),
        segment_end_s: Number(((frag.start || 0) + duration).toFixed(3)),
        level: frag.level,
        height: level.height || '',
        level_bitrate_bps: level.bitrate || '',
        segment_duration_s: duration,
        download_start_s: Number(((startMs - startRef.current) / 1000).toFixed(3)),
        download_end_s: Number(((endMs - startRef.current) / 1000).toFixed(3)),
        bytes_loaded: loadedBytes,
        download_bps: Math.round(throughput),
        buffered_end_s: '',
        playing: Boolean(videoRef.current && !videoRef.current.paused && !videoRef.current.ended),
        played: false,
        buffered: false,
        hls_bandwidth_estimate_bps: Number.isFinite(hls.bandwidthEstimate) ? Math.round(hls.bandwidthEstimate) : '',
        fast_ewma_bps: Math.round(fastRef.current),
        slow_ewma_bps: Math.round(slowRef.current),
        network_profile: profileRef.current,
        segment_sn: frag.sn,
        video_id: video?.id || id,
        video_title: video?.title || ''
      };
      // Key by rendition and media start, so a retry can replace a previous record.
      segmentsRef.current.set(`${frag.level}:${frag.sn}:${frag.start}`, segment);
      setRowCount(segmentsRef.current.size);
    };

    const onFragmentBuffered = (_, data) => {
      if (!startedRef.current || !data.frag || data.frag.type !== 'main') return;
      const frag = data.frag;
      const key = `${frag.level}:${frag.sn}:${frag.start}`;
      const segment = segmentsRef.current.get(key);
      if (segment) {
        segment.buffered = true;
        const buffered = videoRef.current?.buffered;
        segment.buffered_end_s = buffered?.length ? buffered.end(buffered.length - 1) : '';
      }
    };

    hls.on(Hls.Events.FRAG_LOADED, onFragmentLoaded);
    hls.on(Hls.Events.FRAG_BUFFERED, onFragmentBuffered);

    const onEnded = () => { if (startedRef.current) finishRecording({ autoExport: true }); };
    element.addEventListener('ended', onEnded);

    return () => {
      element.removeEventListener('ended', onEnded);
      hls.destroy();
      hlsRef.current = null;
    };
  // The player instance belongs to this route and video; recording state is read via refs
  // in event handlers to avoid repeatedly destroying/recreating hls.js.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.hls_url, id]);

  // Mirror the React recording state in a ref for stable native event listeners.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const onTimeUpdate = () => { if (recording) markPlayed(); };
    element.addEventListener('timeupdate', onTimeUpdate);
    return () => element.removeEventListener('timeupdate', onTimeUpdate);
  }, [recording]);

  if (error) return <section className="abr-page"><p className="abr-error">{error}</p><Link to="/">Back to MeTube</Link></section>;
  if (!video) return <section className="abr-page"><p>Loading experiment…</p></section>;

  const canPlay = video.status === 'ready';

  return (
    <section className="abr-page">
      <header className="abr-header">
        <div>
          <p className="eyebrow">METUBE / LAB</p>
          <h1>ABR experiment recorder</h1>
          <p className="abr-muted">A separate player and recorder; normal watch pages remain unchanged.</p>
        </div>
        <Link className="button-secondary" to={`/watch/${video.id}`}>Normal watch page</Link>
      </header>

      {!canPlay ? <div className="abr-panel">This video is not ready yet. Wait for transcoding to finish.</div> : (
        <div className="abr-grid">
          <div className="abr-main">
            <div className="player-container">
              <video ref={videoRef} className="video-player" controls playsInline preload="metadata" />
            </div>
            <div className="abr-panel">
              <h2>{video.title}</h2>
              <p className="abr-muted">{video.description}</p>
              <div className="abr-controls">
                <button className="button-primary" onClick={startRecording} disabled={recording}>
                  {recording ? 'Recording…' : 'Start / restart recording'}
                </button>
                <button className="button-secondary" onClick={() => finishRecording()} disabled={!recording}>
                  Stop recording
                </button>
                <button className="button-secondary" onClick={() => exportCsv(false)} disabled={!segmentsRef.current.size}>
                  Download CSV now
                </button>
              </div>
              <div className="abr-options">
                <label><span>Network profile label</span>
                  <input value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="e.g. 3 Mbps phase" />
                </label>
                <label className="abr-checkbox">
                  <input type="checkbox" checked={autoDownload} onChange={(event) => setAutoDownload(event.target.checked)} />
                  Automatically download CSV when playback ends
                </label>
              </div>
              <div className="abr-status" role="status">
                <strong>{recording ? 'Recording' : 'Ready / stopped'}</strong>
                <span>{status}</span>
                <span>{rowCount} segment downloads recorded</span>
              </div>
              {manualDownloadReady && <p className="abr-success">CSV export is ready. You can download again if needed.</p>}
            </div>
          </div>
          <aside className="abr-panel abr-notes">
            <h2>Experiment notes</h2>
            <ol>
              <li>Open this route only for experiments; the normal watch route is unaffected.</li>
              <li>Set the profile label before each bandwidth-shaping phase. Each segment stores the label active when it finished downloading.</li>
              <li>Start recording resets this experiment and starts playback from the beginning.</li>
              <li>The CSV downloads automatically when the video reaches its end, if enabled. You can also stop and download manually.</li>
              <li>Use a 60–90 minute video and keep a separate log of the shaping schedule.</li>
            </ol>
            <p className="abr-muted">The fast/slow curves are companion EWMAs computed from measured fragment throughput (3 s / 9 s half-life). The hls.js estimate is recorded separately where the installed version exposes it.</p>
          </aside>
        </div>
      )}
    </section>
  );
}
