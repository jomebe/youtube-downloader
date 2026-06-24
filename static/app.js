const form = document.querySelector("#convert-form");
const input = document.querySelector("#url");
const submit = document.querySelector("#submit");
const message = document.querySelector("#message");
const statusText = document.querySelector("#status");
const log = document.querySelector("#log");
const result = document.querySelector("#result");
const fileName = document.querySelector("#file-name");
const downloadLink = document.querySelector("#download-link");

let pollTimer = null;

function setStatus(status) {
  document.body.dataset.status = status;
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setBusy(isBusy) {
  submit.disabled = isBusy;
  submit.querySelector("span").textContent = isBusy ? "변환 중..." : "MP3 만들기";
}

function renderJob(job) {
  const labels = {
    queued: "대기 중",
    running: "변환 중",
    done: "완료",
    failed: "실패",
  };

  statusText.textContent = labels[job.status] || job.status;
  setStatus(job.status);
  log.textContent = (job.log || []).join("\n");
  log.scrollTop = log.scrollHeight;

  const progressContainer = document.querySelector("#progress-container");
  const progressBar = document.querySelector("#progress-bar");
  const progressText = document.querySelector("#progress-text");

  if (job.status === "running") {
    progressContainer.classList.remove("hidden");
    const pct = job.progress || 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${pct}% 완료`;
  } else if (job.status === "done") {
    progressContainer.classList.remove("hidden");
    progressBar.style.width = "100%";
    progressText.textContent = "100% 완료";
  } else if (job.status === "failed") {
    progressContainer.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressText.textContent = "실패";
  } else {
    progressContainer.classList.add("hidden");
  }

  if (job.status === "done") {
    clearInterval(pollTimer);
    pollTimer = null;
    setBusy(false);
    setMessage("MP3 파일이 준비되었습니다.");
    fileName.textContent = job.file_name;
    downloadLink.href = job.file_url;
    result.classList.remove("hidden");
    return;
  }

  if (job.status === "failed") {
    clearInterval(pollTimer);
    pollTimer = null;
    setBusy(false);
    setMessage(job.error || "변환에 실패했습니다.", true);
  }
}

async function pollJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`);
  const job = await response.json();
  if (!response.ok) {
    throw new Error(job.error || "작업 상태를 확인하지 못했습니다.");
  }
  renderJob(job);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = input.value.trim();
  result.classList.add("hidden");
  log.textContent = "";
  setMessage("");
  setBusy(true);
  statusText.textContent = "요청 중";
  setStatus("running");

  const progressContainer = document.querySelector("#progress-container");
  const progressBar = document.querySelector("#progress-bar");
  const progressText = document.querySelector("#progress-text");
  progressContainer.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.textContent = "0% 완료";

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "변환을 시작하지 못했습니다.");
    }

    setMessage("작업을 시작했습니다. 창을 닫지 마세요.");
    await pollJob(payload.job_id);
    pollTimer = setInterval(() => {
      pollJob(payload.job_id).catch((error) => {
        clearInterval(pollTimer);
        pollTimer = null;
        setBusy(false);
        setMessage(error.message, true);
      });
    }, 1000);
  } catch (error) {
    setBusy(false);
    statusText.textContent = "대기 중";
    setStatus("failed");
    setMessage(error.message, true);
  }
});
