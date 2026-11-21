import{registerHooks}from'node:module';import{readFile,writeFile}from'node:fs/promises';import{parseEnv}from'node:util';import{resolve,extname}from'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!extname(s)){try{return next(s+'.ts',c)}catch{}}return next(s,c)}});
const{analyzeFoundryProduct,applyFoundryAnalysis}=await import('../../server/foundry.ts');
const output=resolve(process.argv[2]??'experiments/product/output');
// Credentials stay in this process; stdout/reporting contains only validated evidence.
const envPath=process.env.ROOMSHIFT_ENV_FILE??resolve('..','.env');let fileEnv={};try{fileEnv=parseEnv(await readFile(envPath,'utf8'))}catch{}
const config={...fileEnv,...process.env};const token=config.LLMFOUNDRY_TOKEN??config.LLMFOUNDRY_API_KEY??config.API_KEY;
if(!token)throw Error('Foundry is not configured for this local worker.');
const run=promisify(execFile),python=resolve('.local-3d/runtime/bin/python');
const{stdout}=await run(python,['scripts/experiments/prepare-vision.py',output],{maxBuffer:160000});const photos=JSON.parse(stdout);const images=await Promise.all(photos.map(async p=>({id:p.id,mime:p.mime,base64:(await readFile(p.file)).toString('base64')})));
const product=JSON.parse(await readFile(resolve(output,'product.json'),'utf8'));
const result=await analyzeFoundryProduct({product,images,onOperation:async operation=>{await writeFile(resolve(output,'foundry-analysis.json'),JSON.stringify({operation},null,2));}},{token,baseUrl:config.LLMFOUNDRY_BASE_URL??config.FOUNDRY_BASE_URL,model:config.LLMFOUNDRY_MODEL??'gemini-2.5-flash',project:'roomshift-studio'});
const next=applyFoundryAnalysis(product,result.analysis);await writeFile(resolve(output,'foundry-analysis.json'),JSON.stringify(result,null,2));await writeFile(resolve(output,'product.json'),JSON.stringify(next,null,2));
console.log(JSON.stringify({model:result.operation.model,selectedImageId:result.analysis.selectedImageId,pose:result.analysis.pose,dimensions:result.analysis.dimensions,warnings:result.analysis.warnings,usage:result.operation.usage,elapsedMs:result.operation.timing.elapsedMs}));
