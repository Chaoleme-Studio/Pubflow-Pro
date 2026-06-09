---
name: pubflow-wxt-manual-browser
description: Use when developing or debugging the PubFlow WXT Chrome extension with a manually launched Chrome on port 9222, especially when WXT/web-ext auto-load fails with CDP Extensions.loadUnpacked errors.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [pubflow, wxt, chrome-extension, cdp, 9222, manual-browser, debugging]
    related_skills: [systematic-debugging, native-mcp, mcporter]
---

# PubFlow WXT Manual Browser Debugging

## Overview

PubFlow is a WXT-based Chrome MV3 extension for multi-platform short-video publishing. During local debugging, the preferred workflow is often:

1. Start a persistent Chrome manually on port 9222 with a stable user-data-dir, so platform login state is preserved.
2. Run WXT in development mode only to build/watch `.output/chrome-mv3-dev` and serve hot-reload assets.
3. Load the unpacked extension manually from Chrome's extension page.
4. Use CDP/DevTools/MCP to inspect the real browser state and content-script console logs.

This avoids WXT/web-ext trying to connect to the already-running browser and calling `Extensions.loadUnpacked`, which can fail with:

```text
ERROR CDP connection closed before response to Extensions.loadUnpacked
```

## When to Use

Use this skill when:

- The user is working in `/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension`.
- `pnpm dev` exits immediately with `CDP connection closed before response to Extensions.loadUnpacked`.
- The user manually starts Chrome with `--remote-debugging-port=9222`.
- The extension is loaded from `.output/chrome-mv3-dev`.
- The page console shows WXT dev-server warnings like `WebSocket connection to ws://localhost:3000 failed`.
- Debugging WeChat Channels / 视频号 page injection at `https://channels.weixin.qq.com/platform/post/create`.

Do not use this for production extension packaging unless the task explicitly involves local debugging.

## Correct Local Paths

Project root:

```bash
/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension
```

Development unpacked extension path:

```bash
/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/.output/chrome-mv3-dev
```

Production build output path:

```bash
/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/.output/chrome-mv3
```

For WXT development with dev server/hot reload, load `.output/chrome-mv3-dev`, not `.output/chrome-mv3`.

## Manual Chrome Command

Use a dedicated Chrome profile so platform logins are stable and isolated:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  '--remote-allow-origins=*' \
  --user-data-dir="$HOME/Downloads/PubFlow/chrome-profile-9222" \
  --no-first-run \
  --no-default-browser-check
```

Verify Chrome is reachable:

```bash
python3 - <<'PY'
import json, urllib.request
print(urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=3).read().decode())
PY
```

List current targets:

```bash
python3 - <<'PY'
import json, urllib.request
pages=json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json/list', timeout=3).read())
for p in pages:
    print(p.get('type'), p.get('title'), p.get('url'))
PY
```

## WXT Manual Runner Mode

WXT 0.20.25 supports disabling its browser runner through `webExt.disabled`.

Recommended project config pattern:

```ts
const MANUAL_BROWSER = parseBooleanEnv(LOCAL_CONFIG.PUBFLOW_MANUAL_BROWSER);

export default defineConfig({
  webExt: {
    disabled: MANUAL_BROWSER,
    chromiumPort: CHROMIUM_PORT,
    chromiumProfile: CHROMIUM_PROFILE,
    keepProfileChanges: true,
    chromiumArgs: ['--remote-allow-origins=*'],
    startUrls: ['chrome://extensions/'],
  },
});
```

Recommended script:

```json
{
  "scripts": {
    "dev:manual": "PUBFLOW_MANUAL_BROWSER=1 wxt"
  }
}
```

Run:

```bash
cd /Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension
pnpm dev:manual
```

Expected behavior:

- WXT starts dev server, usually `http://localhost:3000`.
- WXT builds `.output/chrome-mv3-dev`.
- WXT stays running and watches files.
- WXT does not open Chrome.
- WXT does not call `Extensions.loadUnpacked`.
- Chrome extension must be loaded/reloaded manually from `chrome://extensions/`.

## Manual Load Steps

1. Start Chrome on 9222 with the manual command above.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked / 加载已解压的扩展程序.
5. Select:

```text
/Users/wong/Code/VueLang/文章批量发送/multi-publisher-extension/.output/chrome-mv3-dev
```

6. Keep `pnpm dev:manual` running while testing.
7. If source changes do not apply, click the extension reload button in `chrome://extensions/` or use WXT reload command if available.

## Interpreting Common Errors

### `CDP connection closed before response to Extensions.loadUnpacked`

Root cause: WXT/web-ext is trying to control Chrome through CDP and load the extension automatically. This conflicts with the user's desired manual 9222 workflow or the browser closes/rejects the CDP command.

Fix: use manual runner mode:

```bash
pnpm dev:manual
```

### `WebSocket connection to ws://localhost:3000 failed`

This usually means the dev extension was loaded but the WXT dev server is not running. In dev output, `manifest.json` includes CSP entries for `http://localhost:3000`, and dev chunks may expect the server.

Fix:

```bash
pnpm dev:manual
```

Keep it running while the `.output/chrome-mv3-dev` extension is loaded.

If you do not want a dev server dependency, build production and load `.output/chrome-mv3` instead:

```bash
pnpm build
```

### Extension path confusion

- `.output/chrome-mv3-dev`: dev mode; expects WXT dev server; best for debugging.
- `.output/chrome-mv3`: production build; no WXT dev server; best for stable manual testing.

### No content script logs on 视频号

Check these:

1. The loaded extension is the latest `.output/chrome-mv3-dev` build.
2. The browser tab URL matches `https://channels.weixin.qq.com/*`.
3. `manifest.json` has host permission `https://channels.weixin.qq.com/*`.
4. The content script may intentionally skip top frame for WeChat Channels and only run in the `iframe[name="content"]` frame.
5. Use DevTools frame selector or CDP target/frame inspection to inspect the correct frame.

## WeChat Channels Debug Notes

The WeChat Channels publishing page can be slow and frame-based. It may show only login or shell DOM first, then load the real editor several seconds later in an iframe. Avoid assuming selectors are absent until waiting long enough and checking all frames.

Important page:

```text
https://channels.weixin.qq.com/platform/post/create
```

Important signs:

- Top frame may not be the injection target.
- Content script logic may return early in top frame for `weixinChannels`.
- The target iframe can be named `content`.
- Upload/input elements may appear only after 5-10 seconds.

## Debugging Checklist

- [ ] `http://127.0.0.1:9222/json/version` responds.
- [ ] `pnpm dev:manual` is running and did not print `Extensions.loadUnpacked` errors.
- [ ] Chrome loaded `.output/chrome-mv3-dev`, not the project root and not `.output/chrome-mv3` unless intentionally testing production.
- [ ] If using `.output/chrome-mv3-dev`, WXT dev server is still running on port 3000.
- [ ] `manifest.json` contains `https://channels.weixin.qq.com/*` in `host_permissions`.
- [ ] Content script logs are checked in the correct frame, especially `iframe[name="content"]` for WeChat Channels.
- [ ] Wait at least 10 seconds after navigation before concluding the editor selectors are missing.

## Common Pitfalls

1. Loading `.output/chrome-mv3-dev` without running WXT dev server. This causes `ws://localhost:3000` connection warnings and stale hot-reload behavior.

2. Running plain `pnpm dev` when the user wants a manual 9222 browser. Plain `pnpm dev` may still invoke the WXT web-ext runner and try `Extensions.loadUnpacked`.

3. Inspecting the top frame only on WeChat Channels. The actual editable/upload controls may live inside an iframe.

4. Treating late-loaded selectors as missing. The WeChat page can load the real post editor several seconds after the initial URL is visible.

5. Loading the production output while expecting dev hot reload. `.output/chrome-mv3` is static; `.output/chrome-mv3-dev` is for WXT dev.
