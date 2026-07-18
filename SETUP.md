# Civil Works DMS — Setup Guide

The app is a static site (GitHub Pages). All data lives in **your Google Drive**, accessed
through a small **Google Apps Script** web app that only you deploy. Nobody else needs Google
access — office users sign in with a user ID + password that the Admin creates inside the app.

## 1. Create the Apps Script backend (one time, ~5 minutes)

1. Go to <https://script.google.com> (logged in with the Google account whose Drive should hold the data).
2. Click **New project**. Name it `Civil Works DMS`.
3. Delete the default code in `Code.gs` and paste the entire contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo. Save (Ctrl+S).
4. Click **Deploy → New deployment**.
   - Click the gear icon → select **Web app**.
   - Description: `v1`
   - **Execute as: Me**
   - **Who has access: Anyone**
   - Click **Deploy**.
5. Google will ask you to authorize the script (it needs Drive access for its own data folder).
   Click **Authorize access** → choose your account → *Advanced* → *Go to Civil Works DMS (unsafe)* → **Allow**.
   (The "unsafe" warning appears for every personal Apps Script — it is your own script.)
6. Copy the **Web app URL** (ends in `/exec`).

Quick check: open that URL in a browser tab. You should see `{"ok":true,"app":"civil-works-dms",...}`.

## 2. Point the site at your backend

1. In `index.html`, near the top of the `<script type="text/x-dc">` block, set:

   ```js
   const API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
   ```

2. Commit and push. GitHub Pages redeploys automatically in ~1 minute.

While `API_URL` is empty the site runs in **demo mode** (sample data, resets on reload,
demo credential chips on the login screen). Setting the URL switches it to live mode.

## 3. First login

- Sign in as **admin / admin123**. You will be forced to set a new password immediately —
  do this right away, the default is public knowledge (it's in this repo).
- Go to **Administration** and create an account for each officer (name, role, user ID,
  temporary password). Each person is asked to change their password at first login.
- Only **Admin** and **XEN** accounts can manage users. There is no self sign-up.

## 4. Where your data lives

In your Google Drive you will find a folder **Civil Works DMS**:

- `db.json` — all records (files/letters, movements, procurement plan, users).
  Passwords are stored only as salted SHA-256 hashes, never as plain text.
- `attachments/` — uploaded letter scans/PDFs. Attachment files are shared as
  "anyone with the link can view" so that other signed-in officers can open them.
  (Set `SHARE_ATTACHMENTS = false` in Code.gs if you don't want that; then only
  you can open them from Drive directly.)

**Backup**: db.json is a plain text file — right-click → Download in Drive any time,
or just rely on Drive's version history (right-click → File information → Manage versions).

## 5. Updating the backend later

If `Code.gs` changes in this repo: paste the new version into script.google.com, save, then
**Deploy → Manage deployments → (pencil icon) → Version: New version → Deploy**.
The URL stays the same. (Just saving without a new deployment version does NOT update the live web app.)

## Notes & limits

- Sessions last 8 hours; after that users sign in again.
- 10 wrong passwords in a row locks an account for 10 minutes.
- Apps Script calls take 1–3 seconds — the UI saves in the background and shows a sync indicator.
- Two people editing at the same time is safe (the server serializes writes), but you see each
  other's changes only after a refresh/re-login — this is a lightweight office tool, not Google Docs.
- Free quotas (20,000 script calls/day) are far beyond what a division office will use.
