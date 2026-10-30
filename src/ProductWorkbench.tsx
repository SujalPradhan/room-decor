import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  ImagePlus,
  Link2,
  LoaderCircle,
  Package,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { pipelineStageLabel } from "./pipeline-client";
import DimensionInput from "./DimensionInput";
import {
  DIMENSION_LIMITS,
  fromDisplayUnits,
  toDisplayUnits,
} from "./measurements";
import {
  canTryProduct,
  createProductDraft,
  getProductReviewIssues,
  isSafeProductImageUrl,
  updateProductDraft,
} from "./product-domain";
import type {
  ProductAxis,
  ProductDraft,
  ProductWorkbenchProps,
} from "./product-types";
import type { ItemKind } from "./types";
import "./product-ui.css";

const KINDS: { value: ItemKind; label: string }[] = [
  { value: "bed", label: "Bed" },
  { value: "wardrobe", label: "Wardrobe" },
  { value: "desk", label: "Desk" },
  { value: "chair", label: "Chair" },
  { value: "floor-bed", label: "Floor mattress" },
  { value: "pedestal-fan", label: "Standing fan" },
  { value: "stool", label: "Stool" },
  { value: "plant", label: "Plant" },
  { value: "shelf", label: "Shelf" },
];
const AXES: ProductAxis[] = ["width", "depth", "height"];
const productImage = (p: ProductDraft) =>
  p.images.find((i) => i.id === p.selectedImageId) ?? p.images[0];
const dimensionText = (p: ProductDraft) =>
  AXES.map((a) =>
    p.dimensions[a].metres === null
      ? "—"
      : toDisplayUnits(p.dimensions[a].metres!, "cm"),
  ).join(" × ") + " cm";
const modelStatus = (p: ProductDraft) =>
  p.model.state === "ready"
    ? "3D model ready"
    : p.model.state === "running" || p.model.state === "queued"
      ? "Model in progress"
      : p.model.state === "failed"
        ? "Model needs attention"
        : canTryProduct(p)
          ? "Ready for a size preview"
          : "Measurements needed";

function isCompleteProductLink(value:string):boolean {
  try {const link=new URL(value.trim()),host=link.hostname.toLowerCase();return link.protocol==='https:'&&!link.username&&!link.password&&((host==='flipkart.com'||host.endsWith('.flipkart.com'))&&/\/p\/[^/]+/.test(link.pathname)||(host==='amazon.in'||host.endsWith('.amazon.in'))&&/\/(?:dp|gp\/product)\/[a-z\d]{10}(?:[/?]|$)/i.test(link.pathname)||['amzn.in','amzn.to'].includes(host)&&link.pathname.length>1);}catch{return false;}
}

export function useProductSheetFocus(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    ref.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !ref.current) return;
      const nodes = [
        ...ref.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
      if (!nodes.length) {
        event.preventDefault();
        ref.current.focus();
        return;
      }
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [ref]);
}

export function handleProductTabs(event: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); event.stopPropagation(); tabs[next].click(); tabs[next].focus();
}

export default function ProductWorkbench({
  original,
  storageNote,
  roomId,
  roomName,
  products,
  session,
  initialProductId,
  onResolve,
  onSave,
  onTry,
  onClose,
  onImportModel,
  onAddImage,
  onGenerate,
  pipelineSession,
  pipelineJobs = [],
  onCancelGeneration,
  autoStart,
  onSourceChange,
}: ProductWorkbenchProps) {
  const [tab, setTab] = useState<"link" | "library">("link");
  const [draft, setDraft] = useState<ProductDraft>(() => {
    const saved = products.find((product) => product.id === initialProductId);
    return saved ? structuredClone(saved) : createProductDraft(roomId);
  });
  const [url, setUrl] = useState(
    () =>
      products.find((product) => product.id === initialProductId)?.source
        .submittedUrl ?? "",
  );
  const [specifications, setSpecifications] = useState("");
  const [detailsOpen,setDetailsOpen]=useState(false),[autoRequested,setAutoRequested]=useState(Boolean(autoStart));
  const starting=useRef(false),attemptedLinks=useRef(new Set<string>()),sourceEpoch=useRef(0);
  const [busy, setBusy] = useState<
    "read" | "image" | "model" | "generate" | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const sheet = useRef<HTMLDivElement>(null),
    photoInput = useRef<HTMLInputElement>(null),
    modelInput = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  useProductSheetFocus(sheet);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const updated = products.find((p) => p.id === draft.id);
    if (
      updated &&
      (updated.revision === draft.revision || (draft.model.jobId && pipelineJobs.some(j=>j.id===draft.model.jobId&&j.requestedRevision===draft.revision&&j.status==='succeeded'))) &&
      (updated.updatedAt > draft.updatedAt || (updated.updatedAt === draft.updatedAt && JSON.stringify(updated.model) !== JSON.stringify(draft.model)))
    )
      setDraft(updated);
  }, [products, draft.id, draft.revision, draft.updatedAt, draft.model.jobId, pipelineJobs]);
  const patch = (change: Partial<ProductDraft>) => {
    // Job progress can render before the saved queued model reaches this sheet.
    // Bind only the matching revision; material edits below still invalidate it.
    const activeJob = pipelineJobs.find(j=>j.productId===draft.id&&j.requestedRevision===draft.revision&&['queued','running'].includes(j.status));
    const base = activeJob && !draft.model.jobId ? {...draft,model:{state:activeJob.status==='running'?'running':'queued',appearance:'ai-generated',jobId:activeJob.id,draftRevision:draft.revision}} as ProductDraft : draft;
    const next = updateProductDraft(base, change);
    setDraft(next);
    // Keep every edit made during reconstruction so its older result cannot replace it.
    if (['queued','running'].includes(draft.model.state) || pipelineJobs.some(j=>j.productId===draft.id&&['queued','running'].includes(j.status))) onSave(next);
    setError("");
    setNotice("");
  };
  const selectedImage = productImage(draft);
  const safeImage =
    selectedImage && (detailsOpen || !url.trim() || [draft.source.submittedUrl,draft.source.canonicalUrl].includes(url.trim())) && isSafeProductImageUrl(selectedImage.url)
      ? selectedImage.url
      : null;
  const reviewIssues = getProductReviewIssues(draft);
  const ready = canTryProduct(draft);
  const allPresent = AXES.every((a) => draft.dimensions[a].metres !== null);
  const allConfirmed = AXES.every(
    (a) => draft.dimensions[a].confirmed && draft.dimensions[a].metres !== null,
  );
  const job = pipelineJobs.find(j=>j.productId===draft.id&&j.id===draft.model.jobId) ?? pipelineJobs.filter(j=>j.productId===draft.id&&['queued','running'].includes(j.status)).at(-1);
  const inProgress = Boolean(job && ['queued','running'].includes(job.status)) || ['queued','running'].includes(draft.model.state);
  const localAvailable = Boolean(pipelineSession?.enabled && pipelineSession.online && pipelineSession.remainingJobs > 0);
  const library = products.filter((p) =>
    p.title.toLowerCase().includes(libraryQuery.toLowerCase()),
  );
  const readProduct = async () => {
    if (!url.trim() && !specifications.trim()) {
      setError("Paste a product link or the product specifications first.");
      return;
    }
    setBusy("read");
    setError("");
    setNotice("");
    setAttempted(true);
    try {
      const result = await onResolve({
        url: url.trim() || undefined,
        specifications: specifications.trim() || undefined,
        roomId,
        roomName,
        componentId: original?.id,
      });
      if (!alive.current) return;
      const previous = draft;
      const sameProduct = previous.source.submittedUrl === url.trim() && Boolean(url.trim());
      let next = result.product;
      if (sameProduct) {
        const dimensions = { ...result.product.dimensions };
        for (const axis of AXES) if (previous.dimensions[axis].origin === 'user' && previous.dimensions[axis].metres !== null) dimensions[axis] = previous.dimensions[axis];
        const uploads = previous.images.filter(i=>i.source==='upload');
        next = updateProductDraft(result.product,{title:result.product.title||previous.title,variant:result.product.variant||previous.variant,kind:result.product.kind??previous.kind,dimensions,images:[...result.product.images,...uploads.filter(i=>!result.product.images.some(x=>x.id===i.id))],selectedImageId:uploads.some(i=>i.id===previous.selectedImageId)?previous.selectedImageId:result.product.selectedImageId});
      }
      setDraft(next);
      setNotice(
        result.notice ??
          "Review the product and check its assembled dimensions before trying it.",
      );
      return next;
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "The product could not be read. You can enter its details below.",
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const saveLinkDraft = () => {
    let next=draft;
    try {const link=new URL(url.trim());if(link.protocol==='https:') next=updateProductDraft(draft,{title:draft.title||'Saved product link',source:{...draft.source,submittedUrl:link.href,retailer:/flipkart\.com$/.test(link.hostname)?'flipkart':/amazon\.in$/.test(link.hostname)?'amazon':'manual'}});} catch {/* A malformed link remains in the editor for correction. */}
    onSave(next);
    return next;
  };
  const signInWithDraft = () => {
    const product=saveLinkDraft();
    try {sessionStorage.setItem('roomshift-pending-product-v1',JSON.stringify({product,savedAt:Date.now(),autoGenerate:true}));} catch {/* The device copy remains available if session storage is blocked. */}
  };
  const createModel = async () => {
    if (starting.current || inProgress) return;
    if (!isCompleteProductLink(url)) {setError('Paste the complete HTTPS product link from Amazon or Flipkart.');return;}
    starting.current=true;const epoch=sourceEpoch.current;
    attemptedLinks.current.add(url.trim());
    setError('');
    try {
      if (!session?.user) { saveLinkDraft(); setError('Sign in to create and link this model. Your pasted link is saved.'); return; }
      let product = draft;
      const cached=products.find(p=>p.model.state==='ready'&&p.model.draftRevision===p.revision&&[p.source.submittedUrl,p.source.canonicalUrl].includes(url.trim()));
      if(cached){product=cached;setDraft(structuredClone(cached));}
      if (!cached && !(draft.model.state==='ready'&&draft.model.draftRevision===draft.revision&&draft.source.submittedUrl===url.trim()) && url.trim() && (draft.source.submittedUrl !== url.trim() || !draft.title || !draft.images.length)) {
        const read = await readProduct();
        if (!read) return;
        product = read;
      }
      if(epoch!==sourceEpoch.current||!alive.current)return;
      setBusy('generate');
      await onGenerate(product);
      if(alive.current)setNotice('Creating your product model. It will be linked to your room automatically. You can keep arranging while it runs.');
    } catch(e){if(alive.current)setError(e instanceof Error?e.message:'Model creation could not start. Your link is saved.');}
    finally{starting.current=false;if(alive.current)setBusy(null);}
  };
  useEffect(()=>{
    if(!autoRequested||tab!=='link'||!session||!pipelineSession||busy||inProgress||!isCompleteProductLink(url)||attemptedLinks.current.has(url.trim()))return;
    const sameReady=draft.model.state==='ready'&&draft.model.draftRevision===draft.revision&&draft.source.submittedUrl===url.trim();
    if(sameReady&&!autoStart)return;
    const timer=setTimeout(()=>void createModel(),650);
    return()=>clearTimeout(timer);
  },[url,autoRequested,autoStart,tab,session,pipelineSession,busy,inProgress,draft.id,draft.revision,draft.model.state]);
  const fileAction = async (
    file: File | undefined,
    kind: "image" | "model",
  ) => {
    if (!file) return;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      const updated =
        kind === "image"
          ? await onAddImage(draft, file)
          : await onImportModel(draft, file);
      if (alive.current) {
        setDraft(updated);
        setNotice(
          kind === "image"
            ? "Photo added. Its appearance is a reference; confirm dimensions separately."
            : "3D model imported. Check the dimensions to place it at the right size.",
        );
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "This file could not be opened. Your product details were kept.",
        );
    } finally {
      if (alive.current) setBusy(null);
      if (photoInput.current) photoInput.current.value = "";
      if (modelInput.current) modelInput.current.value = "";
    }
  };
  const save = () => {
    try {
      onSave(draft);
      setNotice("Saved to My products. You can come back to it anytime.");
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This product could not be saved.",
      );
    }
  };
  const tryProduct = (product: ProductDraft) => {
    if (!canTryProduct(product)) return;
    try {
      onTry(product);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This product could not be previewed.",
      );
    }
  };
  const chooseSaved = (product: ProductDraft) => {
    setDraft(structuredClone(product));
    setUrl(product.source.submittedUrl ?? "");
    setSpecifications("");
    setError("");
    setNotice("");
    setAutoRequested(false);
    setDetailsOpen(false);
    setTab("link");
  };
  return (
    <div
      className="product-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="product-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-workbench-title"
        tabIndex={-1}
        ref={sheet}
        onKeyDown={(e) => {
          if (
            e.key === "Delete" ||
            e.key === "Backspace" ||
            ((e.ctrlKey || e.metaKey) &&
              ["z", "y"].includes(e.key.toLowerCase()))
          )
            e.stopPropagation();
          if (
            e.key === "Escape" &&
            !(e.target as HTMLElement).closest("input,textarea,select")
          ) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="product-sheet-header">
          <div>
            <span className="pw-eyebrow">MAKE ROOM FOR SOMETHING NEW</span>
            <h2 id="product-workbench-title">Try a product in your room.</h2>
            <p>
              {original ? (
                <>
                  Replacing <strong>{original.name}</strong> in {roomName}
                </>
              ) : (
                <>Find the right piece for {roomName}</>
              )}
            </p>
          </div>
          <button
            className="pw-icon-button"
            aria-label="Close product workbench"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <nav className="pw-tabs" role="tablist" aria-label="Product workspace" onKeyDown={handleProductTabs}>
          <button
            role="tab"
            id="pw-tab-link" aria-controls="pw-product-tabpanel" tabIndex={tab === "link" ? 0 : -1}
            aria-selected={tab === "link"}
            className={tab === "link" ? "active" : ""}
            onClick={() => setTab("link")}
          >
            <Link2 size={15} /> Product link
          </button>
          <button
            role="tab"
            id="pw-tab-library" aria-controls="pw-product-tabpanel" tabIndex={tab === "library" ? 0 : -1}
            aria-selected={tab === "library"}
            className={tab === "library" ? "active" : ""}
            onClick={() => setTab("library")}
          >
            <Package size={15} /> My products{" "}
            <span className="pw-count">{products.length}</span>
          </button>
        </nav>
        <div className="product-sheet-scroll" role="tabpanel" id="pw-product-tabpanel" aria-labelledby={`pw-tab-${tab}`}>
          {tab === "link" ? (
            <>
              <section className="pw-link-section">
                <label className="pw-label" htmlFor="product-link-input">
                  Amazon or Flipkart product link
                </label>
                <form
                  className="pw-link-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createModel();
                  }}
                >
                  <div className="pw-link-input">
                    <Link2 size={17} />
                    <input
                      id="product-link-input"
                      type="url"
                      placeholder="Paste a product link…"
                      value={url}
                      onChange={(e) => {sourceEpoch.current++;setUrl(e.target.value);setAutoRequested(true);setError('');setNotice('');onSourceChange?.();}}
                      disabled={busy === "read"}
                      autoComplete="off"
                    />
                  </div>
                  {error && <button className="pw-button pw-primary" type="submit" disabled={Boolean(busy)||inProgress||!url.trim()}>Retry model <ArrowUpRight size={16}/></button>}
                </form>
                <p className="pw-hint">
                  Paste the link. We collect the product photos and dimensions, create its 3D model and link it to your room automatically.
                </p>
                <div className="pw-link-options">
                  {!session?.user && pipelineSession && <a className="pw-text-button" href="/signin-with-chatgpt?return_to=/" target="_top" onClick={signInWithDraft}>Sign in to create a model <ArrowUpRight size={13}/></a>}
                </div>
              </section>
              {storageNote && <p className="pw-message" role="status">{storageNote}</p>}
              {(error || notice) && (
                <div
                  className={`pw-message ${error ? "is-error" : ""}`}
                  role={error ? "alert" : "status"}
                >
                  {error || notice}
                </div>
              )}
              <div className="pw-workbench-grid">
                <section aria-label="Model progress">
                  <div className="pw-generation-status available" role="status" aria-live="polite">
                    <span className="pw-status-title">{inProgress||busy ? <LoaderCircle size={17} className="spin"/> : <Package size={17}/>} {busy==='read'?'Reading product photos and dimensions':busy==='generate'?'Starting your model':inProgress?pipelineStageLabel(job?.stage??'queued'):draft.model.state==='ready'?'Your product model is ready':'Your product, in your room'}</span>
                    <p>{inProgress?'You can close this panel and keep arranging. The finished model will be linked to your room automatically.':draft.model.state==='ready'?'The actual generated shape is saved with your product.':'Paste an Amazon or Flipkart product link above to begin. No measurements or furniture choices are needed.'}</p>
                    {(inProgress||busy)&&<span className="pw-pipeline-track" aria-hidden="true"><span/></span>}
                    {draft.model.error&&<p className="pw-warning">{draft.model.error}</p>}
                    {onCancelGeneration&&inProgress&&(job?.id||draft.model.jobId)&&<button className="pw-text-button" onClick={async()=>{setAutoRequested(false);try{await onCancelGeneration((job?.id??draft.model.jobId)!);}catch(e){setError(e instanceof Error?e.message:'Could not cancel. Please try again.');}}}>Cancel model creation</button>}
                    {!localAvailable&&!inProgress&&session?.user&&pipelineSession?.reason&&<p className="pw-hint">{pipelineSession.reason}</p>}
                  </div>
                </section>
                <aside className="pw-appearance"><div className="pw-image-stage">{safeImage?<img src={safeImage} alt={draft.title||'Product photo from the listing'}/>:<div className="pw-image-placeholder"><Link2 size={36} strokeWidth={1}/><span>The product photo appears here</span><small>We use photos from your link.</small></div>}<span className="pw-image-label">{safeImage?'Photo from your product link':'Product reference'}</span></div></aside>
              </div>
              <details className="pw-recovery" open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}>
                <summary>Edit details or import a model <ChevronRight size={15}/></summary>
                <p className="pw-hint">Optional controls for manual edits, specifications or your own 3D model.</p>
                <button className="pw-text-button" disabled={Boolean(busy)||!url.trim()} onClick={()=>{setAutoRequested(false);void readProduct();}}>Read product details only</button>
              <div className="pw-workbench-grid">
                <section
                  className="pw-product-review"
                  aria-label="Product details"
                >
                  <div className="pw-section-title">
                    <span className="pw-step">1</span>
                    <div>
                      <h3>Review your product</h3>
                      <p>Details you can always correct.</p>
                    </div>
                  </div>
                  <label className="pw-field">
                    <span>Product name</span>
                    <input
                      aria-label="Product name"
                      disabled={Boolean(busy)}
                      value={draft.title}
                      maxLength={100}
                      placeholder="e.g. Oak study desk"
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                  </label>
                  <div className="pw-two-fields">
                    <label className="pw-field">
                      <span>Type of piece</span>
                      <select
                        aria-label="Product category"
                        disabled={Boolean(busy)}
                        value={draft.kind ?? ""}
                        onChange={(e) =>
                          patch({
                            kind: (e.target.value || null) as ItemKind | null,
                          })
                        }
                      >
                        <option value="">Choose a type</option>
                        {KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="pw-field">
                      <span>Size / colour variant</span>
                      <input
                        aria-label="Product variant"
                        disabled={Boolean(busy)}
                        value={draft.variant}
                        placeholder="e.g. 120 cm · natural oak"
                        maxLength={160}
                        onChange={(e) => patch({ variant: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="pw-section-title pw-dimensions-heading">
                    <span className="pw-step">2</span>
                    <div>
                      <h3>Check the assembled size</h3>
                      <p>External dimensions, including the frame and legs.</p>
                    </div>
                  </div>
                  <div className="pw-dimension-grid">
                    {AXES.map((axis) => (
                      <label className="pw-dimension" key={axis}>
                        <span>
                          {axis.charAt(0).toUpperCase() + axis.slice(1)}
                        </span>
                        <div>
                          <DimensionInput
                            label={`Product ${axis}`}
                            disabled={Boolean(busy)}
                            value={
                              draft.dimensions[axis].metres === null
                                ? null
                                : toDisplayUnits(
                                    draft.dimensions[axis].metres!,
                                    "cm",
                                  )
                            }
                            min={toDisplayUnits(
                              DIMENSION_LIMITS[axis].min,
                              "cm",
                            )}
                            max={toDisplayUnits(
                              DIMENSION_LIMITS[axis].max,
                              "cm",
                            )}
                            unit="cm"
                            onCommit={(value) =>
                              patch({
                                dimensions: {
                                  ...draft.dimensions,
                                  [axis]: {
                                    metres: fromDisplayUnits(value, "cm"),
                                    origin: "user",
                                    confirmed: false,
                                  },
                                },
                              })
                            }
                            onInvalidValue={setError}
                          />
                          <small>cm</small>
                        </div>
                        <small className="pw-measurement-source">
                          {draft.dimensions[axis].metres === null
                            ? "Not provided"
                            : draft.dimensions[axis].confirmed
                              ? "Checked"
                              : draft.dimensions[axis].origin === "listing"
                                ? "From listing"
                                : "You entered"}
                        </small>
                      </label>
                    ))}
                  </div>
                  <p className="pw-hint">
                    Enter or click outside to apply · Esc cancels an edit. A
                    package size or mattress size may differ from the whole
                    piece.
                  </p>
                  <label className="pw-check">
                    <input
                      type="checkbox"
                      checked={allConfirmed}
                      disabled={!allPresent || Boolean(busy)}
                      onChange={(e) =>
                        patch({
                          dimensions: Object.fromEntries(
                            AXES.map((axis) => [
                              axis,
                              {
                                ...draft.dimensions[axis],
                                confirmed: e.target.checked,
                              },
                            ]),
                          ) as ProductDraft["dimensions"],
                        })
                      }
                    />
                    <span>
                      I checked all three assembled dimensions against the
                      product details.
                    </span>
                  </label>
                  {draft.specificationWarnings?.map((warning, i) => (
                    <p key={i} className="pw-warning">
                      {warning}
                    </p>
                  ))}
                  <details
                    className="pw-recovery"
                    open={attempted || Boolean(error)}
                  >
                    <summary>
                      Have the specifications? Paste them here{" "}
                      <ChevronRight size={15} />
                    </summary>
                    <p className="pw-hint">
                      If the store can’t share its details, keep the link and
                      add the product information yourself.
                    </p>
                    <textarea
                      aria-label="Product specifications"
                      disabled={Boolean(busy)}
                      placeholder="e.g. Width: 120 cm, Depth: 60 cm, Height: 75 cm. Assembled dimensions."
                      rows={4}
                      value={specifications}
                      onChange={(e) => setSpecifications(e.target.value)}
                    />
                    <button
                      className="pw-button pw-secondary"
                      disabled={!specifications.trim() || Boolean(busy)}
                      onClick={() => void readProduct()}
                    >
                      {busy === "read" ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <Check size={15} />
                      )}{" "}
                      Read specifications
                    </button>
                  </details>
                </section>
                <aside className="pw-appearance">
                  <div className="pw-image-stage">
                    {safeImage ? (
                      <img
                        src={safeImage}
                        alt={draft.title || "Product reference"}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="pw-image-placeholder">
                        <Package size={44} strokeWidth={1} />
                        <span>A closer look at your next piece</span>
                        <small>Add a photo, or import a 3D model.</small>
                      </div>
                    )}
                    <span className="pw-image-label">
                      {draft.model.state === "ready"
                        ? "3D model attached"
                        : "Appearance reference"}
                    </span>
                  </div>
                  {draft.images.length > 1 && (
                    <div
                      className="pw-image-options"
                      aria-label="Product photos"
                    >
                      {draft.images
                        .filter((i) => isSafeProductImageUrl(i.url))
                        .map((img, i) => (
                          <button
                            key={img.id}
                            className={
                              selectedImage?.id === img.id ? "active" : ""
                            }
                            aria-label={`Use product photo ${i + 1}`}
                            aria-pressed={selectedImage?.id === img.id}
                            onClick={() => patch({ selectedImageId: img.id })}
                          >
                            <img src={img.url} alt="" />
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="pw-file-buttons">
                    <button
                      className="pw-button pw-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => photoInput.current?.click()}
                    >
                      {busy === "image" ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <ImagePlus size={16} />
                      )}{" "}
                      Add photo
                    </button>
                    <button
                      className="pw-button pw-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => modelInput.current?.click()}
                    >
                      {busy === "model" ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Upload size={16} />
                      )}{" "}
                      Import 3D model
                    </button>
                  </div>
                  <input
                    type="file"
                    ref={photoInput}
                    hidden
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Upload product photo"
                    onChange={(e) =>
                      void fileAction(e.target.files?.[0], "image")
                    }
                  />
                  <input
                    type="file"
                    ref={modelInput}
                    hidden
                    accept=".glb,model/gltf-binary"
                    aria-label="Import product 3D model"
                    onChange={(e) =>
                      void fileAction(e.target.files?.[0], "model")
                    }
                  />
                  <div className="pw-size-preview-note">
                    <Clock3 size={17} />
                    <p>
                      <strong>Start with the fit.</strong> A size preview uses a
                      simple piece at your checked dimensions. It doesn’t turn a
                      photo into a finished 3D model.
                    </p>
                  </div>
                </aside>
              </div>
              </details>
            </>
          ) : (
            <section className="pw-library">
              <div className="pw-library-heading">
                <div>
                  <h3>Pieces worth keeping.</h3>
                  <p>Saved products, measurements and models in one place.</p>
                </div>
                <button
                  className="pw-button pw-secondary"
                  onClick={() => {
                    setAutoRequested(false);
                    setDetailsOpen(false);
                    setDraft(createProductDraft(roomId));
                    setUrl("");
                    setSpecifications("");
                    setError("");
                    setNotice("");
                    setTab("link");
                  }}
                >
                  <Plus size={15} /> New product
                </button>
              </div>
              {products.length > 0 && (
                <input
                  className="pw-library-search"
                  aria-label="Search my products"
                  placeholder="Search your products"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                />
              )}
              {!products.length ? (
                <div className="pw-empty">
                  <Package size={40} strokeWidth={1} />
                  <h3>Your next piece starts here.</h3>
                  <p>
                    Save a product while you compare sizes and colours. Nothing
                    is added to your room until you choose to try it.
                  </p>
                  <button
                    className="pw-button pw-primary"
                    onClick={() => setTab("link")}
                  >
                    Add your first product <ArrowUpRight size={15} />
                  </button>
                </div>
              ) : !library.length ? (
                <p className="pw-empty-search">No products match that name.</p>
              ) : (
                <div className="pw-library-list">
                  {library.map((product) => {
                    const img = productImage(product);
                    return (
                      <article className="pw-library-row" key={product.id}>
                        <div className="pw-library-image">
                          {img && isSafeProductImageUrl(img.url) ? (
                            <img src={img.url} alt="" />
                          ) : (
                            <Package size={25} strokeWidth={1} />
                          )}
                        </div>
                        <div className="pw-library-info">
                          <h4>{product.title || "Untitled product"}</h4>
                          <p>
                            {product.variant ||
                              KINDS.find((k) => k.value === product.kind)
                                ?.label ||
                              "Type not selected"}
                          </p>
                          <span>{dimensionText(product)}</span>
                          <small>{pipelineJobs.some(j=>j.productId===product.id&&["queued","running"].includes(j.status)) ? pipelineStageLabel(pipelineJobs.filter(j=>j.productId===product.id).at(-1)!.stage) : modelStatus(product)}</small>
                        </div>
                        <div className="pw-library-actions">
                          <button
                            className="pw-button pw-secondary"
                            onClick={() => chooseSaved(product)}
                          >
                            Review
                          </button>
                          <button
                            className="pw-button pw-primary"
                            disabled={!canTryProduct(product)}
                            onClick={() => tryProduct(product)}
                          >
                            Try in room <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
        {tab === "link" && detailsOpen && (
          <footer className="pw-footer">
            <div>
              <strong>
                {ready
                  ? "Ready to see how it fits"
                  : draft.title
                    ? "Check the product details above"
                    : "Your room stays just as it is"}
              </strong>
              <span>
                {ready
                  ? "Preview first. Keep it only when you’re happy."
                  : reviewIssues[0] ||
                    "Save a piece for later, or preview it in your room."}
              </span>
            </div>
            <div className="pw-footer-actions">
              <button
                className="pw-button pw-secondary"
                disabled={Boolean(busy) || !draft.title.trim()}
                onClick={save}
              >
                Save for later
              </button>
              <button
                className="pw-button pw-primary"
                disabled={!ready || Boolean(busy)}
                onClick={() => tryProduct(draft)}
              >
                Try in room <ArrowUpRight size={16} />
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
