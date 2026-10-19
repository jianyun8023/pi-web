import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
const {prepare,apply,rollback,load}=createRequire(import.meta.url)('../bin/pi-web-release-state.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const changes=['npm','config','link'].map((name,i)=>{const target=path.join(root,name),replacement=path.join(root,name+'-new');
 if(i===0){fs.mkdirSync(target);fs.writeFileSync(target+'/package.json','old');fs.mkdirSync(replacement);fs.writeFileSync(replacement+'/package.json','new');}
 else if(i===1){fs.writeFileSync(target,'old');fs.writeFileSync(replacement,'new');}
 else{fs.symlinkSync('old-release',target);fs.symlinkSync('new-release',replacement);}return{target,replacement};});
 return{root,changes,backup:root+'/backup'};}
function old(f){assert.equal(fs.readFileSync(f.root+'/npm/package.json','utf8'),'old');assert.equal(fs.readFileSync(f.root+'/config','utf8'),'old');assert.equal(fs.readlinkSync(f.root+'/link'),'old-release');}
test('complete package/config/link combination can be rolled back repeatedly',t=>{const f=fixture(t);apply(prepare(f.backup,f.changes));assert.equal(fs.readFileSync(f.root+'/npm/package.json','utf8'),'new');assert.equal(fs.readlinkSync(f.root+'/link'),'new-release');rollback(load(f.backup));old(f);rollback(load(f.backup));old(f);});
test('failure halfway through deployment restores every previous artifact',t=>{const f=fixture(t);let n=0;assert.throws(()=>apply(prepare(f.backup,f.changes),()=>{if(++n===2)throw Error('injected');}),/injected/);old(f);assert.equal(load(f.backup).phase,'rolled_back');});
test('crash between backup and replacement can be recovered from journal',t=>{const f=fixture(t),state=prepare(f.backup,f.changes);fs.renameSync(state.entries[0].target,state.entries[0].saved);rollback(load(f.backup));old(f);});
