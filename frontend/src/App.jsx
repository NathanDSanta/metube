import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';

import Hls from 'hls.js';

import {
  getHlsUrl,
  getVideo,
  getVideos,
  uploadVideo,
  getThumbnailUrl
} from './api';


// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) {
    return '--:--';
  }

  const totalSeconds = Math.floor(Number(seconds));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(
      secs
    ).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatDate(dateString) {
  if (!dateString) {
    return '';
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(date);
}

function getStatusText(status) {
  switch (status) {
    case 'transcoding':
      return 'Transcoding';

    case 'failed':
      return 'Failed';

    case 'ready':
      return '';

    default:
      return status || 'Processing';
  }
}

function isVideoPlayable(video) {
  return video?.status === 'ready';
}


// ------------------------------------------------------------
// Icons
// ------------------------------------------------------------

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.29-6.86a1 1 0 0 0 0-1.66L9.53 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}


// ------------------------------------------------------------
// App
// ------------------------------------------------------------

function App() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const refreshVideos = useCallback(async () => {
    try {
      const data = await getVideos();

      setVideos(data);
      setError('');
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshVideos();

    const interval = setInterval(() => {
      refreshVideos();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [refreshVideos]);

  function handleUploadFinished() {
    setUploadOpen(false);

    // Immediately refresh instead of waiting
    // for the next polling cycle.
    refreshVideos();
  }

  return (
    <div className="app">
      <Header onUpload={() => setUploadOpen(true)} />

      <main className="main">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                videos={videos}
                loading={loading}
                error={error}
                onRetry={refreshVideos}
              />
            }
          />

          <Route
            path="/watch/:id"
            element={
              <WatchPage
                videos={videos}
                onRefresh={refreshVideos}
              />
            }
          />

          <Route
            path="*"
            element={<Navigate to="/" replace />}
          />
        </Routes>
      </main>

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={handleUploadFinished}
        />
      )}
    </div>
  );
}


// ------------------------------------------------------------
// Header
// ------------------------------------------------------------

function Header({ onUpload }) {
  const [search, setSearch] = useState('');

  return (
    <header className="header">
      <Link
        to="/"
        className="brand"
        aria-label="MeTube home"
      >
        <div className="brand-mark">
          <PlayIcon />
        </div>

        <span className="brand-text">
          Me<span>Tube</span>
        </span>
      </Link>

      <div className="search">
        <SearchIcon />

        <input
          type="text"
          placeholder="Search videos..."
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
        />

        {search && (
          <button
            className="search-clear"
            onClick={() => setSearch('')}
          >
            ×
          </button>
        )}
      </div>

      <button
        className="upload-button"
        onClick={onUpload}
      >
        <UploadIcon />
        <span>Upload</span>
      </button>
    </header>
  );
}


// ------------------------------------------------------------
// Home
// ------------------------------------------------------------

function HomePage({
  videos,
  loading,
  error,
  onRetry,
}) {
  const [search, setSearch] = useState('');

  const filteredVideos = videos.filter((video) => {
    const query = search.toLowerCase().trim();

    if (!query) {
      return true;
    }

    return (
      video.title?.toLowerCase().includes(query) ||
      video.description?.toLowerCase().includes(query) ||
      video.username?.toLowerCase().includes(query)
    );
  });

  return (
    <section className="home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LIBRARY</p>
          <h1>Videos</h1>
        </div>

        <div className="video-count">
          {videos.length}{' '}
          {videos.length === 1 ? 'video' : 'videos'}
        </div>
      </div>

      <div className="mobile-search">
        <SearchIcon />

        <input
          type="text"
          placeholder="Search videos..."
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
        />
      </div>

      {loading && (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading videos...</span>
        </div>
      )}

      {!loading && error && (
        <div className="error-panel">
          <strong>Could not load videos</strong>
          <span>{error}</span>

          <button onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {!loading &&
        !error &&
        filteredVideos.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">
              <PlayIcon />
            </div>

            <h2>
              {videos.length === 0
                ? 'No videos yet'
                : 'No matching videos'}
            </h2>

            <p>
              {videos.length === 0
                ? 'Upload your first video to get started.'
                : 'Try a different search.'}
            </p>
          </div>
        )}

      {!loading &&
        !error &&
        filteredVideos.length > 0 && (
          <div className="video-grid">
            {filteredVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
              />
            ))}
          </div>
        )}
    </section>
  );
}


// ------------------------------------------------------------
// Video Card
// ------------------------------------------------------------

function VideoCard({ video }) {
  const playable = isVideoPlayable(video);

  const card = (
    <article
      className={`video-card ${playable ? '' : 'video-card-disabled'
        }`}
    >
      <div className="thumbnail">
        {video.thumbnail_url ? (
          <img
            src={getThumbnailUrl(video.thumbnail_url)}
            alt={video.title}
            className="video-thumbnail"
          />
        ) : (
          <div className="thumbnail-pattern">
            <div className="thumbnail-orb" />
            <div className="thumbnail-orb secondary" />
          </div>
        )}

        {playable && (
          <div className="thumbnail-play">
            <PlayIcon />
          </div>
        )}

        <div className="duration">
          {formatDuration(video.duration)}
        </div>

        {!playable && (
          <div
            className={`status status-${video.status}`}
          >
            {getStatusText(video.status)}
          </div>
        )}
      </div>

      <div className="video-card-body">
        <div className="video-card-title-row">
          <h2>{video.title}</h2>
        </div>

        <div className="video-card-meta">
          <span>{video.username}</span>
          <span className="dot">•</span>
          <span>
            {formatDate(video.posted_at)}
          </span>
        </div>

        {video.description && (
          <p className="video-card-description">
            {video.description}
          </p>
        )}
      </div>
    </article>
  );

  if (!playable) {
    return (
      <div
        className="video-card-wrapper"
        aria-disabled="true"
      >
        {card}
      </div>
    );
  }

  return (
    <Link
      to={`/watch/${video.id}`}
      className="video-card-link"
    >
      {card}
    </Link>
  );
}


// ------------------------------------------------------------
// Watch page
// ------------------------------------------------------------

function WatchPage({
  videos,
  onRefresh,
}) {
  const { id } = useParams();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadVideo() {
      try {
        const data = await getVideo(id);

        if (!cancelled) {
          setVideo(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadVideo();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Keep the individual video status fresh.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getVideo(id);
        setVideo(data);
      } catch {
        // Ignore polling errors.
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [id]);

  if (loading) {
    return (
      <div className="loading-state large">
        <div className="spinner" />
        <span>Loading video...</span>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="error-panel watch-error">
        <strong>Video unavailable</strong>
        <span>
          {error || 'The video could not be found.'}
        </span>

        <Link to="/" className="button-secondary">
          Back to videos
        </Link>
      </div>
    );
  }

  return (
    <section className="watch-page">
      <div className="watch-layout">
        <div className="watch-main">
          {isVideoPlayable(video) ? (
            <HlsPlayer video={video} />
          ) : (
            <div className="player-unavailable">
              <div className="player-unavailable-icon">
                {video.status === 'failed' ? '!' : '…'}
              </div>

              <h2>
                {video.status === 'failed'
                  ? 'Transcoding failed'
                  : 'Video is being processed'}
              </h2>

              <p>
                {video.status === 'failed'
                  ? 'This video could not be processed.'
                  : 'The video will become available automatically when processing finishes.'}
              </p>
            </div>
          )}

          <div className="video-information">
            <div className="video-information-top">
              <h1>{video.title}</h1>

              <span className="watch-duration">
                {formatDuration(video.duration)}
              </span>
            </div>

            <div className="watch-meta">
              <div className="author-avatar">
                {video.username
                  ?.charAt(0)
                  ?.toUpperCase()}
              </div>

              <div>
                <strong>{video.username}</strong>

                <span>
                  Published{' '}
                  {formatDate(video.posted_at)}
                </span>
              </div>
            </div>

            {video.description && (
              <div className="watch-description">
                {video.description}
              </div>
            )}
          </div>
        </div>

        <aside className="related">
          <div className="related-heading">
            <h2>More videos</h2>
          </div>

          <div className="related-list">
            {videos
              .filter((item) => item.id !== video.id)
              .map((item) => (
                <RelatedVideo
                  key={item.id}
                  video={item}
                />
              ))}

            {videos.filter(
              (item) => item.id !== video.id
            ).length === 0 && (
                <p className="no-related">
                  No other videos yet.
                </p>
              )}
          </div>
        </aside>
      </div>
    </section>
  );
}


// ------------------------------------------------------------
// HLS Player
// ------------------------------------------------------------

function HlsPlayer({ video }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  const [playerError, setPlayerError] =
    useState(false);

  useEffect(() => {
    const videoElement = videoRef.current;

    if (!videoElement || !video.hls_url) {
      return;
    }

    const source = getHlsUrl(video.hls_url);

    setPlayerError(false);

    // Safari / browsers with native HLS support.
    if (
      videoElement.canPlayType(
        'application/vnd.apple.mpegurl'
      )
    ) {
      videoElement.src = source;

      return () => {
        videoElement.removeAttribute('src');
        videoElement.load();
      };
    }

    if (!Hls.isSupported()) {
      setPlayerError(true);
      return;
    }

    const hls = new Hls({
      enableWorker: true,

      // Let the browser/player select the quality.
      capLevelToPlayerSize: true,

      // Start conservatively and let HLS.js adapt.
      startLevel: -1,
    });

    hlsRef.current = hls;

    hls.loadSource(source);
    hls.attachMedia(videoElement);

    hls.on(Hls.Events.ERROR, (_, data) => {
      console.error('HLS error:', data);

      if (data.fatal) {
        setPlayerError(true);
      }
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [video.hls_url]);

  if (playerError) {
    return (
      <div className="player-unavailable">
        <div className="player-unavailable-icon">
          !
        </div>

        <h2>Could not play this video</h2>

        <p>
          The HLS stream could not be loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="player-container">
      <video
        ref={videoRef}
        className="video-player"
        controls
        playsInline
        preload="metadata"
      />
    </div>
  );
}


// ------------------------------------------------------------
// Related video
// ------------------------------------------------------------

function RelatedVideo({ video }) {
  const playable = isVideoPlayable(video);

  const content = (
    <>
      <div className="related-thumbnail">
        {video.thumbnail_url ? (
          <img
            src={getThumbnailUrl(video.thumbnail_url)}
            alt={video.title}
            className="video-thumbnail"
          />
        ) : (
          <div className="related-thumbnail-pattern">
            <div />
          </div>
        )}

        <span className="related-duration">
          {formatDuration(video.duration)}
        </span>

        {!playable && (
          <span className="related-status">
            {getStatusText(video.status)}
          </span>
        )}
      </div>

      <div className="related-information">
        <h3>{video.title}</h3>

        <span>{video.username}</span>
      </div>
    </>
  );

  if (!playable) {
    return (
      <div className="related-video related-disabled">
        {content}
      </div>
    );
  }

  return (
    <Link
      to={`/watch/${video.id}`}
      className="related-video"
    >
      {content}
    </Link>
  );
}


// ------------------------------------------------------------
// Upload modal
// ------------------------------------------------------------

function UploadModal({
  onClose,
  onUploaded,
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] =
    useState('');
  const [username, setUsername] = useState('');
  const [file, setFile] = useState(null);

  const [uploading, setUploading] =
    useState(false);

  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();

    setError('');

    if (!title.trim()) {
      setError('Please enter a title.');
      return;
    }

    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }

    if (!username.trim()) {
      setError('Please enter your name.');
      return;
    }

    if (!file) {
      setError('Please select a video file.');
      return;
    }

    try {
      setUploading(true);
      setProgress(0);

      await uploadVideo({
        file,
        title: title.trim(),
        description: description.trim(),
        username: username.trim(),
        onProgress: setProgress,
      });

      onUploaded();
    } catch (err) {
      console.error(err);
      setError(err.message);
      setUploading(false);
    }
  }

  function handleBackdropClick(event) {
    if (
      event.target === event.currentTarget &&
      !uploading
    ) {
      onClose();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropClick}
    >
      <div className="upload-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">NEW VIDEO</p>
            <h2>Upload a video</h2>
          </div>

          <button
            className="close-button"
            onClick={onClose}
            disabled={uploading}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <form
          className="upload-form"
          onSubmit={handleSubmit}
        >
          <label>
            <span>Title</span>

            <input
              type="text"
              value={title}
              maxLength={150}
              disabled={uploading}
              placeholder="Give your video a title"
              onChange={(event) =>
                setTitle(event.target.value)
              }
            />

            <small>
              {title.length}/150
            </small>
          </label>

          <label>
            <span>Description</span>

            <textarea
              value={description}
              maxLength={500}
              rows={4}
              disabled={uploading}
              placeholder="What is this video about?"
              onChange={(event) =>
                setDescription(event.target.value)
              }
            />

            <small>
              {description.length}/500
            </small>
          </label>

          <label>
            <span>Author</span>

            <input
              type="text"
              value={username}
              maxLength={80}
              disabled={uploading}
              placeholder="Your name"
              onChange={(event) =>
                setUsername(event.target.value)
              }
            />
          </label>

          <label className="file-input-label">
            <span>Video file</span>

            <div
              className={`file-drop ${file ? 'file-selected' : ''
                }`}
            >
              <UploadIcon />

              {file ? (
                <div>
                  <strong>{file.name}</strong>

                  <span>
                    {(
                      file.size /
                      1024 /
                      1024
                    ).toFixed(1)}{' '}
                    MB
                  </span>
                </div>
              ) : (
                <div>
                  <strong>
                    Choose a video
                  </strong>

                  <span>
                    MP4, WebM, MOV and other supported formats
                  </span>
                </div>
              )}

              <input
                type="file"
                accept="video/*"
                disabled={uploading}
                onChange={(event) =>
                  setFile(
                    event.target.files?.[0] ||
                    null
                  )
                }
              />
            </div>
          </label>

          {uploading && (
            <div className="upload-progress">
              <div className="progress-header">
                <span>Uploading...</span>
                <strong>{progress}%</strong>
              </div>

              <div className="progress-track">
                <div
                  className="progress-value"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>

              <p>
                The video will continue transcoding
                after the upload finishes.
              </p>
            </div>
          )}

          {error && (
            <div className="form-error">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={uploading}
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="button-primary"
              disabled={uploading}
            >
              {uploading
                ? 'Uploading...'
                : 'Upload video'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
