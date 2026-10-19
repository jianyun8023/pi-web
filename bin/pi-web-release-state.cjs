/* eslint-disable @typescript-eslint/no-require-imports -- Node deployment helper. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const save=state=>{const file=path.join(state.backup,'transaction.json');fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
function prepare(backup,changes){
 fs.mkdirSync(backup,{recursive:true,mode:0o700});
 if(exists(path.join(backup,'transaction.json')))throw Error('Backup already has a transaction');
 const seen=new Set();
 const entries=changes.map(({target,replacement},i)=>{
  if(!path.isAbsolute(target)||!path.isAbsolute(replacement)||target===replacement||seen.has(target)||!exists(replacement))throw Error('Invalid release transaction');
  seen.add(target);return{target,replacement,saved:path.join(backup,`original-${i}`),failed:path.join(backup,`replaced-${i}`),hadOriginal:exists(target),restored:false};
 });
 const state={schemaVersion:1,backup,phase:'prepared',entries};save(state);return state;
}
function rollback(state){
 for(const entry of [...state.entries].reverse()){
  if(entry.restored)continue;
  if(exists(entry.saved)){
   if(exists(entry.target))fs.renameSync(entry.target,entry.failed);
   fs.renameSync(entry.saved,entry.target);
  }else if(!entry.hadOriginal&&!exists(entry.replacement)&&exists(entry.target))fs.renameSync(entry.target,entry.failed);
  entry.restored=true;save(state);
 }
 state.phase='rolled_back';save(state);return state;
}
function apply(state,afterEach=()=>{}){
 if(state.phase!=='prepared')throw Error('Release transaction already used');
 state.phase='applying';save(state);
 try{
  for(const entry of state.entries){
   if(entry.hadOriginal)fs.renameSync(entry.target,entry.saved);
   fs.renameSync(entry.replacement,entry.target);afterEach(entry);
  }
  state.phase='applied';save(state);return state;
 }catch(error){rollback(state);throw error;}
}
function load(backup){const state=JSON.parse(fs.readFileSync(path.join(backup,'transaction.json'),'utf8'));if(state.schemaVersion!==1||state.backup!==backup)throw Error('Invalid release journal');return state;}
module.exports={prepare,apply,rollback,load};
