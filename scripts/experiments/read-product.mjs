// Node 24: node --experimental-transform-types scripts/experiments/read-product.mjs <product-url> [output-directory]
import {registerHooks} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {performance} from 'node:perf_hooks';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&!extname(specifier)){try{return next(`${specifier}.ts`,context)}catch{}}return next(specifier,context)}});
const {resolveProduct,readBounded,normalizeRetailerUrl}=await import('../../server/retailers.ts');
const {validateProductDraft}=await import('../../src/product-domain.ts');
const url=process.argv[2];if(!url)throw Error('Pass an Amazon India or Flipkart product URL.');
const output=resolve(process.argv[3]??'experiments/product/output');await mkdir(output,{recursive:true});
const started=performance.now();let requested;
const inputIndex=process.argv.indexOf('--product-file');
if(inputIndex>=0){
 requested=validateProductDraft(JSON.parse(await readFile(resolve(process.argv[inputIndex+1]),'utf8')));
 const source=requested.source.canonicalUrl??requested.source.submittedUrl;
 if(!source||normalizeRetailerUrl(source).url.href!==normalizeRetailerUrl(url).url.href)throw Error('The requested product link changed.');
}
// The queue already holds the just-read listing. Reuse its bounded evidence
// instead of fetching the storefront twice for the same explicit request.
const hasListing=requested?.images.some(i=>i.source==='listing');
const result=hasListing?{product:requested}:await resolveProduct({url,roomId:'local-product-experiment'});
let product=result.product;
if(requested){
 const listingImages=product.images.filter(i=>i.source==='listing');
 product={...product,id:requested.id,roomId:requested.roomId,revision:requested.revision,createdAt:requested.createdAt,title:requested.title||product.title,kind:requested.kind??product.kind,variant:requested.variant||product.variant,images:listingImages,selectedImageId:listingImages.some(i=>i.id===requested.selectedImageId)?requested.selectedImageId:listingImages[0]?.id,dimensions:Object.fromEntries(['width','depth','height'].map(a=>[a,requested.dimensions[a].origin==='user'?requested.dimensions[a]:product.dimensions[a]])),model:{state:'proxy',appearance:'size-preview',draftRevision:requested.revision}};
}
const readMs=performance.now()-started;
await writeFile(resolve(output,'product.json'),JSON.stringify(product,null,2));
const photos=[];for(const [index,image]of product.images.entries()){
 const start=performance.now();let source=new URL(image.url);
 // Product-image allowlist is rechecked at each redirect, including on this local runner.
 for(let attempt=0;attempt<4;attempt++){
  if(source.protocol!=='https:'||source.username||source.password||source.port||!(/(^|\.)flixcart\.com$|(^|\.)media-amazon\.com$|(^|\.)ssl-images-amazon\.com$/.test(source.hostname)))throw Error('Unsupported image source.');
  const response=await fetch(source,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(response.status)){const target=response.headers.get('location');if(!target)throw Error('Image redirect is incomplete.');source=new URL(target,source);continue;}
  if(!response.ok)throw Error(`Image unavailable (${response.status}).`);
  const mime=response.headers.get('Content-Type')?.split(';')[0],extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];if(!extension)throw Error('Unsupported image type.');
  const bytes=await readBounded(response,8_000_000),file=`photo-${index+1}.${extension}`;await writeFile(resolve(output,file),bytes);photos.push({id:image.id,source:image.url,file,bytes:bytes.length,elapsedMs:performance.now()-start});break;
 }
}
const report={input:url,title:product.title,variant:product.variant,dimensions:product.dimensions,imageCount:photos.length,photos,notice:result.notice,stages:{extractionMs:readMs,totalMs:performance.now()-started},providerCharge:0,billingNote:'No model API call; network and local resources are unmetered.'};
await writeFile(resolve(output,'extraction-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!product.title||!photos.length)process.exitCode=2;
