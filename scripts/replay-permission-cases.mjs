// Review-only: represented commands and file operations are never executed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { ModelRuntime, ModelRegistry } from '@earendil-works/pi-coding-agent';
const args=process.argv.slice(2), value=name=>args[args.indexOf(name)+1];
for(const name of ['--reviewer','--baseline','--models','--config','--output']) if(!args.includes(name))throw Error(`Missing ${name}`);
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@earendil-works/pi-ai/compat':fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/compat'))}});
const current=path.resolve(value('--reviewer')), baseline=path.resolve(value('--baseline'));
const { complete }=await jiti.import(path.join(current,'src/review/complete.ts'));
const { complete: before }=await jiti.import(path.join(baseline,'src/review/complete.ts'));
const { DEFAULT_CONFIG }=await jiti.import(path.join(current,'src/review/config.ts'));
const config={...DEFAULT_CONFIG,...JSON.parse(fs.readFileSync(value('--config'),'utf8'))};
const credentials={read:async()=>undefined,list:async()=>[],modify:async()=>{throw Error('Review-only fixture');},delete:async()=>{throw Error('Review-only fixture');}};
const runtime=await ModelRuntime.create({credentials,modelsStorePath:value('--models'),allowModelNetwork:false});
const cases=JSON.parse(fs.readFileSync(path.join(current,'test/fixtures/local-review-cases.json'),'utf8'));
const registry=new ModelRegistry(runtime), results=[];
const roots=['/home/operator/Developer/project/github/operator/pi-web','/home/operator/.pi/agent/npm/node_modules/@erichll/pi-auto-review/src','/home/operator/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system/src'];
const variants=[...cases.map(c=>({c,variant:'current',repeat:1})),...cases.filter(c=>c.baseline.outcome==='defer').flatMap(c=>Array.from({length:3},(_,i)=>({c,variant:'baseline',repeat:i+1}))),...cases.filter(c=>c.baseline.outcome==='defer').flatMap(c=>Array.from({length:2},(_,i)=>({c,variant:'current',repeat:i+2})))];
for(const {c,variant,repeat} of variants){
 const ctx={modelRegistry:registry,sessionManager:{getSessionId:()=>`permission-replay-${c.id}-${variant}-${repeat}`,buildContextEntries:()=>[{type:'message',id:'user',message:{role:'user',content:c.userIntent,timestamp:Date.now()}}]}};
 const request={...Object.fromEntries(Object.entries(c.request).filter(([,v])=>v!==null)),...(c.id==='local-04'?{fullCommandTruncated:true}:{}),...(variant==='current'?{reviewEnvironment:{source:'host-observed',authorization:'none',cwd:c.request.cwd,installations:[{packageName:'@agegr/pi-web',root:roots[0]},{packageName:'@erichll/pi-auto-review',root:roots[1].replace(/\/src$/,'')},{packageName:'@gotgenes/pi-permission-system',root:roots[2].replace(/\/src$/,'')}],configuredReadRoots:roots}}:{})};
 try{const r=await (variant==='current'?complete:before)(ctx,config,request);results.push({id:c.id,variant,repeat,expected:c.expected,outcome:r.decision.outcome,reason:r.decision.rationale,durationMs:r.durationMs,attempts:r.attempts,usage:r.usage});}
 catch(error){results.push({id:c.id,variant,repeat,expected:c.expected,error:error.errorClass??error.name,detail:String(error.message).slice(0,200)});}
 fs.writeFileSync(value('--output'),JSON.stringify({model:config.model,note:'De-identified review-only replay with reconstructed user intent. Three samples per defer case per variant; not a proof of safety.',results},null,2)+'\n');
 console.log(JSON.stringify({completed:results.length,total:variants.length,...results.at(-1),reason:undefined,usage:undefined}));
}
