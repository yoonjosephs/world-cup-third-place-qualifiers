const STORAGE_KEY = "bestThirds2026:editedTeams";
const STANDINGS_URL = "data/standings.json";

let teams = TEAMS_RAW.map(t=>({name:t[0],group:t[1],pts:t[2],gd:t[3],gf:t[4],conduct:t[5],fifa:t[6],played:t[7],live:false}));
let SNAPSHOT = JSON.parse(JSON.stringify(teams));

// liveStatus describes where the *current* numbers (before any local edits)
// came from, so the banner and the localStorage version key both reflect
// reality instead of the hardcoded fallback constant.
let liveStatus = { ok:false, lastUpdated:null, version:SNAPSHOT_VERSION };
let usingSavedEdits = false;
let pendingFixtures = []; // remaining (not-yet-started) group-stage fixtures, from data/standings.json
let scenarioEngine = null; // built once after load — see buildScenarioEngine()

// Pulls data/standings.json (written by the GitHub Action in
// scripts/import-standings.mjs) and overlays live points/GD/GF onto the
// bundled TEAMS_RAW baseline. fairPlayScore and fifaRanking always come
// from TEAMS_RAW — they're not part of the live feed (see README).
// Falls back to the pure TEAMS_RAW snapshot on any failure: bad network,
// 404, malformed JSON, or opening this file directly from disk (file://
// fetches of relative JSON are blocked in most browsers).
//
// `live` (set by the importer from football-data.org's match statuses)
// flags a team currently mid-match. football-data.org's standings already
// fold an in-progress match's provisional score into points/GD/GF/played
// *before* the match is final, so a team can look "finished" when it
// isn't. We treat that in-progress game as not-yet-played here — both so
// the displayed "played" count is honest and so the certainty math in
// computeThirdPlaceCertainty() doesn't mistake a live, still-changeable
// line for a locked-in one. See README "In-progress matches".
async function loadLiveStandings(){
  try{
    const res = await fetch(STANDINGS_URL, {cache:'no-store'});
    if(!res.ok) return;
    const data = await res.json();
    if(!data || !Array.isArray(data.teams) || typeof data.lastUpdated !== 'string') return;
    const byName = new Map(data.teams.map(t=>[t.name,t]));
    if(byName.size !== teams.length) return; // shape mismatch — don't trust it
    teams.forEach(t=>{
      const live = byName.get(t.name);
      if(!live) return;
      if(!Number.isInteger(live.pts) || !Number.isInteger(live.gd) || !Number.isInteger(live.gf)) return;
      t.pts = live.pts; t.gd = live.gd; t.gf = live.gf;
      t.live = live.live === true;
      if(Number.isInteger(live.played) && live.played>=0 && live.played<=GROUP_STAGE_GAMES){
        t.played = t.live ? Math.max(0, live.played-1) : live.played;
      }
    });
    liveStatus = { ok:true, lastUpdated:data.lastUpdated, source:data.source||'live feed', version:data.lastUpdated };
    SNAPSHOT = JSON.parse(JSON.stringify(teams));
    if(Array.isArray(data.pendingFixtures) && data.pendingFixtures.every(f=>
      f && typeof f.group==='string' && typeof f.home==='string' && typeof f.away==='string'
    )){
      pendingFixtures = data.pendingFixtures;
    }
  }catch(e){ /* network error, CORS on file://, bad JSON — keep static fallback */ }
}

function loadSavedTeams(){
  let raw;
  try{ raw = localStorage.getItem(STORAGE_KEY); }
  catch(e){ return null; } // storage disabled (private browsing, etc.)
  if(!raw) return null;
  try{
    const payload = JSON.parse(raw);
    if(payload.version !== liveStatus.version) return null;
    if(!Array.isArray(payload.teams) || payload.teams.length !== SNAPSHOT.length) return null;
    const names = new Set(SNAPSHOT.map(t=>t.name));
    if(!payload.teams.every(t=>names.has(t.name))) return null;
    return payload.teams;
  }catch(e){ return null; }
}

function saveTeams(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version:liveStatus.version, teams}));
  }catch(e){ /* storage disabled — edits just won't persist */ }
}

function clearSavedTeams(){
  try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
}

function byGroup(g){return teams.filter(t=>t.group===g);}
function sortKey(a,b){
  if(b.pts!==a.pts) return b.pts-a.pts;
  if(b.gd!==a.gd) return b.gd-a.gd;
  if(b.gf!==a.gf) return b.gf-a.gf;
  if(b.conduct!==a.conduct) return b.conduct-a.conduct;
  return a.fifa-b.fifa; // lower FIFA rank number = better
}
function computeGroupPositions(){
  const groups = {};
  teams.forEach(t=>{groups[t.group]=groups[t.group]||[]; groups[t.group].push(t);});
  Object.keys(groups).forEach(g=>{
    const sorted = groups[g].slice().sort(sortKey);
    sorted.forEach((t,i)=>{t.pos=i+1;});
  });
}
function thirdPlaceTable(){
  const thirds = teams.filter(t=>t.pos===3).slice().sort(sortKey);
  thirds.forEach((t,i)=>{t.rank=i+1; t.qualified = i<8;});
  return thirds;
}
// Mathematical certainty for the third-place race. For each third-place
// team, maxPts is the most points they could possibly finish with — their
// current points plus a win in every game they haven't played yet.
// isDecided is true once a team's own line can no longer change: group
// finished and not mid-match (maxPts === pts at that point).
//
// clinched: true if at most 7 of the other thirds can still end up ranked
// at or above this team. A challenger only counts as "still a threat" if:
//   - it hasn't finished its group yet (its final GD/goals/etc. aren't
//     locked, so we can't rule out it catching up — bounded only by its
//     points ceiling), or
//   - it HAS finished, but applying the real FIFA tiebreak chain (the same
//     sortKey used everywhere else) to its now-permanent stats against this
//     team's current line still puts it at or above this team.
// A finished team that's already been conclusively out-tiebreaked (e.g.
// tied on points but behind on goal difference) is *not* a threat — that
// tie is decided forever, not a future possibility, so it doesn't count
// against clinching.
//
// eliminated: true if 8 or more of the other thirds are *permanently*
// ahead of this team — either strictly more points than this team's
// maxPts (a perfect run still wouldn't be enough), or tied with this
// team's maxPts where BOTH teams are fully decided and the rival wins the
// real tiebreak chain. That second case only applies when this team is
// also decided: a trailing team that still has games left could yet
// raise its own points past a tied-and-currently-ahead-on-GD rival, so a
// tiebreak win only counts as permanent once neither side can move
// anymore. (GD/goals/fair-play/FIFA rank still aren't used to bound a
// still-active rival's *ceiling* — a team could theoretically win 12–0 —
// only to resolve a tie where both sides are already finished.)
function isDecided(team){ return !team.live && team.played >= GROUP_STAGE_GAMES; }

function couldStillOutrank(challenger, target){
  if(challenger.played < GROUP_STAGE_GAMES || challenger.live){
    const theirMaxPts = challenger.pts + (GROUP_STAGE_GAMES - challenger.played)*3;
    return theirMaxPts >= target.pts;
  }
  return sortKey(challenger, target) <= 0; // challenger's frozen line sorts at-or-above target's current line
}

function isPermanentlyAhead(challenger, target){
  if(challenger.pts > target.maxPts) return true;
  if(challenger.pts === target.maxPts && isDecided(challenger) && isDecided(target)){
    return sortKey(challenger, target) < 0; // both frozen — tiebreak result is final, not a future possibility
  }
  return false;
}

function computeThirdPlaceCertainty(thirds){
  thirds.forEach(t=>{ t.maxPts = t.pts + (GROUP_STAGE_GAMES - t.played)*3; });
  thirds.forEach(t=>{
    const others = thirds.filter(o=>o.name!==t.name);
    const stillThreats = others.filter(o=>couldStillOutrank(o, t)).length;
    const alreadyAhead = others.filter(o=>isPermanentlyAhead(o, t)).length;
    t.clinched = stillThreats <= 7;
    t.eliminated = alreadyAhead >= 8;
  });
  // A team mid-match is itself a moving target — their current points can
  // still go up *or down* before full time (a provisional lead can turn
  // into a draw or a loss). Never call them clinched or eliminated while
  // their own match is live, regardless of what the math above says.
  thirds.forEach(t=>{ if(t.live){ t.clinched=false; t.eliminated=false; } });
}

function winnerOf(g){return byGroup(g).find(t=>t.pos===1);}
function runnerUpOf(g){return byGroup(g).find(t=>t.pos===2);}
function thirdOf(g){return byGroup(g).find(t=>t.pos===3);}

function resolveBracket(){
  const thirds = thirdPlaceTable();
  const qualifiedGroups = thirds.filter(t=>t.qualified).map(t=>t.group).sort();
  const key = qualifiedGroups.join('');
  const assign = LOOKUP[key]; // slot -> group letter whose 3rd place plays that slot's winner
  return {assign, qualifiedGroups};
}

const GROUP_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

// Brute-force "what results let team X advance" engine, built once per
// data load from data/standings.json's `pendingFixtures` (the actual
// remaining group-stage matches, fetched by scripts/import-standings.mjs).
// Caps at 3^MAX_SCENARIO_FIXTURES combinations so it can never hang a
// visitor's browser if a future snapshot has an unexpectedly large number
// of games left (e.g. computed earlier in the group stage).
const MAX_SCENARIO_FIXTURES = 10; // 3^10 = 59,049 combinations

// Within one pending group's 4 teams (all "variable" — final score
// unknown), or within the cross-group third-place pool (a mix of
// "fixed" teams whose group already finished, frozen forever, and
// "variable" contenders still pending), compute each entry's best- and
// worst-case final rank. A "fixed" entry's order against another "fixed"
// entry is the real, permanent FIFA tiebreak result (sortKey); any
// comparison touching a "variable" entry can only use points, since an
// unfinished team's eventual GD/goals aren't bounded.
function scenarioPts(entry){ return entry.kind==='fixed' ? entry.team.pts : entry.pts; }
function scenarioRankRanges(entries){
  const isAbove=(a,b)=>{
    if(a.kind==='fixed' && b.kind==='fixed') return sortKey(a.team, b.team) < 0;
    return scenarioPts(a) > scenarioPts(b);
  };
  const isTied=(a,b)=>{
    if(a.kind==='fixed' && b.kind==='fixed') return sortKey(a.team, b.team) === 0;
    return scenarioPts(a) === scenarioPts(b);
  };
  return entries.map(e=>{
    let above=0, tied=0;
    entries.forEach(o=>{
      if(o===e) return;
      if(isAbove(o,e)) above++;
      else if(isTied(o,e)) tied++;
    });
    return {name:e.name, bestCaseRank:above+1, worstCaseRank:above+tied+1};
  });
}

// Builds the engine from the current `teams` state (call once per data
// load, before any Groups-tab "what if" edits — see comment at call site).
// Returns null if there's nothing to compute (no pending fixtures) or the
// safety cap is exceeded.
function buildScenarioEngine(){
  if(!Array.isArray(pendingFixtures) || pendingFixtures.length===0) return null;
  if(pendingFixtures.length > MAX_SCENARIO_FIXTURES) return null;

  const pendingGroups = [...new Set(pendingFixtures.map(f=>f.group))];
  const baseByName = new Map(teams.map(t=>[t.name,t]));
  function ptsAfter(name, combo){
    let pts = baseByName.get(name).pts;
    pendingFixtures.forEach((fx,i)=>{
      if(fx.home===name) pts += combo[i]==='H'?3:combo[i]==='D'?1:0;
      if(fx.away===name) pts += combo[i]==='A'?3:combo[i]==='D'?1:0;
    });
    return pts;
  }

  const decidedThirds = GROUP_LETTERS.filter(g=>!pendingGroups.includes(g))
    .map(g=>byGroup(g).find(t=>t.pos===3)).filter(Boolean);

  const OUTCOMES = ['H','D','A'];
  const N = pendingFixtures.length;
  const total = Math.pow(3, N);
  const perTeam = new Map(); // name -> {QUALIFIED,ELIMINATED,AMBIGUOUS}
  const perTeamPerFixture = new Map(); // name -> [ {H:{...},D:{...},A:{...}}, ... ] indexed like pendingFixtures
  function bump(name, bucket, combo){
    const a = perTeam.get(name) || {QUALIFIED:0,ELIMINATED:0,AMBIGUOUS:0};
    a[bucket]++; perTeam.set(name, a);
    let perFx = perTeamPerFixture.get(name);
    if(!perFx){ perFx = pendingFixtures.map(()=>({H:{QUALIFIED:0,ELIMINATED:0,AMBIGUOUS:0},D:{QUALIFIED:0,ELIMINATED:0,AMBIGUOUS:0},A:{QUALIFIED:0,ELIMINATED:0,AMBIGUOUS:0}})); perTeamPerFixture.set(name, perFx); }
    combo.forEach((outcome,i)=>{ perFx[i][outcome][bucket]++; });
  }

  for(let i=0;i<total;i++){
    const combo = []; let x = i;
    for(let j=0;j<N;j++){ combo.push(OUTCOMES[x%3]); x = Math.floor(x/3); }

    const verdict = new Map();
    const contenders = [];
    pendingGroups.forEach(g=>{
      const names = byGroup(g).map(t=>t.name);
      const entries = names.map(name=>({name, kind:'variable', pts: ptsAfter(name, combo)}));
      scenarioRankRanges(entries).forEach(r=>{
        if(r.worstCaseRank<=2) verdict.set(r.name, 'QUALIFIED');
        else if(r.bestCaseRank>=4 && r.worstCaseRank>=4) verdict.set(r.name, 'ELIMINATED');
        else if(r.bestCaseRank===3 && r.worstCaseRank===3) contenders.push({name:r.name, pts: entries.find(e=>e.name===r.name).pts});
        else verdict.set(r.name, 'AMBIGUOUS'); // own group slot itself undetermined without the actual scoreline
      });
    });

    const poolEntries = decidedThirds.map(t=>({name:t.name, kind:'fixed', team:t}))
      .concat(contenders.map(c=>({name:c.name, kind:'variable', pts:c.pts})));
    scenarioRankRanges(poolEntries).forEach(r=>{
      if(verdict.has(r.name)) return;
      if(r.worstCaseRank<=8) verdict.set(r.name, 'QUALIFIED');
      else if(r.bestCaseRank>8) verdict.set(r.name, 'ELIMINATED');
      else verdict.set(r.name, 'AMBIGUOUS');
    });

    verdict.forEach((bucket,name)=>bump(name, bucket, combo));
  }

  return { fixtures: pendingFixtures, total, perTeam, perTeamPerFixture };
}

// Per-team summary for buildScenarioText(), or null if this team isn't
// affected by any pending fixture (already fully decided, or the engine
// wasn't built at all).
function scenarioSummaryForTeam(name){
  if(!scenarioEngine || !scenarioEngine.perTeam.has(name)) return null;
  const overall = scenarioEngine.perTeam.get(name);
  const perFixture = scenarioEngine.fixtures.map((fx,i)=>({
    group: fx.group, home: fx.home, away: fx.away,
    outcomes: scenarioEngine.perTeamPerFixture.get(name)[i],
  }));
  return { total: scenarioEngine.total, overall, perFixture };
}

function fmtGD(n){return (n>0?'+':'')+n;}
function fmtConduct(n){return (n>0?'+':'')+n;}

function statusOf(t){
  if(t.pos===1) return {label:'1ST · THROUGH', cls:'safe'};
  if(t.pos===2) return {label:'2ND · THROUGH', cls:'safe'};
  if(t.pos===4) return {label:'4TH · OUT', cls:'out'};
  // pos 3
  return t.qualified ? {label:'3RD · QUALIFYING', cls:'safe'} : {label:'3RD · BELOW CUT', cls:'out'};
}

function render(){
  computeGroupPositions();
  const thirds = thirdPlaceTable();
  computeThirdPlaceCertainty(thirds);
  renderSnapshotNote();
  renderThirdTable(thirds);
  renderGroups();
  renderBracket();
  renderScenario();
}

function fmtTimestamp(iso){
  try{
    return new Date(iso).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
  }catch(e){ return iso; }
}

function renderSnapshotNote(){
  const editNote = usingSavedEdits
    ? ' <b>You have unsaved-to-server local edits loaded</b> from a previous visit on this device — use "Reset to original snapshot" in Groups &amp; Edit Data to clear them.'
    : '';
  const dataLine = liveStatus.ok
    ? `<b>Live —</b> points/goal difference/goals scored last updated ${fmtTimestamp(liveStatus.lastUpdated)} via ${liveStatus.source}. Fair-play score and FIFA ranking are fixed inputs (see README) and don't update live.`
    : `<b>Live data unavailable —</b> showing the bundled fallback snapshot taken 25 Jun 2026 (group stage matchday 3). This page will use live standings automatically once they're reachable again.`;
  document.getElementById('snapshotNote').innerHTML =
    `${dataLine} Edit any team in <b>Groups &amp; Edit Data</b> to test a scenario; edits are saved to this browser only.${editNote}`;
}

function thirdStatusLabel(t){
  if(t.qualified) return t.clinched ? 'CLINCHED' : 'IN';
  return t.eliminated ? 'ELIMINATED' : 'OUT';
}

function renderThirdTable(thirds){
  const el = document.getElementById('tpTable');
  let html='';
  thirds.forEach((t,i)=>{
    const label = thirdStatusLabel(t);
    const certaintyWord = label==='CLINCHED' ? 'mathematically clinched a qualifying spot'
      : label==='ELIMINATED' ? 'mathematically eliminated from qualifying'
      : t.qualified ? 'currently in a qualifying spot, not yet clinched' : 'currently outside the qualifying spots, not yet eliminated';
    const liveNote = t.live ? ' Currently playing a match right now, so this is provisional even beyond the usual caveats.' : '';
    const a11yLabel = `${t.name}, Group ${t.group}. ${t.pts} points, goal difference ${fmtGD(t.gd)}, ${t.gf} goals scored, fair-play score ${fmtConduct(t.conduct)}, ${t.played} of ${GROUP_STAGE_GAMES} group games played. Rank ${i+1} of 12 third-place teams, ${certaintyWord}.${liveNote}`;
    html += `<button type="button" class="tp-row ${t.qualified?'q':'o'}" data-team="${t.name}" aria-label="${a11yLabel}">
      <span class="tp-rank" aria-hidden="true">${i+1}</span>
      <span class="tp-team" aria-hidden="true"><span class="tp-name">${t.name}</span><span class="tp-group">GROUP ${t.group} · ${t.played}/${GROUP_STAGE_GAMES} PLD${t.live?' · <span class="live-dot">LIVE</span>':''}</span></span>
      <span class="tp-stat" aria-hidden="true">${t.pts}</span>
      <span class="tp-stat" aria-hidden="true">${fmtGD(t.gd)}</span>
      <span class="tp-stat" aria-hidden="true">${t.gf}</span>
      <span class="tp-stat" aria-hidden="true">${fmtConduct(t.conduct)}</span>
      <span class="tp-status" aria-hidden="true">${label}</span>
    </button>`;
    if(i===7){
      html += `<div class="cutline"><span>Cut line — top 8 advance</span><div class="line"></div></div>`;
    }
  });
  el.innerHTML = html;
  el.querySelectorAll('.tp-row').forEach(row=>{
    row.addEventListener('click', ()=>{
      document.getElementById('teamSelect').value = row.dataset.team;
      renderScenario();
    });
  });
}

function renderGroups(){
  const el = document.getElementById('groupGrid');
  let html='';
  GROUP_LETTERS.forEach(g=>{
    const list = byGroup(g).slice().sort((a,b)=>a.pos-b.pos);
    html += `<div class="group-card"><h3>Group <span class="gl">${g}</span></h3>
      <div class="glabels" aria-hidden="true"><span></span><span>Team</span><span>Pts</span><span>GD</span><span>GF</span><span>Pld</span></div>`;
    list.forEach(t=>{
      html += `<div class="gteam">
        <span class="dot p${t.pos}" aria-hidden="true"></span>
        <span class="nm">${t.name}${t.live?' <span class="live-dot" aria-label="playing right now">LIVE</span>':''}</span>
        <input type="number" inputmode="numeric" data-name="${t.name}" data-field="pts" value="${t.pts}" aria-label="${t.name} points">
        <input type="number" inputmode="numeric" data-name="${t.name}" data-field="gd" value="${t.gd}" aria-label="${t.name} goal difference">
        <input type="number" inputmode="numeric" data-name="${t.name}" data-field="gf" value="${t.gf}" aria-label="${t.name} goals scored">
        <input type="number" inputmode="numeric" min="0" max="${GROUP_STAGE_GAMES}" data-name="${t.name}" data-field="played" value="${t.played}" aria-label="${t.name} games played, of ${GROUP_STAGE_GAMES}">
      </div>`;
    });
    html += `</div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const t = teams.find(x=>x.name===inp.dataset.name);
      let v = parseInt(inp.value,10);
      if(isNaN(v)) v = 0;
      if(inp.dataset.field==='played') v = Math.max(0, Math.min(GROUP_STAGE_GAMES, v));
      t[inp.dataset.field] = v;
      usingSavedEdits = true;
      saveTeams();
      render();
    });
  });
}

function teamLabel(g, kind){
  // kind: 'W' or 'RU'
  const t = kind==='W'? winnerOf(g) : runnerUpOf(g);
  return t ? t.name : `${kind==='W'?'Winner':'Runner-up'} Group ${g}`;
}

function renderBracket(){
  const {assign} = resolveBracket();
  const el = document.getElementById('bracketList');
  let html='';
  MATCHES.forEach(m=>{
    let leftName, leftSrc, rightName, rightSrc, rightProv=false;
    if(m.type==='RU-RU'){
      leftName = teamLabel(m.a,'RU'); leftSrc = `Runner-up · Group ${m.a}`;
      rightName = teamLabel(m.b,'RU'); rightSrc = `Runner-up · Group ${m.b}`;
    } else if(m.type==='W-RU'){
      leftName = teamLabel(m.a,'W'); leftSrc = `Winner · Group ${m.a}`;
      rightName = teamLabel(m.b,'RU'); rightSrc = `Runner-up · Group ${m.b}`;
    } else { // W-3RD
      leftName = teamLabel(m.a,'W'); leftSrc = `Winner · Group ${m.a}`;
      const thirdGroup = assign ? assign[m.a] : null;
      const thirdTeam = thirdGroup ? thirdOf(thirdGroup) : null;
      rightName = thirdTeam ? thirdTeam.name : `Best 3rd · Group ${POOLS[m.a].join('/')}`;
      rightSrc = thirdTeam ? `3rd place · Group ${thirdGroup} (current)` : `Pool: Group ${POOLS[m.a].join('/')}`;
      rightProv = true;
    }
    html += `<div class="match-card">
      <div class="match-meta"><b>${m.id}</b>${m.date}<br>${m.venue}</div>
      <div class="match-sides">
        <div class="side"><span class="nm">${leftName}</span><span class="src">${leftSrc}</span></div>
        <span class="vs" aria-hidden="true">VS</span>
        <div class="side ${rightProv?'prov':''}"><span class="nm">${rightName}</span><span class="src">${rightSrc}</span></div>
      </div>
    </div>`;
  });
  el.innerHTML = html;
}

function fmtPct(n, total){ return total ? Math.round(100*n/total)+'%' : '0%'; }

// Renders scenarioSummaryForTeam()'s output as the "specific results from
// upcoming matches" breakdown: an overall qualify/eliminated/undetermined
// split across every modeled result combination, plus a per-fixture table
// showing how each individual remaining match's outcome shifts the odds.
// Returns '' if this team isn't affected by any pending fixture.
function scenarioBreakdownHtml(name){
  const s = scenarioSummaryForTeam(name);
  if(!s) return '';
  const { total, overall, perFixture } = s;
  const headline = `Across all ${total.toLocaleString()} modeled result combinations for the remaining group-stage games: <b>${name} qualifies in ${overall.QUALIFIED}</b> (${fmtPct(overall.QUALIFIED,total)}), <b>is eliminated in ${overall.ELIMINATED}</b> (${fmtPct(overall.ELIMINATED,total)}), and in the remaining <b>${overall.AMBIGUOUS}</b> (${fmtPct(overall.AMBIGUOUS,total)}) it comes down to the actual scoreline — not just win/draw/loss — which this can't predict.`;
  const rows = perFixture.map(fx=>{
    const h = fx.outcomes.H, d = fx.outcomes.D, a = fx.outcomes.A;
    const hT = h.QUALIFIED+h.ELIMINATED+h.AMBIGUOUS, dT = d.QUALIFIED+d.ELIMINATED+d.AMBIGUOUS, aT = a.QUALIFIED+a.ELIMINATED+a.AMBIGUOUS;
    return `<div class="fixture-row">
      <b>${fx.home} vs ${fx.away}</b> <span class="fixture-group">Group ${fx.group}</span><br>
      If <b>${fx.home}</b> win: ${name} qualifies in ${fmtPct(h.QUALIFIED,hT)} of those scenarios &middot;
      if it's a draw: ${fmtPct(d.QUALIFIED,dT)} &middot;
      if <b>${fx.away}</b> win: ${fmtPct(a.QUALIFIED,aT)}
    </div>`;
  }).join('');
  return `<div class="scenario-breakdown">${headline}<div class="fixture-rows">${rows}</div></div>`;
}

function buildScenarioText(name){
  const t = teams.find(x=>x.name===name);
  if(!t) return '';
  const g = t.group;
  if(t.pos===1 || t.pos===2){
    const kind = t.pos===1?'W':'RU';
    // find which match this team plays in
    let oppHtml='', dateVenue='';
    for(const m of MATCHES){
      if(m.type==='RU-RU' && kind==='RU' && (m.a===g||m.b===g)){
        const other = m.a===g? m.b : m.a;
        oppHtml = teamLabel(other,'RU'); dateVenue = `${m.date} · ${m.venue}`; break;
      }
      if(m.type==='W-RU'){
        if(kind==='W' && m.a===g){ oppHtml = teamLabel(m.b,'RU'); dateVenue=`${m.date} · ${m.venue}`; break; }
        if(kind==='RU' && m.b===g){ oppHtml = teamLabel(m.a,'W'); dateVenue=`${m.date} · ${m.venue}`; break; }
      }
      if(m.type==='W-3RD' && kind==='W' && m.a===g){
        const {assign} = resolveBracket();
        const tg = assign ? assign[g] : null;
        const tt = tg ? thirdOf(tg) : null;
        oppHtml = tt ? `${tt.name} <span class="opp">(currently 3rd, Group ${tg})</span>` : `a best third-placed team from Group ${POOLS[g].join('/')}`;
        dateVenue = `${m.date} · ${m.venue}`; break;
      }
    }
    const posWord = t.pos===1?'won Group '+g:'finished runner-up in Group '+g;
    const groupDoneNote = t.live ? ` ${t.name} is playing right now — this is provisional until that match finishes.`
      : t.played>=GROUP_STAGE_GAMES ? ` Group ${g} has finished all ${GROUP_STAGE_GAMES} games, so this is locked in.`
      : ` Group ${g} still has games left (${t.name} has played ${t.played} of ${GROUP_STAGE_GAMES}), so this could still change.`;
    return `<div class="scenario-head"><span class="badge safe">Through</span><b>${t.name}</b></div>
      ${t.name} has ${posWord} and is into the Round of 32. They play <b>${oppHtml||'TBD'}</b> on ${dateVenue||'a date to be confirmed'}.${groupDoneNote}${scenarioBreakdownHtml(t.name)}`;
  }
  if(t.pos===4){
    const groupDoneNote = t.live ? ` ${t.name} is playing right now — this is provisional until that match finishes.`
      : t.played>=GROUP_STAGE_GAMES ? ` Group ${g} has finished all ${GROUP_STAGE_GAMES} games, so this is final.`
      : ` ${t.name} has played ${t.played} of ${GROUP_STAGE_GAMES} group games — this is provisional until Group ${g} finishes.`;
    return `<div class="scenario-head"><span class="badge out">Eliminated</span><b>${t.name}</b></div>
      ${t.name} finished fourth in Group ${g} on the current numbers and cannot reach the Round of 32 from there.${groupDoneNote}${scenarioBreakdownHtml(t.name)}`;
  }
  // pos 3
  const thirds = thirdPlaceTable();
  const mine = thirds.find(x=>x.name===t.name);
  let gapText='';
  if(mine.qualified){
    const cushion = thirds[8];
    gapText = cushion ? `They sit ${mine.pts-cushion.pts>=0? (mine.pts-cushion.pts)+' pt(s) and ' : ''}${mine.gd-cushion.gd} goal(s) of difference above 9th-placed ${cushion.name} on the bubble below them.` : '';
  } else {
    const line = thirds[7];
    gapText = line ? `They're ${line.pts-mine.pts} point(s) (and ${line.gd-mine.gd} on goal difference) behind 8th-placed ${line.name}, the team currently holding the last qualifying spot.` : '';
  }
  const {assign} = resolveBracket();
  let oppText = '';
  if(mine.qualified){
    // find which winner slot this group's 3rd is assigned to
    let oppSlot = null;
    if(assign){ for(const slot of SLOT_ORDER){ if(assign[slot]===g){ oppSlot = slot; break; } } }
    if(oppSlot){
      const w = winnerOf(oppSlot);
      const m = MATCHES.find(mm=>mm.type==='W-3RD' && mm.a===oppSlot);
      oppText = `<br>If the table finished right now, they'd play <b>${w?w.name:'Group '+oppSlot+' winner'}</b> in the Round of 32 (${m?m.date+' · '+m.venue:''}).`;
    }
  }
  const label = thirdStatusLabel(mine);
  const badge = label==='CLINCHED' ? '<span class="badge safe">Clinched</span>'
    : label==='ELIMINATED' ? '<span class="badge out">Eliminated</span>'
    : mine.qualified ? '<span class="badge safe">In a qualifying spot</span>' : '<span class="badge bubble">On the bubble</span>';
  const playedText = `${t.name} has played ${mine.played} of ${GROUP_STAGE_GAMES} group games`;
  let certaintyText = '', breakdown = '';
  if(mine.live){
    certaintyText = ` ${t.name} is playing right now, so even their current points/GD/GF could still change before full time — they can't be called clinched or eliminated mid-match.`;
  } else if(label==='CLINCHED'){
    certaintyText = ` Even if every other team behind them in the third-place race wins all of its remaining games, at most 7 of them could reach ${mine.pts} points — so ${t.name} can't be pushed below 8th by points alone. Their spot is mathematically clinched.`;
  } else if(label==='ELIMINATED'){
    certaintyText = ` Even with a maximum run of wins in their remaining games (best case: ${mine.maxPts} points), 8 other third-placed teams are already permanently ahead of that — either on points alone, or tied with it and already locked in ahead on goal difference with both sides' group stages finished. ${t.name} can no longer reach the top 8. They're mathematically eliminated from best-thirds qualification.`;
  } else if(mine.played>=GROUP_STAGE_GAMES){
    certaintyText = ` ${t.name}'s own numbers are final — Group ${g} is finished, so their points/GD/GF can't change. What's still open is the field around them: other third-placed teams haven't all finished, so the cutoff itself isn't settled yet. A currently-tied rival could still pull ahead on points by winning its last game, or — much less likely — fall behind ${t.name} on goal difference with a big enough loss while staying tied on points (a draw never moves goal difference; only a loss can move a tied team's GD down). Either way, it's the field's results left to play, not ${t.name}'s.`;
    breakdown = scenarioBreakdownHtml(t.name);
  } else {
    certaintyText = ` Their group stage isn't fully decided yet — ${t.name}'s own remaining games and enough of the field around them are both still open, so this could still move either way.`;
    breakdown = scenarioBreakdownHtml(t.name);
  }
  return `<div class="scenario-head">${badge}<b>${t.name}</b><span style="color:var(--text-faint);font-size:12px;">Rank ${mine.rank} of 12 third-place teams</span></div>
    ${t.name} is currently <b>${mine.qualified?'#'+mine.rank+' — inside the top 8':'#'+mine.rank+' — outside the top 8'}</b> third-placed teams (${mine.pts} pts, ${fmtGD(mine.gd)} GD, ${mine.gf} GF). ${playedText}.${certaintyText} ${gapText} The order is set by points, then goal difference, then goals scored, then fair-play score, then FIFA ranking — try editing ${t.name}'s numbers in the Groups tab to see exactly what flips their position.${oppText}${breakdown}`;
}

function renderScenario(){
  const name = document.getElementById('teamSelect').value;
  document.getElementById('scenarioBox').innerHTML = buildScenarioText(name);
}

function populateSelect(){
  const sel = document.getElementById('teamSelect');
  const sorted = teams.slice().sort((a,b)=> a.group===b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group));
  sel.innerHTML = sorted.map(t=>`<option value="${t.name}">${t.name} — Group ${t.group}</option>`).join('');
  sel.addEventListener('change', renderScenario);
}

function setActiveTab(tab){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach(b=>{
    const isActive = b===tab;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', String(isActive));
    b.tabIndex = isActive ? 0 : -1;
  });
  ['third','groups','bracket'].forEach(v=>{
    document.getElementById('view-'+v).hidden = (v!==tab.dataset.tab);
  });
}

function initTabs(){
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click', ()=>setActiveTab(tab));
    tab.addEventListener('keydown', (e)=>{
      let target = null;
      if(e.key==='ArrowRight') target = tabs[(i+1)%tabs.length];
      else if(e.key==='ArrowLeft') target = tabs[(i-1+tabs.length)%tabs.length];
      else if(e.key==='Home') target = tabs[0];
      else if(e.key==='End') target = tabs[tabs.length-1];
      if(target){ e.preventDefault(); target.focus(); setActiveTab(target); }
    });
  });
}

document.getElementById('resetBtn').addEventListener('click', ()=>{
  teams = JSON.parse(JSON.stringify(SNAPSHOT));
  usingSavedEdits = false;
  clearSavedTeams();
  render();
});

(async function init(){
  await loadLiveStandings();
  // Build the scenario engine off the live/fallback baseline, before any
  // Groups-tab "what if" edits are applied — it answers "what do the real
  // remaining fixtures mean," not "what if you change these numbers."
  computeGroupPositions();
  scenarioEngine = buildScenarioEngine();

  const saved = loadSavedTeams();
  if(saved){ teams = JSON.parse(JSON.stringify(saved)); usingSavedEdits = true; }

  initTabs();
  populateSelect();
  render();
})();
