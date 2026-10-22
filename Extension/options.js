const defaults = ["youtube.com", "feedly.com", "reddit.com"];
const input = document.getElementById("domains");
const message = document.getElementById("message");

chrome.storage.local.get("domains").then(({ domains }) => {
  input.value = (Array.isArray(domains) ? domains : defaults).join("\n");
});

document.getElementById("save").addEventListener("click", async () => {
  const domains = [...new Set(input.value.split(/[\n,]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (domains.length > 50 || domains.some(domain =>
    domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain) ||
    domain.startsWith(".") || domain.endsWith(".") || domain.includes("..") ||
    !domain.includes(".") || domain.split(".").some(part => !part || part.length > 63 || part.startsWith("-") || part.endsWith("-")))) {
    message.textContent = "Enter up to 50 plain domains, one per line (for example, reddit.com).";
    return;
  }
  try {
    const origins = domains.map(domain => `*://*.${domain}/*`);
    if (origins.length && !await chrome.permissions.request({ origins })) {
      message.textContent = "Site access was not granted. Your list was not changed.";
      return;
    }
    await chrome.storage.local.set({ domains });
    message.textContent = "Saved. The nudge updates with your focus timer.";
  } catch (error) {
    message.textContent = `Could not save sites: ${error.message}`;
  }
});
