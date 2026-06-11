# Handover — World Cup '26 Sweep (shareable template)

A genericised, shareable version of the sweep app. Anyone can copy it and run their own
"last team standing" World Cup sweep, set their own branding, and share a read-only link
with friends. Self-hosted and free on GitHub Pages.

## Relationship to `world-cup-sweep`

This is a **separate codebase**, copied from the original `f1atty/world-cup-sweep` on
2026-06-09 and genericised. The original keeps its group-specific content ("Everything But",
"40th Trip"). The two repos will drift, so **a fix made to one (e.g. a Match Centre layout
change) may need applying to the other**.

## Stack

- Vanilla HTML/CSS/JS, no build step. `index.html` + `style.css` + `app.js`.
- State lives in `data.json`, synced to GitHub via a Personal Access Token (admin only).
- Hosted on GitHub Pages; results auto-update via a GitHub Action.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell and all views (Draw, Match Centre, Groups, Knockout, Standings, Teams, Settings, How to use) |
| `style.css` | Stadium-broadcast theme + guide styling |
| `app.js` | Draw, scoring, groups, bracket, Match Centre, GitHub sync, branding |
| `data.json` | Source of truth: teams (48), schedule (104), players, draw, results. Ships as a clean slate. |
| `scripts/update_results.py` | Pulls results from openfootball, fills the schedule, derives alive/out + champion |
| `.github/workflows/update-results.yml` | Runs the updater every ~20 min during the tournament + on demand |
| `Set-Up-Your-World-Cup-Sweep.docx` | Plain-English setup guide to send to a non-technical user |

## What differs from the original (the genericisation)

- **Configurable branding.** `DATA.meta.groupName`, `playerWord`, `playerWordPlural`
  (and `subtitle`) are edited on **Settings → Group Branding** and stored in `data.json`
  (so every viewer sees the same wording). `applyBranding()` (called from `renderAll`)
  pushes them into the header, page title, draw screens and hints. Helpers: `brandGroup()`,
  `pWord()`, `pWordPlural()`.
- **"House" (fixed)** replaces "40th Trip" as the leftover-teams pot (`const HOUSE = 'House'`).
- **"player / players"** replaces user-facing "boy / boys". Internal identifiers
  (`DATA.boys`, CSS classes, function names like `addBoy`/`renderBoysSetup`) were left as-is
  to avoid breakage — they are invisible to users.
- **localStorage namespaced by repo path.** `APP_NS = location.pathname.split('/')[1]`,
  used in `CFG_KEY` and `VIEW_KEY`. Stops two sweeps hosted on the same `*.github.io`
  origin from sharing config and clobbering each other.
- **Repo auto-detection.** `detectRepo()` reads `<owner>.github.io/<repo>` off the URL,
  so a fresh copy points at its own repo with no code edit. Falls back to `DEFAULT_REPO`
  for local dev / custom domains.
- **Clean-slate `data.json`** — no players, no draw, all teams alive, scores cleared.
- **"How to use" tab** (`#view-help`) — in-app setup guide.

## Recent additions

- **Hide-the-Settings-tab toggle.** A shared flag `DATA.meta.hideSettingsTab` (stored in
  `data.json`, so it applies to every viewer) lets the admin hide the Settings tab from the
  wider group. Logic: `settingsHidden()`, `settingsTabVisible()` (visible if not hidden, or the
  viewer is an admin with a token, or the URL hash opens it), `adminHashOpen()`, and the toggle
  button `#toggleSettingsTab` (handler updates the flag and pushes). The admin can always get
  back in via `#settings` (or `#admin`) on the URL, and the tab stays visible on their own
  token-holding browser. Button label/note kept in sync by `updateSettingsTab()`.
- **Groups card text contained.** CSS fix so long team names and standings/fixtures text stay
  inside the group card instead of overflowing.

## Setting up a new sweep (for a new group)

Full steps are in the in-app **How to use** tab and in `Set-Up-Your-World-Cup-Sweep.docx`.
In short:

1. **Use this template** (repo must be flagged as a template: Settings → General → Template
   repository) to create a new repo under the user's own account.
2. Enable **Pages** (Settings → Pages → branch `main`, `/root`). Site lives at
   `<username>.github.io/<repo>`.
3. Enable **Actions** if needed (auto-enabled on template copies; forks need it switched on).
4. On the site → **Settings**, paste a fine-grained PAT with **Contents: Read & write** on
   that repo. Badge reads "Admin · synced".
5. **Settings → Group Branding** to name it, then run the draw on **The Draw** tab.

No token = read-only view of the latest committed data.

## Auto-updating results

The GitHub Action runs `scripts/update_results.py` every ~20 min during the tournament
window (and on demand from the Actions tab). It pulls the public
[openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) feed (no API key),
fills scores, resolves the bracket, derives alive/out + champion, and commits `data.json`
only if something changed. Semi-live: latency = openfootball lag + the 20-min cron.
Manual fallback: set results by hand on the **Teams** tab.

## Notes / gotchas

- This repo is **public** (required for free Pages). Anything in `data.json` (player names,
  draw, results) is publicly viewable. No tokens/credentials are ever committed.
- Kick-off times render in Sydney time (the `SYD` constant in `app.js`).
- Admin status is purely client-side: holding a valid token in the browser = admin.
