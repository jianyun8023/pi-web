// Creates an isolated agent with a deterministic provider; no external model call.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),agent=path.resolve(process.argv[2]??'/tmp/pi-permission-delivery/browser-agent');
if(!/^\/(?:private\/)?tmp\//.test(agent))throw Error('Fixture agent must be under /tmp');
if(fs.existsSync(path.join(agent,'settings.json')))throw Error('Choose a new fixture directory');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/permission-bundle.json')));
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2));};
save(agent+'/settings.json',{packages:Object.entries(manifest.packages).map(([name,spec])=>name.includes('auto-review')?{source:`npm:${name}@${spec.version}`,extensions:[]}:`npm:${name}@${spec.version}`),defaultProvider:'permission-fixture',defaultModel:'reviewer-fixture',defaultThinkingLevel:'off',defaultTools:['write'],extensions:[agent+'/fixture.ts']});
createRequire(import.meta.url)('../bin/pi-web-fork-packages.cjs').install(agent,root,{cache:'/tmp/pi-npm-cache'});
const workspace=path.join(agent,'workspace');fs.mkdirSync(workspace,{recursive:true});
save(agent+'/extensions/pi-permission-system/config.json',{permissionReviewLog:false,authorizerChain:['pi-auto-review'],permission:{'*':'allow',bash:{'*':'ask'},write:'allow',path_write:{'*':'ask'},external_directory:{'*':'allow'}}});
const fixture=fs.readFileSync(path.join(root,'scripts/fixtures/permission-provider.ts.txt'),'utf8').replace('__FAUX_IMPORT__',JSON.stringify(path.join(root,'node_modules/@earendil-works/pi-ai/dist/providers/faux.js'))).replace('__REVIEWER_IMPORT__',JSON.stringify(path.join(agent,'npm/node_modules/@erichll/pi-auto-review/src/index.ts'))).replace('__WORKSPACE__',JSON.stringify(workspace));
fs.writeFileSync(agent+'/fixture.ts',fixture);console.log(agent);
