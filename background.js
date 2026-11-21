/* B站多账号切换 - 后台脚本
   页面里的 SESSDATA 是 HttpOnly，content script 读不到也改不了，
   所以 Cookie 的读取、替换统一放在这里，用 chrome.cookies 处理。
   另外负责抓当前登录信息、打开 B站登录页。 */
const STORAGE_KEY = "bili_switcher_accounts";
const LAST_MID_KEY = "bili_switcher_last_mid";
const NAV_API = "https://api.bilibili.com/x/web-interface/nav";
const LOGIN_URL = "https://passport.bilibili.com/login";

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
function cookieUrl(cookie) {
  const host = String(cookie.domain || "").replace(/^\./, "");
  const path = cookie.path || "/";
  return "https://" + host + path;
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
  const host = String(cookie.domain || "").replace(/^\./, "");
  const path = cookie.path || "/";
  const details = {
    url: "https://" + host + path,
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

async function removeBiliCookies() {
  const cookies = await getBiliCookies();
  for (const cookie of cookies) {
    await cookieRemove(removeDetails(cookie));
  }
}

async function writeCookies(cookies) {
  for (const cookie of cookies) {
    try {
      await cookieSet(setDetails(cookie));
    } catch (err) {
      throw new Error("写入 " + cookie.name + " 失败：" + err.message);
    }
  }
}

/* ---------- 账号 ---------- */
async function getCurrentUser() {
  const cookies = await getBiliCookies();
  const sess = cookies.find((c) => c.name === "SESSDATA" && c.value);
  if (!sess) return { ok: true, loggedIn: false, mid: "" };
  const mid = cookies.find((c) => c.name === "DedeUserID" && c.value);
  return { ok: true, loggedIn: true, mid: (mid && mid.value) || "" };
}

/* 页面每次打开都调一次：当前号没存过就自动抓下来。
   用 lastMid 记住刚处理过的号，用户手动删掉的账号不会马上又被加回来。 */
async function syncCurrent() {
  const current = await getCurrentUser();
  const stored = await storageGet([STORAGE_KEY, LAST_MID_KEY]);

  if (!current.loggedIn) {
    if (stored[LAST_MID_KEY]) await storageSet({ [LAST_MID_KEY]: "" });
    return { ok: true, loggedIn: false, mid: "", captured: false };
  }

  const mid = current.mid;
  const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const saved = mid ? accounts.some((a) => String(a.mid) === String(mid)) : false;

  if (saved) {
    if (stored[LAST_MID_KEY] !== mid) await storageSet({ [LAST_MID_KEY]: mid });
    return { ok: true, loggedIn: true, mid: mid, captured: false };
  }

  // 没拿到 UID，或者这个号刚在设置页被删掉，就先不自动存
  if (!mid || stored[LAST_MID_KEY] === mid) {
    return { ok: true, loggedIn: true, mid: mid || "", captured: false };
  }

  const res = await captureAccount();
  if (!res.ok) {
    return { ok: true, loggedIn: true, mid: mid, captured: false, error: res.error };
  }
  await storageSet({ [LAST_MID_KEY]: mid });
  return { ok: true, loggedIn: true, mid: mid, captured: true, account: res.account };
}

async function fetchNavUser() {
  const res = await fetch(NAV_API, { credentials: "include", cache: "no-store" });
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
  const account = {
    mid: mid || "-",
    name: (user && user.name) || ("B站账号 " + (mid || "-")),
    avatar: normalizeAvatar(user && user.avatar),
    cookies: cookies,
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

  return {
    ok: true,
    updated: idx >= 0,
    account: { mid: account.mid, name: account.name, avatar: account.avatar },
  };
}

async function switchAccount(mid) {
  const stored = await storageGet(STORAGE_KEY);
  const accounts = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const account = accounts.find((a) => String(a.mid) === String(mid));
  if (!account) return { ok: false, error: "找不到这个账号，可能已经在设置页删掉了。" };
  if (!Array.isArray(account.cookies) || account.cookies.length === 0) {
    return { ok: false, error: "这个账号没有保存登录信息，重新添加一次吧。" };
  }
  const sess = account.cookies.find((c) => c.name === "SESSDATA" && c.value);
  if (!sess) {
    return { ok: false, error: "这个账号没存到登录 Cookie，重新添加一次吧。" };
  }
  if (typeof sess.expirationDate === "number" && sess.expirationDate * 1000 < Date.now()) {
    return { ok: false, error: "这个账号的登录信息已经过期，重新登录后再保存一次。" };
  }

  // 先留一份现在的 Cookie，中途失败还能恢复回去，别把用户搞成未登录
  const backup = await getBiliCookies();
  try {
    await removeBiliCookies();
    await writeCookies(account.cookies);
    return { ok: true };
  } catch (err) {
    try {
      await removeBiliCookies();
      await writeCookies(backup);
    } catch (_) {
      // 恢复也失败就没办法了，至少把错误报回去
    }
    return { ok: false, error: err.message || String(err) };
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
  if (win) return { ok: true, reused: false };

  // 有些环境不让开弹窗，退回到普通标签页
  await createTab(LOGIN_URL);
  return { ok: true, reused: false };
}

/* ---------- 消息入口 ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const action = msg && msg.action;
  const run = async () => {
    switch (action) {
      case "getCurrentUser":
        return getCurrentUser();
      case "syncCurrent":
        return syncCurrent();
      case "captureAccount":
        return captureAccount();
      case "switchAccount":
        return switchAccount(msg.mid);
      case "openLogin":
        return openLoginPage();
      default:
        return { ok: false, error: "不认识的操作：" + action };
    }
  };

  run().then(sendResponse, (err) => {
    sendResponse({ ok: false, error: (err && err.message) || String(err) });
  });
  // 异步回消息，得占住这个通道
  return true;
});
