const HOST = "com.cozyfocuspet.status";
const ALARM = "reconcile-focus";
const REDIRECT_RULE = 1;
const BYPASS_RULE_START = 1000;
const DEFAULT_DOMAINS = ["youtube.com", "feedly.com", "reddit.com"];
const NUDGE_URL = chrome.runtime.getURL("nudge.html");
const bypassArmed = new Set();
const bypassStarted = new Set();

function validDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain) ||
      domain.startsWith(".") || domain.endsWith(".") || domain.includes("..") ||
      !domain.includes(".") || domain.split(".").some(part => !part || part.length > 63 || part.startsWith("-") || part.endsWith("-"))) {
    return null;
  }
  return domain;
}

async function configuredDomains() {
  const { domains } = await chrome.storage.local.get("domains");
  return [...new Set((Array.isArray(domains) ? domains : DEFAULT_DOMAINS).map(validDomain).filter(Boolean))];
}

async function permittedDomains() {
  const domains = await configuredDomains();
  const grants = await Promise.all(domains.map(async domain => ({
    domain,
    allowed: await chrome.permissions.contains({ origins: [`*://*.${domain}/*`] })
  })));
  return grants.filter(item => item.allowed).map(item => item.domain);
}

function activeFocus(status) {
  const now = Date.now();
  const expiry = Date.parse(status?.expiresAt);
  return status?.phase === "focus" && status?.active === true &&
    Number.isFinite(expiry) && expiry > now && expiry <= now + 120_000;
}

async function releaseRedirect() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (rules.some(rule => rule.id === REDIRECT_RULE)) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [REDIRECT_RULE] });
  }
}

async function reconcile() {
  let status;
  try {
    status = await chrome.runtime.sendNativeMessage(HOST, { command: "status" });
  } catch (_) {
    await releaseRedirect();
    return { active: false, reason: "host-unavailable" };
  }
  if (!activeFocus(status)) {
    await releaseRedirect();
    return { active: false, reason: status?.reason || "not-focusing" };
  }
  const domains = await permittedDomains();
  if (!domains.length) {
    await releaseRedirect();
    return { active: false, reason: "no-site-permission" };
  }
  const rule = {
    id: REDIRECT_RULE,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: `${NUDGE_URL}#\\1` } },
    condition: {
      regexFilter: "^(https?://.*)$",
      requestDomains: domains,
      resourceTypes: ["main_frame"]
    }
  };
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const current = existing.find(item => item.id === REDIRECT_RULE);
  if (current && JSON.stringify(current) === JSON.stringify(rule)) {
    return { active: true, domains };
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [REDIRECT_RULE],
    addRules: [rule]
  });
  return { active: true, domains };
}

async function grantBypass(url, tabId) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !Number.isInteger(tabId)) {
    throw new Error("Invalid bypass target");
  }
  const domains = await permittedDomains();
  const domain = domains.find(value => parsed.hostname === value || parsed.hostname.endsWith(`.${value}`));
  if (!domain) throw new Error("Site is not in your nudge list");
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const id = Math.max(BYPASS_RULE_START - 1, ...rules.map(rule => rule.id)) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id,
      priority: 2,
      action: { type: "allow" },
      condition: { tabIds: [tabId], requestDomains: [domain], resourceTypes: ["main_frame"] }
    }]
  });
  await chrome.storage.session.set({ [`bypass:${tabId}`]: id });
  bypassArmed.add(tabId);
  bypassStarted.delete(tabId);
  await chrome.alarms.create(`bypass:${tabId}`, { delayInMinutes: 1 });
  return true;
}

async function clearBypass(tabId) {
  const key = `bypass:${tabId}`;
  const value = (await chrome.storage.session.get(key))[key];
  if (Number.isInteger(value)) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [value] });
  }
  await chrome.storage.session.remove(key);
  await chrome.alarms.clear(key);
  bypassArmed.delete(tabId);
  bypassStarted.delete(tabId);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  reconcile().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  reconcile().catch(console.error);
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) reconcile().catch(console.error);
  else if (alarm.name.startsWith("bypass:")) {
    clearBypass(Number(alarm.name.slice(7))).catch(console.error);
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.domains) reconcile().catch(console.error);
});
chrome.permissions.onAdded.addListener(() => reconcile().catch(console.error));
chrome.permissions.onRemoved.addListener(() => reconcile().catch(console.error));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && bypassArmed.has(tabId)) bypassStarted.add(tabId);
  if (changeInfo.status === "complete" && bypassStarted.has(tabId) && tab.url && !tab.url.startsWith(NUDGE_URL)) {
    clearBypass(tabId).catch(console.error);
  }
});
chrome.tabs.onRemoved.addListener(tabId => clearBypass(tabId).catch(console.error));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.command === "status") {
    reconcile().then(respond, error => respond({ active: false, reason: String(error) }));
    return true;
  }
  if (message?.command === "bypass" && sender.tab?.id != null && sender.url?.startsWith(NUDGE_URL)) {
    grantBypass(message.url, sender.tab.id).then(
      () => respond({ ok: true }),
      error => respond({ ok: false, error: String(error) })
    );
    return true;
  }
});

// Service workers can be restarted without a startup event.
chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
reconcile().catch(console.error);
