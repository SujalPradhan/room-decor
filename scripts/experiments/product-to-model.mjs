// Local pipeline: Foundry evidence review, local inference, and a reviewable GLB.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
const url=process.argv[2];if(!url)throw Error('Pass a supported product URL. See docs/RECLINER_EXPERIMENT.md for local setup.');
const output=resolve(process.argv[3]??'experiments/product/output'),python=resolve('.local-3d/runtime/bin/python'),source=resolve('.local-3d/TripoSR');
if(!existsSync(python)||!existsSync(source))throw Error('Local inference dependencies are missing. Follow docs/RECLINER_EXPERIMENT.md first.');
await mkdir(output,{recursive:true});const started=performance.now();
const stage=name=>console.log('ROOMSHIFT_STAGE '+JSON.stringify({stage:name}));
async function run(command,args){const p=spawn(command,args,{stdio:'inherit'});const code=await new Promise((done,reject)=>{p.once('error',reject);p.once('exit',done)});if(code!==0)throw Error(`${command} could not finish. Your intermediate outputs remain in ${output}.`)}
const inputIndex=process.argv.indexOf('--product-file'),inputArgs=inputIndex>=0?['--product-file',resolve(process.argv[inputIndex+1])]:[];
stage('reading');await run(process.execPath,['--experimental-transform-types','scripts/experiments/read-product.mjs',url,output,...inputArgs]);
let config={};try{config=parseEnv(await readFile(process.env.ROOMSHIFT_ENV_FILE??resolve('..','.env'),'utf8'))}catch{}
config={...config,...process.env};let foundry=null;
if((config.LLMFOUNDRY_TOKEN||config.LLMFOUNDRY_API_KEY||config.API_KEY)&&config.ROOMSHIFT_USE_FOUNDRY!=='false'){
 stage('analyzing');await run(process.execPath,['--experimental-transform-types','scripts/experiments/analyze-product.mjs',output]);foundry=JSON.parse(await readFile(resolve(output,'foundry-analysis.json'),'utf8'));
}
const product=JSON.parse(await readFile(resolve(output,'product.json'),'utf8'));
if(!['width','depth','height'].every(a=>product.dimensions[a].metres>0))throw Error('The listing still has incomplete outer dimensions. Review its specifications before metric conversion.');
const extraction=JSON.parse(await readFile(resolve(output,'extraction-report.json'),'utf8'));
const selectedIndex=product.images.findIndex(i=>i.id===product.selectedImageId),photo=extraction.photos.find(p=>p.id===product.selectedImageId)??extraction.photos[selectedIndex>=0?selectedIndex:0];if(!photo)throw Error('The selected product reference image is unavailable.');
stage('preparing');const crop=foundry?.analysis?.cropBox;await run(python,['scripts/experiments/run-triposr.py','--input',resolve(output,photo.file),'--output',output,...(crop?.length===4?['--crop',...crop.map(String)]:[])]);
stage('converting');await run('blender',['--background','--python','scripts/experiments/prepare-recliner.blender.py','--',output]);
const generation=JSON.parse(await readFile(resolve(output,'generation-report.json'),'utf8')),conversion=JSON.parse(await readFile(resolve(output,'conversion-report.json'),'utf8'));
await writeFile(resolve(output,'pipeline-report.json'),JSON.stringify({source:url,title:product.title,extraction,foundry,generation,conversion,totalSeconds:(performance.now()-started)/1000,providerCharge:foundry?null:0,output:resolve(output,'snuzspace-recliner-experimental.glb'),limitations:['Single-image reconstruction; hidden surfaces are inferred.','Listing and image measurements are not independently verified.','Local 3D inference uses no paid 3D API; Foundry review has separately recorded token usage and unreconciled account cost.']},null,2));
stage('ready');console.log('Product model and stage reports:',output);
