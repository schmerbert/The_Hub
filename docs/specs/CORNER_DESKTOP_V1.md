# Corner Desktop v1

**Status:** Implemented shell; packaging and native GUI smoke remain pending

**Adopted:** 2026-08-10

**Extends:** [`CORNER_SURFACE.md`](CORNER_SURFACE.md)

**Streaming contract:** [`WAKE_STREAM_V1.md`](WAKE_STREAM_V1.md)

## 1. Purpose

Corner Desktop wraps the existing local Hub and renderer in an Electron shell. It adds window and tray behavior only. It does not create a second resident, provider contract, database, authority model, or renderer implementation.

## 2. Implemented lifecycle

- Electron is pinned exactly to 43.2.0 and launches with `npm run desktop`.
- The application admits one Electron instance. A second launch asks the owned window to expand.
- One main process owns `createHub`, binds it to `127.0.0.1`, waits for listen success, and only then loads `/?shell=desktop`.
- Explicit quit first marks the controller as quitting, awaits `hub.close()`, destroys desktop resources, and exits. If a provider crossing is active, Hub close aborts it and allows up to 250 ms for compliant partial raw/outcome custody before gating late callbacks and closing stores; Tool and World execution outside that provider window remains awaited. Startup/listen failure also closes Hub custody.
- Ordinary window close is not process exit: it collapses to compact state and hides the window. Tray actions show/expand, collapse, or explicitly quit.

## 3. Geometry and parity

- Compact size is exactly 96x96 CSS pixels.
- Expanded size is 980x680, clamped only when the active display work area is smaller.
- Placement uses the active display work area and a 24-pixel right/bottom margin.
- The window is opaque, frameless, fixed-size, and not fullscreenable.
- Normal-level always-on-top defaults to enabled. `HUB_CORNER_ALWAYS_ON_TOP=false`, `0`, `off`, or `no` disables it. Electron main reads this shell-only key directly after `.env` loading; it is not part of the resident `readConfig()` object.
- Desktop compact mode remains compact at 96 pixels. Ordinary narrow browsers open expanded and remain independently usable.
- Browser and desktop share the same HTML, CSS, JavaScript, HTTP API, wake stream, and accessibility obligations.

## 4. Security boundary

- `contextIsolation`, Electron sandboxing, and web security are enabled; renderer Node integration is disabled.
- The renderer receives no provider, Source Ledger, Spine, Forest, World, Result Rack, filesystem, shell, or Electron object.
- The preload exposes only `getMode`, validated `setMode(compact|expanded)`, and `onMode` subscription.
- IPC accepts only the exact owned `webContents` sender at the expected loopback origin, path, and desktop query.
- Permission requests/checks, new windows, and navigation away from the owned page are denied.
- The shell is not transparent and does not depend on synthetic wake, continuous presence, or hidden resident activity.

## 5. Acceptance evidence

Automated tests cover pure geometry, active-display selection, secure BrowserWindow options, IPC sender refusal, navigation/permission denial, close/hide behavior, tray quit, loopback-after-listen host startup, and idempotent awaited shutdown. The shared renderer retains browser behavior and the complete Hub suite remains the regression boundary.

## 6. Not implemented

Installer/package generation, code signing, auto-update, protocol/file associations, crash recovery UI, general file/artifact opening, source highlighting, and a recorded native GUI/tray smoke pass. These absences do not weaken the implemented lifecycle and renderer security contract, but release packaging must not be claimed yet.
