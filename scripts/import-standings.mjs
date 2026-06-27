#!/usr/bin/env node
// Pulls live World Cup group standings from football-data.org and writes
// data/standings.json — but only if the response passes sanity checks.
// On any failure (network, auth, shape, or sanity), it logs why and exits
// without touching the existing file, so the site keeps serving the last
// good data instead of garbage. See README.md "Live data pipeline".
import { writeFile, readFile } from "node:fs/promises";
import { TEAM_ID_MAP, EXPECTED_TEAM_COUNT } from "./team-id-map.mjs";

const STANDINGS_URL = "https://api.football-data.org/v4/competitions/WC/standings";
// football-data.org's `status=LIVE` filter maps to IN_PLAY + PAUSED — matches
// that have started but haven't gone final. Crucially, the standings
// endpoint already folds an in-progress match's current score into
// points/goalsFor/goalDifference and counts it in playedGames *before* the
// match is over — so a team mid-match can look "finished" (playedGames===3)
// when it isn't. We cross-reference this separately so app.js can avoid
// treating that team's current line as locked in. See README "Live data
// pipeline" / "In-progress matches".
const LIVE_MATCHES_URL = "https://api.football-data.org/v4/competitions/WC/matches?status=LIVE";
// Remaining (not-yet-started) group-stage fixtures, used by the "what
// result combinations let team X advance" scenario engine in js/app.js.
// `status=SCHEDULED` is football-data.org's alias covering both SCHEDULED
// and TIMED (confirmed kickoff, not started) -- same convenience-alias
// pattern as `status=LIVE` covering IN_PLAY+PAUSED.
const PENDING_FIXTURES_URL = "https://api.football-data.org/v4/competitions/WC/matches?stage=GROUP_STAGE&status=SCHEDULED";
const OUT_PATH = new URL("../data/standings.json", import.meta.url);
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
// Safety cutoff: the scenario engine brute-forces 3^N combinations for N
// remaining matches. 3^12 ~= 531k is still fine for a browser; comfortably
// above what group stage ever has left in practice (at most a handful of
// groups x 2 matches). If this ever gets exceeded, the importer just omits
// pendingFixtures and the app falls back to its non-scenario explanation.
const MAX_PENDING_FIXTURES = 12;

function summarize(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    return writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" }).catch(() => {});
  }
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) {
    throw new Error(`football-data.org returned HTTP ${res.status} for ${url}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

// Returns a Set of football-data.org team ids that currently have a match
// IN_PLAY or PAUSED (i.e. started but not final).
function extractLiveTeamIds(matchesPayload) {
  const ids = new Set();
  for (const m of matchesPayload?.matches || []) {
    if (m.status === "IN_PLAY" || m.status === "PAUSED") {
      if (m.homeTeam?.id) ids.add(m.homeTeam.id);
      if (m.awayTeam?.id) ids.add(m.awayTeam.id);
    }
  }
  return ids;
}

// Returns { fixtures, errors }. fixtures is only meaningful if errors is empty.
// Each fixture: { group, home, away } using our canonical team names.
function validatePendingFixtures(matchesPayload) {
  const errors = [];
  const fixtures = [];
  const matches = matchesPayload?.matches || [];

  if (matches.length > MAX_PENDING_FIXTURES) {
    errors.push(`${matches.length} pending group-stage fixtures exceeds the safety cutoff of ${MAX_PENDING_FIXTURES} -- skipping pendingFixtures this run (scenario engine would be too expensive to brute-force).`);
    return { fixtures, errors };
  }

  for (const m of matches) {
    const groupLetter = (m.group || "").replace(/^GROUP_/, "").trim();
    const home = TEAM_ID_MAP[m.homeTeam?.id];
    const away = TEAM_ID_MAP[m.awayTeam?.id];
    if (!home || !away) {
      errors.push(`Pending fixture has unmatched team id(s): home=${m.homeTeam?.id} (${m.homeTeam?.name}), away=${m.awayTeam?.id} (${m.awayTeam?.name})`);
      continue;
    }
    if (home.group !== groupLetter || away.group !== groupLetter || home.group !== away.group) {
      errors.push(`Pending fixture group mismatch: ${home.name} (Group ${home.group}) vs ${away.name} (Group ${away.group}), API says Group ${groupLetter}`);
      continue;
    }
    fixtures.push({ group: groupLetter, home: home.name, away: away.name });
  }
  return { fixtures, errors };
}

// Returns { records, errors }. records is only meaningful if errors is empty.
function validateAndExtract(payload, liveTeamIds) {
  const errors = [];
  const unmatched = [];
  const byName = new Map();

  const groupEntries = Array.isArray(payload?.standings) ? payload.standings : [];
  for (const entry of groupEntries) {
    const groupLetter = (entry.group || "").replace(/^Group\s+/i, "").trim();
    const table = Array.isArray(entry.table) ? entry.table : [];

    if (table.length !== 4) {
      errors.push(`Group ${groupLetter || "?"}: expected 4 teams, got ${table.length}`);
    }

    for (const row of table) {
      const apiId = row?.team?.id;
      const known = TEAM_ID_MAP[apiId];
      if (!known) {
        unmatched.push(`team id ${apiId} ("${row?.team?.name}") in API group "${entry.group}"`);
        continue;
      }
      if (known.group !== groupLetter) {
        errors.push(`${known.name}: API has them in Group ${groupLetter}, expected Group ${known.group}`);
      }

      const pts = row.points;
      const gf = row.goalsFor;
      const gd = row.goalDifference;
      const played = row.playedGames;
      const live = liveTeamIds.has(apiId);
      if (!Number.isInteger(pts) || pts < 0 || pts > 9) {
        errors.push(`${known.name}: points out of range (${pts})`);
      }
      if (!Number.isInteger(gf) || gf < 0) {
        errors.push(`${known.name}: goalsFor invalid (${gf})`);
      }
      if (!Number.isInteger(gd) || gd < -30 || gd > 30) {
        errors.push(`${known.name}: goalDifference out of sane range (${gd})`);
      }
      if (!Number.isInteger(played) || played < 0 || played > 3) {
        errors.push(`${known.name}: playedGames out of range (${played})`);
      }

      byName.set(known.name, { name: known.name, group: known.group, pts, gd, gf, played, live });
    }
  }

  if (unmatched.length) {
    errors.push(`${unmatched.length} unmatched team id(s) — add them to scripts/team-id-map.mjs:`, ...unmatched.map(u => `  - ${u}`));
  }
  if (byName.size !== EXPECTED_TEAM_COUNT) {
    errors.push(`expected ${EXPECTED_TEAM_COUNT} teams total, matched ${byName.size}`);
  }

  return { records: [...byName.values()].sort((a, b) => a.group === b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group)), errors };
}

async function main() {
  if (!API_KEY) {
    await summarize(["⚠️ FOOTBALL_DATA_API_KEY not set — skipping live update, keeping existing data/standings.json."]);
    return;
  }

  let payload, liveTeamIds, fixturesPayload;
  try {
    payload = await fetchJSON(STANDINGS_URL);
    const matchesPayload = await fetchJSON(LIVE_MATCHES_URL);
    liveTeamIds = extractLiveTeamIds(matchesPayload);
    fixturesPayload = await fetchJSON(PENDING_FIXTURES_URL);
  } catch (e) {
    await summarize([`⚠️ Fetch failed: ${e.message}`, "Keeping existing data/standings.json."]);
    return;
  }

  const { records, errors } = validateAndExtract(payload, liveTeamIds);
  if (errors.length) {
    await summarize(["⚠️ Sanity checks failed — not publishing this update:", ...errors.map(e => `  - ${e}`), "Keeping existing data/standings.json."]);
    return;
  }

  const { fixtures, errors: fixtureErrors } = validatePendingFixtures(fixturesPayload);
  if (fixtureErrors.length) {
    await summarize(["⚠️ Pending-fixtures checks failed — publishing standings without scenario data this run:", ...fixtureErrors.map(e => `  - ${e}`)]);
  }

  const out = {
    lastUpdated: new Date().toISOString(),
    source: "football-data.org",
    teams: records,
    pendingFixtures: fixtureErrors.length ? [] : fixtures,
  };

  const previous = await readFile(OUT_PATH, "utf8").catch(() => null);
  const previousPayload = previous ? JSON.parse(previous) : null;
  const previousComparable = previousPayload ? JSON.stringify({ teams: previousPayload.teams, pendingFixtures: previousPayload.pendingFixtures || [] }) : null;
  const nextComparable = JSON.stringify({ teams: out.teams, pendingFixtures: out.pendingFixtures });
  if (previousComparable === nextComparable) {
    await summarize([`✅ Fetched OK, no change in standings or fixtures since last run (checked at ${out.lastUpdated}).`]);
    return; // don't touch lastUpdated / commit if nothing actually changed
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  await summarize([`✅ Published updated standings (${records.length} teams, ${out.pendingFixtures.length} pending fixtures) at ${out.lastUpdated}.`]);
}

main().catch(async (e) => {
  await summarize([`⚠️ Unexpected importer error: ${e.stack || e.message}`, "Keeping existing data/standings.json."]);
});
