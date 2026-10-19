import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
const require=createRequire(import.meta.url), {verify,configured,install}=require('../bin/pi-web-fork-packages.cjs');
const root=path.resolve(import.meta.dirname,'..');
const manifestFile=path.join(root,'vendor/permission-bundle.json');
const manifest=JSON.parse(fs.readFileSync(manifestFile));
function fixture(t){const agent=fs.mkdtempSync(path.join(os.tmpdir(),'pi-bundle-check-'));t.after(()=>fs.rmSync(agent,{recursive:true,force:true}));
 fs.writeFileSync(path.join(agent,'settings.json'),JSON.stringify({packages:Object.entries(manifest.packages).map(([name,spec])=>`npm:${name}@${spec.version}`)}));
 for(const [name,spec] of Object.entries(manifest.packages)){const destination=path.join(agent,'npm/node_modules',name);fs.mkdirSync(destination,{recursive:true});execFileSync('tar',['-xzf',path.join(root,spec.archive),'-C',destination,'--strip-components=1']);}
 for(const name of ['pi-ai','pi-coding-agent','pi-tui']){const destination=path.join(agent,'npm/permission-fork-runtime/node_modules/@earendil-works',name);fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify({version:manifest.piSdk}));}
 for(const name of Object.keys(manifest.packages)){const installed=path.join(agent,'npm/node_modules',name),runtime=path.join(agent,'npm/permission-fork-runtime/node_modules');fs.symlinkSync(path.relative(installed,runtime),path.join(installed,'node_modules'));const alias=path.join(runtime,name);fs.mkdirSync(path.dirname(alias),{recursive:true});fs.symlinkSync(path.relative(path.dirname(alias),installed),alias);}
 return agent;
}
test('packed fork files verify and same-version source replacement is rejected',t=>{const agent=fixture(t);assert.equal(verify(agent,root).piSdk,'1.3.0');
 const file=path.join(agent,'npm/node_modules/@erichll/pi-auto-review/src/index.ts');fs.appendFileSync(file,'\n// same version, different code\n');assert.throws(()=>verify(agent,root),/integrity mismatch/);
});
test('additional executable sources cannot evade the file manifest',t=>{const agent=fixture(t);fs.writeFileSync(path.join(agent,'npm/node_modules/@gotgenes/pi-permission-system/src/unlisted.ts'),'');assert.throws(()=>verify(agent,root),/Unrecognized permission source/);});
test('the runtime version must match the tested Pi SDK combination',t=>{const agent=fixture(t);fs.writeFileSync(path.join(agent,'npm/permission-fork-runtime/node_modules/@earendil-works/pi-ai/package.json'),JSON.stringify({version:'1.4.0'}));assert.throws(()=>verify(agent,root),/runtime mismatch/);});
test('duplicate and path-overridden engines are diagnosed before startup',t=>{const agent=fixture(t),file=path.join(agent,'settings.json'),settings=JSON.parse(fs.readFileSync(file));settings.packages.push({source:settings.packages[0]});fs.writeFileSync(file,JSON.stringify(settings));assert.throws(()=>verify(agent,root),/exactly one/);
 settings.packages.pop();settings.extensions=['/tmp/pi-permission-system/src/index.ts'];assert.throws(()=>configured(agent,settings),/duplicate extension paths/);
 settings.extensions=[];settings.packages[0]=path.join(agent,'npm/node_modules/@gotgenes/pi-permission-system');fs.writeFileSync(file,JSON.stringify(settings));assert.throws(()=>verify(agent,root),/local source overrides/);
});
test('archive hash failure is detected before npm can mutate the installation',t=>{const agent=fixture(t),release=fs.mkdtempSync(path.join(os.tmpdir(),'pi-bundle-bad-'));t.after(()=>fs.rmSync(release,{recursive:true,force:true}));fs.cpSync(path.join(root,'vendor'),path.join(release,'vendor'),{recursive:true});const archive=Object.values(manifest.packages)[0].archive;fs.appendFileSync(path.join(release,archive),'bad');const before=fs.readFileSync(path.join(agent,'settings.json'));assert.throws(()=>install(agent,release),/archive integrity mismatch/);assert.deepEqual(fs.readFileSync(path.join(agent,'settings.json')),before);verify(agent,root);});

test('the complete runtime moves with an agent without changing other SDK dependencies',t=>{const agent=fixture(t),rootPackage=path.join(agent,'npm/node_modules/@earendil-works/pi-ai/package.json');fs.mkdirSync(path.dirname(rootPackage),{recursive:true});fs.writeFileSync(rootPackage,JSON.stringify({version:'0.84.4'}));const moved=agent+'-relocated';fs.renameSync(agent,moved);t.after(()=>fs.rmSync(moved,{recursive:true,force:true}));verify(moved,root);assert.equal(JSON.parse(fs.readFileSync(path.join(moved,'npm/node_modules/@earendil-works/pi-ai/package.json'))).version,'0.84.4');});
