const STORAGE_KEY = "bestThirds2026:editedTeams";

let teams = TEAMS_RAW.map(t=>({name:t[0],group:t[1],pts:t[2],gd:t[3],gf:t[4],conduct:t[5],fifa:t[6]}));
const SNAPSHOT = JSON.parse(JSON.stringify(teams));

function loadSavedTeams(){
  let raw;
  try{ raw = localStorage.getItem(STORAGE_KEY); }
  catch(e){ return null; } // storage disabled (private browsing, etc.)
  if(!raw) return null;
  try{
    const payload = JSON.parse(raw);
    if(payload.version !== SNAPSHOT_VERSION) return null;
    if(!Array.isArray(payload.teams) || payload.teams.length !== SNAPSHOT.length) return null;
    const names = new Set(SNAPSHOT.map(t=>t.name));
    if(!payload.teams.every(t=>names.has(t.name))) return null;
    return payload.teams;
  }catch(e){ return null; }
}

function saveTeams(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({version:SNAPSHOT_VERSION, teams}));
  }catch(e){ /* storage disabled — edits just won't persist */ }
}

function clearSavedTeams(){
  try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
}

const saved = loadSavedTeams();
if(saved) teams = JSON.parse(JSON.stringify(saved));
let usingSavedEdits = !!saved;

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
  renderSnapshotNote();
  renderThirdTable(thirds);
  renderGroups();
  renderBracket();
  renderScenario();
}

function renderSnapshotNote(){
  const editNote = usingSavedEdits
    ? ' <b>You have unsaved-to-server local edits loaded</b> from a previous visit on this device — use "Reset to original snapshot" in Groups &amp; Edit Data to clear them.'
    : '';
  document.getElementById('snapshotNote').innerHTML =
    `<b>Data note —</b> seeded from a snapshot taken 25 Jun 2026 (group stage matchday 3 still finishing for several groups). Edit any team in <b>Groups &amp; Edit Data</b> to bring it current or to test a scenario; edits are saved to this browser only.${editNote}`;
}

function renderThirdTable(thirds){
  const el = document.getElementById('tpTable');
  let html='';
  thirds.forEach((t,i)=>{
    const a11yLabel = `${t.name}, Group ${t.group}. ${t.pts} points, goal difference ${fmtGD(t.gd)}, ${t.gf} goals scored, fair-play score ${fmtConduct(t.conduct)}. Rank ${i+1} of 12 third-place teams, currently ${t.qualified?'qualifying':'outside the qualifying spots'}.`;
    html += `<button type="button" class="tp-row ${t.qualified?'q':'o'}" data-team="${t.name}" aria-label="${a11yLabel}">
      <span class="tp-rank" aria-hidden="true">${i+1}</span>
      <span class="tp-team" aria-hidden="true"><span class="tp-name">${t.name}</span><span class="tp-group">GROUP ${t.group}</span></span>
      <span class="tp-stat" aria-hidden="true">${t.pts}</span>
      <span class="tp-stat" aria-hidden="true">${fmtGD(t.gd)}</span>
      <span class="tp-stat" aria-hidden="true">${t.gf}</span>
      <span class="tp-stat" aria-hidden="true">${fmtConduct(t.conduct)}</span>
      <span class="tp-status" aria-hidden="true">${t.qualified?'IN':'OUT'}</span>
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
      <div class="glabels" aria-hidden="true"><span></span><span>Team</span><span>Pts</span><span>GD</span><span>GF</span></div>`;
    list.forEach(t=>{
      html += `<div class="gteam">
        <span class="dot p${t.pos}" aria-hidden="true"></span>
        <span class="nm">${t.name}</span>
        <input type="number" inputmode="numeric" data-name="${t.name}" data-field="pts" value="${t.pts}" aria-label="${t.name} points">
        <input type="number" inputmode="numeric" data-name="${t.name}" data-field="gd" value="${t.gd}" aria-label="${t.name} goal difference">
        <input type="number" inputmode="numeric" data-name="${t.name}" data-field="gf" value="${t.gf}" aria-label="${t.name} goals scored">
      </div>`;
    });
    html += `</div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const t = teams.find(x=>x.name===inp.dataset.name);
      const v = parseInt(inp.value,10);
      t[inp.dataset.field] = isNaN(v)?0:v;
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
    return `<div class="scenario-head"><span class="badge safe">Through</span><b>${t.name}</b></div>
      ${t.name} has ${posWord} and is into the Round of 32. They play <b>${oppHtml||'TBD'}</b> on ${dateVenue||'a date to be confirmed'}.`;
  }
  if(t.pos===4){
    return `<div class="scenario-head"><span class="badge out">Eliminated</span><b>${t.name}</b></div>
      ${t.name} finished fourth in Group ${g} on the current numbers and cannot reach the Round of 32 from there.`;
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
  const badge = mine.qualified ? '<span class="badge safe">In a qualifying spot</span>' : '<span class="badge bubble">On the bubble</span>';
  return `<div class="scenario-head">${badge}<b>${t.name}</b><span style="color:var(--text-faint);font-size:12px;">Rank ${mine.rank} of 12 third-place teams</span></div>
    ${t.name} is currently <b>${mine.qualified?'#'+mine.rank+' — inside the top 8':'#'+mine.rank+' — outside the top 8'}</b> third-placed teams (${mine.pts} pts, ${fmtGD(mine.gd)} GD, ${mine.gf} GF). ${gapText} The order is set by points, then goal difference, then goals scored, then fair-play score, then FIFA ranking — try editing ${t.name}'s numbers in the Groups tab to see exactly what flips their position.${oppText}`;
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

initTabs();
populateSelect();
render();
