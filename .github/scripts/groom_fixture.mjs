import fs from 'node:fs';
export async function createGroomFixture({github,context}){
  if(context.repo.owner!=='mohanad-hafez'||context.repo.repo!=='dotnet-dashboard-groom')throw Error('Owned fixture target only');
  const {owner,repo}=context.repo,plan=JSON.parse(fs.readFileSync('.github/data/groom-fixture-input.json','utf8'));
  const marker='<!-- dashboard-check-01 -->',receipt={status:'reading',writes:[],input_kind:plan.input_kind};
  const checkpoint=()=>fs.writeFileSync('groom-fixture-result.json',JSON.stringify(receipt,null,2));checkpoint();
  const existing=await github.paginate(github.rest.issues.listForRepo,{owner,repo,state:'all',per_page:100});if(existing.some(i=>i.body?.includes(marker)))throw Error('Fixture already exists; do not repeat');
  async function write(kind,fn){receipt.status='delivery_pending';receipt.pending=kind;checkpoint();try{const r=await fn();receipt.writes.push({kind,status:'confirmed'});delete receipt.pending;receipt.status='working';checkpoint();return r;}catch(e){receipt.status='delivery_uncertain';receipt.error={kind,status:e.status,message:e.message};checkpoint();throw e;}}
  const issue=await write('create_dashboard',()=>github.rest.issues.create({owner,repo,title:plan.title,body:plan.body+marker+'\n',labels:['devops-health']}));receipt.issue={number:issue.data.number,url:issue.data.html_url,body:issue.data.body};checkpoint();
  receipt.comments=[];for(const body of plan.comments){const c=await write('create_bot_comment',()=>github.rest.issues.createComment({owner,repo,issue_number:issue.data.number,body}));receipt.comments.push({id:c.data.id,node_id:c.data.node_id,url:c.data.html_url,author:c.data.user.login,created_at:c.data.created_at,body:c.data.body});checkpoint();if(c.data.user.login!=='github-actions[bot]')throw Error('Expected actual bot-authored comment');}
  receipt.status='completed';checkpoint();
}
