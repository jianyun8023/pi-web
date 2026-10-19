import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { auditUpdate, auditStatus, mergeAuditRows, projectAuditBranch } = await jiti.import('./permission-audit.ts');
const { createPermissionAuditBridge } = await jiti.import('./permission-audit-bridge.ts');
const { buildSessionContext } = await jiti.import('./session-reader.ts');
const row = (overrides = {}) => ({ entry: {schemaVersion:1,eventId:'e',sessionId:'s',adjudicatorSessionId:'s',generationId:'g',anchorEntryId:'u',toolCallId:'t',parentToolCallId:null,requestId:'r',sequence:1,kind:'gate',phase:'started',occurredAt:'2026-10-20T00:00:00Z',request:{surface:'path_read',toolName:'read',targetSummary:'source.ts',matchedRule:'*',policyOrigin:'global'},...overrides},storage:'saved',live:true});
const final = {result:'allow',source:'reviewer',resolution:'authorizer_allowed',reasonSummary:'read-only'};
test('public packed schema rejects malformed events and strips arbitrary data', () => {
  assert.equal(auditUpdate({entry:{schemaVersion:2},storage:'saved'}),null);
  assert.equal(auditUpdate({...row(),storage:'unknown'}),null);
  const input=row({secret:'not-for-wire',request:{...row().entry.request,payload:'secret'}});
  const output=auditUpdate(input);
  assert.ok(output); assert.equal('secret' in output.entry,false); assert.equal('payload' in output.entry.request,false);
  assert.equal(auditUpdate(row({sequence:Infinity})),null);
  assert.equal(auditUpdate(row({phase:'resolved'})),null);
});
test('duplicate/reordered snapshots cannot replace final results or hide a storage error', () => {
  const done=row({phase:'resolved',sequence:3,final}); done.storage='error';
  const replay=row({phase:'reviewed',sequence:2,review:{outcome:'allow',reasonCode:'verdict',reasonSummary:'ok',model:'fixture',durationMs:10,attempts:1}});
  const restored={...done,live:false,storage:'saved'};
  const result=mergeAuditRows([done],[replay,restored,done]);
  assert.equal(result.length,1); assert.equal(result[0].entry.final.result,'allow'); assert.equal(result[0].storage,'error');
});
test('identities isolate concurrent sessions, reload generations and child tools', () => {
  const rows=mergeAuditRows([],[row(),row({sessionId:'other'}),row({generationId:'new'}),row({requestId:'child',toolCallId:'nested',parentToolCallId:'t'})]);
  assert.equal(rows.length,4); assert.equal(rows.find(r=>r.entry.requestId==='child').entry.parentToolCallId,'t');
});
test('pending persisted history is unknown until the active process replays it', () => {
  const pending=projectAuditBranch([{type:'custom',customType:'permission-audit/v1',data:row({phase:'awaiting_human'}).entry}]);
  assert.equal(auditStatus(pending[0]),'unknown');
  assert.equal(auditStatus(mergeAuditRows(pending,[row({phase:'awaiting_human'})])[0]),'waiting');
  assert.equal(auditStatus(row({phase:'resolved',final:{...final,result:'deny',resolution:'cancelled'}})),'cancelled');
});
test('active branch projection excludes abandoned records and never adds audit to model/chat messages', () => {
  const entries=[{type:'message',id:'u',parentId:null,timestamp:'2026-10-20',message:{role:'user',content:'inspect',timestamp:1}},
    {type:'custom',id:'a',parentId:'u',customType:'permission-audit/v1',data:row({phase:'resolved',final}).entry},
    {type:'custom',id:'b',parentId:'u',customType:'permission-audit/v1',data:row({requestId:'abandoned'}).entry}];
  const context=buildSessionContext(entries,'a');
  assert.equal(context.permissionAudit.length,1);assert.equal(context.permissionAudit[0].entry.requestId,'r');
  assert.equal(context.messages.length,1);assert.equal(context.messages[0].role,'user');
  assert.equal(buildSessionContext(entries,null).permissionAudit.length,0);
  assert.equal(buildSessionContext(entries,'b').permissionAudit[0].entry.requestId,'abandoned');
});
test('fork history retains original source identity without resurrecting a grant', () => {
  const record=row({phase:'resolved',final}).entry;
  const rows=projectAuditBranch([{type:'custom',customType:'permission-audit/v1',data:record}]);
  assert.equal(rows[0].entry.sessionId,'s');assert.equal(rows[0].live,false);
  assert.equal(Object.keys(rows[0]).some(k=>/token|consume|approve/.test(k)),false);
});
test('public bridge subscribes once on reload, replays latest state and unregisters on shutdown', () => {
  let listener;let disposals=0;const handlers=new Map();const updates=[];
  const pi={events:{on:(_name,fn)=>{listener=fn;return()=>{disposals++;listener=undefined;};}},on:(name,fn)=>handlers.set(name,fn)};
  const bridge=createPermissionAuditBridge();bridge.extension.factory(pi);
  listener(row());bridge.connect(r=>updates.push(r));
  listener(row({phase:'resolved',sequence:2,final}));
  assert.equal(bridge.snapshot().length,1);assert.equal(updates.length,2);
  bridge.extension.factory(pi);assert.equal(disposals,1);assert.equal(bridge.snapshot().length,0);
  handlers.get('session_shutdown')();assert.equal(disposals,2);assert.equal(listener,undefined);
});
test('large histories deduplicate per gate and preserve the full branch count', () => {
  const entries=Array.from({length:3000},(_,i)=>row({requestId:`r${Math.floor(i/3)}`,sequence:i%3+1,eventId:`e${i}`}));
  assert.equal(mergeAuditRows([],entries).length,1000);
});

test('real Pi SDK retains custom metadata but excludes it from model projection', async () => {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const manager = SessionManager.inMemory('/tmp/audit-model-context-fixture');
  manager.appendMessage({role:'user',content:'inspect only',timestamp:1});
  manager.appendCustomEntry('permission-audit/v1',row({phase:'resolved',final}).entry);
  assert.equal(manager.getEntries().filter(e=>e.type==='custom').length,1);
  assert.equal(manager.buildContextEntries().some(e=>e.type==='custom'),true); // raw entries are not the model projection
  assert.equal(JSON.stringify(manager.buildSessionProjection().messages).includes('permission-audit'),false);
});
