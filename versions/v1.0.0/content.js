/* B站多账号切换 - 向 B站用户菜单注入“切换账号”入口，并弹出二级面板 */
(function () {
  const STORAGE_KEY = "bili_switcher_accounts";
  const COOKIE_DOMAINS = [".bilibili.com", "bilibili.com"];
  const COOKIE_PATHS = ["/", "/"];

  let accounts = [];
  let $panel, $list, $toast;
  let anchorBtn = null;

  /* ---------- 存储 ---------- */
  function loadAccounts() {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      accounts = res[STORAGE_KEY] || [];
    });
  }

  function saveAccounts() {
    chrome.storage.local.set({ [STORAGE_KEY]: accounts }, () => {
      renderPanel();
    });
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(msg, ms = 2200) {
    if (!$toast) return;
    $toast.textContent = msg;
    $toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      $toast.style.display = "none";
    }, ms);
  }

  function getCookie(name) {
    const m = document.cookie.match(
      new RegExp(
        "(?:^|; )" +
          name.replace(/[.$*?|{}()\\\[\]\\/+^]/g, "\\$&") +
          "=([^;]*)"
      )
    );
    return m ? decodeURIComponent(m[1]) : "";
  }

  function deleteCookie(name, path, domain) {
    document.cookie =
      name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=" + path + "; domain=" + domain;
  }

  function setCookie(name, value, path, domain) {
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; path=" +
      path +
      "; domain=" +
      domain +
      "; SameSite=Lax";
  }

  function clearBilibiliCookies() {
    document.cookie.split(";").forEach((pair) => {
      const name = pair.split("=")[0].trim();
      if (!name) return;
      COOKIE_DOMAINS.forEach((domain) => {
        COOKIE_PATHS.forEach((path) => {
          deleteCookie(name, path, domain);
        });
      });
    });
  }

  function captureCurrentCookies() {
    const cookies = [];
    const seen = new Set();
    document.cookie.split(";").forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return;
      const name = pair.slice(0, eq).trim();
      if (!name) return;
      COOKIE_DOMAINS.forEach((domain) => {
        COOKIE_PATHS.forEach((path) => {
          const val = getCookie(name);
          if (val === "") return;
          const key = name + "|" + domain + "|" + path;
          if (seen.has(key)) return;
          seen.add(key);
          cookies.push({ name, value: val, path, domain });
        });
      });
    });
    return cookies;
  }

  /* ---------- 面板 ---------- */
  function createPanel() {
    if (document.getElementById("bili-switch-panel")) return;
    const panel = document.createElement("div");
    panel.id = "bili-switch-panel";
    panel.className = "bili-switch-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "切换账号");
    panel.innerHTML =
      '<div class="bili-switch-panel-header">' +
      '<span class="bili-switch-panel-title">切换账号</span>' +
      '<button class="bili-switch-panel-close" id="bili-switch-close" title="关闭">×</button>' +
      "</div>" +
      '<div class="bili-switch-list" id="bili-switch-list"></div>' +
      '<div class="bili-switch-divider"></div>' +
      '<div class="bili-switch-add" id="bili-switch-add" title="添加账户"><span>+ 添加账户</span></div>' +
      '<div class="bili-switch-toast" id="bili-switch-toast"></div>';
    document.body.appendChild(panel);

    $panel = panel;
    $list = document.getElementById("bili-switch-list");
    $toast = document.getElementById("bili-switch-toast");

    document.getElementById("bili-switch-close").addEventListener("click", hidePanel);
    document.getElementById("bili-switch-add").addEventListener("click", (e) => {
      e.stopPropagation();
      handleAdd();
    });
    panel.addEventListener("click", (e) => {
      if (e.target === panel) hidePanel();
    });

    // 点击页面其他地方关闭
    document.addEventListener("mousedown", (e) => {
      if ($panel && $panel.classList.contains("is-open") && !$panel.contains(e.target)) {
        if (e.target !== anchorBtn) hidePanel();
      }
    });
  }

  function positionPanel() {
    if (!$panel || !anchorBtn) return;
    const rect = anchorBtn.getBoundingClientRect();
    $panel.style.left = rect.left + "px";
    $panel.style.top = rect.bottom + 6 + "px";
  }

  function showPanel() {
    if (!$panel) createPanel();
    renderPanel();
    positionPanel();
    $panel.classList.add("is-open");
  }

  function hidePanel() {
    if ($panel) $panel.classList.remove("is-open");
  }

  function renderPanel() {
    if (!$list) return;
    $list.innerHTML = "";
    if (accounts.length === 0) {
      $list.innerHTML =
        '<div class="bili-switch-empty">还没有保存的账号，点击下方“添加账户”登录一个。</div>';
      return;
    }
    accounts.forEach((acct, idx) => {
      const item = document.createElement("div");
      item.className = "bili-switch-item";
      item.innerHTML =
        '<img class="bili-switch-item-avatar" src="' +
        escapeHtml(acct.avatar || "") +
        '" alt="">' +
        '<div class="bili-switch-item-info">' +
        '<div class="bili-switch-item-name">' +
        escapeHtml(acct.name || "未命名账号") +
        "</div>" +
        '<div class="bili-switch-item-mid">UID: ' +
        escapeHtml(acct.mid || "-") +
        "</div>" +
        "</div>";
      item.addEventListener("click", () => {
        hidePanel();
        switchAccount(idx);
      });
      $list.appendChild(item);
    });
  }

  /* ---------- 切换 / 添加 ---------- */
  function switchAccount(idx) {
    const acct = accounts[idx];
    if (!acct || !acct.cookies || acct.cookies.length === 0) {
      showToast("这个账号没有可用的登录信息，请重新添加。");
      return;
    }
    clearBilibiliCookies();
    acct.cookies.forEach((c) => {
      setCookie(c.name, c.value, c.path || "/", c.domain || ".bilibili.com");
    });
    showToast("正在切换到 " + (acct.name || "该账号") + " …");
    setTimeout(() => {
      location.reload();
    }, 600);
  }

  function handleAdd() {
    hidePanel();
    if (getCookie("SESSDATA")) {
      captureAndSave();
    } else {
      openLoginPage();
    }
  }

  function captureAndSave() {
    const cookies = captureCurrentCookies();
    const sess = cookies.find((c) => c.name === "SESSDATA");
    if (!sess) {
      showToast("没检测到登录状态，请先在 B站登录再保存。");
      return;
    }

    const mid = getCookie("DedeUserID") || "-";
    let displayName = "B站账号 " + mid;
    const $nick =
      document.querySelector(".sprofile-name, .user-name, .v-user-name") ||
      document.querySelector("[class*='name']");
    if ($nick && $nick.textContent.trim()) {
      displayName = $nick.textContent.trim();
    }
    const $avatar =
      document.querySelector(".sprofile-avatar img, .user-avatar img") ||
      document.querySelector("img[class*='avatar']");
    const avatar = $avatar ? $avatar.src : "";

    accounts.push({
      mid: mid,
      name: displayName,
      avatar: avatar,
      cookies: cookies,
      addedAt: Date.now(),
    });
    saveAccounts();
    showToast("账号 " + displayName + " 已保存。");
  }

  function openLoginPage() {
    chrome.runtime.sendMessage({ action: "openLogin", url: "https://passport.bilibili.com/login" });
    showToast("已打开登录页，登录完成后再点“添加账户”保存即可。");
  }

  /* ---------- 注入按钮 ---------- */
  function createButton() {
    if (document.getElementById("bili-switch-btn")) return;
    const btn = document.createElement("div");
    btn.id = "bili-switch-btn";
    btn.className = "bili-switch-wrap";
    btn.title = "切换账号";
    btn.innerHTML =
      '<img class="bili-switch-avatar" src="">' +
      '<span class="bili-switch-text">切换账号</span>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      anchorBtn = btn;
      showPanel();
    });
    return btn;
  }

  function findLogoutItem() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const text = (node.textContent || "").trim();
          if (text === "退出登录" || text.indexOf("退出登录") === 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      }
    );
    let node = walker.nextNode();
    while (node) {
      let container = node;
      for (let i = 0; i < 6 && container; i++) {
        const tag = container.tagName;
        if (tag === "LI" || tag === "A" || tag === "BUTTON") break;
        container = container.parentElement;
      }
      if (container && container.parentElement) {
        return { item: container, parent: container.parentElement };
      }
      node = walker.nextNode();
    }
    return null;
  }

  function insertButton() {
    if (document.getElementById("bili-switch-btn")) return;
    const found = findLogoutItem();
    if (!found) return;
    const btn = createButton();
    found.parent.insertBefore(btn, found.item);
  }

  const observer = new MutationObserver(() => {
    insertButton();
  });

  function start() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      insertButton();
      loadAccounts();
    } else {
      window.addEventListener("DOMContentLoaded", start);
    }
  }

  start();
})();
