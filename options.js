/* B站多账号切换 - 设置页逻辑 */
(function () {
  const STORAGE_KEY = "bili_switcher_accounts";
  const STATS_KEY = "bili_switcher_stats";
  const AUTH_COOKIE_NAMES = new Set([
    "SESSDATA",
    "bili_jct",
    "DedeUserID",
    "DedeUserID__ckMd5",
    "sid",
  ]);
  const $list = document.getElementById("accountList");
  const $empty = document.getElementById("emptyState");
  const $count = document.getElementById("accountCount");
  const $version = document.getElementById("appVersion");
  const $cfgAuto = document.getElementById("cfgAutoSwitch");
  const $cfgBtn = document.getElementById("cfgShowBtn");
  const $cfgDebug = document.getElementById("cfgDebug");
  const $stats = document.getElementById("statsText");
  const $themeRadios = Array.from(document.querySelectorAll('input[name="cfgTheme"]'));
  let currentTheme = "auto";

  // 版本号
  fetch(chrome.runtime.getURL("manifest.json"))
    .then((r) => r.json())
    .then((m) => {
      if ($version) $version.textContent = m.version_name || m.version || "1.2.1";
    })
    .catch(() => {});

  function todayKey() {
    const now = new Date();
    return (
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0")
    );
  }

  function selectedTheme() {
    const checked = $themeRadios.find((radio) => radio.checked);
    return checked ? checked.value : "auto";
  }

  function readBiliTheme() {
    if (!chrome.cookies || !chrome.cookies.get) {
      document.documentElement.classList.remove("bili-theme-dark");
      return;
    }
    try {
      chrome.cookies.get(
        { url: "https://www.bilibili.com/", name: "theme_style" },
        (cookie) => {
          void chrome.runtime.lastError;
          const dark = !!(cookie && cookie.value === "dark");
          document.documentElement.classList.toggle("bili-theme-dark", dark);
        }
      );
    } catch (_) {
      document.documentElement.classList.remove("bili-theme-dark");
    }
  }

  function applyTheme() {
    currentTheme = selectedTheme();
    if (currentTheme === "dark") {
      document.documentElement.classList.add("bili-theme-dark");
      return;
    }
    if (currentTheme === "light") {
      document.documentElement.classList.remove("bili-theme-dark");
      return;
    }
    readBiliTheme();
  }

  if (chrome.cookies && chrome.cookies.onChanged) {
    chrome.cookies.onChanged.addListener((info) => {
      if (currentTheme !== "auto") return;
      if (!info.cookie || info.cookie.name !== "theme_style") return;
      if (String(info.cookie.domain || "").indexOf("bilibili.com") === -1) return;
      readBiliTheme();
    });
  }

  // 加载设置
  function loadSettings() {
    chrome.storage.local.get(
      [STORAGE_KEY, "cfgAutoSwitch", "cfgShowBtn", "cfgDebug", "cfgTheme", STATS_KEY],
      (res) => {
        const accounts = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        renderAccounts(accounts);
        if ($cfgAuto) $cfgAuto.checked = res.cfgAutoSwitch !== false;
        if ($cfgBtn) $cfgBtn.checked = res.cfgShowBtn !== false;
        if ($cfgDebug) $cfgDebug.checked = res.cfgDebug !== false;
        const theme = ["auto", "light", "dark"].includes(res.cfgTheme)
          ? res.cfgTheme
          : "auto";
        $themeRadios.forEach((radio) => {
          radio.checked = radio.value === theme;
        });
        applyTheme();
        renderStats(res[STATS_KEY]);
      }
    );
  }

  function saveSettings() {
    chrome.storage.local.set({
      cfgAutoSwitch: $cfgAuto ? $cfgAuto.checked : true,
      cfgShowBtn: $cfgBtn ? $cfgBtn.checked : true,
      cfgDebug: $cfgDebug ? $cfgDebug.checked : true,
      cfgTheme: selectedTheme(),
    });
  }

  if ($cfgAuto) $cfgAuto.addEventListener("change", saveSettings);
  if ($cfgBtn) $cfgBtn.addEventListener("change", saveSettings);
  if ($cfgDebug) $cfgDebug.addEventListener("change", saveSettings);
  $themeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      applyTheme();
      saveSettings();
    });
  });

  function renderStats(stats) {
    if (!$stats) return;
    const total = (stats && stats.total) || 0;
    const today = stats && stats.date === todayKey() ? stats.today || 0 : 0;
    $stats.textContent = "今日切换 " + today + " 次 · 累计切换 " + total + " 次";
  }

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

  function slimAccount(acct) {
    return {
      ...acct,
      cookies: Array.isArray(acct.cookies)
        ? acct.cookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name))
        : [],
    };
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
    if ($count) $count.textContent = accounts.length + " 个账号";
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

  // 事件只挂一次
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

  // 重置统计
  const $resetStats = document.getElementById("resetStats");
  if ($resetStats) {
    $resetStats.addEventListener("click", () => {
      if (!window.confirm("把切换统计清零？账号不会删除。")) return;
      chrome.storage.local.set(
        { [STATS_KEY]: { date: todayKey(), today: 0, total: 0 } },
        () => loadSettings()
      );
    });
  }

  // 导出配置
  const $exportConfig = document.getElementById("exportConfig");
  if ($exportConfig) {
    $exportConfig.addEventListener("click", () => {
      chrome.storage.local.get(
        [STORAGE_KEY, "cfgAutoSwitch", "cfgShowBtn", "cfgDebug", "cfgTheme", STATS_KEY],
        (res) => {
          const data = {
            format: "bili-account-switcher",
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: {
              cfgAutoSwitch: res.cfgAutoSwitch !== false,
              cfgShowBtn: res.cfgShowBtn !== false,
              cfgDebug: res.cfgDebug !== false,
              cfgTheme: ["auto", "light", "dark"].includes(res.cfgTheme)
                ? res.cfgTheme
                : "auto",
            },
            accounts: Array.isArray(res[STORAGE_KEY])
              ? res[STORAGE_KEY].map(slimAccount)
              : [],
            stats: res[STATS_KEY] || {},
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "bili-account-switcher-config.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      );
    });
  }

  // 导入配置
  const $importConfig = document.getElementById("importConfig");
  const $importFile = document.getElementById("importFile");
  if ($importConfig && $importFile) {
    $importConfig.addEventListener("click", () => $importFile.click());
    $importFile.addEventListener("change", () => {
      const file = $importFile.files && $importFile.files[0];
      if (!file) return;
      file
        .text()
        .then((text) => {
          let data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error("不是有效的 JSON 文件");
          }
          if (!data || !Array.isArray(data.accounts)) {
            throw new Error("文件里没有账号数据");
          }
          const importedAccounts = data.accounts
            .filter((acct) => acct && typeof acct === "object")
            .map(slimAccount);
          if (!window.confirm("导入会覆盖当前的账号和设置，继续吗？")) return;
          const settings = data.settings || {};
          chrome.storage.local.set(
            {
              [STORAGE_KEY]: importedAccounts,
              cfgAutoSwitch: settings.cfgAutoSwitch !== false,
              cfgShowBtn: settings.cfgShowBtn !== false,
              cfgDebug: settings.cfgDebug !== false,
              cfgTheme: ["auto", "light", "dark"].includes(settings.cfgTheme)
                ? settings.cfgTheme
                : "auto",
              [STATS_KEY]: data.stats || { date: todayKey(), today: 0, total: 0 },
            },
            () => loadSettings()
          );
        })
        .catch((err) => window.alert("导入失败：" + (err.message || err)))
        .finally(() => {
          $importFile.value = "";
        });
    });
  }

  // 清除扩展数据，并删除 bilibili.com 的所有 Cookie（会退出当前登录）
  const $clearData = document.getElementById("clearData");
  if ($clearData) {
    $clearData.addEventListener("click", () => {
      const ok = window.confirm(
        "会删除所有已保存账号、设置和统计，并删除 bilibili.com 的所有 Cookie；当前 B站 会退出登录。确定吗？"
      );
      if (!ok) return;
      chrome.runtime.sendMessage({ action: "clearDataAndCookies" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          const message = chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : (res && res.error) || "未知错误";
          window.alert("清除失败：" + message);
          return;
        }
        window.alert("已清除，删除了 " + res.removedCookies + " 个 B站 Cookie。");
        loadSettings();
      });
    });
  }

  // 网页端保存账号或切换后，设置页跟着更新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      const accounts = Array.isArray(changes[STORAGE_KEY].newValue)
        ? changes[STORAGE_KEY].newValue
        : [];
      renderAccounts(accounts);
    }
    if (changes[STATS_KEY]) renderStats(changes[STATS_KEY].newValue);
    if (changes.cfgAutoSwitch && $cfgAuto) {
      $cfgAuto.checked = changes.cfgAutoSwitch.newValue !== false;
    }
    if (changes.cfgShowBtn && $cfgBtn) {
      $cfgBtn.checked = changes.cfgShowBtn.newValue !== false;
    }
    if (changes.cfgDebug && $cfgDebug) {
      $cfgDebug.checked = changes.cfgDebug.newValue !== false;
    }
    if (changes.cfgTheme) {
      const theme = ["auto", "light", "dark"].includes(changes.cfgTheme.newValue)
        ? changes.cfgTheme.newValue
        : "auto";
      $themeRadios.forEach((radio) => {
        radio.checked = radio.value === theme;
      });
      applyTheme();
    }
  });

  loadSettings();
})();
