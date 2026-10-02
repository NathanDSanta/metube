const API_BASE = import.meta.env.VITE_API_URL || "";

export async function getVideos() {
  const response = await fetch(`${API_BASE}/api/videos`);

  if (!response.ok) {
    throw new Error("Could not load videos");
  }

  return response.json();
}

export async function getVideo(id) {
  const response = await fetch(
    `${API_BASE}/api/videos/${encodeURIComponent(id)}`,
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Video not found");
    }

    throw new Error("Could not load video");
  }

  return response.json();
}

export async function uploadVideo({
  file,
  title,
  description,
  username,
  onProgress,
}) {
  const formData = new FormData();

  formData.append("file", file);
  formData.append("title", title);
  formData.append("description", description);
  formData.append("username", username);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", `${API_BASE}/api/upload`);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const percentage = Math.round((event.loaded / event.total) * 100);

        onProgress(percentage);
      }
    });

    xhr.addEventListener("load", () => {
      let data;

      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("Invalid server response"));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.error || "Could not upload video"));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error while uploading"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    xhr.send(formData);
  });
}

export function getHlsUrl(hlsUrl) {
  return `${API_BASE}${hlsUrl}`;
}

export function getThumbnailUrl(thumbnailUrl) {
  return `${API_BASE}${thumbnailUrl}`;
}
