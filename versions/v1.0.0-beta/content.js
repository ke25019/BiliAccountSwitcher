/* B站多账号切换 - 在 B站 用户菜单里加“切换账号”，点开是账号面板
   Cookie 读写和自动记账号都在 background.js，这里只管界面 */
(function () {
  const STORAGE_KEY = "bili_switcher_accounts";

  const SWAP_ICON =
    '<svg class="bili-switch-swap-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>' +
    "</svg>";
  const PLUS_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>' +
    "</svg>";

  const state = {
    accounts: [],
    showBtn: true,
    autoSwitch: true,
    currentUser: { loggedIn: false, mid: "" },
    userReady: false,
  };

  let $panel = null;
  let $list = null;
  let anchorBtn = null;
  let $toast = null;
  let lastSearch = 0;
  let scanTimer = 0;
  let switching = false;
  let syncing = false;

  /* ---------- 和后台通信 ---------- */
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

  /* ---------- 小工具 ---------- */
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
    if (!url) return '<span class="bili-switch-item-avatar bili-switch-avatar-empty"></span>';
    return '<img class="bili-switch-item-avatar" src="' + url + '" alt="">';
  }

  function ensureToast() {
    if ($toast && $toast.isConnected) return $toast;
    $toast = document.getElementById("bili-switch-toast");
    if (!$toast) {
      $toast = document.createElement("div");
      $toast.id = "bili-switch-toast";
      $toast.className = "bili-switch-toast";
    }
    (document.body || document.documentElement).appendChild($toast);
    return $toast;
  }

  function showToast(msg, ms = 2400) {
    const toast = ensureToast();
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-show"), ms);
  }

  function findCurrentAccount() {
    if (!state.currentUser.loggedIn || !state.currentUser.mid) return null;
    return (
      state.accounts.find((a) => String(a.mid) === String(state.currentUser.mid)) || null
    );
  }

  /* ---------- 设置 / 账号数据 ---------- */
  function loadSettings() {
    chrome.storage.local.get(
      { cfgAutoSwitch: true, cfgShowBtn: true, [STORAGE_KEY]: [] },
      (res) => {
        state.autoSwitch = res.cfgAutoSwitch !== false;
        state.showBtn = res.cfgShowBtn !== false;
        state.accounts = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        applySettings();
        renderPanel();
        syncCurrentUser();
      }
    );
  }

  function applySettings() {
    if (!state.showBtn) {
      hidePanel();
      const btn = document.getElementById("bili-switch-btn");
      if (btn) btn.remove();
      return;
    }
    scheduleInsert(0);
    renderButtonAvatar();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.cfgShowBtn) {
      state.showBtn = changes.cfgShowBtn.newValue !== false;
      applySettings();
    }
    if (changes.cfgAutoSwitch) {
      state.autoSwitch = changes.cfgAutoSwitch.newValue !== false;
    }
    if (changes[STORAGE_KEY]) {
      const next = changes[STORAGE_KEY].newValue;
      state.accounts = Array.isArray(next) ? next : [];
      renderButtonAvatar();
      renderPanel();
    }
  });

  /* 每次打开 B站 页面都问一次后台：当前号存过没有，没存就自动抓下来 */
  function syncCurrentUser() {
    if (syncing) return;
    syncing = true;
    send({ action: "syncCurrent" }).then((res) => {
      syncing = false;
      state.userReady = true;
      if (res && res.ok) {
        state.currentUser = { loggedIn: !!res.loggedIn, mid: res.mid || "" };
        if (!state.currentUser.loggedIn) {
          // 退出登录后菜单里的入口会跟着消失，换成顶部“登录”旁边的入口
          const btn = document.getElementById("bili-switch-btn");
          if (btn && btn.dataset.kind === "menu") btn.remove();
        }
        if (res.captured && res.account) {
          showToast("已自动记下：" + (res.account.name || res.account.mid));
        }
      }
      renderButtonAvatar();
      renderPanel();
      scheduleInsert(0);
    });
  }

  /* ---------- 注入入口 ---------- */
  function renderButtonAvatar() {
    const btn = document.getElementById("bili-switch-btn");
    if (!btn) return;
    const img = btn.querySelector(".bili-switch-avatar");
    const icon = btn.querySelector(".bili-switch-swap-icon");
    const acct = findCurrentAccount();
    const url = acct ? avatarUrl(acct.avatar) : "";

    if (img) {
      if (url) {
        if (img.getAttribute("src") !== url) img.src = url;
        img.style.display = "";
      } else {
        img.removeAttribute("src");
        img.style.display = "none";
      }
    }
    if (icon) icon.style.display = url ? "none" : "";
  }

  function createButton(kind) {
    const btn = document.createElement("div");
    btn.id = "bili-switch-btn";
    btn.className = "bili-switch-wrap" + (kind === "header" ? " is-header" : "");
    btn.dataset.kind = kind;
    btn.title = "切换账号";
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = 0;
    btn.innerHTML =
      '<span class="bili-switch-entry-icon">' +
      '<img class="bili-switch-avatar" alt="" style="display:none">' +
      SWAP_ICON +
      "</span>" +
      '<span class="bili-switch-text">切换账号</span>' +
      (kind === "menu" ? '<span class="bili-switch-arrow">›</span>' : "");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      anchorBtn = btn;
      if ($panel && $panel.classList.contains("is-open")) hidePanel();
      else showPanel();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        anchorBtn = btn;
        showPanel();
      }
    });
    return btn;
  }

  function searchRow(scope, labels) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = (node.nodeValue || "").replace(/\s+/g, "");
        return labels.indexOf(text) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node) {
      // 往上爬到只包着这一行文字的最外层，别把入口插到行内部的链接里
      let row = node.parentElement;
      while (row && row !== scope) {
        const parent = row.parentElement;
        if (!parent || parent === scope) break;
        const parentText = (parent.textContent || "").replace(/\s+/g, "");
        if (labels.indexOf(parentText) < 0) break;
        row = parent;
      }
      if (row && row !== scope && row.parentElement && row.parentElement !== scope) {
        return { item: row, parent: row.parentElement };
      }
      node = walker.nextNode();
    }
    return null;
  }

  function findLogoutItem() {
    const scopes = [];
    const menu = document.querySelector(
      ".v-popover, .bili-user-profile, [class*='user-menu'], [class*='userMenu']"
    );
    if (menu) scopes.push(menu);
    const header = document.querySelector(".bili-header, #biliHeader, .mini-header");
    if (header && header !== menu) scopes.push(header);
    scopes.push(document.body);

    for (const scope of scopes) {
      if (!scope) continue;
      const found = searchRow(scope, ["退出登录"]);
      if (found) return found;
    }
    return null;
  }

  /* 没登录时 B站 顶部只有“登录”，把入口放到它旁边 */
  function findLoginItem() {
    const header = document.querySelector(".bili-header, #biliHeader, .mini-header");
    if (!header) return null;
    return searchRow(header, ["登录", "登录/注册"]);
  }

  function insertButton() {
    if (!state.showBtn || !state.userReady) return;
    if (document.getElementById("bili-switch-btn")) return;

    // B站页面一直在动，这里限一下频率，别把主线程拖住
    const now = Date.now();
    if (now - lastSearch < 400) return;
    lastSearch = now;

    let kind = "menu";
    let found = null;
    if (state.currentUser.loggedIn) {
      found = findLogoutItem();
    } else {
      // 没登录时优先用顶部“登录”旁边的入口，别插到可能残留的隐藏菜单里
      found = findLoginItem();
      kind = "header";
      if (!found) {
        found = findLogoutItem();
        kind = "menu";
      }
    }
    if (!found) return;

    const btn = createButton(kind);
    let holder = btn;
    const parentTag = found.parent.tagName;
    if (parentTag === "UL" || parentTag === "OL") {
      holder = document.createElement("li");
      holder.className = "bili-switch-li";
      holder.appendChild(btn);
    }
    found.parent.insertBefore(holder, found.item);
    renderButtonAvatar();
  }

  function scheduleInsert(delay = 80) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      insertButton();
    }, delay);
  }

  function onHeaderHover(e) {
    if (!state.showBtn || !state.userReady) return;
    if (document.getElementById("bili-switch-btn")) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".bili-header, #biliHeader, .mini-header, .v-popover")) {
      scheduleInsert(120);
    }
  }

  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      if (!state.showBtn || !state.userReady) return;
      if (document.getElementById("bili-switch-btn")) return;
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.id === "bili-switch-btn") continue;
          if (node.textContent && node.textContent.indexOf("退出登录") !== -1) {
            scheduleInsert(60);
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- 面板 ---------- */
  function createPanel() {
    const exists = document.getElementById("bili-switch-panel");
    if (exists) {
      $panel = exists;
      $list = document.getElementById("bili-switch-list");
      return;
    }

    const panel = document.createElement("div");
    panel.id = "bili-switch-panel";
    panel.className = "bili-switch-panel";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "切换账号");
    panel.innerHTML =
      '<div class="bili-switch-panel-header">' +
      '<span class="bili-switch-panel-title">切换账号</span>' +
      '<button type="button" class="bili-switch-panel-close" id="bili-switch-close" title="关闭" aria-label="关闭">×</button>' +
      "</div>" +
      '<div class="bili-switch-list" id="bili-switch-list"></div>' +
      '<div class="bili-switch-divider"></div>' +
      '<div class="bili-switch-add" id="bili-switch-add" role="menuitem" tabindex="0">' +
      '<span class="bili-switch-add-icon">' +
      PLUS_ICON +
      "</span><span>添加账户</span></div>";
    document.body.appendChild(panel);

    $panel = panel;
    $list = document.getElementById("bili-switch-list");

    document.getElementById("bili-switch-close").addEventListener("click", hidePanel);
    document.getElementById("bili-switch-add").addEventListener("click", (e) => {
      e.stopPropagation();
      handleAdd();
    });
    document.getElementById("bili-switch-add").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleAdd();
      }
    });
  }

  function isPanelOpen() {
    return !!($panel && $panel.classList.contains("is-open"));
  }

  function positionPanel() {
    if (!$panel || !anchorBtn) return;
    if (anchorBtn.isConnected === false) return;

    const btnRect = anchorBtn.getBoundingClientRect();
    const panelRect = $panel.getBoundingClientRect();
    const gap = 8;
    const margin = 8;

    // 优先放在按钮左边，像 B站 自己的二级浮层
    let left = btnRect.left - panelRect.width - gap;
    let top = btnRect.top - 8;

    if (left < margin) {
      left = btnRect.left;
      top = btnRect.bottom + gap;
    }
    if (left + panelRect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - panelRect.width - margin);
    }
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, btnRect.top - panelRect.height - gap);
    }

    $panel.style.left = left + "px";
    $panel.style.top = top + "px";
  }

  function showPanel() {
    createPanel();
    renderPanel();
    $panel.classList.add("is-open");
    positionPanel();
    syncCurrentUser();
  }

  function hidePanel() {
    if ($panel) $panel.classList.remove("is-open");
  }

  function createSaveRow() {
    const item = document.createElement("div");
    item.className = "bili-switch-item bili-switch-save";
    item.setAttribute("role", "menuitem");
    item.tabIndex = 0;
    item.innerHTML =
      avatarHtml("") +
      '<div class="bili-switch-item-info">' +
      '<div class="bili-switch-item-name">保存当前账号</div>' +
      '<div class="bili-switch-item-mid">UID: ' +
      escapeHtml(state.currentUser.mid || "-") +
      "</div></div>";

    const choose = saveCurrentAccount;
    item.addEventListener("click", choose);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    });
    return item;
  }

  function renderPanel() {
    if (!$list) return;
    $list.innerHTML = "";
    const current = findCurrentAccount();

    if (state.accounts.length === 0) {
      if (state.currentUser.loggedIn && !current) {
        $list.appendChild(createSaveRow());
      } else {
        const empty = document.createElement("div");
        empty.className = "bili-switch-empty";
        empty.textContent = state.currentUser.loggedIn
          ? "正在读取当前账号…"
          : "还没保存账号，点下面的“添加账户”登录一个。";
        $list.appendChild(empty);
      }
      return;
    }

    if (state.currentUser.loggedIn && !current) {
      $list.appendChild(createSaveRow());
    }

    state.accounts.forEach((acct, idx) => {
      const active = current && String(current.mid) === String(acct.mid);
      const item = document.createElement("div");
      item.className =
        "bili-switch-item bili-switch-account" + (active ? " active" : "");
      item.setAttribute("role", "menuitem");
      item.tabIndex = 0;
      item.innerHTML =
        avatarHtml(acct.avatar) +
        '<div class="bili-switch-item-info">' +
        '<div class="bili-switch-item-name">' +
        escapeHtml(acct.name || "未命名账号") +
        (active ? '<span class="bili-switch-item-tag">当前</span>' : "") +
        "</div>" +
        '<div class="bili-switch-item-mid">UID: ' +
        escapeHtml(acct.mid || "-") +
        "</div></div>";

      const choose = () => switchAccount(idx);
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

  /* ---------- 保存 / 添加 / 切换 ---------- */
  function saveCurrentAccount() {
    hidePanel();
    showToast("正在保存当前账号…");
    send({ action: "captureAccount" }).then((res) => {
      if (!res || !res.ok) {
        showToast((res && res.error) || "保存失败，稍后再试。");
        return;
      }
      state.currentUser = { loggedIn: true, mid: res.account.mid };
      renderButtonAvatar();
      renderPanel();
      showToast("已保存：" + (res.account.name || res.account.mid));
      scheduleInsert(0);
    });
  }

  function handleAdd() {
    hidePanel();
    const wasLoggedIn = state.currentUser.loggedIn;
    send({ action: "openLogin" }).then((res) => {
      if (res && res.ok) {
        showToast(
          wasLoggedIn
            ? "已打开登录窗口。要加新号，先在窗口里退出当前账号再登录。"
            : "已打开 B站登录窗口，登录成功后会自动记下这个号。",
          3500
        );
      } else {
        showToast("登录窗口没打开，手动去 passport.bilibili.com 登录吧。");
      }
    });
  }

  function switchAccount(idx) {
    const acct = state.accounts[idx];
    if (!acct) return;
    hidePanel();
    if (switching) return;

    if (
      state.currentUser.mid &&
      acct.mid &&
      String(state.currentUser.mid) === String(acct.mid)
    ) {
      showToast("现在就是 " + (acct.name || "这个号") + "。");
      return;
    }

    switching = true;
    showToast("正在切换到 " + (acct.name || "该账号") + "…");
    send({ action: "switchAccount", mid: acct.mid }).then((res) => {
      if (!res || !res.ok) {
        switching = false;
        showToast("切换失败：" + ((res && res.error) || "未知错误"), 3200);
        return;
      }
      state.currentUser = { loggedIn: true, mid: acct.mid };
      if (state.autoSwitch) {
        setTimeout(() => location.reload(), 500);
      } else {
        switching = false;
        renderButtonAvatar();
        showToast("已切换，刷新一下页面才会生效。", 3200);
      }
    });
  }

  /* ---------- 启动 ---------- */
  function start() {
    loadSettings();
    watchDom();
    scheduleInsert(600);
    setTimeout(() => insertButton(), 2500);
    // 后台一时半会儿没回话，也别让入口一直不出来
    setTimeout(() => {
      if (!state.userReady) {
        state.userReady = true;
        scheduleInsert(0);
      }
    }, 3000);

    document.addEventListener("mouseover", onHeaderHover, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hidePanel();
    });
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!isPanelOpen()) return;
        if ($panel.contains(e.target)) return;
        if (anchorBtn && anchorBtn.contains(e.target)) return;
        hidePanel();
      },
      true
    );
    window.addEventListener("resize", () => {
      if (isPanelOpen()) positionPanel();
    });
    document.addEventListener(
      "scroll",
      () => {
        if (isPanelOpen()) positionPanel();
      },
      true
    );
  }

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start);
})();
