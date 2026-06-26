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

## Files

```
index.html        Markup + tab/panel structure
css/styles.css     All styling
js/data.js         Embedded dataset + the Annex C lookup table + its decoder
js/app.js          State, tiebreaker logic, rendering, localStorage persistence
```

## Data model

### `TEAMS_RAW` (in `js/data.js`)

A flat array of 48 rows, one per team:

```js
[name, group, points, goalDifference, goalsScored, fairPlayScore, fifaRanking]
```

- **fairPlayScore** follows FIFA's disciplinary-points convention: `0` is
  clean, more negative means more accumulated yellow/red-card penalties.
  Higher (closer to zero) wins a tiebreak.
- **fifaRanking** is the team's position in the FIFA World Ranking — lower
  number is better.

`js/app.js` expands each row into a `{name, group, pts, gd, gf, conduct,
fifa}` object at load time, then computes `pos` (1st–4th in group) and,
for third-place teams, `rank`/`qualified` across all 12 thirds.

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

## Updating the snapshot as real results come in

1. Open `js/data.js`.
2. For each match result, update the affected teams' rows in `TEAMS_RAW`:
   add to `points` (3 for a win, 1 each for a draw), update
   `goalDifference` and `goalsScored`, and adjust `fairPlayScore` for any
   yellow/red cards shown (FIFA's disciplinary deductions: −1 per yellow,
   −3 for a single red, −4 for two-yellows-into-red).
3. Bump `SNAPSHOT_VERSION` to the date of the new snapshot (e.g.
   `"2026-06-27"`). This string is compared against what's saved in each
   visitor's `localStorage` — bumping it means anyone with old local edits
   gets the fresh snapshot instead of a stale mix, the next time they load
   the page.
4. Update the date in the "Data note" text in `renderSnapshotNote()`
   (`js/app.js`) to match.
5. `FIFA ranking` only changes when FIFA publishes a new ranking (monthly,
   not per-match) — leave it alone unless a new ranking has actually been
   released.
6. `POOLS`, `MATCHES`, `SLOT_ORDER`, and `TABLE_COMPACT` are fixed
   tournament structure, not results — don't touch them.

No build step is required; editing `js/data.js` and reloading the page
(or redeploying) is the entire update process.

## Local edits & persistence

Visiting the **Groups & Edit Data** tab and changing a team's points,
goal difference, or goals scored updates the page live and is saved to
that browser's `localStorage` (`bestThirds2026:editedTeams`), so it
survives a reload on the same device. It is never sent anywhere — it's
purely a local "what if" sandbox layered on top of the shipped snapshot.

Saved edits are tagged with the `SNAPSHOT_VERSION` they were made
against; if the deployed snapshot is later updated, stale local edits
are automatically discarded in favor of the fresh data.

Click **"Reset to original snapshot"** in the Groups tab at any time to
discard local edits and clear them from storage.

## Running locally

```
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Any static file server works — there's nothing to build or compile.
