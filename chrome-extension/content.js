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
      <div class="ytmp3-main-row">
        <button class="ytmp3-button" type="button">
          <svg class="ytmp3-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px; margin-right: 6px; vertical-align: -2px; display: inline-block;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span class="ytmp3-label">음원 다운로드</span>
        </button>
        <div class="ytmp3-status-container">
          <span class="ytmp3-dot"></span>
          <span class="ytmp3-status">converter ready</span>
        </div>
      </div>
      <div class="ytmp3-progress-container" style="display: none;">
        <div class="ytmp3-progress-bar"></div>
      </div>
    </div>
  `;

  const button = bar.querySelector(".ytmp3-button");
  button.addEventListener("click", () => convertCurrentVideo(video, bar));

  target.insertAdjacentElement("afterend", bar);
}

async function convertCurrentVideo(video, bar) {
  const button = bar.querySelector(".ytmp3-button");

  clearInterval(pollTimer);
  setUi(bar, "running", "서버로 전송 중...", 0);
  button.disabled = true;

  try {
    const start = await sendMessage({ type: "start-conversion", videoUrl: video.url });
    setUi(bar, "running", "변환 중...", 0);
    pollTimer = setInterval(() => pollJob(start.jobId, bar), 1100);
    await pollJob(start.jobId, bar);
  } catch (error) {
    clearInterval(pollTimer);
    button.disabled = false;
    setUi(bar, "failed", error.message, 0);
  }
}

async function pollJob(jobId, bar) {
  const button = bar.querySelector(".ytmp3-button");
  const response = await sendMessage({ type: "job-status", jobId });
  const job = response.job;

  if (job.status === "queued" || job.status === "running") {
    setUi(bar, "running", latestLog(job) || "변환 중...", job.progress || 0);
    return;
  }

  clearInterval(pollTimer);
  pollTimer = null;
  button.disabled = false;

  if (job.status === "done") {
    setUi(bar, "done", "다운로드 시작", 100);
    await sendMessage({
      type: "download-file",
      fileUrl: job.file_url,
      fileName: job.file_name,
    });
    setUi(bar, "done", job.file_name || "완료", 100);

    // 다운로드 기록 저장
    try {
      const video = currentVideo();
      if (video) {
        saveToHistory(video, job.file_name || "음원 파일");
      }
    } catch (e) {
      console.error(e);
    }
    return;
  }

  setUi(bar, "failed", job.error || "변환 실패", 0);
}

function latestLog(job) {
  const lines = job.log || [];
  return lines[lines.length - 1];
}

function setUi(bar, state, text, progress = 0) {
  bar.dataset.state = state;
  const status = bar.querySelector(".ytmp3-status");
  const label = bar.querySelector(".ytmp3-label");
  const progressContainer = bar.querySelector(".ytmp3-progress-container");
  const progressBar = bar.querySelector(".ytmp3-progress-bar");

  if (state === "running") {
    if (progressContainer && progressBar) {
      progressContainer.style.display = "block";
      progressBar.style.width = `${progress}%`;
    }
    status.textContent = `[${progress}%] ${text}`;
    label.textContent = "변환 중...";
  } else if (state === "done") {
    if (progressContainer && progressBar) {
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
    }
    status.textContent = text;
    label.textContent = "다운로드 완료";
  } else {
    if (progressContainer && progressBar) {
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
    }
    status.textContent = text;
    label.textContent = "음원 다운로드";
  }
}

let mountTimer = null;
function scheduleMount() {
  if (mountTimer) return; // 이미 대기 중인 마운트 요청이 있다면 중복 등록하지 않음 (누적 지연 방지)
  mountTimer = setTimeout(() => {
    mountButton();
    mountTimer = null;
  }, 200);
}

window.addEventListener("yt-navigate-finish", scheduleMount);
window.addEventListener("popstate", scheduleMount);

const observer = new MutationObserver(scheduleMount);
observer.observe(document.documentElement, { childList: true, subtree: true });

// 주기적인 감시 타이머 (비동기 렌더링 및 엘리먼트 소실 방지용 안전장치)
setInterval(() => {
  const video = currentVideo();
  const target = targetNode();
  const existing = document.getElementById(BAR_ID);

  if (video && target && (!existing || mountedVideoId !== video.id)) {
    mountButton();
  }
}, 1000);

scheduleMount();

function saveToHistory(video, fileName) {
  if (!chrome.storage?.local) return;

  const item = {
    id: video.id,
    title: fileName.replace(/\.[^/.]+$/, ""), // 확장자 제거
    url: video.url,
    timestamp: Date.now()
  };

  chrome.storage.local.get({ downloadHistory: [], totalDownloads: 0 }, (data) => {
    let history = data.downloadHistory || [];
    history = history.filter(h => h.id !== video.id);
    history.unshift(item);
    if (history.length > 5) history.pop();

    const total = (data.totalDownloads || 0) + 1;
    chrome.storage.local.set({ 
      downloadHistory: history, 
      totalDownloads: total 
    });
  });
}
