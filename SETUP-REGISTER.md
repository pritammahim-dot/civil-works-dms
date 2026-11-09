# File Movement Register: setup guide

`register.html` is a simple digital file movement register for the Civil Department (P&D).
It answers one question at all times: **where is the file now, who is responsible for it,
and when did it move?**

It is separate from the older Civil Works DMS (`index.html`), which is left unchanged.
The register has its own backend and its own Drive folder, so the two never mix data.

## How the register works

| Step | Who | What is recorded |
|---|---|---|
| File arrives from SE (P&D) | XEN, or the receiving office (Office Staff role) | Reference no., subject, received from, actual date and time received. The register Sl. is generated automatically. |
| File marked to an officer | XEN | Marking date and time. Status becomes **Awaiting receipt**. |
| Officer receives the physical file | That officer | Confirms receipt: "now" or the actual earlier time. Status becomes **Received**. |
| Forward / return | Officer holding the file | Same as marking: awaiting receipt until the next officer confirms. |
| Wrong officer / file never left the desk | The sender, before receipt | **Recall**. Recorded in the history. |
| Work finished, file leaves the department (e.g. back to SE) | XEN or receiving office, while holding the file | **Close**: sent to whom, despatch / memo no., note. Status becomes **Closed**; the file stays in the register. |
| File comes back, or was closed by mistake | XEN | **Reopen** with a reason. The file returns to XEN's desk. |
| Typing mistake in the registration | XEN or Admin | **Correct details** (reference no., subject, received from, receiving time) with a reason. Old and new values are kept in the history. |

Rules enforced by the system (in `register-core.js`, used by both demo and live):

- Marking a file does **not** mean it was received. The sender stays responsible until the receiver confirms.
- Only the officer currently holding a file can send it on. Only the named receiver can confirm receipt.
- A receipt time cannot be earlier than the sending time, or in the future. If it is entered later
  than it happened, the history shows both the actual time and when it was recorded.
- History entries are only ever added. Nothing in the app can edit or delete one. A correction
  changes the file's current details, but adds a "Details corrected" entry showing the old value,
  the new value, who changed it and why.
- A closed file cannot be marked or forwarded until XEN reopens it.
- XEN and Admin see every file. Other officers see only files sent to them or handled by them.
- Only the Admin creates officer accounts (no self sign-up). New and reset accounts must set
  their own password at first sign-in. Officers who leave are **deactivated**, not deleted,
  so their names stay in the history. An officer still holding files cannot be deactivated.

## 1. Create the Apps Script backend (one time, about 10 minutes)

1. Go to <https://script.google.com> with the Google account whose Drive should hold the register.
2. **New project**. Rename it `Civil File Register`.
3. The project needs **two** script files:
   - `Code.gs`: replace the default code with the whole of
     [`apps-script/register/Code.gs`](apps-script/register/Code.gs).
   - `Core.gs`: click **+** next to Files, choose **Script**, name it `Core`, and paste the whole of
     [`register-core.js`](register-core.js).
   Save (Ctrl+S).
4. **Deploy, New deployment**, gear icon, **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy, then **Authorize access** (choose your account, Advanced, Go to Civil File Register, Allow).
5. Copy the **Web app URL** (ends in `/exec`). Opening it in a browser should show
   `{"ok":true,"app":"civil-file-register",...}`.

## 2. Turn on the daily backup

In the Apps Script editor: **Triggers** (clock icon) > **Add Trigger**:
function `dailyBackup`, event source **Time-driven**, type **Day timer**, any night-time hour. Save.

Each night a dated copy of `db.json` is saved in `Civil File Register/backups/` (the last 60 are kept).
Drive's own version history of `db.json` is a second safety net.

## 3. Point the page at the backend

In `register.html`, near the top of the `<script type="text/x-dc">` block:

```js
const API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

While `API_URL` is empty the page runs in **demo mode**: sample officers and files,
nothing is saved, and demo sign-in buttons are shown.

## 4. First use

1. Sign in as **admin / admin123** and immediately set a new password (you will be forced to).
2. **Officers > Add officer**: create the XEN, SDEs, AEs, SAEs and, if the receiving office
   registers files, an Office Staff account. Use the real names and designations.
   Give each officer their user ID and temporary password.
3. The XEN (or receiving office) registers incoming files from that point on.

## Updating the backend later

After changing `register-core.js` or `apps-script/register/Code.gs`, paste the new version into
the matching file in the Apps Script editor, save, then
**Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy**.
The URL stays the same. Saving without a new version does not update the live register.

## Limits

- Sessions last 8 hours. 10 wrong passwords in a row lock that user ID for 10 minutes.
- Each action takes about 1 to 3 seconds to save (Apps Script). Other users see changes when
  they press Refresh or come back to the page.
- Free Apps Script quotas are far above what one office uses.
