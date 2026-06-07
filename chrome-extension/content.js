const BAR_ID = "ytmp3-converter-bar";

let pollTimer = null;
let mountedVideoId = null;

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new Error("확장프로그램이 업데이트되었습니다. YouTube 탭을 새로고침하세요."));
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "확장프로그램 요청 실패"));
        return;
      }
      resolve(response);
    });
  });
}

function currentVideo() {
  const url = new URL(window.location.href);
  const videoId = url.searchParams.get("v");
  if (!videoId || url.pathname !== "/watch") {
    return null;
  }

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  };
}

function targetNode() {
  const metadata = document.querySelector("ytd-watch-metadata");
  if (!metadata) {
    return null;
  }

  const title = metadata.querySelector("#title") || metadata.querySelector("h1");
  return title?.parentElement || metadata;
}

function mountButton() {
  const video = currentVideo();
  const target = targetNode();
  const existing = document.getElementById(BAR_ID);

  if (!video || !target) {
    existing?.remove();
    mountedVideoId = null;
    return;
  }

  if (existing && mountedVideoId === video.id) {
    return;
  }

  existing?.remove();
  mountedVideoId = video.id;

  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.dataset.videoId = video.id;
  bar.innerHTML = `
    <div class="ytmp3-card">
      <button class="ytmp3-button" type="button">
        <span class="ytmp3-dot"></span>
        <span class="ytmp3-label">MP3 다운로드</span>
      </button>
      <span class="ytmp3-status">converter ready</span>
    </div>
  `;

  const button = bar.querySelector(".ytmp3-button");
  button.addEventListener("click", () => convertCurrentVideo(video, bar));

  target.insertAdjacentElement("afterend", bar);
}

async function convertCurrentVideo(video, bar) {
  const button = bar.querySelector(".ytmp3-button");

  clearInterval(pollTimer);
  setUi(bar, "running", "서버로 전송 중...");
  button.disabled = true;

  try {
    const start = await sendMessage({ type: "start-conversion", videoUrl: video.url });
    setUi(bar, "running", "변환 중...");
    pollTimer = setInterval(() => pollJob(start.jobId, bar), 1100);
    await pollJob(start.jobId, bar);
  } catch (error) {
    clearInterval(pollTimer);
    button.disabled = false;
    setUi(bar, "failed", error.message);
  }
}

async function pollJob(jobId, bar) {
  const button = bar.querySelector(".ytmp3-button");
  const response = await sendMessage({ type: "job-status", jobId });
  const job = response.job;

  if (job.status === "queued" || job.status === "running") {
    setUi(bar, "running", latestLog(job) || "변환 중...");
    return;
  }

  clearInterval(pollTimer);
  pollTimer = null;
  button.disabled = false;

  if (job.status === "done") {
    setUi(bar, "done", "다운로드 시작");
    await sendMessage({
      type: "download-file",
      fileUrl: job.file_url,
      fileName: job.file_name,
    });
    setUi(bar, "done", job.file_name || "완료");
    return;
  }

  setUi(bar, "failed", job.error || "변환 실패");
}

function latestLog(job) {
  const lines = job.log || [];
  return lines[lines.length - 1];
}

function setUi(bar, state, text) {
  bar.dataset.state = state;
  const status = bar.querySelector(".ytmp3-status");
  const label = bar.querySelector(".ytmp3-label");
  status.textContent = text;
  label.textContent = state === "running" ? "변환 중..." : "MP3 다운로드";
}

let mountTimer = null;
function scheduleMount() {
  clearTimeout(mountTimer);
  mountTimer = setTimeout(mountButton, 250);
}

window.addEventListener("yt-navigate-finish", scheduleMount);
window.addEventListener("popstate", scheduleMount);

const observer = new MutationObserver(scheduleMount);
observer.observe(document.documentElement, { childList: true, subtree: true });

scheduleMount();
