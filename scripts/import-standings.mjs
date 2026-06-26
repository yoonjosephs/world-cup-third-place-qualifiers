#!/usr/bin/env node
// Pulls live World Cup group standings from football-data.org and writes
// data/standings.json — but only if the response passes sanity checks.
// On any failure (network, auth, shape, or sanity), it logs why and exits
// without touching the existing file, so the site keeps serving the last
// good data instead of garbage. See README.md "Live data pipeline".
import { writeFile, readFile } from "node:fs/promises";
import { TEAM_ID_MAP, EXPECTED_TEAM_COUNT } from "./team-id-map.mjs";

const API_URL = "https://api.football-data.org/v4/competitions/WC/standings";
const OUT_PATH = new URL("../data/standings.json", import.meta.url);
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;

function summarize(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    return writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" }).catch(() => {});
  }
}

async function fetchStandings() {
  const res = await fetch(API_URL, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) {
    throw new Error(`football-data.org returned HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

// Returns { records, errors }. records is only meaningful if errors is empty.
function validateAndExtract(payload) {
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
      if (!Number.isInteger(pts) || pts < 0 || pts > 9) {
        errors.push(`${known.name}: points out of range (${pts})`);
      }
      if (!Number.isInteger(gf) || gf < 0) {
        errors.push(`${known.name}: goalsFor invalid (${gf})`);
      }
      if (!Number.isInteger(gd) || gd < -30 || gd > 30) {
        errors.push(`${known.name}: goalDifference out of sane range (${gd})`);
      }

      byName.set(known.name, { name: known.name, group: known.group, pts, gd, gf });
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

  let payload;
  try {
    payload = await fetchStandings();
  } catch (e) {
    await summarize([`⚠️ Fetch failed: ${e.message}`, "Keeping existing data/standings.json."]);
    return;
  }

  const { records, errors } = validateAndExtract(payload);
  if (errors.length) {
    await summarize(["⚠️ Sanity checks failed — not publishing this update:", ...errors.map(e => `  - ${e}`), "Keeping existing data/standings.json."]);
    return;
  }

  const out = {
    lastUpdated: new Date().toISOString(),
    source: "football-data.org",
    teams: records,
  };

  const previous = await readFile(OUT_PATH, "utf8").catch(() => null);
  const previousTeams = previous ? JSON.stringify(JSON.parse(previous).teams) : null;
  if (previousTeams === JSON.stringify(records)) {
    await summarize([`✅ Fetched OK, no change in standings since last run (checked at ${out.lastUpdated}).`]);
    return; // don't touch lastUpdated / commit if nothing actually changed
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  await summarize([`✅ Published updated standings (${records.length} teams) at ${out.lastUpdated}.`]);
}

main().catch(async (e) => {
  await summarize([`⚠️ Unexpected importer error: ${e.stack || e.message}`, "Keeping existing data/standings.json."]);
});
