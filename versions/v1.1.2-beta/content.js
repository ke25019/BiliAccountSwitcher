/* B站多账号切换 - 在 B站 用户菜单里加“切换账号”，点开是账号面板
   Cookie 读写和自动记账号都在 background.js，这里只管界面 */
(function () {
  const STORAGE_KEY = "bili_switcher_accounts";
  const LAST_SWITCH_KEY = "bili_switcher_last_switch";

  const SWAP_ICON =
    '<svg class="bili-switch-swap-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>' +
    "</svg>";
  const PLUS_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>' +
    "</svg>";
  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="m5 12 5 5L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
    "</svg>";
  const ARROW_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>' +
    "</svg>";

  const TAG = "[B站多账号切换]";
  function log(...args) {
    console.log(TAG, ...args);
  }
  function logError(...args) {
    console.error(TAG, ...args);
  }

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
  let debugDumped = false;
  let lastProfileRefresh = 0;
  let lastSync = 0;
  let hideTimer = 0;
  let openTimer = 0;
  let lastSwitchReported = false;
  let $modal = null;
  let addPollTimer = 0;
  let addFlow = false;
  let addClosing = false;
  let addPreviousMid = "";
  let addPrevOverflow = "";

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

  /* 从 B站 顶部头像拿当前账号的实时头像，避免和存下来的旧头像对不上 */
  function liveHeaderAvatar() {
    const header = document.querySelector(".bili-header, #biliHeader, .mini-header");
    if (!header) return "";
    const imgs = header.querySelectorAll('img[src*="/bfs/face/"], img[data-src*="/bfs/face/"]');
    for (const img of imgs) {
      const url = avatarUrl(
        img.currentSrc || img.src || img.getAttribute("data-src") || ""
      );
      if (url) return url;
    }
    return "";
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
        log(
          "读取设置 " +
            JSON.stringify({
              showBtn: state.showBtn,
              autoSwitch: state.autoSwitch,
              accounts: state.accounts.length,
            })
        );
        applySettings();
        renderPanel();
        syncCurrentUser(true);
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
      renderPanel();
    }
  });

  /* 控制台排查信息：只打印 Cookie 名字和账号概况，不打印 Cookie 值 */
  function dumpDebugInfo(force) {
    if (debugDumped && !force) return;
    debugDumped = true;
    send({ action: "debugInfo" }).then((info) => {
      if (!info || !info.ok) {
        log("调试信息获取失败 " + JSON.stringify(info));
        return;
      }
      // 用一行 JSON 输出，导出的控制台日志里才能看到内容
      log("调试信息 " + JSON.stringify(info));
    });
  }

  function reportLastSwitch() {
    if (lastSwitchReported) return;
    lastSwitchReported = true;
    chrome.storage.local.get(LAST_SWITCH_KEY, (res) => {
      const rec = res && res[LAST_SWITCH_KEY];
      if (!rec) return;
      const nowMid = state.currentUser.mid || "";
      const toMid = String(rec.toMid || "");
      const canCheck = !!toMid && toMid !== "-";
      const mismatched =
        rec.ok && canCheck && (!state.currentUser.loggedIn || String(nowMid) !== toMid);
      log(
        "上次切换记录 " +
          JSON.stringify({
            at: rec.at ? new Date(rec.at).toLocaleString() : "",
            fromMid: rec.fromMid,
            toMid: rec.toMid,
            toName: rec.toName,
            ok: rec.ok,
            error: rec.error,
            steps: rec.steps,
            nowLoggedIn: state.currentUser.loggedIn,
            nowMid,
            mismatched,
          })
      );
      if (mismatched) {
        showToast(
          "切换后 B站 没保持登录，可能这个号的登录信息过期了，重新登录保存一次吧。",
          4500
        );
      }
      try {
        chrome.storage.local.remove(LAST_SWITCH_KEY);
      } catch (_) {
        // 老环境没有 remove 也不影响页面
      }
    });
  }

  /* 每次打开 B站 页面都问一次后台：当前号存过没有，没存就自动抓下来 */
  function syncCurrentUser(force) {
    if (syncing) return;
    const now = Date.now();
    if (!force && now - lastSync < 1500) return;
    lastSync = now;
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
      log("同步结果 " + JSON.stringify(res));
      renderPanel();
      scheduleInsert(0);
      dumpDebugInfo(false);
      reportLastSwitch();
    });
  }

  /* ---------- 注入入口 ---------- */
  function createButton(kind) {
    const btn = document.createElement("div");
    btn.id = "bili-switch-btn";
    btn.className = "bili-switch-wrap" + (kind === "header" ? " is-header" : "");
    btn.dataset.kind = kind;
    btn.title = "切换账号";
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = 0;
    btn.innerHTML =
      '<span class="bili-switch-entry-title">' +
      '<span class="bili-switch-entry-icon">' +
      SWAP_ICON +
      "</span>" +
      '<span class="bili-switch-text">切换账号</span>' +
      "</span>" +
      (kind === "menu"
        ? '<span class="bili-switch-arrow">' + ARROW_ICON + "</span>"
        : "");

    btn.addEventListener("mouseenter", () => openFromHover(btn));
    btn.addEventListener("mouseleave", () => {
      clearTimeout(openTimer);
      scheduleHide(280);
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(openTimer);
      cancelHide();
      anchorBtn = btn;
      if (isPanelOpen()) hidePanel();
      else showPanel();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        clearTimeout(openTimer);
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
    log(
      "注入入口 " +
        JSON.stringify({
          kind,
          parent: parentTag,
          path: location.pathname,
        })
    );
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
  function panelHost() {
    if (!anchorBtn) return document.body;
    // 菜单里的入口：面板塞进 B站 的浮层里面，鼠标移过去时资料卡片不会收起来
    return anchorBtn.closest(".v-popover-content") || document.body;
  }

  function createPanel() {
    const host = panelHost();
    let panel = document.getElementById("bili-switch-panel");
    if (panel && panel.parentElement !== host) {
      panel.remove();
      panel = null;
    }

    if (panel) {
      $panel = panel;
      $list = document.getElementById("bili-switch-list");
      return;
    }

    panel = document.createElement("div");
    panel.id = "bili-switch-panel";
    panel.className = "bili-switch-panel";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "切换账号");
    panel.innerHTML =
      '<div class="bili-switch-list" id="bili-switch-list"></div>' +
      '<div class="bili-switch-divider"></div>' +
      '<div class="bili-switch-add" id="bili-switch-add" role="menuitem" tabindex="0">' +
      '<span class="bili-switch-add-icon">' +
      PLUS_ICON +
      "</span><span>添加账户</span>" +
      '<span class="bili-switch-arrow">' +
      ARROW_ICON +
      "</span></div>";
    host.appendChild(panel);

    $panel = panel;
    $list = document.getElementById("bili-switch-list");

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
    panel.addEventListener("mouseenter", cancelHide);
    panel.addEventListener("mouseleave", () => scheduleHide(220));
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  }

  function scheduleHide(delay = 240) {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      hidePanel();
    }, delay);
  }

  function openFromHover(btn) {
    anchorBtn = btn;
    cancelHide();
    clearTimeout(openTimer);
    openTimer = setTimeout(() => {
      openTimer = 0;
      if (btn.isConnected) showPanel();
    }, 80);
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

    // 面板在菜单浮层里时用 absolute，位置换算成相对菜单的坐标
    const host = $panel.parentElement;
    const inMenu = host && host !== document.body;
    const hostRect = inMenu ? host.getBoundingClientRect() : null;

    // 优先放在按钮左边，像 B站 自己的二级浮层
    let left = (inMenu ? hostRect.left : btnRect.left) - panelRect.width - gap;
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
    if (top < margin) top = margin;

    if (inMenu) {
      $panel.style.position = "absolute";
      $panel.style.left = left - hostRect.left + "px";
      $panel.style.top = top - hostRect.top + "px";
    } else {
      $panel.style.position = "fixed";
      $panel.style.left = left + "px";
      $panel.style.top = top + "px";
    }
  }

  function refreshCurrentProfile() {
    if (!state.currentUser.loggedIn) return;
    const now = Date.now();
    if (now - lastProfileRefresh < 60 * 1000) return;
    lastProfileRefresh = now;
    send({ action: "refreshProfile" }).then((res) => {
      log("刷新账号资料 " + JSON.stringify(res));
      if (res && res.ok && res.updated) renderPanel();
    });
  }

  function showPanel() {
    const wasOpen = isPanelOpen();
    cancelHide();
    createPanel();
    renderPanel();
    $panel.classList.add("is-open");
    positionPanel();
    if (!wasOpen) {
      log(
        "打开面板 " +
          JSON.stringify({ mid: state.currentUser.mid, accounts: state.accounts.length })
      );
    }
    syncCurrentUser();
    refreshCurrentProfile();
  }

  function hidePanel() {
    cancelHide();
    if ($panel) $panel.classList.remove("is-open");
  }

  function createSaveRow() {
    const item = document.createElement("div");
    item.className = "bili-switch-item bili-switch-save";
    item.setAttribute("role", "menuitem");
    item.tabIndex = 0;
    item.innerHTML =
      '<span class="bili-switch-item-avatar bili-switch-avatar-empty bili-switch-save-icon">' +
      PLUS_ICON +
      "</span>" +
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
        avatarHtml(active ? liveHeaderAvatar() || acct.avatar : acct.avatar) +
        '<div class="bili-switch-item-info">' +
        '<div class="bili-switch-item-name">' +
        escapeHtml(acct.name || "未命名账号") +
        "</div>" +
        '<div class="bili-switch-item-mid">UID: ' +
        escapeHtml(acct.mid || "-") +
        "</div></div>" +
        (active ? '<span class="bili-switch-item-check">' + CHECK_ICON + "</span>" : "");

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
      renderPanel();
      showToast("已保存：" + (res.account.name || res.account.mid));
      log("手动保存账号 " + JSON.stringify(res.account));
      scheduleInsert(0);
    });
  }

  function createAddModal(wasLoggedIn) {
    if ($modal) return $modal;
    const mask = document.createElement("div");
    mask.id = "bili-switch-modal";
    mask.className = "bili-switch-modal-mask";
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-label", "添加账号");
    mask.innerHTML =
      '<div class="bili-switch-modal">' +
      '<div class="bili-switch-modal-head">' +
      '<span class="bili-switch-modal-title">添加账号</span>' +
      '<button type="button" class="bili-switch-modal-close" aria-label="关闭">×</button>' +
      "</div>" +
      '<div class="bili-switch-modal-body">' +
      '<iframe class="bili-switch-login-frame" title="B站登录" src="https://passport.bilibili.com/login"></iframe>' +
      "</div>" +
      '<div class="bili-switch-modal-hint">' +
      (wasLoggedIn
        ? "当前账号已经保存。登录新账号后会自动记下来；不想加就关掉，会切回原来的账号。"
        : "登录成功后会自动记下这个账号。") +
      "</div>" +
      "</div>";
    document.body.appendChild(mask);
    mask.querySelector(".bili-switch-modal-close").addEventListener("click", () => {
      cancelAddFlow();
    });
    mask.addEventListener("mousedown", (e) => {
      if (e.target === mask) cancelAddFlow();
    });
    $modal = mask;
    return mask;
  }

  function showAddModal(wasLoggedIn) {
    createAddModal(wasLoggedIn);
    addPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    $modal.classList.add("is-open");
  }

  function closeAddModal() {
    clearTimeout(addPollTimer);
    addPollTimer = 0;
    if ($modal) {
      $modal.remove();
      $modal = null;
    }
    document.body.style.overflow = addPrevOverflow || "";
  }

  function pollAddLogin() {
    if (!addFlow) return;
    send({ action: "getCurrentUser" }).then((cur) => {
      if (!addFlow) return;
      if (cur && cur.ok && cur.loggedIn) {
        addFlow = false;
        closeAddModal();
        send({ action: "captureAccount" }).then((cap) => {
          if (cap && cap.ok) {
            showToast("已保存：" + (cap.account.name || cap.account.mid));
          } else {
            showToast(
              "登录成功，但保存账号失败：" + ((cap && cap.error) || "未知错误"),
              4000
            );
          }
          setTimeout(() => location.reload(), 700);
        });
        return;
      }
      addPollTimer = setTimeout(pollAddLogin, 900);
    });
  }

  async function startAddFlow() {
    if (addFlow || addClosing) return;
    addFlow = true;
    hidePanel();

    const current = await send({ action: "getCurrentUser" });
    const wasLoggedIn = !!(current && current.ok && current.loggedIn);
    addPreviousMid = wasLoggedIn ? current.mid || "" : "";
    log(
      "添加账号：开始 " +
        JSON.stringify({ wasLoggedIn, previousMid: addPreviousMid })
    );

    if (wasLoggedIn) {
      showToast("正在保存当前账号…");
      const saved = await send({ action: "captureAccount" });
      if (!saved || !saved.ok) {
        addFlow = false;
        showToast((saved && saved.error) || "当前账号没保存成功，先不退出登录。");
        return;
      }
      const out = await send({ action: "logoutCurrent" });
      log("添加账号：退出当前号 " + JSON.stringify(out));
      if (!out || !out.ok || out.stillLoggedIn) {
        addFlow = false;
        showToast("退出当前账号失败，先不加新号了。", 3500);
        return;
      }
      state.currentUser = { loggedIn: false, mid: "" };
      log("添加账号：已退出当前账号，准备登录新号");
    }

    if (!addFlow) return;
    showAddModal(wasLoggedIn);
    pollAddLogin();
  }

  async function cancelAddFlow() {
    if (addClosing) return;
    if (!$modal && !addFlow) return;
    addClosing = true;
    addFlow = false;
    clearTimeout(addPollTimer);
    addPollTimer = 0;
    closeAddModal();

    const prevMid = addPreviousMid;
    addPreviousMid = "";
    try {
      const current = await send({ action: "getCurrentUser" });
      if (current && current.ok && current.loggedIn) {
        if (prevMid && String(current.mid) !== String(prevMid)) {
          await send({ action: "captureAccount" });
          showToast("已保存新账号，正在刷新页面…");
          setTimeout(() => location.reload(), 600);
          return;
        }
        showToast("登录窗口已关闭");
        return;
      }

      if (prevMid) {
        showToast("已取消，正在切回原账号…");
        const res = await send({ action: "switchAccount", mid: prevMid });
        if (res && res.ok) setTimeout(() => location.reload(), 500);
        else showToast("切回原账号失败：" + ((res && res.error) || "未知错误"), 4000);
      } else {
        showToast("登录窗口已关闭");
      }
    } finally {
      addClosing = false;
    }
  }

  function handleAdd() {
    startAddFlow();
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
    log(
      "请求切换 " +
        JSON.stringify({ mid: acct.mid, name: acct.name, from: state.currentUser.mid })
    );
    send({ action: "switchAccount", mid: acct.mid }).then((res) => {
      if (res && res.steps && res.steps.length) {
        log("切换流程 " + JSON.stringify(res.steps));
      }
      if (!res || !res.ok) {
        switching = false;
        logError("切换失败 " + JSON.stringify(res));
        showToast("切换失败：" + ((res && res.error) || "未知错误"), 3200);
        dumpDebugInfo(true);
        reportLastSwitch();
        return;
      }
      state.currentUser = { loggedIn: true, mid: acct.mid };
      log(
        "切换成功 " +
          JSON.stringify({ mid: acct.mid, autoSwitch: state.autoSwitch })
      );
      if (state.autoSwitch) {
        setTimeout(() => location.reload(), 500);
      } else {
        switching = false;
        showToast("已切换，刷新一下页面才会生效。", 3200);
      }
    });
  }

  /* ---------- 启动 ---------- */
  function start() {
    try {
      const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
      log(
        "页面加载 " +
          JSON.stringify({
            version: manifest ? manifest.version_name || manifest.version : "?",
            url: location.href,
          })
      );
    } catch (_) {
      log("页面加载 " + location.href);
    }
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
      if (e.key !== "Escape") return;
      if ($modal) {
        cancelAddFlow();
        return;
      }
      hidePanel();
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
