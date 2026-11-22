/* B站多账号切换 - 设置页逻辑 */
(function () {
  const STORAGE_KEY = "bili_switcher_accounts";
  const $list = document.getElementById("accountList");
  const $empty = document.getElementById("emptyState");
  const $version = document.getElementById("appVersion");
  const $cfgAuto = document.getElementById("cfgAutoSwitch");
  const $cfgBtn = document.getElementById("cfgShowBtn");

  // 版本号
  fetch(chrome.runtime.getURL("manifest.json"))
    .then((r) => r.json())
    .then((m) => {
      if ($version) $version.textContent = m.version_name || m.version || "1.1.0-beta";
    })
    .catch(() => {});

  // 加载设置
  function loadSettings() {
    chrome.storage.local.get(
      [STORAGE_KEY, "cfgAutoSwitch", "cfgShowBtn"],
      (res) => {
        const accounts = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        renderAccounts(accounts);
        if ($cfgAuto) $cfgAuto.checked = res.cfgAutoSwitch !== false;
        if ($cfgBtn) $cfgBtn.checked = res.cfgShowBtn !== false;
      }
    );
  }

  function saveSettings() {
    chrome.storage.local.set({
      cfgAutoSwitch: $cfgAuto ? $cfgAuto.checked : true,
      cfgShowBtn: $cfgBtn ? $cfgBtn.checked : true,
    });
  }

  if ($cfgAuto) $cfgAuto.addEventListener("change", saveSettings);
  if ($cfgBtn) $cfgBtn.addEventListener("change", saveSettings);

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function accountKey(acct) {
    return String(acct.mid || "") + "|" + String(acct.addedAt || "");
  }

  function avatarUrl(src) {
    const str = String(src || "");
    if (!str) return "";
    if (str.indexOf("//") === 0) return "https:" + str;
    return str.replace(/^http:\/\//, "https://");
  }

  function renderAccounts(accounts) {
    if (!$list) return;
    $list.innerHTML = "";
    if ($empty) $empty.style.display = accounts.length === 0 ? "" : "none";
    if (accounts.length === 0) return;

    accounts.forEach((acct) => {
      const item = document.createElement("div");
      item.className = "opts-account-item";
      const avatar = avatarUrl(acct.avatar);
      const avatarHtml = avatar
        ? '<img class="opts-account-item-avatar" src="' + escapeHtml(avatar) + '" alt="">'
        : '<span class="opts-account-item-avatar opts-account-avatar-empty"></span>';
      item.innerHTML =
        avatarHtml +
        '<div class="opts-account-item-info">' +
        '<div class="opts-account-item-name">' +
        escapeHtml(acct.name || "未命名账号") +
        "</div>" +
        '<div class="opts-account-item-mid">UID: ' +
        escapeHtml(acct.mid || "-") +
        "</div>" +
        "</div>" +
        '<button type="button" class="opts-account-item-remove" data-key="' +
        escapeHtml(accountKey(acct)) +
        '" data-name="' +
        escapeHtml(acct.name || "这个账号") +
        '">删除</button>';
      $list.appendChild(item);
    });
  }

  // 只在外面挂一次，别每次重绘都加一个监听
  if ($list) {
    $list.addEventListener("click", (e) => {
      const btn = e.target.closest(".opts-account-item-remove");
      if (!btn) return;
      const key = btn.getAttribute("data-key") || "";
      const name = btn.getAttribute("data-name") || "这个账号";
      if (!window.confirm("删除“" + name + "”的登录信息？以后要用得重新添加。")) return;

      chrome.storage.local.get(STORAGE_KEY, (res) => {
        const arr = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        const next = arr.filter((acct) => accountKey(acct) !== key);
        chrome.storage.local.set({ [STORAGE_KEY]: next }, () => loadSettings());
      });
    });
  }

  // 在网页端保存/切换账号后，设置页也跟着更新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      const accounts = Array.isArray(changes[STORAGE_KEY].newValue)
        ? changes[STORAGE_KEY].newValue
        : [];
      renderAccounts(accounts);
    }
    if (changes.cfgAutoSwitch && $cfgAuto) {
      $cfgAuto.checked = changes.cfgAutoSwitch.newValue !== false;
    }
    if (changes.cfgShowBtn && $cfgBtn) {
      $cfgBtn.checked = changes.cfgShowBtn.newValue !== false;
    }
  });

  loadSettings();
})();
