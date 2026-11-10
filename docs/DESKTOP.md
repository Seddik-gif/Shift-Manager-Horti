# Horti Magici for Windows (admin app)

A small native program for the two administrators. It opens the **hosted** web app in its own window and adds what a
browser tab cannot: a tray icon, start with Windows, and a **Back up now** button. The scheduling logic is the web
app, so deploying a new web version updates everyone at once; the installed program rarely needs reinstalling.

* Employees use the phone app (PWA) or the browser. If an employee signs in inside the desktop program they see a
  notice that it is for administrators. (A courtesy screen: permissions are enforced by the database.)
* The database stays in Supabase. The program needs internet; if it is offline it shows a "retrying" page.

## Install (for the admins)

1. Run `Horti Magici_0.1.0_x64-setup.exe` (per-user install, no administrator rights needed).
   Windows SmartScreen may say "unknown publisher" because the installer is not code-signed yet: *More info → Run anyway*.
2. On first start the **Settings** window opens. Enter the address of the app (`https://…`) and press **Save and open**.
3. Sign in with your normal admin account.

Closing the window keeps the program in the tray (next to the clock). Right-click the icon: *Open*, *Back up now*,
*Settings*, *Start with Windows*, *Quit*. Starting a second copy just brings the first one forward.

## Back up from the program

In **Settings → Backup**:

1. Paste the database address (Supabase → Project Settings → Database → Connection string) and press
   **Save securely**. It is stored in the **Windows Credential Manager**, never in a file, and is never shown again.
2. Install the PostgreSQL command-line tools on this PC if they are not there (`pg_dump`, `pg_restore`). The program
   looks on `PATH` and in `C:\Program Files\PostgreSQL\*\bin`; or enter the folder in Settings.
3. Press **Back up now** (or use the tray menu). The file `horti-YYYYMMDD-HHMM.dump` goes into
   `Documents\HortiMagici\backups` (or the folder you chose), is read back to prove it is valid, and only the newest
   14 are kept.

To check that a backup really restores, use `npm run restore:test` (see `BACKUP.md`). For a nightly schedule or an
offsite copy, use `scripts/backup.mjs` with Task Scheduler (also in `BACKUP.md`); the button is for "back up before I
change something".

## Build it yourself

Needs Node 20+, the Rust toolchain (`rustup`, MSVC build tools) and WebView2 (already on Windows 10/11).

```bash
npm --prefix desktop install        # once
npm run desktop:dev                 # run in development
npm run desktop:build               # → desktop/src-tauri/target/release/bundle/nsis/*-setup.exe  (about 1 MB)
```

Rebuild the icons with `npm run icons` then `cd desktop && npm run icons` (source: `desktop/icon-source.png`).
The first build downloads the Rust crates and the NSIS packager, so it needs internet and takes several minutes.

## How it keeps the hosted page contained

* The window starts on a **local** loading page, which checks the server is reachable and then navigates to your app address.
* Only the two local pages (loading, settings) may call the program's commands (`capabilities/default.json`).
  The hosted web app has **no** access to the backup, the stored database address or the settings.
* The app address must be `https://` (or `http://localhost` for development); a user name or password in it is refused.
* The window identifies itself as `HortiDesktop/<version>` in its user agent (used for the administrators-only notice).

## Honest limits

* **Not code-signed.** Buy a certificate and set it up in `tauri.conf.json` (`bundle.windows.certificateThumbprint`)
  to remove the SmartScreen warning.
* **No automatic updater.** Updating the program means running a new installer. Web changes need no reinstall.
* **No native Windows notifications yet.** The web app's push notifications target phones; the desktop window shows
  the bell inside the app. (Adding the `notification` plugin later is straightforward.)
* **Tested here:** the program builds, starts, shows its window and enforces a single instance; the Rust logic (backup
  naming/retention, password handling, address checks, settings file) has unit tests. **Not tested here:** a real
  backup from the button (needs PostgreSQL tools and a database), start-with-Windows across a reboot, the credential
  store with real credentials, and the installer on a clean PC. Try each once before relying on them.
