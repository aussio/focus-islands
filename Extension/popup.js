chrome.runtime.sendMessage({ command: "status" }).then(status => {
  document.getElementById("state").textContent = status?.active
    ? `On during focus for ${status.domains.join(", ")}.`
    : "Off until your next focus session.";
}).catch(() => {
  document.getElementById("state").textContent = "Could not read the app status.";
});
document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
