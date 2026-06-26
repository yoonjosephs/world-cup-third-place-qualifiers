# Best Thirds — 2026 World Cup Round of 32 Calculator

A static, no-build, client-side calculator for the 2026 FIFA World Cup's
"best third-placed team" qualification race. It shows:

- **Third-Place Race** — all 12 group-stage third-place teams, ranked by
  FIFA's official tiebreaker order, with the top 8 qualifying for the
  Round of 32.
- **Groups & Edit Data** — every group's standings, editable in-browser to
  test scenarios.
- **Round of 32 Bracket** — the resulting knockout-stage matchups, including
  which group's third-place team lands in which slot, per FIFA's fixed
  Annex C pairing table.

It's plain HTML/CSS/JS — no build step, no backend, no framework. Open
`index.html` directly or serve the folder with any static file server.
Points, goal difference, and goals scored are kept current automatically
by a scheduled GitHub Action (see "Live data pipeline" below); fair-play
score and FIFA ranking are fixed inputs that don't change live.

## Files

```
index.html                          Markup + tab/panel structure
css/styles.css                       All styling
js/data.js                           Bundled fallback dataset + the Annex C lookup table + its decoder
js/app.js                            State, tiebreaker logic, rendering, live-data fetch, localStorage persistence
data/standings.json                  Live points/GD/GF/gamesPlayed, written by the GitHub Action — fetched by js/app.js at page load
scripts/team-id-map.mjs              Explicit football-data.org team-id -> {name, group} alias map
scripts/import-standings.mjs         Fetches, validates, and writes data/standings.json
.github/workflows/update-standings.yml   Schedules the importer every 20 minutes
```

## Data model

### `TEAMS_RAW` (in `js/data.js`)

A flat array of 48 rows, one per team:

```js
[name, group, points, goalDifference, goalsScored, fairPlayScore, fifaRanking, gamesPlayed]
```

- **fairPlayScore** follows FIFA's disciplinary-points convention: `0` is
  clean, more negative means more accumulated yellow/red-card penalties.
  Higher (closer to zero) wins a tiebreak. **Not live** — see "Live data
  pipeline" for why — update it by hand if a real tie at that level comes up.
- **fifaRanking** is the team's position in the FIFA World Ranking — lower
  number is better. Frozen for the tournament by FIFA's own regulations
  (see below); never fetched live, on purpose.
- **gamesPlayed** is `0`–`GROUP_STAGE_GAMES` (3 — a single round-robin of 4
  teams). Shown directly in the UI ("PLD" / "Pld") and used to compute the
  mathematical clinch/eliminate status described below. It's not part of
  the tiebreaker sort itself.

`js/app.js` expands each row into a `{name, group, pts, gd, gf, conduct,
fifa, played}` object at load time, then — if `data/standings.json` is
reachable — overwrites `pts`/`gd`/`gf`/`played` with the live values
before computing `pos` (1st–4th in group) and, for third-place teams,
`rank`/`qualified` across all 12 thirds. `conduct` (fair-play) and `fifa`
always come from `TEAMS_RAW`, live or not. If the fetch fails for any
reason, `TEAMS_RAW`'s numbers are used as-is — it's the permanent fallback
snapshot, not just a one-time seed, so keep it reasonably current (see
below).

### Clinched / eliminated status for the third-place race

Beyond the current top-8 cut (`qualified`), each third-place team also
gets a `clinched`/`eliminated` flag from `computeThirdPlaceCertainty()`
in `js/app.js`:

- **`maxPts`** = current points + 3 × remaining games — the most points a
  team could possibly finish group play with. Used only for `eliminated`:
  a team is eliminated if 8+ of the other thirds *already* have more
  points than this team's `maxPts` — i.e. even a perfect run through the
  remaining games can't get them into the top 8 on points alone. This is
  points-only on purpose: a trailing team's eventual GD/goals/fair-play/
  FIFA rank can't be bounded the way a 3-points-per-win ceiling can (a
  team could theoretically win 12–0).
- **`clinched`**: true if at most 7 of the other thirds could still end up
  ranked at or above this team — via `couldStillOutrank()`. A challenger
  only counts as a real threat if:
  - it **hasn't finished its group yet** (bounded only by its points
    ceiling, since its final GD/goals/etc. aren't locked), or
  - it **has finished**, but running the actual FIFA tiebreak chain — the
    same `sortKey()` used for every other ranking in this app — against
    this team's current line still puts it at or above this team.

  The second branch matters: two teams tied on points with their groups
  both finished isn't a future possibility, it's a *permanent, decided*
  ranking — goal difference (then goals scored, then fair-play, then FIFA
  rank) already broke that tie for good. A finished team that's already
  lost that tiebreak doesn't count against clinching just because the
  points number matches. (Example: Sweden, Ecuador, and Bosnia and
  Herzegovina were tied on 4 points with their groups all finished —
  Sweden led on goals scored, Bosnia trailed on goal difference. That tie
  is over; it doesn't keep any of them from clinching just because the
  points column matches.)

Everything that isn't conclusively clinched or eliminated shows as a
provisional **IN**/**OUT** that "could still move either way." The
Third-Place Race table and the per-team scenario text both reflect this:
**CLINCHED**/**ELIMINATED** vs. plain **IN**/**OUT**.

### `TABLE_COMPACT` (FIFA Annex C lookup table)

FIFA fixed, in advance, exactly which group's third-place finisher plays
which group-winner in the Round of 32 — for every one of the
`C(12,8) = 495` possible combinations of "which 8 of the 12 groups
produce a qualifying third-place team." That's Annex C of the competition
regulations, and it's baked into this app as one compact string instead
of a 495-row JSON table.

**Format:** the string is chunked into 16-character rows. Each row is:

```
[8 sorted group letters = the key][8 group letters in SLOT_ORDER = the assignment]
```

- The **key** (first 8 chars) is the sorted, concatenated set of group
  letters whose third-place team qualified (e.g. `"ABDEGIKL"`).
- The **assignment** (last 8 chars) says, for each slot in `SLOT_ORDER =
  ["A","B","D","E","G","I","K","L"]`, which group's third-place team plays
  that slot's group-winner. (Only 8 of the 12 groups — A, B, D, E, G, I, K,
  L — ever feed a "winner vs. best third" match in the official bracket;
  the rest only appear in winner-vs-runner-up or runner-up-vs-runner-up
  matches.)

`buildLookup()` in `js/data.js` slices the string 16 characters at a time,
sorts the key half, and zips the assignment half against `SLOT_ORDER` to
build a `{ "ABDEGIKL": {A:"E", B:"...", ...}, ... }` map. At runtime,
`resolveBracket()` figures out which 8 groups currently qualify, joins
their sorted letters into a key, and looks up the assignment directly —
no scanning, no recomputation of FIFA's table.

If you want to regenerate `TABLE_COMPACT` from FIFA's published Annex C
PDF/table rather than trust the existing string, the safest approach is
a small script that parses the official table into the same 495 rows and
re-emits this compact form — the encoding is lossless and arbitrary table
sources, so long as they cover all 495 combinations, will round-trip
through `buildLookup()` correctly.

### `POOLS` and `MATCHES`

- `POOLS[group]` lists the other groups whose third-place team could
  realistically face that group's winner (used as a fallback display
  before the actual qualifying combination is known).
- `MATCHES` is the fixed Round of 32 schedule: 16 matches, each tagged
  `RU-RU` (runner-up vs runner-up), `W-RU` (winner vs runner-up), or
  `W-3RD` (winner vs a best third-placed team), with date/venue and the
  group(s) that feed each side.

None of `POOLS`, `MATCHES`, `SLOT_ORDER`, or `TABLE_COMPACT` should need
to change between tournaments edits — they're fixed by FIFA regulation
for this World Cup. `TEAMS_RAW` is the only data that changes as results
come in.

## FIFA tiebreaker rules implemented

Both **group standings** and the **third-place ranking** use the same
five-criteria order (`sortKey()` in `js/app.js`):

1. Points (descending)
2. Goal difference (descending)
3. Goals scored (descending)
4. Fair-play / disciplinary score (descending — fewer cards wins)
5. FIFA World Ranking (ascending — lower rank number wins)

**Not modeled:** head-to-head results between teams tied on all five
criteria. FIFA's regulations resolve that case with a head-to-head
mini-table (or drawing of lots if more than two teams remain tied); this
calculator will leave such teams in whatever order they appear in
`TEAMS_RAW` until you break the tie manually by editing one of the five
numeric fields. The app's own UI flags this in the Groups tab.

## Live data pipeline

Points, goal difference, and goals scored update automatically — fair-play
score and FIFA ranking don't (see "Why fair-play and FIFA ranking aren't
live" below). The pipeline:

1. **`.github/workflows/update-standings.yml`** runs `scripts/import-standings.mjs`
   on a 20-minute cron (plus manual `workflow_dispatch`).
2. The script calls football-data.org's `GET /v4/competitions/WC/standings`
   using an API key read from the `FOOTBALL_DATA_API_KEY` repo secret (sent
   as the `X-Auth-Token` header) — **the key never appears in client-side
   code**, only in the Action's environment.
3. **Team matching** uses `scripts/team-id-map.mjs`, an explicit map of
   football-data.org's numeric `team.id` → `{name, group}` for all 48
   teams. We match on id, not name strings, because the API's names don't
   always match ours (`"United States"` vs `"USA"`, `"Bosnia-Herzegovina"`
   vs `"Bosnia and Herzegovina"`, `"Turkey"` vs `"Türkiye"`, `"Congo DR"`
   vs `"DR Congo"`, `"Cape Verde Islands"` vs `"Cape Verde"`). Any
   unrecognized team id is logged explicitly and blocks the update — it's
   never silently guessed or dropped.
4. **Sanity checks** run before anything is written: exactly 4 teams per
   group, every team matched, the API's reported group matches what we
   expect for that team id, points in `0–9`, goals scored `≥ 0`, goal
   difference within `±30`, games played in `0–3`. If anything fails, the
   script logs why and exits without touching `data/standings.json` — the
   site keeps serving the last good data instead of garbage. (Check the
   Action's run summary on GitHub if you want to see what was rejected
   and why.)
5. If everything checks out and the standings actually changed, it writes
   `data/standings.json` (`{lastUpdated, source, teams: [{name, group,
   pts, gd, gf, played, live}, ...]}`) and the workflow commits it
   directly to `main`. `live` (see "In-progress matches" below) flags a
   team currently mid-match.
6. **`js/app.js`** fetches `data/standings.json` at page load
   (`loadLiveStandings()`), overlays `pts`/`gd`/`gf`/`played`/`live` onto
   the `TEAMS_RAW` baseline by name, and records `lastUpdated`/`source` for
   the "Data note" banner. Any failure — network error, 404, malformed
   JSON, or opening `index.html` straight from disk (`file://` blocks
   relative `fetch()` in most browsers) — is caught, and the page
   silently falls back to whatever's in `TEAMS_RAW`.

### Why fair-play and FIFA ranking aren't live

- **FIFA ranking** is frozen by FIFA's own regulations — the ranking used
  for this tiebreaker is the one published *before* the tournament
  started, not a live value. Don't fetch it live even if you find a
  source that offers it.
- **Fair-play score** isn't exposed as a ready field by football-data.org's
  free tier (cards/lineups require a paid add-on), and even paid sources
  generally don't hand you FIFA's exact disciplinary-point formula
  (−1 yellow / −3 red / −4 second-yellow) pre-computed — you'd have to
  aggregate it yourself from raw match card events. Given it's the 4th of
  5 tiebreakers (only matters on an exact points/GD/GF tie) and the group
  stage locks in a couple of days, that wasn't worth automating. Edit it
  by hand in `js/data.js` if a real tie at that level shows up.

### In-progress matches

football-data.org's standings endpoint folds an in-progress match's
*current* score into `points`/`goalsFor`/`goalDifference` — and counts it
in `playedGames` — before the match is actually final. Left unhandled,
that means a team mid-match can look like its group has finished
(`playedGames === 3`) when it hasn't, which would have let the clinch/
eliminate math (and the "X/3 PLD" display) treat a score that can still
change as if it were permanent.

`scripts/import-standings.mjs` also fetches
`GET /v4/competitions/WC/matches?status=LIVE` (football-data.org's filter
for `IN_PLAY`/`PAUSED`) and tags every team currently in one of those
matches with `live: true` in `data/standings.json`. `js/app.js` then:

- Treats that team's in-progress match as **not yet played** — their
  displayed `played` count is the API's `playedGames` minus one, not the
  raw value — so the UI never claims a group is finished while a match
  in it is still going.
- Excludes a live team from the "already decided" tiebreak comparison in
  `couldStillOutrank()` — it's evaluated by its points ceiling like any
  other unfinished team, never treated as frozen.
- **Never marks a live team itself `clinched` or `eliminated`**,
  regardless of what the rest of the math says — explicitly forced at the
  end of `computeThirdPlaceCertainty()`. A team's own current points can
  still go *down* as well as up before full time (a provisional lead can
  end in a draw or a loss), so even a team that currently looks safely
  inside or hopelessly outside the top 8 isn't either of those for
  certain until its match is over.

A "LIVE" badge (pulsing, respects `prefers-reduced-motion`) shows next to
that team's played count in both the Third-Place table and the Groups
editor.

### Re-running or adjusting the importer

- Trigger it manually: **Actions → Update World Cup standings → Run workflow**
  on GitHub, or locally with `FOOTBALL_DATA_API_KEY=... node scripts/import-standings.mjs`.
- Change the polling cadence by editing the `cron` line in
  `.github/workflows/update-standings.yml`. Once the bracket locks
  (group stage ends, all 8 best-thirds are fixed), this workflow has
  nothing left to usefully update — disable the schedule or delete the
  file rather than letting it poll an unchanging table forever.
- If football-data.org ever changes a team's `id` (shouldn't happen) or
  you swap providers, update `scripts/team-id-map.mjs` — that's the only
  place name/id matching logic lives.

### Updating `TEAMS_RAW`'s fallback values

`TEAMS_RAW` in `js/data.js` is the permanent fallback, not a one-time
seed — keep it reasonably current so the page still makes sense for
anyone who loads it while `data/standings.json` is unreachable:

1. Update the affected teams' `points`/`goalDifference`/`goalsScored`/`gamesPlayed`.
2. Bump `SNAPSHOT_VERSION` (e.g. `"2026-06-27"`) and the date in the
   "Data note" fallback text in `renderSnapshotNote()` (`js/app.js`).
3. Leave `fairPlayScore` and `fifaRanking` alone unless you have a
   specific reason to change them (see above).
4. `POOLS`, `MATCHES`, `SLOT_ORDER`, and `TABLE_COMPACT` are fixed
   tournament structure, not results — never touch them here.

## Local edits & persistence

Visiting the **Groups & Edit Data** tab and changing a team's points,
goal difference, or goals scored updates the page live and is saved to
that browser's `localStorage` (`bestThirds2026:editedTeams`), so it
survives a reload on the same device. It is never sent anywhere — it's
purely a local "what if" sandbox layered on top of whatever's currently
loaded (live data if reachable, `TEAMS_RAW` otherwise).

Saved edits are tagged with the live feed's `lastUpdated` timestamp (or
`SNAPSHOT_VERSION` if running on the static fallback) at the moment they
were made. If newer live data — or a bumped `SNAPSHOT_VERSION` — shows up
later, stale local edits are automatically discarded in favor of the
fresh numbers rather than silently mixing old edits with new results.

Click **"Reset to original snapshot"** in the Groups tab at any time to
discard local edits and clear them from storage.

## Running locally

```
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Any static file server works — there's nothing to build or compile. A
plain file server is enough; `data/standings.json` just needs to be
fetchable as a relative path, which `file://` won't allow but any
`http://` server will.

To exercise the importer locally instead of waiting for the schedule:

```
FOOTBALL_DATA_API_KEY=your_key_here node scripts/import-standings.mjs
```

## Forking / deploying your own copy

Get a free API key at [football-data.org](https://www.football-data.org/client/register),
then add it as a repo secret named `FOOTBALL_DATA_API_KEY`
(`gh secret set FOOTBALL_DATA_API_KEY` or Settings → Secrets and
variables → Actions on GitHub) so `.github/workflows/update-standings.yml`
can use it. The key is never read by anything client-side.
