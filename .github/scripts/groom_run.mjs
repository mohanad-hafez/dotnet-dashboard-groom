import fs from 'node:fs';
import crypto from 'node:crypto';
import {planGroom} from './groom_dashboard.mjs';
export async function runGroom({github,context}){
  if(context.repo.owner!=='mohanad-hafez'||context.repo.repo!=='dotnet-dashboard-groom')throw Error('Owned target only');
  const {owner,repo}=context.repo;
  const receipt={run_id:context.runId,status:'reading',writes:[],source_variant:'affe68b0_four_columns_resolved_rows_retained'};
  const checkpoint=()=>fs.writeFileSync('groom-result.json',JSON.stringify(receipt,null,2));checkpoint();
  const write=async(kind,fn)=>{receipt.status='delivery_pending';receipt.pending=kind;checkpoint();try{const r=await fn();receipt.writes.push({kind,status:'confirmed'});delete receipt.pending;receipt.status='working';checkpoint();return r;}catch(e){receipt.status='delivery_uncertain';receipt.error={kind,status:e.status,message:e.message};checkpoint();throw e;}};
  try{
    const list=await github.rest.issues.listForRepo({owner,repo,labels:'devops-health',state:'open',sort:'created',direction:'desc',per_page:5});
    const selected=list.data.find(i=>!i.pull_request);if(!selected){receipt.status='noop';receipt.reason='No health dashboard issue found';checkpoint();return;}
    const issue=(await github.rest.issues.get({owner,repo,issue_number:selected.number})).data;
    receipt.issue={number:issue.number,url:issue.html_url};
    const since=new Date(Date.now()-30*86400000).toISOString();
    const comments=await github.paginate(github.rest.issues.listComments,{owner,repo,issue_number:issue.number,per_page:100,since});
    const bot=comments.filter(c=>c.user?.login==='github-actions[bot]');
    for(let i=0;i<bot.length;i+=50){const ids=bot.slice(i,i+50).map(c=>c.node_id);const graph=await github.graphql('query($ids:[ID!]!){nodes(ids:$ids){... on IssueComment{id isMinimized}}}',{ids});for(const c of bot.slice(i,i+50)){const node=graph.nodes.find(n=>n?.id===c.node_id);if(!node)throw Error('Missing comment minimization state');c.isMinimized=node.isMinimized;}}
    const plan=planGroom(issue.body??'',bot);
    receipt.before_sha256=crypto.createHash('sha256').update(issue.body??'').digest('hex');receipt.plan={changed:plan.changed,hides:plan.hides,skipped_hides:plan.skipped_hides,active_fingerprints:plan.active_fingerprints,investigation_count:plan.investigation_count,rows:plan.rows};receipt.input={issue,comments,scan_since:since,captured_at:new Date().toISOString()};checkpoint();
    if(plan.changed){const current=await github.rest.issues.get({owner,repo,issue_number:issue.number});if(current.data.body!==issue.body)throw Error('Concurrent issue update; inspect before reprocessing');await write('replace_investigation_island',()=>github.rest.issues.update({owner,repo,issue_number:issue.number,body:plan.body}));}
    for(const hide of plan.hides){await write('hide_comment_'+hide.id,()=>github.graphql('mutation($id:ID!,$reason:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$reason}){minimizedComment{isMinimized minimizedReason}}}',{id:hide.node_id,reason:hide.reason}));}
    const after=(await github.rest.issues.get({owner,repo,issue_number:issue.number})).data;
    if(after.body!==plan.body)throw Error('Issue body readback mismatch');
    receipt.after_sha256=crypto.createHash('sha256').update(after.body).digest('hex');receipt.after={body:after.body,updated_at:after.updated_at};receipt.status=receipt.writes.length?'completed':'noop';checkpoint();
  }catch(e){if(!['delivery_uncertain','delivery_pending'].includes(receipt.status)){receipt.status='inspection_error';receipt.error={status:e.status,message:e.message};checkpoint();}throw e;}
}
