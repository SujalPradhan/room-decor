import { ArrowLeft, ArrowLeftRight, Check, ExternalLink, Move, Ruler } from 'lucide-react';
import type { FurnitureItem, Layout, RoomSpec } from './types';
import type { ProductDraft } from './product-types';
import { validatePlacement } from './domain';
import { toDisplayUnits } from './measurements';
export default function ProductPreviewPanel({product,candidate,original,layout,room,showAfter,onCompare,onBack,onConfirm,onFocus}:{product:ProductDraft;candidate:FurnitureItem;original:FurnitureItem|null;layout:Layout;room:RoomSpec;showAfter:boolean;onCompare:(after:boolean)=>void;onBack:()=>void;onConfirm:()=>void;onFocus:()=>void}){
 const preview={...layout,items:original?layout.items.map(i=>i.id===original.id?candidate:i):[...layout.items,candidate]};
 const seen=new Set<string>();const issues=preview.items.flatMap(i=>validatePlacement(i,preview.items,room)).filter(i=>{if(!i.itemIds.includes(candidate.id))return false;const key=i.code+i.itemIds.slice().sort().join(':');if(seen.has(key))return false;seen.add(key);return true;});
 const readyModel=product.model.state==='ready'&&product.model.appearance==='seller-model';
 return <div className="replacement-workbench product-preview-panel">
  <header className="replacement-header"><button onClick={onBack}><ArrowLeft size={14}/>Product details</button><span className="eyebrow">{original?'TRY IT IN THE SAME SPACE':'A NEW POSSIBILITY'}</span><h2>{candidate.name}</h2><p>{readyModel?'Imported 3D model':'Size preview · approximate appearance'}</p></header>
  <div className="replacement-scroll">
   <div className="comparison-switch" aria-label="Product preview comparison"><button className={!showAfter?'active':''} onClick={()=>onCompare(false)}>Before</button><button className={showAfter?'active':''} onClick={()=>onCompare(true)}>After <ArrowLeftRight size={12}/></button></div>
   <div className="product-preview-dimensions"><Ruler size={17}/><strong>{(['width','depth','height'] as const).map(a=>toDisplayUnits(candidate.dimensions[a],'cm')).join(' × ')} cm</strong><span>Reviewed outer dimensions</span></div>
   <p className="product-preview-copy"><Move size={15}/>Drag this piece in the room to try a position. Your saved layout stays unchanged until you confirm.</p>
   <button className="button outline small" onClick={onFocus}>Focus on this piece</button>
   <div className={`product-fit-card ${issues.length?'has-issues':''}`}><strong>{issues.length?'Check this placement':'No placement conflicts in this draft'}</strong>{issues.slice(0,4).map((i,n)=><p key={n}>{i.message}</p>)}<p>Room measurements are estimated. Confirm them before deciding on a tight fit.</p></div>
   {!readyModel&&<p className="product-preview-copy">This preview uses a simple furniture shape scaled to the dimensions you reviewed. A product photo does not define its exact 3D geometry.</p>}
   {product.source.submittedUrl&&<a className="product-source-link" href={product.source.submittedUrl} target="_blank" rel="noopener noreferrer">View product listing <ExternalLink size={13}/></a>}
  </div>
  <footer className="replacement-footer"><span>Preview only · one undoable change when confirmed</span><button className="button gold" onClick={onConfirm}>{original?'Use this product':'Add to room'}<Check size={15}/></button><button className="cancel-replacement" onClick={onBack}>Back to product details</button></footer>
 </div>;
}
