import fs from 'node:fs';
import assert from 'node:assert/strict';
import {planGroom} from './groom_dashboard.mjs';
const {inputs}=JSON.parse(fs.readFileSync('groom.json','utf8'));
const result=planGroom(inputs.dashboard,inputs.comments,new Date(inputs.clock));
assert.equal(result.changed,true);
assert.deepEqual(result.hides,[]);
if(process.env.ARM==='agent'){
  const calls=fs.readFileSync('evidence/tools.jsonl','utf8').trim().split('\n').map(JSON.parse);
  assert(calls.every(row=>!row.error));
  assert.deepEqual([...new Set(calls.slice(0,-1).map(row=>row.args.name))].sort(),['clock','comments','dashboard']);
  assert.equal(calls.at(-1).name,'publish_result');
  const proposal=JSON.parse(calls.at(-1).args.body);
  assert.deepEqual(proposal.rows,result.rows);
  assert.deepEqual(proposal.hides,[]);
}
fs.writeFileSync('evidence/result.json',JSON.stringify({body:result.body,rows:result.rows,hides:result.hides}));
