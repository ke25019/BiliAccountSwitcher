/* B站多账号切换 - 登录页增强
   在 passport.bilibili.com 的“其他方式登录”右边加一个“本地账号”入口，
   用存下来的 Cookie 直接登录。 */
(function () {
  const STORAGE_KEY = "bili_switcher_accounts";
  const TAG = "[B站多账号切换]";
  const SWAP_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>' +
    "</svg>";

  let $panel = null;
  let $list = null;
  let $error = null;
  let $anchor = null;
  let accounts = [];
  let loadingMid = "";
  let injectTimer = 0;
  let debugEnabled = true;
  let theme = "auto";

  function log(...args) {
    if (debugEnabled) console.log(TAG, ...args);
  }

  function applyThemeTo(el) {
    if (!el || !el.classList) return;
    el.classList.remove("bili-switch-force-light", "bili-switch-force-dark");
    if (theme === "light") el.classList.add("bili-switch-force-light");
    else if (theme === "dark") el.classList.add("bili-switch-force-dark");
  }

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: "后台没有响应" });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function avatarUrl(src) {
    const str = String(src || "");
    if (!str) return "";
    if (str.indexOf("//") === 0) return "https:" + str;
    return str.replace(/^http:\/\//, "https://");
  }

  function avatarHtml(src) {
    const url = escapeHtml(avatarUrl(src));
    if (!url) return '<span class="bili-switch-login-avatar"></span>';
    return '<img class="bili-switch-login-avatar" src="' + url + '" alt="">';
  }

  function removeAccountByMid(mid, callback) {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      const list = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
      const next = list.filter((a) => String(a.mid) !== String(mid));
      chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
        accounts = next;
        if (callback) callback();
      });
    });
  }

  function askDeleteExpired(acct) {
    if (!acct) return;
    const name = acct.name || acct.mid || "这个账号";
    const ok = window.confirm(
      "“" + name + "”的登录信息已经过期，使用它会失败。要删除这个已保存的账号吗？"
    );
    if (ok) {
      removeAccountByMid(acct.mid, () => {
        renderAccounts();
        log("已删除过期账号 " + JSON.stringify({ mid: acct.mid }));
      });
    }
  }

  function injectEntry() {
    if (document.getElementById("bili-switch-saved-login")) return;
    const host = document.querySelector(".third-party-login-wrapper .sns");
    if (!host) return;

    const item = document.createElement("div");
    item.id = "bili-switch-saved-login";
    item.className = "sns__item bili-switch-saved-item";
    item.setAttribute("data-v-711e0118", "");
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.title = "使用本地保存的账号登录";
    item.innerHTML =
      '<i class="sns__icon bili-switch-saved-icon" data-v-711e0118="">' +
      SWAP_ICON +
      "</i>" +
      '<span class="sns__name" data-v-711e0118="">本地账号</span>';

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(item);
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openPanel(item);
      }
    });

    host.appendChild(item);
    applyThemeTo(item);
    log("登录页已加入“本地账号”入口");
  }

  function scheduleInject() {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(injectEntry, 200);
  }

  function loadAccounts(callback) {
    chrome.storage.local.get(
      [STORAGE_KEY, "cfgDebug", "cfgTheme"],
      (res) => {
        accounts = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        debugEnabled = res.cfgDebug !== false;
        theme = ["auto", "light", "dark"].includes(res.cfgTheme)
          ? res.cfgTheme
          : "auto";
        if ($panel) applyThemeTo($panel);
        const entry = document.getElementById("bili-switch-saved-login");
        if (entry) applyThemeTo(entry);
        callback(accounts);
      }
    );
  }

  function createPanel() {
    if ($panel) return;
    const panel = document.createElement("div");
    panel.className = "bili-switch-login-popover";
    panel.id = "bili-switch-login-popover";
    panel.setAttribute("role", "menu");
    panel.innerHTML =
      '<div class="bili-switch-login-title">选择已保存的账号</div>' +
      '<div class="bili-switch-login-list"></div>' +
      '<div class="bili-switch-login-error"></div>';
    document.body.appendChild(panel);
    $panel = panel;
    $list = panel.querySelector(".bili-switch-login-list");
    $error = panel.querySelector(".bili-switch-login-error");
    panel.addEventListener("mousedown", (e) => e.stopPropagation());
    applyThemeTo(panel);
  }

  function positionPanel() {
    if (!$panel || !$anchor) return;
    const anchorRect = $anchor.getBoundingClientRect();
    const panelRect = $panel.getBoundingClientRect();
    const margin = 8;

    let left = anchorRect.left + anchorRect.width / 2 - panelRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));

    let top = anchorRect.top - panelRect.height - margin;
    if (top < margin) top = anchorRect.bottom + margin;
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - panelRect.height - margin);
    }

    $panel.style.left = left + "px";
    $panel.style.top = top + "px";
  }

  function renderAccounts() {
    if (!$list) return;
    $list.innerHTML = "";
    $error.textContent = "";

    if (accounts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bili-switch-login-empty";
      empty.textContent = "还没有保存的账号。先在 B站 登录一个，插件会自动记下来。";
      $list.appendChild(empty);
      return;
    }

    accounts.forEach((acct) => {
      const item = document.createElement("div");
      item.className = "bili-switch-login-item";
      item.setAttribute("role", "menuitem");
      item.tabIndex = 0;
      item.innerHTML =
        avatarHtml(acct.avatar) +
        '<div class="bili-switch-login-info">' +
        '<div class="bili-switch-login-name">' +
        escapeHtml(acct.name || "未命名账号") +
        "</div>" +
        '<div class="bili-switch-login-mid">UID: ' +
        escapeHtml(acct.mid || "-") +
        "</div></div>";

      const choose = () => loginWith(acct, item);
      item.addEventListener("click", choose);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
      $list.appendChild(item);
    });
  }

  function openPanel(anchor) {
    if ($panel && $panel.classList.contains("is-open") && $anchor === anchor) {
      hidePanel();
      return;
    }
    $anchor = anchor;
    loadAccounts(() => {
      createPanel();
      renderAccounts();
      $panel.classList.add("is-open");
      positionPanel();
      log("打开本地账号列表", { count: accounts.length });
    });
  }

  function hidePanel() {
    if ($panel) $panel.classList.remove("is-open");
  }

  function loginWith(acct, item) {
    if (loadingMid) return;
    loadingMid = acct.mid;
    $error.textContent = "";
    item.classList.add("is-busy");
    log("使用本地账号登录 " + JSON.stringify({ mid: acct.mid, name: acct.name }));

    send({ action: "switchAccount", mid: acct.mid }).then((res) => {
      if (res && res.ok) {
        $error.textContent = "登录成功，正在跳转…";
        log("本地账号登录成功 " + JSON.stringify({ mid: acct.mid }));
        setTimeout(() => {
          location.href = "https://www.bilibili.com/";
        }, 350);
        return;
      }
      loadingMid = "";
      item.classList.remove("is-busy");
      const message = (res && res.error) || "未知错误";
      $error.textContent = "登录失败：" + message;
      log("本地账号登录失败 " + JSON.stringify({ mid: acct.mid, error: message }));
      if (res && res.expired) askDeleteExpired(acct);
    });
  }

  function setupCloseHandlers() {
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!$panel || !$panel.classList.contains("is-open")) return;
        if ($panel.contains(e.target)) return;
        if ($anchor && $anchor.contains(e.target)) return;
        hidePanel();
      },
      true
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hidePanel();
    });
    window.addEventListener("resize", () => {
      if ($panel && $panel.classList.contains("is-open")) positionPanel();
    });
    document.addEventListener(
      "scroll",
      () => {
        if ($panel && $panel.classList.contains("is-open")) positionPanel();
      },
      true
    );
  }

  function start() {
    loadAccounts(() => injectEntry());
    scheduleInject();
    setupCloseHandlers();

    const observer = new MutationObserver(() => {
      scheduleInject();
      if ($panel && $anchor && !document.contains($anchor)) hidePanel();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.cfgDebug) {
        debugEnabled = changes.cfgDebug.newValue !== false;
      }
      if (changes.cfgTheme) {
        theme = ["auto", "light", "dark"].includes(changes.cfgTheme.newValue)
          ? changes.cfgTheme.newValue
          : "auto";
        if ($panel) applyThemeTo($panel);
        const entry = document.getElementById("bili-switch-saved-login");
        if (entry) applyThemeTo(entry);
      }
    });

    // 登录页有异步渲染，兜底再试几次
    setTimeout(injectEntry, 800);
    setTimeout(injectEntry, 2000);
  }

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start);
})();
