# Bilibili Account Switcher

[简体中文](README.md) | English

A Manifest V3 browser extension for switching between multiple Bilibili accounts on the web. It adds a **Switch account** entry above **Log out** in the Bilibili user menu, so you can change accounts without logging out and back in every time.

Current version: `1.1.4-beta`

## Features

- **Automatic account capture**: after you log in to Bilibili, the extension reads the current account's name, avatar and login cookies and saves them locally.
- **Switch accounts**: a **Switch account** row above **Log out**, with an icon, text and a small arrow. Hover it to open the account panel; the panel stays open while your pointer is over it.
- **Safe switching**: before leaving an account, its latest cookies are saved again; short-lived tickets are skipped; the extension verifies the new login through Bilibili's nav API and restores the previous login if verification fails.
- **Works while logged out**: when logged out, the entry appears next to the **Log in** button in the header, and saved accounts can still be used.
- **Add account**: opens an in-page login window with the Bilibili login page embedded. The current account is saved first, then logged out so the login form can appear; closing the window restores the previous account.
- **Local account login**: a fourth **Local account** option next to WeChat / Weibo / QQ on the Bilibili login page, letting you log in with a saved account's cookies.
- **Dark mode**: the injected entry, account panel, add-account window and settings page follow Bilibili's dark theme.
- **Settings page**: account management, theme mode, auto refresh, debug logs, switch statistics, config export/import and reset.

## Install

1. Go to Microsoft Edge Add-ons and click **Get** (not published yet); the browser will install and keep it updated automatically.
2. To install manually or try a beta, download the matching zip from [Releases](https://github.com/ke25019/BiliAccountSwitcher/releases), extract it, then open **Developer mode** → **Load unpacked** on the extensions page.

> Chrome/Edge 121+ is required. Firefox 121+ also works; if login state is not detected in Firefox, enable site access for `bilibili.com` in the extension settings.

## Files

- `manifest.json`: extension manifest (Manifest V3).
- `background.js`: cookie reading/writing with `chrome.cookies`, account capture, logout and login verification.
- `content.js` / `content.css`: the in-page switch entry and account panel.
- `login.js` / `login.css`: the **Local account** login option on Bilibili's login page.
- `options.html` / `options.css` / `options.js`: the settings page.
- `icons/`: extension icons.
- `LICENSE`: PolyForm Noncommercial License 1.0.0.

## Debugging

- Open DevTools on a Bilibili page and filter for `[B站多账号切换]` (`[Bilibili Account Switcher]`) to see sync, injection and switch steps.
- The last switch result is stored and printed after a page reload.
- Logs contain cookie names/domains/paths only, never cookie values.

## AI notice

This project includes AI-generated content. All changes were reviewed before release.

## Privacy and license

- Account credentials stay in your local browser and are never uploaded. Cookies are replaced locally by the background script.
- This is an unofficial third-party project and is not affiliated with Bilibili.
- Released under the [PolyForm Noncommercial License 1.0.0](LICENSE). Personal use is free; commercial use is not allowed.
- Repository: https://github.com/ke25019/BiliAccountSwitcher
