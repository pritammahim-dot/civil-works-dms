# Civil Works DMS

File, letter (dak) and work tracking system for the Civil Works division, P&D, WZPDCL, Khulna.

- **Live site**: https://pritammahim-dot.github.io/civil-works-dms/
- Static frontend (GitHub Pages) + Google Apps Script backend storing data in Google Drive.
- Runs in **demo mode** (sample data, resets on reload) until an Apps Script URL is configured — see [SETUP.md](SETUP.md).

## Features

- Dashboard with per-officer inbox, overdue and pending counts
- Files & Letters: incoming/outgoing/dak registration with auto file numbers, movement history, forward/dispose/despatch/reopen
- Registers: inward, outward, file movement, orders & notices, pending/overdue
- Annual Procurement Plan with file linkage and stage tracking
- Administration: user accounts (Admin/XEN managed, no self sign-up), org hierarchy, file categories
- Password-protected accounts (salted-hash storage, forced password change on first login), attachment upload to Google Drive

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app (declarative UI + logic; `API_URL` config at the top of the script block) |
| `dc-runtime.js` | UI runtime (renders the declarative template with React) |
| `apps-script/Code.gs` | Backend — paste into script.google.com (see SETUP.md) |
| `SETUP.md` | Step-by-step deployment guide |
