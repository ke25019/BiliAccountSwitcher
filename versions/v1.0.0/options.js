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
      if ($version) $version.textContent = m.version || "1.0.0";
    });

  // 加载设置
  function loadSettings() {
    chrome.storage.local.get(
      [STORAGE_KEY, "cfgAutoSwitch", "cfgShowBtn"],
      (res) => {
        const accounts = res[STORAGE_KEY] || [];
        renderAccounts(accounts);
        if ($cfgAuto) $cfgAuto.checked = res.cfgAutoSwitch !== false;
        if ($cfgBtn) $cfgBtn.checked = res.cfgShowBtn !== false;
      }
    );
  }

  function saveSettings() {
    chrome.storage.local.set(
      {
        cfgAutoSwitch: $cfgAuto ? $cfgAuto.checked : true,
        cfgShowBtn: $cfgBtn ? $cfgBtn.checked : true,
      },
      () => {}
    );
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

  function renderAccounts(accounts) {
    if (!$list) return;
    $list.innerHTML = "";
    if ($empty) {
      $empty.style.display = accounts.length === 0 ? "" : "none";
    }
    if (accounts.length === 0) return;
    accounts.forEach((acct, idx) => {
      const item = document.createElement("div");
      item.className = "opts-account-item";
      item.innerHTML =
        '<img class="opts-account-item-avatar" src="' +
        escapeHtml(acct.avatar || "") +
        '" alt="">' +
        '<div class="opts-account-item-info">' +
        '<div class="opts-account-item-name">' +
        escapeHtml(acct.name || "未命名账号") +
        "</div>" +
        '<div class="opts-account-item-mid">UID: ' +
        escapeHtml(acct.mid || "-") +
        "</div>" +
        "</div>" +
        '<button class="opts-account-item-remove" data-idx="' +
        idx +
        '" title="删除">删除</button>';
      $list.appendChild(item);
    });
    $list.addEventListener("click", (e) => {
      const btn = e.target.closest(".opts-account-item-remove");
      if (!btn) return;
      const idx = Number(btn.getAttribute("data-idx"));
      chrome.storage.local.get(STORAGE_KEY, (res) => {
        const arr = res[STORAGE_KEY] || [];
        arr.splice(idx, 1);
        chrome.storage.local.set({ [STORAGE_KEY]: arr }, () => {
          loadSettings();
        });
      });
    });
  }

  loadSettings();
})();
