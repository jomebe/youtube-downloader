const input = document.querySelector("#backend-url");
const save = document.querySelector("#save");
const saveStatus = document.querySelector("#save-status");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");
const serverStatusText = document.querySelector("#server-status-text");
const serverStatusDot = document.querySelector(".status-dot");
const statsTotal = document.querySelector("#stats-total");
const historyList = document.querySelector("#history-list");

const DEFAULT_BACKEND_URL = "https://youtube-downloader-8kya.onrender.com";

// 1. 설정 패널 토글
settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

// 2. 서버 설정 불러오기 및 연결 테스트
chrome.storage.sync.get("backendUrl", (stored) => {
  const url = stored.backendUrl || DEFAULT_BACKEND_URL;
  input.value = url;
  checkServerConnection(url);
});

// 3. 서버 설정 저장
save.addEventListener("click", async () => {
  saveStatus.textContent = "";
  try {
    const backendUrl = normalizeBackendUrl(input.value);
    await chrome.storage.sync.set({ backendUrl });
    input.value = backendUrl;
    saveStatus.textContent = "저장되었습니다.";
    saveStatus.style.color = "#00e676";
    checkServerConnection(backendUrl);
    setTimeout(() => { saveStatus.textContent = ""; }, 2000);
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.style.color = "#ff1744";
  }
});

// 4. 최근 다운로드 내역 및 통계 로드
chrome.storage.local.get({ downloadHistory: [], totalDownloads: 0 }, (data) => {
  // 총 다운로드 횟수 표시
  statsTotal.textContent = `총 다운로드: ${data.totalDownloads || 0}곡`;

  // 다운로드 내역 목록 표시
  renderHistory(data.downloadHistory || []);
});

// 서버 연결 확인 함수
async function checkServerConnection(baseUrl) {
  serverStatusDot.className = "status-dot pulsing";
  serverStatusDot.style.background = "#ffaa00";
  serverStatusDot.style.boxShadow = "0 0 10px #ffaa00";
  serverStatusText.textContent = "연결 확인 중...";

  try {
    // 서버가 살았는지 가벼운 GET 요청으로 확인
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4초 타임아웃
    
    const response = await fetch(`${baseUrl}/static/styles.css`, { 
      method: "GET", 
      signal: controller.signal 
    });
    clearTimeout(timeoutId);

    if (response.ok || response.status === 404) {
      // 404라도 응답이 왔다는 건 서버가 켜져있음을 의미
      serverStatusDot.className = "status-dot";
      serverStatusDot.style.background = "#00e676";
      serverStatusDot.style.boxShadow = "0 0 10px #00e676";
      serverStatusText.textContent = "서버 연결 완료 (Online)";
    } else {
      throw new Error();
    }
  } catch (e) {
    serverStatusDot.className = "status-dot";
    serverStatusDot.style.background = "#ff1744";
    serverStatusDot.style.boxShadow = "0 0 10px #ff1744";
    serverStatusText.textContent = "서버 연결 끊김 (Offline)";
  }
}

// 다운로드 내역 렌더링 함수
function renderHistory(items) {
  if (items.length === 0) {
    historyList.innerHTML = `
      <div class="empty-history">
        최근 다운로드한 음원이 없습니다.
      </div>
    `;
    return;
  }

  historyList.innerHTML = items.map(item => {
    // 썸네일 및 제목 매핑
    const thumbUrl = `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`;
    const dateStr = formatRelativeTime(item.timestamp);
    const escapedTitle = escapeHtml(item.title);

    return `
      <div class="history-item" data-url="${item.url}">
        <img class="history-thumb" src="${thumbUrl}" alt="thumbnail" onerror="this.src='https://www.youtube.com/favicon.ico'" />
        <div class="history-info">
          <div class="history-title" title="${escapedTitle}">${escapedTitle}</div>
          <div class="history-meta">
            <span class="history-format">M4A</span>
            <span class="history-time">${dateStr}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 각 아이템 클릭 시 유튜브 비디오 페이지로 새 탭 이동
  document.querySelectorAll(".history-item").forEach(card => {
    card.addEventListener("click", () => {
      const url = card.dataset.url;
      if (url) {
        chrome.tabs.create({ url });
      }
    });
  });
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  return `${days}일 전`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeBackendUrl(value) {
  const raw = String(value || "").trim();
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("http 또는 https 주소를 입력하세요.");
  }

  return raw.replace(/\/+$/, "");
}
