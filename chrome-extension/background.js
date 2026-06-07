const DEFAULT_BACKEND_URL = "https://youtube-downloader-8kya.onrender.com";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message?.type === "get-config") {
    return { backendUrl: await getBackendUrl() };
  }

  if (message?.type === "set-backend-url") {
    const backendUrl = normalizeBackendUrl(message.backendUrl);
    await chrome.storage.sync.set({ backendUrl });
    return { backendUrl };
  }

  if (message?.type === "start-conversion") {
    return startConversion(message.videoUrl);
  }

  if (message?.type === "job-status") {
    return getJobStatus(message.jobId);
  }

  if (message?.type === "download-file") {
    return downloadFile(message.fileUrl, message.fileName);
  }

  throw new Error("알 수 없는 요청입니다.");
}

async function getBackendUrl() {
  const stored = await chrome.storage.sync.get("backendUrl");
  return normalizeBackendUrl(stored.backendUrl || DEFAULT_BACKEND_URL);
}

function normalizeBackendUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("서버 주소가 비어 있습니다.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("서버 주소 형식이 올바르지 않습니다.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("서버 주소는 http 또는 https여야 합니다.");
  }

  return raw.replace(/\/+$/, "");
}

function backendPath(baseUrl, path) {
  return `${baseUrl}${path}`;
}

async function startConversion(videoUrl) {
  if (!isYouTubeWatchUrl(videoUrl)) {
    throw new Error("유튜브 영상 주소만 변환할 수 있습니다.");
  }

  const backendUrl = await getBackendUrl();
  const cookies = await getYouTubeCookies();
  const response = await fetch(backendPath(backendUrl, "/api/convert"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: videoUrl, cookies }),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload.error || "변환 시작 실패");
  }

  return { jobId: payload.job_id };
}

async function getYouTubeCookies() {
  const cookies = await chrome.cookies.getAll({ domain: ".youtube.com" });
  if (!cookies.length) {
    throw new Error("YouTube 로그인 쿠키를 찾지 못했습니다. 로그인 후 다시 시도하세요.");
  }

  return cookies.map((cookie) => ({
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    path: cookie.path,
    secure: cookie.secure,
    expirationDate: cookie.expirationDate || 0,
    name: cookie.name,
    value: cookie.value,
  }));
}

async function getJobStatus(jobId) {
  if (!jobId) {
    throw new Error("작업 ID가 없습니다.");
  }

  const backendUrl = await getBackendUrl();
  const response = await fetch(backendPath(backendUrl, `/api/jobs/${jobId}`));
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(payload.error || "작업 상태 확인 실패");
  }

  if (payload.file_url) {
    payload.file_url = absoluteUrl(backendUrl, payload.file_url);
  }

  return { job: payload };
}

async function downloadFile(fileUrl, fileName) {
  if (!fileUrl) {
    throw new Error("다운로드 주소가 없습니다.");
  }

  const id = await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: fileUrl,
        filename: `YouTube MP3/${safeFileName(fileName || "audio.mp3")}`,
        saveAs: false,
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(downloadId);
      },
    );
  });

  return { downloadId: id };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function absoluteUrl(baseUrl, value) {
  try {
    return new URL(value, `${baseUrl}/`).toString();
  } catch {
    return value;
  }
}

function isYouTubeWatchUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith("youtube.com") && url.pathname === "/watch" && url.searchParams.has("v");
  } catch {
    return false;
  }
}

function safeFileName(value) {
  return String(value)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
