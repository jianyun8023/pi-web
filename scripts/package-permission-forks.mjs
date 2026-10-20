// Build immutable npm artifacts from the two narrow forks. No registry publication.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const roots=process.argv.slice(2);
if(roots.length!==2)throw Error('Usage: node scripts/package-permission-forks.mjs PERMISSION_PACKAGE REVIEWER_PACKAGE');
const root=process.cwd(), vendor=path.join(root,'vendor');fs.mkdirSync(vendor,{recursive:true});
const manifest={schemaVersion:1,piSdk:'1.3.0',packages:{}};
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
for(const input of roots){
 const cwd=path.resolve(input),pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json')));
 const permission=pkg.name==='@gotgenes/pi-permission-system';
 const output=JSON.parse(execFileSync(permission?'pnpm':'npm',['pack',...(permission?[]:['--ignore-scripts']),'--json','--pack-destination',vendor],{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:'/tmp/pi-npm-cache'}}));
 const packed=Array.isArray(output)?output[0]:{...output,filename:path.basename(output.filename)};
 const archive=path.join(vendor,packed.filename),unpacked=fs.mkdtempSync(path.join(os.tmpdir(),'pi-fork-pack-'));
 try{execFileSync('tar',['-xzf',archive,'-C',unpacked]);const files={};for(const entry of packed.files){files[entry.path]=hash(fs.readFileSync(path.join(unpacked,'package',entry.path)));}
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
 manifest.packages[pkg.name]={version:pkg.version,repository:pkg.piWebFork.repository,revision,archive:path.relative(root,archive),sha256:hash(fs.readFileSync(archive)),files};
 }finally{fs.rmSync(unpacked,{recursive:true,force:true});}
}
fs.writeFileSync(path.join(vendor,'permission-bundle.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(manifest.packages).map(([name,p])=>[name,{version:p.version,revision:p.revision,sha256:p.sha256}]))));
