// Tests an isolated Pi Web fixture server through its real RPC + SSE APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:30142', workspace=process.argv[3]??'/tmp/pi-permission-delivery/browser-agent/workspace';
if(!base.startsWith('http://127.0.0.1:') || !/^\/(?:private\/)?tmp\//.test(workspace))throw Error('Only isolated local fixture environments are supported');
const req=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(`${r.status} ${JSON.stringify(result)}`);return result;};
const wait=async(test,label)=>{for(let i=0;i<500;i++){if(test())return;await new Promise(r=>setTimeout(r,20));}throw Error(`Timeout: ${label}`);};
async function stream(id){const controller=new AbortController(),events=[];const response=await fetch(`${base}/api/agent/${id}/events`,{signal:controller.signal});const task=(async()=>{let buffer='';for await(const chunk of response.body){buffer+=new TextDecoder().decode(chunk);let end;while((end=buffer.indexOf('\n\n'))>=0){const record=buffer.slice(0,end);buffer=buffer.slice(end+2);for(const line of record.split('\n'))if(line.startsWith('data: ')){try{events.push(JSON.parse(line.slice(6)));}catch{}}}}})().catch(()=>{});return{events,close(){controller.abort();},task};}
const report=[];
for(const outcome of ['allow','defer','deny','offline','timeout','cancel']){
 const created=await req('/api/agent/new',{cwd:workspace,type:'ensure_session',toolNames:['write']}),id=created.sessionId;
 const s=await stream(id),command=body=>req('/api/agent/'+id,body);
 const start=Date.now();await command({type:'prompt',message:`${outcome==='cancel'?'defer':outcome}: perform the isolated fixture write only.`});
 if(outcome==='cancel') {await wait(()=>s.events.some(e=>e.type==='permission_audit'&&e.update.entry.phase==='started'),'review started');await command({type:'abort'});}
 else if(['defer','offline','timeout'].includes(outcome)){
  await wait(()=>s.events.some(e=>e.method==='select'),'human prompt');
  const first=s.events.findIndex(e=>e.method==='select'),review=s.events.findIndex(e=>e.type==='permission_audit'&&e.update.entry.phase==='reviewed');
  assert.ok(review>=0&&review<first,`${outcome}: human prompt followed review`);
  const prompt=s.events[first];s.close();const resumed=await stream(id);await wait(()=>resumed.events.some(e=>e.id===prompt.id),'same prompt reconnected');
  assert.ok(resumed.events.some(e=>e.type==='permission_audit'&&e.update.entry.phase==='awaiting_human'),'pending audit replayed');
  const response={type:'extension_ui_response',id:prompt.id,value:outcome==='defer'?'Yes':'No'};
  await Promise.all([command(response),command(response)]);await command(response); // second tab + stale response
  s.events.push(...resumed.events);s.resume=resumed;
 }
 await wait(()=>s.events.some(e=>e.type==='agent_end')||s.resume?.events.some(e=>e.type==='agent_end'),'run finished');
 const context=(await req('/api/sessions/'+id+'/context')).context;
 const rows=context.permissionAudit??[],tool=rows.filter(r=>r.entry.kind==='tool');
 assert.equal(tool.length,1,`${outcome}: one tool permission summary`);
 assert.equal(tool[0].entry.final.result,['allow','defer'].includes(outcome)?'allow':'deny');
 assert.ok(!context.messages.some(m=>m.customType==='permission-audit/v1'));
 const all=[...s.events,...(s.resume?.events??[])];
 if(['allow','deny','cancel'].includes(outcome))assert.equal(all.filter(e=>e.method==='select').length,0);
 const reviewed=rows.find(r=>r.entry.review);
 if(outcome==='offline')assert.equal(reviewed.entry.review.reasonCode,'review_unavailable');
 if(outcome==='timeout')assert.equal(reviewed.entry.review.reasonCode,'review_timeout');
 const oldGeneration=tool[0].entry.generationId;await command({type:'reload'});
 const refreshed=(await req('/api/sessions/'+id+'/context')).context.permissionAudit;
 assert.equal(refreshed.find(r=>r.entry.kind==='tool').entry.generationId,oldGeneration);
 s.close();s.resume?.close();
 report.push({outcome,sessionId:id,pass:true,gateCount:rows.filter(r=>r.entry.kind==='gate').length,durationMs:Date.now()-start});
 console.log(JSON.stringify(report.at(-1)));
}
fs.writeFileSync(process.argv[4]??'/tmp/pi-permission-runtime-proof.json',JSON.stringify(report,null,2)+'\n');
