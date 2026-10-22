const site = document.getElementById("site");
const message = document.getElementById("message");
const continueButton = document.getElementById("continue");
const target = location.hash.slice(1);
let parsed;
try {
  parsed = new URL(target);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Unsupported URL");
  site.textContent = parsed.hostname;
} catch (_) {
  continueButton.disabled = true;
  message.textContent = "The original page could not be recovered.";
}

continueButton.addEventListener("click", async () => {
  continueButton.disabled = true;
  message.textContent = "Opening this page once…";
  try {
    const result = await chrome.runtime.sendMessage({ command: "bypass", url: target });
    if (!result?.ok) throw new Error(result?.error || "Bypass unavailable");
    location.replace(target);
  } catch (_) {
    message.textContent = "Could not open this page. Try again.";
    continueButton.disabled = false;
  }
});

document.getElementById("stay").addEventListener("click", () => {
  location.replace("about:blank");
});

// If a break starts while this page is open, release the pending destination too.
if (parsed) {
  setInterval(async () => {
    try {
      const status = await chrome.runtime.sendMessage({ command: "status" });
      if (!status?.active) location.replace(target);
    } catch (_) { /* The worker will clear rules on its next alarm. */ }
  }, 15_000);
}
