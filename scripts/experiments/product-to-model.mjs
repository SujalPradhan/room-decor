// Experimental local pipeline. No API keys, cloud job, or room-layout changes.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const url=process.argv[2];if(!url)throw Error('Pass a supported product URL. See docs/RECLINER_EXPERIMENT.md for local setup.');
const output=resolve(process.argv[3]??'experiments/product/output'),python=resolve('.local-3d/runtime/bin/python'),source=resolve('.local-3d/TripoSR');
if(!existsSync(python)||!existsSync(source))throw Error('Local inference dependencies are missing. Follow docs/RECLINER_EXPERIMENT.md first.');
await mkdir(output,{recursive:true});const started=performance.now();
async function run(command,args){const p=spawn(command,args,{stdio:'inherit'});const code=await new Promise((done,reject)=>{p.once('error',reject);p.once('exit',done)});if(code!==0)throw Error(`${command} failed (${code}). Your intermediate outputs remain in ${output}.`)}
await run(process.execPath,['--experimental-transform-types','scripts/experiments/read-product.mjs',url,output]);
const product=JSON.parse(await readFile(resolve(output,'product.json'),'utf8'));
if(!['width','depth','height'].every(a=>product.dimensions[a].metres>0))throw Error('The listing has incomplete outer dimensions. Review its specifications before metric conversion.');
const extraction=JSON.parse(await readFile(resolve(output,'extraction-report.json'),'utf8'));const first=extraction.photos[0];if(!first)throw Error('The listing has no supported reference image.');
await run(python,['scripts/experiments/run-triposr.py','--input',resolve(output,first.file),'--output',output]);
await run('blender',['--background','--python','scripts/experiments/prepare-recliner.blender.py','--',output]);
const generation=JSON.parse(await readFile(resolve(output,'generation-report.json'),'utf8')),conversion=JSON.parse(await readFile(resolve(output,'conversion-report.json'),'utf8'));
await writeFile(resolve(output,'pipeline-report.json'),JSON.stringify({source:url,title:product.title,extraction,generation,conversion,totalSeconds:(performance.now()-started)/1000,providerCharge:0,output:resolve(output,'snuzspace-recliner-experimental.glb'),limitations:['Single-image reconstruction; not guaranteed hidden-surface accuracy.','Listing measurements are not independently verified.','This local experiment is not a public inference service.','The experiment uses the first gallery photo, not a proven general image selector.']},null,2));
console.log('Experimental model and stage reports:',output);
