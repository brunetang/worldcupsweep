#!/usr/bin/env python3
"""
World Cup '26 Sweep — results updater.

Single source of truth for transforming the openfootball schedule into the
app's `schedule` array, and deriving the sweep state (team alive/out, champion).

Idempotent: running it pre-tournament seeds the fixtures with empty scores;
running it during the tournament fills scores, resolves knockout teams, and
recomputes who is still alive.

Sources:
  - Fixture STRUCTURE (knockout slot labels, bracket wiring): openfootball
    https://github.com/openfootball/worldcup.json  (public domain, no key)
  - Live SCORES: ESPN's public scoreboard (key-free), overlaid on top, because
    openfootball's community score feed can lag by hours or days.

Usage:
    python3 scripts/update_results.py            # fetch live, write data.json
    python3 scripts/update_results.py --local F  # use local openfootball file
    python3 scripts/update_results.py --dry-run  # print summary, don't write
"""

import json
import sys
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(HERE, "data.json")
OPENFOOTBALL_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
# ESPN's public scoreboard: key-free and near-live where openfootball's score feed
# lags. limit=200 returns all 104 matches in one request, not just the current day.
ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260720&limit=200"

# openfootball name -> our team name (only where they differ)
NAME_FIX = {
    "Bosnia & Herzegovina": "Bosnia and Herzegovina",
    "USA": "United States",
}

# ESPN displayName -> our team name (only where they differ)
ESPN_NAME_FIX = {
    "Czechia": "Czech Republic",
    "Türkiye": "Turkey",
    "Congo DR": "DR Congo",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "USA": "United States",
}

# openfootball round label -> our stage code, and bracket numbering base
STAGE = {
    "Round of 32": ("R32", 73),
    "Round of 16": ("R16", 89),
    "Quarter-final": ("QF", 97),
    "Semi-final": ("SF", 101),
    "Match for third place": ("3P", 103),
    "Final": ("F", 104),
}


def fetch_openfootball(local=None):
    if local:
        with open(local, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(OPENFOOTBALL_URL, headers={"User-Agent": "wc26-sweep"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_espn():
    req = urllib.request.Request(ESPN_URL, headers={"User-Agent": "wc26-sweep"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _date_only(s):
    try:
        return datetime(int(s[:4]), int(s[5:7]), int(s[8:10]))
    except (ValueError, TypeError, IndexError):
        return None


def espn_score_index(espn, name_to_id):
    """Map sorted (id1,id2) pair -> list of score records from ESPN's scoreboard.

    A list per pair because a pair could in theory meet twice, and ESPN's date is
    a UTC instant that can land a day off openfootball's venue-local date, so the
    overlay disambiguates by nearest date.
    """
    def id_of(nm):
        if not nm:
            return None
        return name_to_id.get(ESPN_NAME_FIX.get(nm, nm))

    idx = {}
    for e in espn.get("events", []):
        comps = e.get("competitions") or []
        if not comps:
            continue
        cs = comps[0].get("competitors") or []
        if len(cs) < 2:
            continue
        home = next((c for c in cs if c.get("homeAway") == "home"), cs[0])
        away = next((c for c in cs if c.get("homeAway") == "away"), cs[1])
        id1 = id_of((home.get("team") or {}).get("displayName"))
        id2 = id_of((away.get("team") or {}).get("displayName"))
        if not id1 or not id2:   # unresolved placeholder ("Group A Winner") -> skip
            continue
        st = (e.get("status") or {}).get("type") or {}
        if st.get("state") not in ("in", "post"):   # not kicked off yet
            continue
        try:
            s1, s2 = int(home.get("score")), int(away.get("score"))
        except (TypeError, ValueError):
            continue
        p1 = int(home["shootoutScore"]) if home.get("shootoutScore") not in (None, "") else None
        p2 = int(away["shootoutScore"]) if away.get("shootoutScore") not in (None, "") else None
        rec = {
            "id1": id1, "id2": id2, "s1": s1, "s2": s2, "p1": p1, "p2": p2,
            "finished": st.get("completed") is True or st.get("state") == "post",
            "date": (e.get("date") or "")[:10],
        }
        idx.setdefault("|".join(sorted([id1, id2])), []).append(rec)
    return idx


def overlay_espn_scores(schedule, idx):
    """Overlay ESPN scores onto the openfootball-built schedule. Only scores and the
    finished flag are touched; team resolution and bracket wiring stay openfootball's."""
    for m in schedule:
        if not (m["t1"] and m["t2"]):
            continue
        recs = idx.get("|".join(sorted([m["t1"], m["t2"]])))
        if not recs:
            continue
        md = _date_only(m.get("date") or "")

        def closeness(r):
            rd = _date_only(r["date"])
            return abs((rd - md).days) if (md and rd) else 0

        e = min(recs, key=closeness)
        # ESPN's home/away may be the reverse of our t1/t2 - align to our orientation.
        if e["id1"] == m["t1"]:
            m["s1"], m["s2"], m["p1"], m["p2"] = e["s1"], e["s2"], e["p1"], e["p2"]
        else:
            m["s1"], m["s2"], m["p1"], m["p2"] = e["s2"], e["s1"], e["p2"], e["p1"]
        if e["finished"]:
            m["status"] = "finished"


def build(data, of):
    name_to_id = {t["name"]: t["id"] for t in data["teams"]}

    def resolve(label):
        """Return team id if `label` is a real team name, else None."""
        if not label:
            return None
        nm = NAME_FIX.get(label, label)
        return name_to_id.get(nm)

    def scores(m):
        """Return (s1, s2, p1, p2) from an openfootball match, or Nones."""
        sc = m.get("score") or {}
        ft = sc.get("ft")
        et = sc.get("et")
        pn = sc.get("p")
        base = et or ft
        if not base:
            return (None, None, None, None)
        s1, s2 = base[0], base[1]
        p1 = pn[0] if pn else None
        p2 = pn[1] if pn else None
        return (s1, s2, p1, p2)

    def kickoff_utc(date, time_str):
        """openfootball stores venue-local time + offset, e.g. '13:00 UTC-6'.
        Return the UTC instant as an ISO string (the frontend renders Sydney)."""
        if not date or not time_str:
            return None
        mt = re.match(r"\s*(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})(?::(\d{2}))?", time_str)
        if not mt:
            return None
        hh, mm, oh, om = int(mt.group(1)), int(mt.group(2)), int(mt.group(3)), int(mt.group(4) or 0)
        try:
            local = datetime(int(date[:4]), int(date[5:7]), int(date[8:10]), hh, mm)
        except ValueError:
            return None
        off = timedelta(hours=abs(oh), minutes=om)
        if oh < 0:
            off = -off
        utc = (local - off).replace(tzinfo=timezone.utc)
        return utc.isoformat().replace("+00:00", "Z")

    schedule = []
    counters = {}  # stage code -> running number
    group_no = 0

    for m in of["matches"]:
        rnd = m.get("round", "")
        grp = str(m.get("group", ""))
        s1, s2, p1, p2 = scores(m)
        finished = s1 is not None

        if grp.startswith("Group"):
            group_no += 1
            schedule.append({
                "num": group_no,
                "stage": "group",
                "group": grp.split()[1],
                "date": m.get("date"),
                "kickoff": kickoff_utc(m.get("date"), m.get("time")),
                "t1": resolve(m["team1"]),
                "t2": resolve(m["team2"]),
                "ref1": None, "ref2": None,
                "s1": s1, "s2": s2, "p1": None, "p2": None,
                "status": "finished" if finished else "scheduled",
            })
        elif rnd in STAGE:
            code, base = STAGE[rnd]
            n = counters.get(code, 0)
            counters[code] = n + 1
            num = base + n
            t1, t2 = resolve(m["team1"]), resolve(m["team2"])
            schedule.append({
                "num": num,
                "stage": code,
                "group": None,
                "date": m.get("date"),
                "kickoff": kickoff_utc(m.get("date"), m.get("time")),
                "t1": t1,
                "t2": t2,
                "ref1": None if t1 else m["team1"],
                "ref2": None if t2 else m["team2"],
                "s1": s1, "s2": s2, "p1": p1, "p2": p2,
                "status": "finished" if finished else "scheduled",
            })

    return schedule


def knockout_winner_loser(mt):
    """Given a finished knockout match, return (winner_id, loser_id) or (None,None)."""
    if mt["status"] != "finished" or not (mt["t1"] and mt["t2"]):
        return (None, None)
    a, b = mt["s1"], mt["s2"]
    if mt["p1"] is not None and a == b:
        a, b = mt["p1"], mt["p2"]
    if a == b:
        return (None, None)
    return (mt["t1"], mt["t2"]) if a > b else (mt["t2"], mt["t1"])


def derive_status(data):
    """Set each team's status (alive/out) and the champion from results."""
    schedule = data["schedule"]
    out = set()
    champion = None

    # 1) knockout losers are out; final winner is champion
    for mt in schedule:
        if mt["stage"] in ("R32", "R16", "QF", "SF", "F"):
            w, l = knockout_winner_loser(mt)
            if l:
                out.add(l)
            if mt["stage"] == "F" and w:
                champion = w

    # 2) once the group stage is fully played, anyone not in a knockout tie is out
    group_done = all(m["status"] == "finished" for m in schedule if m["stage"] == "group")
    if group_done:
        in_knockout = set()
        for mt in schedule:
            if mt["stage"] == "R32":
                for k in ("t1", "t2"):
                    if mt[k]:
                        in_knockout.add(mt[k])
        # only mark out if we actually know the R32 line-up
        if in_knockout:
            for t in data["teams"]:
                if t["id"] not in in_knockout:
                    out.add(t["id"])

    for t in data["teams"]:
        t["status"] = "out" if t["id"] in out else "alive"
    data["champion"] = champion
    return len(out), champion


def summarise(data):
    fin = sum(1 for m in data["schedule"] if m["status"] == "finished")
    out = sum(1 for t in data["teams"] if t["status"] == "out")
    champ = next((t["name"] for t in data["teams"] if t["id"] == data["champion"]), None)
    return f"{fin}/{len(data['schedule'])} matches played · {out} teams out · champion: {champ or '—'}"


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    local = None
    if "--local" in args:
        local = args[args.index("--local") + 1]

    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    # snapshot the bits that actually matter, ignoring the sync timestamp,
    # so a no-op run doesn't churn a commit every 20 minutes
    def fingerprint(d):
        return json.dumps({
            "schedule": d.get("schedule"),
            "teams": [{"id": t["id"], "status": t.get("status")} for t in d.get("teams", [])],
            "champion": d.get("champion"),
        }, sort_keys=True, ensure_ascii=False)

    before = fingerprint(data)

    of = fetch_openfootball(local)
    data["schedule"] = build(data, of)

    # Overlay near-live scores from ESPN. Best effort: if it fails, openfootball's
    # structure (and whatever scores it had) still stands.
    try:
        name_to_id = {t["name"]: t["id"] for t in data["teams"]}
        overlay_espn_scores(data["schedule"], espn_score_index(fetch_espn(), name_to_id))
    except Exception as e:
        print(f"ESPN overlay skipped ({e})", file=sys.stderr)

    derive_status(data)

    print(summarise(data))

    if fingerprint(data) == before:
        print("No result changes — leaving data.json untouched.")
        return

    from datetime import datetime, timezone
    data.setdefault("meta", {})["lastResultSync"] = datetime.now(timezone.utc).isoformat()

    if dry:
        print("(dry run — data.json not written)")
        return

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("data.json updated")


if __name__ == "__main__":
    main()
