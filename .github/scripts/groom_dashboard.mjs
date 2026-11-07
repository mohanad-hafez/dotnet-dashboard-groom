const heading='## 🔍 Investigation Results';
const intro='> Deep investigations are dispatched for new critical/warning findings.\n> The [grooming workflow](../workflows/devops-health-groom.md) links results ~3 hours after this run.';
const day=86400000;
export function sections(body){
  const entries=[];let offset=0,fence=null;
  for(const line of body.split(/(?<=\n)/)){
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=null;}
    else if(!fence&&/^## /.test(line))entries.push({title:line.trimEnd(),start:offset});
    offset+=line.length;
  }
  return entries.map((s,i)=>({...s,end:entries[i+1]?.start??body.length,text:body.slice(s.start,entries[i+1]?.start??body.length)}));
}
function cell(s){return String(s).replace(/\r?\n/g,' ').replace(/\|/g,'\\|');}
function linkText(s){return cell(s).replace(/\[/g,'\\[').replace(/\]/g,'\\]');}
function fingerprintSet(body){
  const active=new Set();
  for(const s of sections(body))if(/^## (🆕 New Findings|📌 Existing Findings)/.test(s.title)){
    const ids=[...s.text.matchAll(/(?:\*\*)?Fingerprint:(?:\*\*)?\s*`([^`]+)`/g)].map(m=>m[1]);
    const count=s.title.match(/\((\d+)\)/)?.[1];
    if(count!==undefined&&Number(count)>ids.length)throw Error('Active finding fingerprints incomplete; cannot infer resolved status');
    for(const id of ids)active.add(id);
  }
  return active;
}
export function parseComments(comments){
  const parsed=[];
  for(const c of comments){
    if(c.user?.login!=='github-actions[bot]')continue;
    const ageTime=Date.parse(c.created_at);if(!Number.isFinite(ageTime))throw Error('Invalid bot comment timestamp');
    const common={...c,time:ageTime,category:'other'};
    if(c.body.startsWith('## 🔍 Investigation:')){
      const field=name=>c.body.match(new RegExp('^\\*\\*'+name+':\\*\\*[^\\S\\r\\n]*(.*)$','m'))?.[1]?.trim();
      const id=field('Finding ID')?.match(/^`([^`]+)`$/)?.[1],summary=field('Executive Summary'),severity=field('Severity');
      if(!id||!summary||!severity)throw Error('Malformed investigation comment '+c.id);
      parsed.push({...common,category:'investigation',finding_id:id,title:c.body.split(/\r?\n/)[0].slice('## 🔍 Investigation:'.length).trim(),summary,severity,correlation:field('Correlation')});
    }else parsed.push({...common,category:c.body.startsWith('## 📋 Health Check —')?'overview':'other'});
  }
  return parsed;
}
function tableRows(section){
  const result=[];
  for(const line of section.split(/\r?\n/)){
    if(!line.startsWith('|'))continue;
    const values=line.split(/(?<!\\)\|/).slice(1,-1).map(x=>x.trim());
    if(values[0]==='Finding'||values.every(x=>/^:?-+:?$/.test(x)))continue;
    if(values.length!==4)throw Error('Unsupported table schema; preserve source four columns');
    result.push(values);
  }
  return result;
}
export function planGroom(body,comments,now=new Date()){
  const parsed=parseComments(comments),investigations=parsed.filter(c=>c.category==='investigation'),active=fingerprintSet(body),parts=sections(body),islands=parts.filter(s=>s.title===heading);
  if(islands.length>1)throw Error('Duplicate source islands require inspection');
  const island=islands[0],rows=island?tableRows(island.text):[],originalRows=JSON.stringify(rows);
  const unique=new Map();for(const c of investigations.sort((a,b)=>a.time-b.time))unique.set(c.finding_id,c);
  const matched=new Set();
  for(const row of rows){
    const matches=[...unique.values()].filter(c=>row[0]===cell(c.title)||row[0]===cell(c.finding_id)||row[0]===`\`${cell(c.finding_id)}\``);
    if(matches.length>1)throw Error('Ambiguous exact finding match');
    if(matches.length){const c=matches[0];matched.add(c.finding_id);row[2]=active.has(c.finding_id)?'✅ Done':'✅ Resolved';row[3]=`[${linkText(c.summary)}](${c.html_url})`;}
  }
  for(const c of unique.values())if(!matched.has(c.finding_id)&&(!island||active.has(c.finding_id))){rows.push([cell(c.title),cell(c.severity),active.has(c.finding_id)?'✅ Done':'✅ Resolved',`[${linkText(c.summary)}](${c.html_url})`]);matched.add(c.finding_id);}
  const table=rows.map(r=>'| '+r.join(' | ')+' |').join('\n');
  const replacement=`${heading}\n\n${intro}\n\n| Finding | Severity | Status | Result |\n|---------|----------|--------|--------|\n${table}${table?'\n':''}\n`;
  let updated=body;
  if(island&&JSON.stringify(rows)!==originalRows)updated=body.slice(0,island.start)+replacement+body.slice(island.end);
  if(!island&&investigations.length){const insert=parts.find(s=>/^## (✅ Resolved|📌 Existing|📊 Trends)/.test(s.title))?.start??(body.indexOf('<sub>')>=0?body.indexOf('<sub>'):body.length);updated=body.slice(0,insert)+(insert&& !body.slice(0,insert).endsWith('\n\n')?'\n':'')+replacement+body.slice(insert);}
  const candidates=[];
  for(const c of parsed){
    if(c.isMinimized)continue;
    const age=now.getTime()-c.time;if(age<3*day)continue;
    let priority,reason;
    if(c.category==='investigation'&&age>7*day&&!active.has(c.finding_id)){priority=0;reason='RESOLVED';}
    else if(c.category==='investigation'&&age>7*day&&!rows.some(r=>r[0]===cell(c.title)||r[0]===cell(c.finding_id)||r[0]===`\`${cell(c.finding_id)}\``)){priority=1;reason='OUTDATED';}
    else if(c.category==='overview'&&age>7*day){priority=2;reason='OUTDATED';}
    else if(age>28*day){priority=3;reason='OUTDATED';}
    if(reason)candidates.push({id:c.id,node_id:c.node_id,reason,priority,time:c.time});
  }
  candidates.sort((a,b)=>a.priority-b.priority||a.time-b.time||a.id-b.id);
  if(updated.length>65535)throw Error('Issue body exceeds API limit');
  return {body:updated,changed:updated!==body,hides:candidates.slice(0,50),skipped_hides:Math.max(candidates.length-50,0),active_fingerprints:[...active],investigation_count:investigations.length,rows};
}
