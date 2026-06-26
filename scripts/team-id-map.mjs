// Explicit alias map: football-data.org's numeric team id -> this app's
// canonical team name (matching js/data.js TEAMS_RAW) and group.
//
// We match on the API's stable numeric `team.id`, not on name strings,
// because football-data.org's `name`/`shortName` don't always match ours
// (diacritics, "USA" vs "United States", "Bosnia-Herzegovina" vs "Bosnia
// and Herzegovina", "Turkey" vs "Türkiye", "Congo DR" vs "DR Congo",
// "Cape Verde Islands" vs "Cape Verde"). An id is unambiguous; a name
// string isn't worth trying to fuzzy-match.
//
// Verified against a live GET /v4/competitions/WC/standings response on
// 2026-06-26. If football-data.org ever reassigns one of these ids (it
// shouldn't — they're stable team identifiers), or if a team here doesn't
// show up in a future response, scripts/import-standings.mjs logs it as
// unmatched and refuses to publish rather than guessing.
export const TEAM_ID_MAP = {
  769: { name: "Mexico", group: "A" },
  774: { name: "South Africa", group: "A" },
  772: { name: "South Korea", group: "A" },
  798: { name: "Czechia", group: "A" },

  788: { name: "Switzerland", group: "B" },
  828: { name: "Canada", group: "B" },
  1060: { name: "Bosnia and Herzegovina", group: "B" },
  8030: { name: "Qatar", group: "B" },

  764: { name: "Brazil", group: "C" },
  815: { name: "Morocco", group: "C" },
  8873: { name: "Scotland", group: "C" },
  836: { name: "Haiti", group: "C" },

  771: { name: "USA", group: "D" },
  779: { name: "Australia", group: "D" },
  761: { name: "Paraguay", group: "D" },
  803: { name: "Türkiye", group: "D" },

  759: { name: "Germany", group: "E" },
  1935: { name: "Ivory Coast", group: "E" },
  791: { name: "Ecuador", group: "E" },
  9460: { name: "Curaçao", group: "E" },

  8601: { name: "Netherlands", group: "F" },
  766: { name: "Japan", group: "F" },
  792: { name: "Sweden", group: "F" },
  802: { name: "Tunisia", group: "F" },

  825: { name: "Egypt", group: "G" },
  840: { name: "Iran", group: "G" },
  805: { name: "Belgium", group: "G" },
  783: { name: "New Zealand", group: "G" },

  760: { name: "Spain", group: "H" },
  758: { name: "Uruguay", group: "H" },
  1930: { name: "Cape Verde", group: "H" },
  801: { name: "Saudi Arabia", group: "H" },

  773: { name: "France", group: "I" },
  8872: { name: "Norway", group: "I" },
  804: { name: "Senegal", group: "I" },
  8062: { name: "Iraq", group: "I" },

  762: { name: "Argentina", group: "J" },
  816: { name: "Austria", group: "J" },
  778: { name: "Algeria", group: "J" },
  8049: { name: "Jordan", group: "J" },

  818: { name: "Colombia", group: "K" },
  765: { name: "Portugal", group: "K" },
  1934: { name: "DR Congo", group: "K" },
  8070: { name: "Uzbekistan", group: "K" },

  770: { name: "England", group: "L" },
  763: { name: "Ghana", group: "L" },
  799: { name: "Croatia", group: "L" },
  1836: { name: "Panama", group: "L" },
};

export const EXPECTED_TEAM_COUNT = Object.keys(TEAM_ID_MAP).length; // 48
