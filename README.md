# World Cup '26 Sweep

A free, self-hosted sweepstake app for the 2026 FIFA World Cup. Run a "last team standing" sweep for your own group: enter the players, run an animated draw, and let results update themselves.

- **48 teams**, 12 groups of 4 (the real 2026 final draw).
- **Animated live draw** — shuffles the draw order, then deals every team out slot-machine style.
- **Last team standing** — whoever owns the eventual champion takes the pot.
- **Group stage + knockout bracket** tabs that fill in as the tournament plays out, each team tagged with the player who drew it.
- **Auto-updating results** — a GitHub Action pulls live scores and updates the app on its own.
- **Shared live state** via a `data.json` file synced to GitHub (admin uses a personal access token; everyone else just views).
- **Make it yours** — set your group name and what to call the players from the Settings tab. No code needed.

No build step. Vanilla HTML/CSS/JS.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell and views |
| `style.css` | Stadium-broadcast theme |
| `app.js` | Draw, scoring, groups, bracket, GitHub sync |
| `data.json` | The single source of truth (teams, players, draw, schedule, results) |
| `scripts/update_results.py` | Pulls results from openfootball, fills the schedule, derives who's still alive |
| `.github/workflows/update-results.yml` | Runs the updater on a schedule + on demand |

## How it works

1. **The Draw** — two steps: *Draw the order* shuffles the running order and locks it in, then *Draw the teams* deals the 48 teams out with animation. Every player gets an equal share; any leftover teams go to **House** (the pot). Both steps save automatically.
2. **Groups** — the 12 group tables, computed live from results, top two highlighted, plus fixtures. Each team is tagged with its owner.
3. **Knockout** — the full bracket, Round of 32 → Final (+ third-place), teams filling in as groups finish.
4. **Standings** — players ranked by how many of their teams are still alive.
5. **Teams** — manual override: the admin can mark teams out / crown the champion by hand (useful if the feed lags).

## Set this up for your group

1. **Create your own repo from this one** (use it as a template, or fork it) and enable **GitHub Pages** (repo Settings → Pages → Branch: `main`).
2. **Point the app at your repo.** Open `app.js` and set `DEFAULT_REPO.owner` to your GitHub username (and `repo` to your repo name if you renamed it). This is what lets your viewers load the live data automatically.
3. **Enable Actions** on your repo (the Actions tab → enable) so results auto-update. No secrets needed — it uses GitHub's built-in token and a free public results feed.
4. **Add your admin token.** On the deployed site → **Settings** → fill in repo owner / name, then create a **fine-grained personal access token** with **Contents: Read & write** on your repo (or a classic token with the `repo` scope). Paste it in and *Save config*. The token is stored only in your browser (`localStorage`) and is never committed.
5. **Brand it.** Settings → **Group Branding**: set your group name, tagline, and the word for players (e.g. "player", "lad", "member"). Saved with the sweep so everyone sees the same wording.
6. **Run the draw** and share the Pages URL. No token = read-only view of the latest committed data.

## Auto-updating results

A scheduled **GitHub Action** (`.github/workflows/update-results.yml`) runs every ~20 minutes during the tournament window (and on demand from the Actions tab). It runs `scripts/update_results.py`, which:

- pulls the public-domain schedule + results from [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) (no API key),
- fills in scores, resolves knockout fixtures, recomputes group standings,
- derives each team's alive/out status and the champion,
- commits `data.json` if anything changed → Pages serves the update to everyone.

This is **semi-live**: latency depends on how quickly openfootball is updated after a match (minutes to ~an hour) plus the 20-minute cron. The auto-update is authoritative; if it ever lags, the admin can set results by hand in the **Teams** tab (the next auto-run will reconcile). Run `python3 scripts/update_results.py --dry-run` locally to preview.

## Notes

- Team list reflects the 2026 final draw as published. Any single team can be corrected directly in `data.json` (`name`, `group`, `flag`).
- Local backup: **Settings → Export / Import JSON**.
- All kick-off times display in Sydney time (AEST); adjust in `app.js` (`SYD` constant) if you want a different zone.
