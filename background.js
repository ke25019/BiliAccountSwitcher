/* B站多账号切换 - 后台脚本
   页面里的 SESSDATA 是 HttpOnly，content script 读不到也改不了，
   所以 Cookie 的读取、替换统一放在这里，用 chrome.cookies 处理。
   另外负责抓当前登录信息、打开 B站登录页。 */
const STORAGE_KEY = "bili_switcher_accounts";
const LAST_MID_KEY = "bili_switcher_last_mid";
const LAST_SWITCH_KEY = "bili_switcher_last_switch";
const STATS_KEY = "bili_switcher_stats";
const NAV_API = "https://api.bilibili.com/x/web-interface/nav";
const LOGIN_URL = "https://passport.bilibili.com/login";

/* 调试输出，前缀统一，方便在控制台过滤；不打印 Cookie 的值 */
const TAG = "[B站多账号切换]";
let debugEnabled = true;
chrome.storage.local.get({ cfgDebug: true }, (res) => {
  debugEnabled = res.cfgDebug !== false;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cfgDebug) {
    debugEnabled = changes.cfgDebug.newValue !== false;
  }
});
function log(...args) {
  if (debugEnabled) console.log(TAG, ...args);
}
function warn(...args) {
  console.warn(TAG, ...args);
}
function logError(...args) {
  console.error(TAG, ...args);
}

/* 真正跟账号登录状态相关的 Cookie，账号数据和导出只保留这些 */
const AUTH_COOKIE_NAMES = new Set([
  "SESSDATA",
  "bili_jct",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "sid",
]);

/* 退出当前账号/清理旧号时要删掉的登录 Cookie */
const ACCOUNT_COOKIE_NAMES = new Set([
  ...AUTH_COOKIE_NAMES,
  "bili_ticket",
  "bili_ticket_expires",
]);

/* ---------- 把回调式的 chrome API 包一层 ---------- */
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (res) => {
      void chrome.runtime.lastError;
      resolve(res || {});
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function cookiesGetAll(filter) {
  return new Promise((resolve) => {
    chrome.cookies.getAll(filter, (cookies) => {
      void chrome.runtime.lastError;
      resolve(cookies || []);
    });
  });
}

function cookieSet(details) {
  return new Promise((resolve, reject) => {
    chrome.cookies.set(details, (cookie) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(cookie);
    });
  });
}

function cookieRemove(details) {
  return new Promise((resolve) => {
    chrome.cookies.remove(details, () => {
      // Cookie 可能已经被删掉了，这里的报错不用管
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/* ---------- Cookie 读写 ---------- */
function cookieHost(cookie) {
  let host = String(cookie.domain || "").replace(/^\./, "");
  // 写 .bilibili.com 的域 Cookie 时用 www 子域更稳，裸域有些 Chrome 版本会挑
  if (!cookie.hostOnly && host === "bilibili.com") host = "www.bilibili.com";
  return host;
}

function cookieUrl(cookie) {
  const path = cookie.path || "/";
  return "https://" + cookieHost(cookie) + path;
}

function getBiliCookies() {
  // domain 过滤会带上 passport / api 等子域
  return cookiesGetAll({ domain: "bilibili.com" });
}

function removeDetails(cookie) {
  const details = { url: cookieUrl(cookie), name: cookie.name };
  if (cookie.storeId) details.storeId = cookie.storeId;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  return details;
}

function setDetails(cookie) {
  const path = cookie.path || "/";
  const details = {
    url: "https://" + cookieHost(cookie) + path,
    name: cookie.name,
    value: cookie.value,
    path: path,
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
  };
  if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain;
  if (typeof cookie.expirationDate === "number") details.expirationDate = cookie.expirationDate;
  if (cookie.sameSite) details.sameSite = cookie.sameSite;
  if (cookie.storeId) details.storeId = cookie.storeId;
  if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
  return details;
}

/* ---------- 账号 ---------- */
async function getCurrentUser() {
  const cookies = await getBiliCookies();
  const sess = cookies.find((c) => c.name === "SESSDATA" && c.value);
  if (!sess) return { ok: true, loggedIn: false, mid: "" };
  const mid = cookies.find((c) => c.name === "DedeUserID" && c.value);
  return { ok: true, loggedIn: true, mid: (mid && mid.value) || "" };
}

/* 添加新号前把当前账号退出，只删登录相关 Cookie，设备 Cookie 保留 */
async function logoutCurrent() {
  const cookies = await getBiliCookies();
  const removed = [];
  for (const cookie of cookies) {
    if (!ACCOUNT_COOKIE_NAMES.has(cookie.name)) continue;
    await cookieRemove(removeDetails(cookie));
    removed.push(cookie.name);
  }
  const current = await getCurrentUser();
  log("退出当前账号", { removed, stillLoggedIn: current.loggedIn });
  return { ok: true, removed: removed.length, stillLoggedIn: current.loggedIn };
}

/* 控制台排查用的快照，只输出 Cookie 名字/域/路径，不输出值 */
async function debugInfo() {
  const [cookies, stored] = await Promise.all([
    getBiliCookies(),
    storageGet([STORAGE_KEY, LAST_MID_KEY]),
  ]);
  const manifest = chrome.runtime.getManifest();
  const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const sess = cookies.find((c) => c.name === "SESSDATA" && c.value);
  const mid = cookies.find((c) => c.name === "DedeUserID" && c.value);

  return {
    ok: true,
    version: manifest.version_name || manifest.version,
    loggedIn: !!sess,
    mid: (mid && mid.value) || "",
    lastMid: stored[LAST_MID_KEY] || "",
    cookieCount: cookies.length,
    cookies: cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: c.sameSite,
      expires: typeof c.expirationDate === "number"
        ? new Date(c.expirationDate * 1000).toISOString()
        : "session",
      valueLength: String(c.value || "").length,
    })),
    accounts: accounts.map((a) => ({
      mid: a.mid,
      name: a.name,
      cookieCount: Array.isArray(a.cookies) ? a.cookies.length : 0,
      addedAt: a.addedAt || 0,
      avatar: a.avatar || "",
    })),
  };
}

/* 面板打开时顺手把当前账号的昵称/头像刷新一下，免得和 B站 上显示的不一致 */
async function refreshProfile() {
  const current = await getCurrentUser();
  if (!current.loggedIn || !current.mid) {
    return { ok: true, updated: false, reason: "没登录" };
  }

  const stored = await storageGet(STORAGE_KEY);
  const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const idx = accounts.findIndex((a) => String(a.mid) === String(current.mid));
  if (idx < 0) return { ok: true, updated: false, reason: "当前账号没存过" };

  let user = null;
  try {
    user = await fetchNavUser();
  } catch (_) {
    return { ok: true, updated: false, reason: "nav 接口没取到" };
  }
  if (!user) return { ok: true, updated: false, reason: "nav 没登录状态" };
  if (user.mid && String(user.mid) !== String(current.mid)) {
    return { ok: true, updated: false, reason: "nav 返回的 UID 对不上" };
  }

  const account = accounts[idx];
  const name = user.name || account.name;
  const avatar = normalizeAvatar(user.avatar) || account.avatar;
  const changed = name !== account.name || avatar !== account.avatar;
  if (changed) {
    accounts[idx] = { ...account, name, avatar };
    await storageSet({ [STORAGE_KEY]: accounts });
  }

  log("刷新账号资料", {
    mid: current.mid,
    changed,
    name,
    hasAvatar: !!avatar,
  });
  return {
    ok: true,
    updated: changed,
    account: { mid: account.mid, name, avatar },
  };
}

/* 页面每次打开都调一次：当前号没存过就自动抓下来。
   用 lastMid 记住刚处理过的号，用户手动删掉的账号不会马上又被加回来。 */
async function syncCurrent() {
  const current = await getCurrentUser();
  const stored = await storageGet([STORAGE_KEY, LAST_MID_KEY]);

  if (!current.loggedIn) {
    if (stored[LAST_MID_KEY]) await storageSet({ [LAST_MID_KEY]: "" });
    log("同步", { loggedIn: false });
    return { ok: true, loggedIn: false, mid: "", captured: false };
  }

  const mid = current.mid;
  const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const saved = mid ? accounts.some((a) => String(a.mid) === String(mid)) : false;

  if (saved) {
    if (stored[LAST_MID_KEY] !== mid) await storageSet({ [LAST_MID_KEY]: mid });
    log("同步", { loggedIn: true, mid, saved: true, accounts: accounts.length });
    return { ok: true, loggedIn: true, mid: mid, captured: false };
  }

  // 没拿到 UID，或者这个号刚在设置页被删掉，就先不自动存
  if (!mid || stored[LAST_MID_KEY] === mid) {
    log("同步", { loggedIn: true, mid, saved: false, skipped: true });
    return { ok: true, loggedIn: true, mid: mid || "", captured: false };
  }

  const res = await captureAccount();
  if (!res.ok) {
    warn("同步时自动保存失败", res.error);
    return { ok: true, loggedIn: true, mid: mid, captured: false, error: res.error };
  }
  await storageSet({ [LAST_MID_KEY]: mid });
  log("同步", { loggedIn: true, mid, captured: true, name: res.account.name });
  return { ok: true, loggedIn: true, mid: mid, captured: true, account: res.account };
}

async function fetchNavUser() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(NAV_API, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.code === 0 && json.data && json.data.isLogin) {
      return {
        mid: String(json.data.mid || ""),
        name: json.data.uname || "",
        avatar: json.data.face || "",
      };
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAvatar(url) {
  const str = String(url || "");
  if (!str) return "";
  if (str.indexOf("//") === 0) return "https:" + str;
  return str.replace(/^http:\/\//, "https://");
}

async function captureAccount() {
  const cookies = await getBiliCookies();
  if (!cookies.some((c) => c.name === "SESSDATA" && c.value)) {
    warn("自动保存失败：没有 SESSDATA");
    return { ok: false, error: "没检测到登录状态，先在 B站 登录再点保存。" };
  }

  let user = null;
  try {
    user = await fetchNavUser();
  } catch (_) {
    // 接口偶尔抽风就退回用 UID 当名字，不影响切换
  }
  const midCookie = cookies.find((c) => c.name === "DedeUserID" && c.value);
  const mid = (user && user.mid) || (midCookie && midCookie.value) || "";
  const authCookies = cookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name));
  const account = {
    mid: mid || "-",
    name: (user && user.name) || ("B站账号 " + (mid || "-")),
    avatar: normalizeAvatar(user && user.avatar),
    cookies: authCookies,
    addedAt: Date.now(),
  };

  // 同一个 UID 只留一条，重新登录就当更新
  const stored = await storageGet(STORAGE_KEY);
  const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const idx = mid ? accounts.findIndex((a) => String(a.mid) === String(mid)) : -1;
  if (idx >= 0) {
    const prev = accounts[idx];
    // 接口没拿到昵称时别把原来存的好名字冲掉
    if (!user) {
      account.name = prev.name || account.name;
      account.avatar = prev.avatar || account.avatar;
    }
    account.addedAt = prev.addedAt || account.addedAt;
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  await storageSet({ [STORAGE_KEY]: accounts });

  log("保存账号", {
    mid: account.mid,
    name: account.name,
    cookieCount: authCookies.length,
    rawCookieCount: cookies.length,
    updated: idx >= 0,
    navUser: !!user,
  });

  return {
    ok: true,
    updated: idx >= 0,
    account: { mid: account.mid, name: account.name, avatar: account.avatar },
  };
}

function sameCookie(a, b) {
  return (
    a.name === b.name &&
    String(a.domain || "") === String(b.domain || "") &&
    (a.path || "/") === (b.path || "/")
  );
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

async function bumpSwitchStats() {
  try {
    const stored = await storageGet(STATS_KEY);
    const stats = stored[STATS_KEY] || { date: "", today: 0, total: 0 };
    const today = todayKey();
    if (stats.date !== today) {
      stats.date = today;
      stats.today = 0;
    }
    stats.today = (stats.today || 0) + 1;
    stats.total = (stats.total || 0) + 1;
    await storageSet({ [STATS_KEY]: stats });
  } catch (e) {
    warn("更新切换统计失败", e.message || e);
  }
}

async function switchAccount(mid) {
  const steps = [];
  const step = (msg) => {
    steps.push(msg);
    log("切换", msg);
  };
  const before = await getCurrentUser();
  const record = {
    at: Date.now(),
    fromMid: before.mid || "",
    toMid: String(mid || ""),
    toName: "",
    ok: false,
    error: "",
    steps,
  };
  const finish = async (result) => {
    record.ok = !!result.ok;
    record.error = result.error || "";
    try {
      await storageSet({ [LAST_SWITCH_KEY]: record });
    } catch (e) {
      warn("保存切换记录失败", e.message || e);
    }
    log("切换结果", {
      ok: record.ok,
      error: record.error,
      fromMid: record.fromMid,
      toMid: record.toMid,
      toName: record.toName,
      steps,
    });
    return result;
  };

  let stored = await storageGet(STORAGE_KEY);
  let accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];

  // 离开当前号之前，先把它的 Cookie 刷新保存一遍：
  // B站 的登录票据会变，存着刚登录时那份，过一会儿切回来就可能失效
  const beforeAccount =
    before.loggedIn && before.mid
      ? accounts.find((a) => String(a.mid) === String(before.mid))
      : null;
  if (beforeAccount && String(before.mid) !== String(mid)) {
    step("先把当前账号的登录状态更新保存");
    try {
      const refreshed = await captureAccount();
      step(refreshed.ok ? "当前账号已更新" : "当前账号更新失败：" + refreshed.error);
      stored = await storageGet(STORAGE_KEY);
      accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : accounts;
    } catch (e) {
      step("当前账号更新异常：" + (e.message || e));
    }
  }

  const account = accounts.find((a) => String(a.mid) === String(mid));
  if (!account) {
    return finish({ ok: false, error: "找不到这个账号，可能已经在设置页删掉了。", steps });
  }
  record.toName = account.name || "";
  if (!Array.isArray(account.cookies) || account.cookies.length === 0) {
    return finish({
      ok: false,
      error: "这个账号没有保存登录信息，重新添加一次吧。",
      expired: true,
      steps,
    });
  }
  const sess = account.cookies.find((c) => c.name === "SESSDATA" && c.value);
  if (!sess) {
    return finish({
      ok: false,
      error: "这个账号没存到登录 Cookie，重新添加一次吧。",
      expired: true,
      steps,
    });
  }
  if (typeof sess.expirationDate === "number" && sess.expirationDate * 1000 < Date.now()) {
    return finish({
      ok: false,
      error: "这个账号的登录信息已经过期，重新登录后再保存一次。",
      expired: true,
      steps,
    });
  }

  const backup = await getBiliCookies();
  step(`当前 Cookie ${backup.length} 个，目标账号存了 ${account.cookies.length} 个`);
  log("当前 Cookie 名单", backup.map((c) => c.name));
  log("目标 Cookie 名单", account.cookies.map((c) => c.name));

  // 账号数据里只保留登录相关 Cookie；就算旧数据里存了通用项，这里也只写白名单
  const now = Date.now() / 1000;
  const authCookies = account.cookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name));
  const ignoredCookies = account.cookies.filter((c) => !AUTH_COOKIE_NAMES.has(c.name));
  const expiredCookies = authCookies.filter(
    (c) => typeof c.expirationDate === "number" && c.expirationDate < now
  );
  const toWrite = authCookies.filter((c) => !expiredCookies.includes(c));

  step(
    `目标账号存了 ${account.cookies.length} 个 Cookie，其中登录相关 ${authCookies.length} 个；准备写入 ${toWrite.length} 个，忽略通用项 ${ignoredCookies.length} 个、过期项 ${expiredCookies.length} 个`
  );
  if (ignoredCookies.length) {
    step("忽略通用 Cookie：" + ignoredCookies.map((c) => c.name).join(", "));
  }
  if (expiredCookies.length) {
    step("跳过过期 Cookie：" + expiredCookies.map((c) => c.name).join(", "));
  }

  const written = [];
  try {
    for (const cookie of toWrite) {
      await cookieSet(setDetails(cookie));
      written.push(cookie);
      step(`写入 ${cookie.name} (${cookie.domain || "?"}${cookie.path || "/"})`);
    }

    const after = await getBiliCookies();
    const afterSess = after.find((c) => c.name === "SESSDATA" && c.value);
    if (!afterSess || afterSess.value !== sess.value) {
      throw new Error("SESSDATA 写入后校验不一致");
    }
    step("校验通过，SESSDATA 已写入");

    // 用 B站 自己的 nav 接口再确认一次，防止写进去了但登录状态其实已经失效
    const nav = await fetchNavUser();
    if (!nav) {
      const navError = new Error("切换后 B站 接口没返回登录状态，保存的登录信息可能已经过期");
      navError.expired = true;
      throw navError;
    }
    if (String(nav.mid) !== String(mid)) {
      throw new Error("切换后 B站 返回的是 " + (nav.mid || "未知账号") + "，不是目标账号");
    }
    step(`B站 接口校验通过：${nav.name || nav.mid} (${nav.mid})`);

    // 清掉旧账号残留的登录 Cookie，避免两套登录信息混在一起
    for (const old of backup) {
      if (!ACCOUNT_COOKIE_NAMES.has(old.name)) continue;
      if (toWrite.some((c) => sameCookie(c, old))) continue;
      await cookieRemove(removeDetails(old));
      step(`清掉旧账号 Cookie ${old.name} (${old.domain || "?"}${old.path || "/"})`);
    }

    await bumpSwitchStats();
    return finish({ ok: true, steps });
  } catch (err) {
    step(`失败：${err.message || err}，开始恢复原来的 Cookie`);
    for (const cookie of written) {
      const old = backup.find((b) => sameCookie(b, cookie));
      try {
        if (old) await cookieSet(setDetails(old));
        else await cookieRemove(removeDetails(cookie));
      } catch (e2) {
        warn("恢复 Cookie 失败", cookie.name, e2.message || e2);
      }
    }
    step("已尝试恢复原来的 Cookie");
    return finish({
      ok: false,
      error: err.message || String(err),
      expired: !!err.expired,
      steps,
    });
  }
}

/* ---------- 登录页 ---------- */
function queryTabs(query) {
  return new Promise((resolve) => {
    chrome.tabs.query(query, (tabs) => {
      void chrome.runtime.lastError;
      resolve(tabs || []);
    });
  });
}

function updateTab(tabId, props) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, props, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function focusWindow(windowId) {
  return new Promise((resolve) => {
    chrome.windows.update(windowId, { focused: true }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function createTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url }, (tab) => {
      void chrome.runtime.lastError;
      resolve(tab);
    });
  });
}

function createWindow(options) {
  return new Promise((resolve) => {
    chrome.windows.create(options, (win) => {
      const err = chrome.runtime.lastError;
      resolve(err ? null : win);
    });
  });
}

async function openLoginPage() {
  const tabs = await queryTabs({ url: "*://passport.bilibili.com/*" });
  if (tabs.length) {
    log("打开登录页：复用已有标签", tabs[0].id);
    await updateTab(tabs[0].id, { active: true });
    if (tabs[0].windowId) await focusWindow(tabs[0].windowId);
    return { ok: true, reused: true };
  }

  // 开个小弹窗登录，别一下子占满整个标签页
  const win = await createWindow({
    url: LOGIN_URL,
    type: "popup",
    width: 500,
    height: 720,
    focused: true,
  });
  if (win) {
    log("打开登录页：新建弹窗");
    return { ok: true, reused: false };
  }

  // 有些环境不让开弹窗，退回到普通标签页
  log("打开登录页：弹窗失败，退回标签页");
  await createTab(LOGIN_URL);
  return { ok: true, reused: false };
}

/* 老版本账号里存了全量 Cookie，升级后顺手裁成登录相关的几项 */
async function slimStoredAccounts() {
  try {
    const stored = await storageGet(STORAGE_KEY);
    const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    let changed = false;
    const next = accounts.map((acct) => {
      const cookies = Array.isArray(acct.cookies) ? acct.cookies : [];
      const kept = cookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name));
      if (kept.length !== cookies.length) changed = true;
      return { ...acct, cookies: kept };
    });
    if (changed) {
      await storageSet({ [STORAGE_KEY]: next });
      log("已把历史账号的 Cookie 裁剪为登录相关项");
    }
  } catch (e) {
    warn("裁剪历史账号 Cookie 失败", e.message || e);
  }
}

if (chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    slimStoredAccounts();
  });
}
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    slimStoredAccounts();
  });
}

/* ---------- 消息入口 ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const action = msg && msg.action;
  const run = async () => {
    switch (action) {
      case "getCurrentUser":
        return getCurrentUser();
      case "logoutCurrent":
        return logoutCurrent();
      case "syncCurrent":
        return syncCurrent();
      case "captureAccount":
        return captureAccount();
      case "switchAccount":
        log("收到切换请求", { mid: msg.mid });
        return switchAccount(msg.mid);
      case "refreshProfile":
        log("收到刷新资料请求");
        return refreshProfile();
      case "debugInfo":
        return debugInfo();
      case "openLogin":
        return openLoginPage();
      default:
        return { ok: false, error: "不认识的操作：" + action };
    }
  };

  run().then(sendResponse, (err) => {
    logError("消息处理失败", action, err && err.message);
    sendResponse({ ok: false, error: (err && err.message) || String(err) });
  });
  // 异步回消息，得占住这个通道
  return true;
});
