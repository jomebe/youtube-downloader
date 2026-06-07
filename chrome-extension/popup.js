const input = document.querySelector("#backend-url");
const save = document.querySelector("#save");
const status = document.querySelector("#status");

sendMessage({ type: "get-config" })
  .then((response) => {
    input.value = response.backendUrl;
  })
  .catch((error) => {
    status.textContent = error.message;
  });

save.addEventListener("click", async () => {
  status.textContent = "";
  try {
    const response = await sendMessage({ type: "set-backend-url", backendUrl: input.value });
    input.value = response.backendUrl;
    status.textContent = "저장됨";
  } catch (error) {
    status.textContent = error.message;
  }
});

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "요청 실패"));
        return;
      }
      resolve(response);
    });
  });
}
