const input = document.querySelector("#backend-url");
const save = document.querySelector("#save");
const status = document.querySelector("#status");
const DEFAULT_BACKEND_URL = "https://youtube-downloader-8kya.onrender.com";

chrome.storage.sync
  .get("backendUrl")
  .then((stored) => {
    input.value = stored.backendUrl || DEFAULT_BACKEND_URL;
  })
  .catch((error) => {
    status.textContent = error.message;
  });

save.addEventListener("click", async () => {
  status.textContent = "";
  try {
    const backendUrl = normalizeBackendUrl(input.value);
    await chrome.storage.sync.set({ backendUrl });
    input.value = backendUrl;
    status.textContent = "저장됨";
  } catch (error) {
    status.textContent = error.message;
  }
});

function normalizeBackendUrl(value) {
  const raw = String(value || "").trim();
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("http 또는 https 주소를 입력하세요.");
  }

  return raw.replace(/\/+$/, "");
}
