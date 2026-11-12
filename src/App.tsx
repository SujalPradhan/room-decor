import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  ArrowDownToLine,
  ArrowUpRight,
  BedDouble,
  Box,
  Camera,
  Clock3,
  Link2,
  UserRound,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  CreditCard,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  Fan,
  FlaskConical,
  Footprints,
  Gem,
  Grid2X2,
  Layers3,
  LayoutGrid,
  Leaf,
  Lock,
  Maximize2,
  Menu,
  MessagesSquare,
  MousePointer2,
  Move,
  Palette,
  PanelTop,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Rows3,
  Ruler,
  Save,
  Settings2,
  Sofa,
  Store,
  Table2,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  FurnitureItem,
  ItemKind,
  Layout,
  Position,
  Project,
  SceneController,
  SceneState,
  SpaceType,
  ViewMode,
} from "./types";
import {
  createFurnitureItem,
  createInitialProject,
  createRetailProject,
  kindsForSpace,
  parseProject,
  spaceOf,
  upgradeRetiredPresets,
  serializeProject,
  validateLayout,
} from "./domain";
import { createRoomScene } from "./scene";
import ReplacementPanel from "./ReplacementPanel";
import { createReplacementDraft, previewReplacement } from "./replacement";
import { getLocalModel } from "./local-assets";
import DimensionInput from "./DimensionInput";
import ProductWorkbench from "./ProductWorkbench";
import CostTimePanel from "./CostTimePanel";
import ProductPreviewPanel from "./ProductPreviewPanel";
import LayoutExplainerPanel from "./LayoutExplainerPanel";
import LayoutAgentComposer,{type LayoutAgentReply} from "./LayoutAgentComposer";
import {useLayoutWalkthrough} from "./useLayoutWalkthrough";
import {matchLayoutIntent} from "./layout-intent";
import type {LayoutAgentResult} from "./layout-agent-types";
import {askLayoutAgent,LayoutAgentHttpError,readLayoutAgentResult} from "./layout-agent-client";
import type {LayoutGoal} from "./layout-goals";
import { useProductStudio } from "./useProductStudio";
import { productToFurniture, generatedProductToFurniture, isSafeProductImageUrl } from "./product-domain";
import { chooseProductPosition, placeProduct, readPlacementIntents, WALL_KINDS, type ProductPlacementIntent } from "./automatic-products";
import { createLocalOperation } from "./ledger";
import type { ProductDraft } from "./product-types";
import {
  DIMENSION_LIMITS,
  toDisplayUnits,
  fromDisplayUnits,
} from "./measurements";

const STORAGE_KEY = "roomshift-project-v1";
const PANELS_KEY = "roomshift-panels-v1";
interface PanelState { leftCollapsed: boolean; layoutsCollapsed: boolean }
function savedPanels(): PanelState {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "{}") as Partial<PanelState>;
    return { leftCollapsed: saved.leftCollapsed === true, layoutsCollapsed: saved.layoutsCollapsed === true };
  } catch { return { leftCollapsed: false, layoutsCollapsed: false }; }
}
/** v2 is the 20 × 28 m flagship; a saved 9 × 12 m store under v1 is left where it is. */
const STORE_STORAGE_KEY = "roomshift-store-project-v2";
const SPACE_KEY = "roomshift-space-v1";
/** The store saved before the flagship. It is never deleted; the first visit to the store offers to open it once. */
const EARLIER_STORE_KEY = "roomshift-store-project-v1", EARLIER_STORE_OFFERED_KEY = "roomshift-store-v1-offered";
const storageKey = (space: SpaceType) => (space === "retail" ? STORE_STORAGE_KEY : STORAGE_KEY);
const defaultName = (space: SpaceType) => (space === "retail" ? "Experiential store" : "My bedroom");
const spaces = [
  { id: "room", label: "Bedroom", Icon: BedDouble },
  { id: "retail", label: "Store", Icon: Store },
] as const;
import { DoorClosed, Gift, MonitorPlay, ScanFace, Sparkles, SprayCan } from "lucide-react";
import { ChevronUp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
const kindIcons: Record<ItemKind, LucideIcon> = {
  bed: BedDouble,
  wardrobe: PanelTop,
  desk: Table2,
  chair: Armchair,
  "floor-bed": BedDouble,
  "pedestal-fan": Fan,
  stool: Box,
  plant: Leaf,
  shelf: Layers3,
  "display-table": LayoutGrid,
  "wall-display": Rows3,
  "testing-bar": FlaskConical,
  "consultation-station": MessagesSquare,
  "hero-plinth": Gem,
  "checkout-counter": CreditCard,
  "lounge-bench": Sofa,
  "fragrance-tower": SprayCan,
  "skin-analyzer": ScanFace,
  "beauty-chair": Armchair,
  "service-cabin": DoorClosed,
  "digital-wall": MonitorPlay,
  "gift-station": Gift,
  "mirror-station": Sparkles,
};
const kindNames: Record<ItemKind, string> = {
  bed: "Wooden bed",
  wardrobe: "Wardrobe",
  desk: "Study desk",
  chair: "Office chair",
  "floor-bed": "Floor mattress",
  "pedestal-fan": "Pedestal fan",
  stool: "Small stool",
  plant: "Potted plant",
  shelf: "Bookshelf",
  "display-table": "Display table",
  "wall-display": "Wall display",
  "testing-bar": "Testing bar",
  "consultation-station": "Consultation station",
  "hero-plinth": "Hero plinth",
  "checkout-counter": "Checkout counter",
  "lounge-bench": "Lounge bench",
  "fragrance-tower": "Fragrance tower",
  "skin-analyzer": "Skin analyzer",
  "beauty-chair": "Beauty chair",
  "service-cabin": "Service cabin",
  "digital-wall": "Digital wall",
  "gift-station": "Gift station",
  "mirror-station": "Mirror station",
};
const colors = [
  "#d3c7b0",
  "#a7b5a0",
  "#c0a28d",
  "#718b85",
  "#7b858e",
  "#b5a0ac",
  "#e6e0d3",
  "#56584e",
];
const furnitureColors = [
  "#635b52",
  "#344b41",
  "#987655",
  "#9a5257",
  "#c8bca4",
  "#667d88",
];
type Modal = "catalog" | "room" | "references" | "help" | "save" | null;
/** Decisions about saved work. Kept apart from Modal because switching and walkthroughs close that one. */
type SpacePrompt = { kind: "conflict" | "unsaved" | "draft" | "earlier-store"; retry?: () => void };
const ROOM_KIND_IN_STORE = "Room furniture cannot go in a store. Try a plant, stool, chair or shelf instead.";
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
function initialSpace(): SpaceType {
  const linked = new URLSearchParams(location.search).get("space");
  if (linked === "retail" || linked === "room") return linked;
  try {
    return localStorage.getItem(SPACE_KEY) === "retail" ? "retail" : "room";
  } catch {
    return "room";
  }
}
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** What this tab knows about the space's key. `clean` is the snapshot with nothing left to save. */
interface Stored {
  raw: string | null;
  clean: string;
  /** Unreadable data could not be backed up, so it must not be overwritten. */
  held: boolean;
}
type Loaded = Stored & { project: Project; notice?: string };
function loadProject(space: SpaceType): Loaded {
  const identify = (p: Project): Project => ({ ...p, id: p.id ?? crypto.randomUUID(), name: p.name ?? defaultName(space) });
  const key = storageKey(space), raw = readStored(key), word = space === "retail" ? "store" : "bedroom";
  const loaded = (project: Project, extra: Partial<Loaded> = {}): Loaded => ({ project, raw, clean: serializeProject(project), held: false, ...extra });
  if (raw) {
    try {
      const parsed = upgradeRetiredPresets(parseProject(raw));
      if (spaceOf(parsed) === space) return loaded(identify(parsed));
    } catch {}
  }
  const fresh = identify(space === "retail" ? { ...createRetailProject(), id: crypto.randomUUID() } : createInitialProject());
  if (!raw) return loaded(fresh);
  try {
    localStorage.setItem(`${key}.corrupt`, raw);
    return loaded(fresh, { notice: `Your saved ${word} could not be read, so a new one was started. The old data was kept in this browser as ${key}.corrupt.` });
  } catch {
    return loaded(fresh, { held: true, notice: `Your saved ${word} could not be read or backed up, so it was left in place and changes here will not be saved. Export your project to keep a copy.` });
  }
}
/** The store saved under the earlier key, when it can still be opened as a store. */
function earlierStore(): Project | null {
  const raw = readStored(EARLIER_STORE_KEY);
  if (!raw) return null;
  try {
    const parsed = upgradeRetiredPresets(parseProject(raw));
    return spaceOf(parsed) === "retail" ? { ...parsed, id: parsed.id ?? crypto.randomUUID(), name: parsed.name ?? "My earlier store" } : null;
  } catch {
    return null;
  }
}
function downloadFile(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RoomCanvas({
  state,
  onSelect,
  onMove,
  onController,
  onReady,
  onError,
}: {
  state: SceneState;
  onSelect: (id: string | null) => void;
  onMove: (id: string, p: Position) => boolean | void;
  onController: (c: SceneController | null) => void;
  onReady: () => void;
  onError: (s: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<SceneController | null>(null);
  const callbackRef = useRef({
    onSelect,
    onMove,
    onController,
    onReady,
    onError,
  });
  callbackRef.current = { onSelect, onMove, onController, onReady, onError };
  useEffect(() => {
    if (!host.current) return;
    try {
      const c = createRoomScene(host.current, state, {
        onSelect: (id) => callbackRef.current.onSelect(id),
        onMove: (id, p) => callbackRef.current.onMove(id, p),
        onReady: () => callbackRef.current.onReady(),
        onError: (m) => callbackRef.current.onError(m),
      });
      controller.current = c;
      callbackRef.current.onController(c);
      return () => {
        c.dispose();
        controller.current = null;
        callbackRef.current.onController(null);
      };
    } catch (e) {
      callbackRef.current.onError(
        e instanceof Error ? e.message : "The 3D view could not start.",
      );
    }
  }, []);
  useEffect(() => {
    // Without this boundary, one bad frame would blank the whole app rather than only the 3D view.
    try {
      controller.current?.update(state);
      if (controller.current) callbackRef.current.onError("");
    } catch (e) {
      callbackRef.current.onError(e instanceof Error ? e.message : "The 3D view could not update.");
    }
  }, [state]);
  return <div ref={host} className="canvas-host" data-testid="room-canvas" />;
}

function MiniPlan({ layout, project }: { layout: Layout; project: Project }) {
  return (
    <div className="mini-plan">
      <div className={`mini-plan-inner${spaceOf(project) === "retail" ? " store-floor" : ""}`}>
        {layout.items
          .filter((i) => i.visible)
          .map((i) => (
            <i
              key={i.id}
              className={`mini-item mini-${i.kind}`}
              style={{
                left: `${(i.position.x / project.room.width + 0.5) * 100}%`,
                top: `${(i.position.z / project.room.depth + 0.5) * 100}%`,
                width: `${(i.dimensions.width / project.room.width) * 100}%`,
                height: `${(i.dimensions.depth / project.room.depth) * 100}%`,
                transform: `translate(-50%,-50%) rotate(${-i.rotation}rad)`,
                backgroundColor: i.color,
              }}
            />
          ))}
      </div>
    </div>
  );
}

export default function App() {
  const layoutFrame=useRef<{layout:Layout;itemId?:string}|null>(null),sceneBase=useRef<SceneState|null>(null);
  const [productOpen, setProductOpen] = useState(false), [costOpen, setCostOpen] = useState(false);
  const [productTarget, setProductTarget] = useState<FurnitureItem | null>(null), [initialProductId, setInitialProductId] = useState<string | undefined>();
  const [autoStartProduct,setAutoStartProduct]=useState(false);
  const [panels,setPanels]=useState<PanelState>(savedPanels);
  const togglePanel=(key:keyof PanelState)=>setPanels(current=>{const next={...current,[key]:!current[key]};try{localStorage.setItem(PANELS_KEY,JSON.stringify(next));}catch{/* The choice still holds for this visit. */}return next;});
  const [placementTick,setPlacementTick]=useState(0);
  const sourceVersion=useRef(0),activeProductRequest=useRef<AbortController|null>(null);
  const autoIntents=useRef(new Map<string,ProductPlacementIntent>()),placementScope=useRef(''),activeAutoIntent=useRef<string|null>(null),placing=useRef(new Set<string>()),placementRetries=useRef(new Map<string,number>()),pendingCancellation=useRef<Promise<unknown>>(Promise.resolve()),appAlive=useRef(true),placementTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  useEffect(()=>{appAlive.current=true;return()=>{appAlive.current=false;for(const timer of placementTimers.current.values())clearTimeout(timer);};},[]);
  const [productPreview, setProductPreview] = useState<{ product: ProductDraft; candidate: FurnitureItem; originalId: string | null; layoutId: string } | null>(null);
  const sceneStarted = useRef(performance.now()), sceneFinished = useRef<number | null>(null), meteredScene = useRef(false);
  const [replacementDraft, setReplacementDraft] =
      useState<FurnitureItem | null>(null),
    [showReplacement, setShowReplacement] = useState(true),
    [missingModel, setMissingModel] = useState(false);
  const [opened] = useState(() => loadProject(initialSpace()));
  const [project, setProject] = useState<Project>(opened.project),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [mode, setMode] = useState<ViewMode>("orbit");
  const [wallsVisible, setWallsVisible] = useState(true),
    [showClearances, setShowClearances] = useState(false),
    [modal, setModal] = useState<Modal>(null),
    [mobilePanel, setMobilePanel] = useState<"items" | "properties" | null>(
      null,
    );
  const [tab, setTab] = useState<"object" | "finishes">("object"),
    [ready, setReady] = useState(false),
    [sceneError, setSceneError] = useState(""),
    [toast, setToast] = useState(""),
    [savedSnapshot, setSavedSnapshot] = useState(""),
    [saveFailed, setSaveFailed] = useState(false),
    [prompt, setPrompt] = useState<SpacePrompt | null>(null),
    [exportOpen, setExportOpen] = useState(false);
  const [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]),
    [layoutName, setLayoutName] = useState("My new layout"),
    [roomDraft, setRoomDraft] = useState(project.room),
    [references, setReferences] = useState<
      { name: string; url: string; type: string }[]
    >([]);
  const controller = useRef<SceneController | null>(null),
    shownSpace = useRef(spaceOf(project)),
    fileInput = useRef<HTMLInputElement>(null),
    mediaInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    projectRef = useRef(project),
    referencesRef = useRef(references),
    synced = useRef<Stored>({ raw: opened.raw, clean: opened.clean, held: opened.held }),
    pastRef = useRef(past),
    futureRef = useRef(future),
    promptRef = useRef(prompt),
    reconcileRef = useRef(() => {}),
    shelved = useRef(new Map<SpaceType, { project: Project; past: Project[]; future: Project[]; raw: string | null; clean: string }>());
  projectRef.current = project;
  referencesRef.current = references;
  pastRef.current = past;
  futureRef.current = future;
  promptRef.current = prompt;
  const space = spaceOf(project),
    place = space === "retail" ? "store" : "room",
    Place = space === "retail" ? "Store" : "Room",
    pieces = space === "retail" ? "fixtures" : "furniture",
    Pieces = space === "retail" ? "Fixtures" : "Furniture",
    projectName = project.name ?? defaultName(space);
  const layout =
      project.layouts.find((l) => l.id === project.activeLayoutId) ??
      project.layouts[0],
    selected = layout.items.find((i) => i.id === selectedId) ?? null;
  const issues = useMemo(
    () => validateLayout(layout, project.room),
    [layout, project.room],
  );
  const activeCount = layout.items.filter((i) => i.visible).length;
  const snapshot = useMemo(() => serializeProject(project), [project]),
    saved = savedSnapshot === snapshot;
  const notify = useCallback((s: string, ms = 4000) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }, []);
  useEffect(() => {
    if (opened.notice) notify(opened.notice, 10000);
  }, [opened, notify]);
  /** Never overwrites a value this tab has not seen. With onlyChanges, an unchanged project is not written at all. */
  const persist = useCallback((current: Project, onlyChanges = false): "saved" | "conflict" | "failed" => {
    const text = serializeProject(current), known = synced.current;
    if (onlyChanges && text === known.clean) return "saved";
    if (known.held) return "failed";
    try {
      const key = storageKey(spaceOf(current)), raw = localStorage.getItem(key);
      if (raw !== null && raw !== known.raw && raw !== text) return "conflict";
      if (raw !== text) localStorage.setItem(key, text);
      synced.current = { ...known, raw: text, clean: text };
      return "saved";
    } catch {
      return "failed";
    }
  }, []);
  const studio = useProductStudio(project.id!, projectName, notify);
  useEffect(() => {
    if (!ready || !studio.loaded || meteredScene.current || sceneFinished.current === null) return;
    meteredScene.current = true;
    const duration = sceneFinished.current - sceneStarted.current;
    void studio.record(createLocalOperation({ roomId: project.id!, roomName: projectName, kind: "render", name: `Open ${place} scene`, engine: "Three.js browser renderer", startedAt: new Date(Date.now() - duration).toISOString(), elapsedMs: duration }));
  }, [ready, studio.loaded, studio.record, project.id, projectName]);
  const selectedProduct=studio.products.find(p=>p.id===selected?.productId);
  const selectedPhoto=selectedProduct?.images.find(i=>i.id===selectedProduct.selectedImageId)??selectedProduct?.images[0];
  const selectedProductPhoto=selectedPhoto&&isSafeProductImageUrl(selectedPhoto.url)?selectedPhoto.url:undefined;
  const openProducts = (target: FurnitureItem | null, productId?: string) => {
    if (target?.locked) { notify("Unlock this piece before trying a product."); return; }
    setAutoStartProduct(false);setProductTarget(target ? clone(target) : null); setInitialProductId(productId); setProductOpen(true); setCostOpen(false); setModal(null); setExportOpen(false); setMode("orbit"); setMobilePanel(null);
  };
  const tryProduct = async (product: ProductDraft) => {
    try {
      if (productTarget && (!layout.items.some(i => i.id === productTarget.id) || layout.items.find(i => i.id === productTarget.id)?.locked)) throw new Error("This piece changed. Close the product panel and select it again.");
      const original = productTarget ? layout.items.find(i => i.id === productTarget.id)! : null;
      product = await studio.prepareModel(product);
      const candidate = productToFurniture(product, original);
      if (!kindsForSpace(space).includes(candidate.kind)) throw new Error(ROOM_KIND_IN_STORE);
      if (!original) candidate.position = { x: 0, z: Math.min(project.room.depth / 2 - candidate.dimensions.depth / 2, 1) };
      studio.save(product); setProductPreview({ product: clone(product), candidate, originalId: original?.id ?? null, layoutId: layout.id }); setShowReplacement(true); setReplacementDraft(null); setProductOpen(false); setTab("object"); setMobilePanel("properties");
    } catch (error) { notify(error instanceof Error ? error.message : "This product could not be previewed."); }
  };
  const commit = useCallback(
    (mutate: (p: Project) => void) => {
      const current = projectRef.current,
        next = clone(current);
      try {
        mutate(next);
        serializeProject(next);
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "This change could not be saved.",
        );
        return false;
      }
      projectRef.current = next;
      setPast((old) => [...old.slice(-39), clone(current)]);
      setFuture([]);
      setProject(next);
      return true;
    },
    [notify],
  );
  const agentLayout=useRef<Layout|null>(null);
  const clearAsked=()=>{if(walkthrough.current.current?.plan.request)setLayoutRequest('');};
  const walkthrough=useLayoutWalkthrough((next,itemId)=>{
    layoutFrame.current=next?{layout:next,itemId}:null;
    const base=sceneBase.current,current=projectRef.current;
    if(base)controller.current?.update({...base,room:current.room,layout:next??current.layouts.find(l=>l.id===current.activeLayoutId)!,selectedId:next?itemId??null:null,presentation:Boolean(next),showClearances:next?false:base.showClearances,mode:base.mode==='walk'&&next?'orbit':base.mode});
  },targetId=>{
    const current=projectRef.current,proposed=agentLayout.current?.id===targetId?agentLayout.current:null;
    if(proposed){
      if(current.layouts.length>=12){notify('This project has 12 layouts. Delete one, then ask again.');return false;}
      const accepted=commit(p=>{p.layouts.push(structuredClone(proposed));p.activeLayoutId=proposed.id;});
      if(accepted){agentLayout.current=null;clearAsked();notify('Layout saved. Undo returns to the previous layout.');}
      return accepted;
    }
    if(!current.layouts.some(l=>l.id===targetId)){notify('That saved layout is no longer available.');return false;}
    if(current.activeLayoutId===targetId)return true;
    const accepted=commit(p=>{p.activeLayoutId=targetId;});
    if(accepted){clearAsked();notify('Layout switched. Undo returns to the previous layout.');}
    return accepted;
  });
  const presenting=Boolean(walkthrough.view&&!walkthrough.view.finished);
  const [layoutRequest,setLayoutRequest]=useState(''),[layoutReply,setLayoutReply]=useState<LayoutAgentReply|null>(null),agentInput=useRef<HTMLInputElement>(null),[agentBusy,setAgentBusy]=useState(false);
  const agentAbort=useRef<AbortController|null>(null),movedOn=useRef(false),[agentAttempt,setAgentAttempt]=useState(1);
  const startPreset=(targetId:string,request?:string,byAgent=false,reading?:{goals?:LayoutGoal[];limits?:string})=>{
    const current=projectRef.current,target=current.layouts.find(l=>l.id===targetId);
    if(!target||(!presenting&&current.activeLayoutId===targetId))return;
    if(presenting&&walkthrough.view?.plan.toId===targetId)return;
    const snapshot=walkthrough.snapshot(),from=snapshot&&presenting?{...snapshot,id:'current-view',name:'Current view'}:current.layouts.find(l=>l.id===current.activeLayoutId)!;
    setProductPreview(null);setReplacementDraft(null);setProductOpen(false);setCostOpen(false);setModal(null);setExportOpen(false);setSelectedId(null);setMobilePanel(null);if(mode==='walk')setMode('orbit');
    walkthrough.start(from,target,current.room,request,undefined,byAgent,spaceOf(current),reading);
  };
  const useRules=(request:string,note='Keyword rules')=>{
    const current=projectRef.current,match=matchLayoutIntent(request,current.layouts,current.activeLayoutId,current.room,spaceOf(current));
    setLayoutReply({text:match.reply,meta:note});
    if(match.targetId)startPreset(match.targetId,request);
  };
  const stopAgent=()=>{agentAbort.current?.abort();agentAbort.current=null;setAgentBusy(false);};
  const cancelWalkthrough=()=>{if(!walkthrough.current.current?.completed)setLayoutReply(null);walkthrough.close();};
  const showProject=(loaded:Loaded,past:Project[]=[],future:Project[]=[],shown=loaded.project)=>{
    // Replacing the project makes any late agent reply or walkthrough callback stale.
    movedOn.current=true;stopAgent();cancelWalkthrough();agentLayout.current=null;
    synced.current={raw:loaded.raw,clean:loaded.clean,held:loaded.held};
    projectRef.current=shown;pastRef.current=past;futureRef.current=future;setProject(shown);
    setPast(past);setFuture(future);setSelectedId(null);setLayoutRequest('');setLayoutReply(null);
    setReplacementDraft(null);setProductPreview(null);setProductTarget(null);setProductOpen(false);setCostOpen(false);setModal(null);setExportOpen(false);setMobilePanel(null);setMode(m=>m==='walk'?'orbit':m);
  };
  /** History, and any work storage refused, wait in memory. They are dropped if the key has moved on since. */
  const openSpace=(next:SpaceType)=>{
    const current=projectRef.current;
    shelved.current.set(spaceOf(current),{project:current,past:pastRef.current,future:futureRef.current,raw:synced.current.raw,clean:synced.current.clean});
    const loaded=loadProject(next),memory=shelved.current.get(next);
    shelved.current.delete(next);
    if(memory&&memory.raw===loaded.raw){showProject({...loaded,clean:memory.clean},memory.past,memory.future,memory.project);return;}
    showProject(loaded);
    const note=loaded.notice??(memory?'This space changed in another tab, so the latest version is showing and its undo history was cleared.':'');
    if(note)notify(note,10000);
  };
  const switchSpace=(next:SpaceType,after?:()=>void,ack:{draft?:boolean;unsaved?:boolean}={})=>{
    const current=projectRef.current;
    if(next===spaceOf(current)){after?.();return;}
    const retry=(more:typeof ack)=>()=>switchSpace(next,after,{...ack,...more});
    if(!ack.draft&&(replacementDraft||productPreview)){setPrompt({kind:'draft',retry:retry({draft:true})});return;}
    if(!ack.unsaved){
      const result=persist(current,true);
      if(result==='conflict'){setPrompt({kind:'conflict',retry:retry({draft:true})});return;}
      if(result==='failed'){setPrompt({kind:'unsaved',retry:retry({draft:true,unsaved:true})});return;}
    }
    openSpace(next);after?.();
  };
  const adoptStored=()=>{
    const current=projectRef.current,loaded=loadProject(spaceOf(current));
    showProject(loaded);
    notify(loaded.notice??`This ${place} changed in another tab, so the latest version is showing.`,8000);
  };
  // A tab with nothing unsaved just follows the newer data. Otherwise the person chooses, and saving waits.
  reconcileRef.current=()=>{
    const current=projectRef.current,raw=readStored(storageKey(spaceOf(current)));
    if(raw===null){synced.current={...synced.current,raw:null};return;}
    if(raw===synced.current.raw)return;
    const text=serializeProject(current);
    if(raw===text)synced.current={...synced.current,raw,clean:text};
    else if(text===synced.current.clean)adoptStored();
    else setPrompt(old=>old?.kind==='conflict'?old:{kind:'conflict'});
  };
  const resolveConflict=(keepMine:boolean)=>{
    const retry=prompt?.retry,current=projectRef.current;
    setPrompt(null);
    if(keepMine){
      synced.current={...synced.current,raw:readStored(storageKey(spaceOf(current)))};
      if(persist(current)==='saved'){setSaveFailed(false);setSavedSnapshot(serializeProject(current));}
      else notify('Storage is unavailable. Export your project to keep a copy.');
    }else adoptStored();
    retry?.();
  };
  const askLayout=async(text:string)=>{
    const request=text.trim(),asked=projectRef.current;
    if(!request||agentBusy||presenting)return;
    if(asked.layouts.length>=12){useRules(request,'12 layouts reached · delete one to use the agent');return;}
    if(walkthrough.view)walkthrough.close();
    const controller=new AbortController();agentAbort.current=controller;
    setAgentBusy(true);setAgentAttempt(1);setLayoutReply(null);
    const stale=()=>movedOn.current||projectRef.current!==asked;
    const movedAway=()=>setLayoutReply({text:'You moved on while the agent was working, so nothing changed. Ask again when you are ready.'});
    let result:LayoutAgentResult;
    try{
      const reply=await askLayoutAgent(request,asked,{signal:controller.signal,onAttempt:setAgentAttempt});
      result=readLayoutAgentResult(reply,asked);
    }catch(error){
      if(controller.signal.aborted)return;
      setAgentBusy(false);
      // The quick rules answer instead, and the note says why in plain words.
      const busy=error instanceof LayoutAgentHttpError&&error.status===429;
      if(stale())movedAway();else useRules(request,busy?'The agent is busy right now, so quick rules answered':'The agent could not answer just now, so quick rules answered');
      return;
    }
    if(controller.signal.aborted)return;
    setAgentBusy(false);
    if(stale()){movedAway();return;}
    const current=projectRef.current,from=current.layouts.find(l=>l.id===current.activeLayoutId)!;
    setLayoutReply({text:result.reply,meta:`${result.model} · ${(result.elapsedMs/1000).toFixed(1)}s`});
    if(result.action==='use_layout'&&result.layoutId!==from.id)startPreset(result.layoutId,request,true,result);
    if(result.action==='rearrange'){
      agentLayout.current=result.layout;
      setSelectedId(null);setMobilePanel(null);setExportOpen(false);
      walkthrough.start(from,result.layout,current.room,request,result.reasons,true,spaceOf(current),result);
    }
  };
  const deleteLayout=(id:string)=>{
    const target=projectRef.current.layouts.find(l=>l.id===id);
    if(!target||id==='original'||presenting)return;
    walkthrough.close();setReplacementDraft(null);setProductPreview(null);setSelectedId(null);setLayoutReply(null);
    if(commit(p=>{p.layouts=p.layouts.filter(l=>l.id!==id);if(p.activeLayoutId===id)p.activeLayoutId=p.layouts[0].id;}))notify(`${target.name} deleted. Undo brings it back.`);
  };
  const editLayout = useCallback(
    (mutate: (l: Layout) => void) =>
      commit((p) => {
        let l = p.layouts.find((x) => x.id === p.activeLayoutId)!;
        if (l.id === "original") {
          if (p.layouts.length >= 12) {
            throw new Error(
              "This project has 12 layouts. Open an existing alternative to edit, or export a copy first.",
            );
          }
          l = {
            ...clone(l),
            id: crypto.randomUUID(),
            name: "My layout",
            description: "A fresh take on your space",
          };
          p.layouts.push(l);
          p.activeLayoutId = l.id;
        }
        mutate(l);
      }),
    [commit, notify],
  );
  const placementKey=studio.session?.user ? `roomshift-auto-products:${studio.session.user.id}:${project.id}` : '';
  // The scope ref changes with the map, so a callback from an earlier space cannot file one space's intents under another's key.
  const saveIntents=()=>{const key=placementScope.current;if(key)try{localStorage.setItem(key,JSON.stringify([...autoIntents.current.values()]));}catch{/* Current-tab placement remains available. */}};
  const forgetIntent=(id:string,scope:string,roomId:string)=>{
    if(scope===placementScope.current){autoIntents.current.delete(id);saveIntents();return;}
    if(scope)try{localStorage.setItem(scope,JSON.stringify(readPlacementIntents(scope,roomId).filter(i=>i.id!==id)));}catch{/* The stale intent expires with its product. */}
  };
  useEffect(()=>{
    if(!studio.loaded||!placementKey||placementScope.current===placementKey)return;
    placementScope.current=placementKey;autoIntents.current=new Map(readPlacementIntents(placementKey,project.id!).map(i=>[i.id,i]));setPlacementTick(n=>n+1);
  },[studio.loaded,placementKey,project.id]);
  useEffect(()=>{
    if(!studio.loaded||!studio.pendingAutoProductId||!studio.products.some(p=>p.id===studio.pendingAutoProductId))return;
    openProducts(null,studio.pendingAutoProductId);setAutoStartProduct(true);studio.clearPendingAutoProduct();
  },[studio.pendingAutoProductId,studio.loaded,studio.products]);
  const changeProductSource=()=>{
    sourceVersion.current++;activeProductRequest.current?.abort();
    const id=activeAutoIntent.current,intent=id?autoIntents.current.get(id):undefined;
    if(!intent)return;
    autoIntents.current.delete(intent.id);activeAutoIntent.current=null;saveIntents();
    const running=studio.pipelineJobs.find(j=>j.productId===intent.productId&&['queued','running'].includes(j.status));
    if(running)pendingCancellation.current=studio.cancelGeneration(running.id).catch(()=>undefined);
    setPlacementTick(n=>n+1);
  };
  const generateProduct=async(product:ProductDraft)=>{
    if(product.kind&&!kindsForSpace(spaceOf(projectRef.current)).includes(product.kind))throw Error(ROOM_KIND_IN_STORE);
    const source=sourceVersion.current,request=new AbortController();activeProductRequest.current=request;
    await pendingCancellation.current;if(source!==sourceVersion.current)return;
    const current=projectRef.current,target=current.layouts.find(l=>l.id===current.activeLayoutId),original=target?.items.find(i=>i.id===productTarget?.id);
    if(product.roomId!==current.id)product={...product,id:crypto.randomUUID(),roomId:current.id!,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    for(const previous of autoIntents.current.values())if(previous.productId===product.id)autoIntents.current.delete(previous.id);
    if(!target)throw Error(`The target ${place} is unavailable.`);
    const intent:ProductPlacementIntent={id:crypto.randomUUID(),productId:product.id,revision:product.revision,roomId:current.id!,layoutId:target.id,targetId:original?.id??null,...(original?{targetFingerprint:JSON.stringify(original)}:{}),createdAt:Date.now()};
    autoIntents.current.set(intent.id,intent);activeAutoIntent.current=intent.id;saveIntents();setPlacementTick(n=>n+1);
    const scope=placementScope.current;
    try{await studio.generate(product,request.signal);}catch(error){forgetIntent(intent.id,scope,intent.roomId);throw error;}
  };
  useEffect(()=>{
    if(!studio.loaded||!placementKey||placementScope.current!==placementKey)return;
    for(const intent of autoIntents.current.values()){
      const product=studio.products.find(p=>p.id===intent.productId);
      if(product&&(product.model.state==='failed'||(product.revision!==intent.revision&&product.model.state!=='ready'))){autoIntents.current.delete(intent.id);saveIntents();continue;}
      if(!product||product.model.state!=='ready'||product.model.appearance!=='ai-generated'||placing.current.has(intent.id)||placementTimers.current.has(intent.id))continue;
      const job=studio.pipelineJobs.find(j=>j.productId===product.id&&j.requestedRevision===intent.revision);
      if(product.revision!==intent.revision&&job?.status!=='succeeded'){autoIntents.current.delete(intent.id);saveIntents();continue;}
      placing.current.add(intent.id);
      void(async()=>{
        try{
          const prepared=await studio.prepareModel(product);
          if(!appAlive.current||!autoIntents.current.has(intent.id)||placementScope.current!==placementKey)return;
          const current=projectRef.current,target=current.layouts.find(l=>l.id===intent.layoutId);
          if(!target||current.id!==intent.roomId){autoIntents.current.delete(intent.id);saveIntents();return;}
          const original=intent.targetId?target.items.find(i=>i.id===intent.targetId):undefined;
          const replace=original&&!original.locked&&JSON.stringify(original)===intent.targetFingerprint?original:null;
          let candidate=generatedProductToFurniture(prepared,replace);
          if(!candidate.assetId||!await getLocalModel(candidate.assetId))throw Error('The generated model is temporarily unavailable.');
          if(!appAlive.current||!autoIntents.current.has(intent.id)||placementScope.current!==placementKey)return;
          if(!kindsForSpace(spaceOf(current)).includes(candidate.kind)){autoIntents.current.delete(intent.id);saveIntents();notify(ROOM_KIND_IN_STORE);return;}
          if(!replace){candidate.id=`product-${intent.id}`;candidate=chooseProductPosition(candidate,target,current.room,{space:spaceOf(current)});}
          const accepted=commit(p=>{
            let destination=p.layouts.find(l=>l.id===intent.layoutId);if(!destination)throw Error('The destination layout changed.');
            if(destination.id==='original'){
              if(p.layouts.length>=12)throw Error(`The model is saved in My products. Your ${place} has reached its layout limit.`);
              destination={...clone(destination),id:`layout-${intent.id}`,name:'My layout',description:'A new piece, automatically added'};p.layouts.push(destination);if(p.activeLayoutId===intent.layoutId)p.activeLayoutId=destination.id;
            }
            if(destination.items.some(i=>i.id===candidate.id&&i.assetId===candidate.assetId))return;
            if(replace)destination.items=destination.items.map(i=>i.id===replace.id?clone(candidate):i);else destination.items.push(clone(candidate));
          });
          if(!accepted){autoIntents.current.delete(intent.id);saveIntents();return;}
          // Persist the room before consuming the intent, preventing duplicate additions on reload.
          persist(projectRef.current);
          autoIntents.current.delete(intent.id);saveIntents();placementRetries.current.delete(intent.id);
          setSelectedId(candidate.id);setProductOpen(false);setProductPreview(null);setReplacementDraft(null);setTab('object');setMode('orbit');setMobilePanel(null);
          requestAnimationFrame(()=>controller.current?.focusItem?.(candidate.id));notify(`Product added to your ${place}. Undo removes this change.`);
        }catch(error){
          const attempts=(placementRetries.current.get(intent.id)??0)+1;placementRetries.current.set(intent.id,attempts);
          if(attempts<3&&appAlive.current){const timer=setTimeout(()=>{placementTimers.current.delete(intent.id);setPlacementTick(n=>n+1);},attempts*2500);placementTimers.current.set(intent.id,timer);}
          else{forgetIntent(intent.id,placementKey,intent.roomId);notify(error instanceof Error?error.message:`The product model could not be loaded. Your ${place} was kept.`);}
        }finally{placing.current.delete(intent.id);}
      })();
    }
  },[studio.products,studio.pipelineJobs,studio.loaded,placementKey,placementTick,commit]);
  const editItem = useCallback(
    (id: string, changes: Partial<FurnitureItem>) =>
      editLayout((l) => {
        const item = l.items.find((i) => i.id === id);
        if (item) Object.assign(item, changes);
      }),
    [editLayout],
  );
  const deleteSelected = useCallback(() => {
    if (!selected || replacementDraft || productPreview || productOpen || costOpen || modal) return;
    if (selected.locked) {
      notify("Unlock this piece before deleting it.");
      return;
    }
    if (
      editLayout((l) => {
        l.items = l.items.filter((item) => item.id !== selected.id);
      })
    ) {
      setSelectedId(null);
      setMobilePanel(null);
      notify(`${selected.name} deleted. Ctrl/⌘ Z restores it.`);
    }
  }, [selected, replacementDraft, productPreview, productOpen, costOpen, modal, editLayout, notify]);
  const undo = useCallback(() => {
    if(presenting){cancelWalkthrough();return;}
    if (!past.length) return;
    walkthrough.close();setLayoutReply(null);
    setFuture((f) => [clone(project), ...f]);
    setProject(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, project,presenting]);
  const redo = useCallback(() => {
    if(presenting){walkthrough.close();return;}
    if (!future.length) return;
    walkthrough.close();
    setPast((p) => [...p, clone(project)]);
    setProject(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, project,presenting]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (promptRef.current?.kind === "conflict") return;
      const result = persist(projectRef.current);
      setSaveFailed(result === "failed");
      if (result === "saved") setSavedSnapshot(snapshot);
      else if (result === "failed") notify("Storage is unavailable. Export your project to keep a copy.");
      else reconcileRef.current();
    }, 350);
    return () => clearTimeout(t);
  }, [snapshot, space, notify, persist]);
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      if (e.key === null || e.key === storageKey(spaceOf(projectRef.current))) reconcileRef.current();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    let remembered = true;
    try {
      localStorage.setItem(SPACE_KEY, space);
    } catch {
      remembered = false;
    }
    const url = new URL(location.href);
    if (space === "retail") url.searchParams.set("space", "retail");
    else if (remembered) url.searchParams.delete("space");
    else url.searchParams.set("space", "room");
    if (url.href !== location.href) history.replaceState(history.state, "", url);
    if (shownSpace.current !== space) {
      shownSpace.current = space;
      controller.current?.resetView();
    }
  }, [space]);
  const earlierOffered = useRef(false);
  useEffect(() => {
    if (space !== "retail" || earlierOffered.current) return;
    earlierOffered.current = true;
    if (readStored(EARLIER_STORE_OFFERED_KEY) || !earlierStore()) return;
    // Offered once: either answer, or dismissing it, keeps the choice.
    try { localStorage.setItem(EARLIER_STORE_OFFERED_KEY, "1"); } catch { /* Offered again next visit. */ }
    setPrompt((old) => old ?? { kind: "earlier-store" });
  }, [space]);
  const openEarlierStore = () => {
    setPrompt(null);
    const earlier = earlierStore();
    if (!earlier || spaceOf(projectRef.current) !== "retail") return;
    walkthrough.close();
    if (commit((p) => Object.assign(p, earlier))) {
      setSelectedId(null); setReplacementDraft(null); setProductPreview(null); setLayoutReply(null);
      notify("Your earlier store is open. Undo brings back the flagship.", 8000);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (promptRef.current) {
        if (e.key === "Escape" && promptRef.current.kind !== "conflict") setPrompt(null);
        return;
      }
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable='true']",
        )
      )
        return;
      if(agentBusy&&e.key==='Escape'){e.preventDefault();stopAgent();return;}
      if(presenting){
        if(e.key==='Escape'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')){e.preventDefault();cancelWalkthrough();}
        else if(e.code==='Space'&&!(e.target as HTMLElement)?.closest('.space-switch')){e.preventDefault();walkthrough.toggle();}
        return;
      }
      if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!modal&&!productOpen&&!costOpen&&!replacementDraft&&!productPreview){e.preventDefault();agentInput.current?.focus();return;}
      if (productOpen || costOpen) { if (e.key === "Escape") { setProductOpen(false); setCostOpen(false); } return; }
      if (productPreview) { if (e.key === "Escape") { setProductPreview(null); setMobilePanel(null); } return; }
      if (replacementDraft && e.key !== "Escape") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (
        !modal &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat &&
        (e.key === "Delete" || e.key === "Backspace") &&
        selected
      ) {
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "Escape") {
        setReplacementDraft(null);
        setModal(null);
        setSelectedId(null);
        setMobilePanel(null);
        setExportOpen(false);
      }
      if (e.key.toLowerCase() === "r" && selected && !selected.locked)
        editItem(selected.id, { rotation: selected.rotation + Math.PI / 2 });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, redo, selected, editItem, replacementDraft, productPreview, productOpen, costOpen, modal, deleteSelected,presenting,agentBusy]);
  useEffect(
    () => () => {
      referencesRef.current.forEach((r) => URL.revokeObjectURL(r.url));
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  movedOn.current=Boolean(walkthrough.view||modal||productOpen||costOpen||replacementDraft||productPreview||mode==='walk');
  const sceneState = useMemo<SceneState>(
    () => ({
      space,
      room: project.room,
      layout: (presenting?layoutFrame.current?.layout:null) ?? (productPreview && productPreview.layoutId === layout.id && showReplacement
        ? { ...layout, items: productPreview.originalId ? layout.items.map(i => i.id === productPreview.originalId ? productPreview.candidate : i) : [...layout.items, productPreview.candidate] }
        : replacementDraft && showReplacement ? previewReplacement(layout, replacementDraft) : layout),
      presentation:presenting,
      ghostItem: productPreview && showReplacement ? layout.items.find(i => i.id === productPreview.originalId) ?? null : replacementDraft && showReplacement ? selected : null,
      selectedId: (presenting?layoutFrame.current?.itemId:null) ?? (productPreview ? productPreview.candidate.id : selectedId),
      mode,
      wallsVisible,
      showClearances:presenting?false:showClearances,
    }),
    [
      space,
      project.room,
      productPreview,
      layout,
      selectedId,
      mode,
      wallsVisible,
      showClearances,
      replacementDraft,
      showReplacement,
      selected,
      walkthrough.view?.plan.id,
      walkthrough.view?.finished,
    ],
  );
  sceneBase.current=sceneState;
  const select = (id: string | null) => {
    if(presenting)return;
    if(walkthrough.view)walkthrough.close();
    if (replacementDraft || productPreview || productOpen || costOpen) return;
    setSelectedId(id);
    if (id) {
      setTab("object");
      if (window.innerWidth < 1100) setMobilePanel("properties");
    }
  };
  const onMove = (id: string, position: Position) => {
    if (productPreview && id === productPreview.candidate.id) { setProductPreview(old => old ? { ...old, candidate: { ...old.candidate, position: { x: Math.round(position.x * 100) / 100, z: Math.round(position.z * 100) / 100 } } } : old); return true; }
    if (productOpen || costOpen) return false;
    const item = layout.items.find((i) => i.id === id);
    if (!item || item.locked || replacementDraft) return false;
    return editItem(id, {
      position: {
        x: Math.round(position.x * 100) / 100,
        z: Math.round(position.z * 100) / 100,
      },
    });
  };
  const addItem = (kind: ItemKind) => {
    let item = createFurnitureItem(kind);
    item.position = { x: 0, z: 1.5 };
    let placed: ReturnType<typeof placeProduct> | null = null;
    if (space === "retail") {
      // Near the piece the person is working on, otherwise near the centre.
      placed = placeProduct(item, layout, project.room, { space, near: selected?.position });
      item = placed.item;
    }
    if (editLayout((l) => l.items.push(item))) {
      setSelectedId(item.id);
      setModal(null);
      setTab("object");
      notify(!placed ? `${item.name} added. Drag it into place.`
        : placed.errors ? `${item.name} added, but there is no free spot left in the ${place}. Drag it somewhere, or make room first.`
        : placed.warnings ? `${item.name} added in the clearest spot left, which still crowds a nearby piece. Drag it, or make room first.`
        : `${item.name} added in a clear spot${WALL_KINDS.includes(kind) ? " against a wall" : ""}. Drag it to move it.`, 6000);
    }
  };
  const saveLayout = () => {
    const name = layoutName.trim();
    if (!name) return;
    const success = commit((p) => {
      const l = clone(p.layouts.find((x) => x.id === p.activeLayoutId)!);
      l.id = crypto.randomUUID();
      l.name = name.slice(0, 40);
      l.description = "Your own arrangement";
      p.layouts.push(l);
      p.activeLayoutId = l.id;
    });
    if (success) {
      setModal(null);
      notify(space === "retail" ? "Layout saved." : "Layout saved. Make yourself at home.");
    }
  };
  const importProject = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      notify(
        `Could not open this ${place}: The project is too large (maximum 2 MB).`,
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    try {
      const parsed = parseProject(await file.text()), target = spaceOf(parsed);
      const next = { ...parsed, id: parsed.id ?? crypto.randomUUID(), name: parsed.name ?? (file.name.replace(/\.json$/i, "").slice(0, 80) || (target === "retail" ? "My store" : "My room")) };
      const moved = target !== spaceOf(projectRef.current);
      // A file opens in its own space. Committing there keeps that space's previous project one undo away.
      switchSpace(target, () => {
        commit((p) => Object.assign(p, next));
        setSelectedId(null);
        setReplacementDraft(null); setProductPreview(null); setProductOpen(false);
        notify(
          moved
            ? `Project opened in ${target === "retail" ? "the store" : "the bedroom"}. Undo restores the one it replaced.`
            : "Project opened successfully. Imported GLB files are stored separately in this browser.",
        );
      });
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "This project file could not be opened.",
      );
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const capture = () => {
    const startedAt = new Date().toISOString(), started = performance.now();
    try {
      const url = controller.current?.capture();
      if (!url) {
        notify(`Wait for the ${place} to finish loading.`);
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "roomshift-" + layout.name.toLowerCase().replaceAll(" ", "-") + ".png";
      a.click();
      notify(`${Place} image downloaded.`);
      void studio.record(createLocalOperation({ roomId: project.id!, roomName: project.name, kind: "render", name: `Export ${place} image`, engine: "Three.js PNG export", startedAt, elapsedMs: performance.now() - started }));
    } catch {
      notify(`The ${place} image could not be exported.`);
    }
    setExportOpen(false);
  };
  const exportProject = () => {
    downloadFile("roomshift-project.json", serializeProject(projectRef.current));
    notify("Project downloaded.");
  };
  const convert = (m: number) => toDisplayUnits(m, project.unit);
  const changeDimension = (
    axis: "width" | "depth" | "height",
    value: number,
  ) => {
    if (!selected) return false;
    return editItem(selected.id, {
      dimensions: {
        ...selected.dimensions,
        [axis]: fromDisplayUnits(value, project.unit),
      },
      dimensionSource: "estimated",
    });
  };
  useEffect(() => {
    let active = true;
    setMissingModel(false);
    if (selected?.assetId?.startsWith("local:"))
      getLocalModel(selected.assetId)
        .then((blob) => {
          if (active) setMissingModel(!blob);
        })
        .catch(() => {
          if (active) setMissingModel(true);
        });
    return () => {
      active = false;
    };
  }, [selected?.assetId]);
  const selectedIssues = selected
    ? issues.filter((i) => i.itemIds.includes(selected.id))
    : [];
  return (
    <div className={`app-shell laptop-studio${panels.leftCollapsed?" left-collapsed":""}${panels.layoutsCollapsed?" layouts-collapsed":""}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Roomshift home">
          <Box size={26} strokeWidth={1.3} />
          <span>
            ROOMSHIFT<span className="brand-dot">®</span>
          </span>
        </a>
        <div className="breadcrumb">
          My spaces <ChevronRight size={12} />
          <span>{projectName}</span>
          <span className="project-count">01</span>
        </div>
        <div className="space-switch" role="group" aria-label="Space">
          {spaces.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={space === id ? "active" : ""}
              aria-label={label}
              aria-pressed={space === id}
              title={`Switch to ${label.toLowerCase()}`}
              onClick={() => switchSpace(id)}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="header-actions" inert={presenting}>
          <button className="button outline small studio-cost-button" aria-label="Cost & time" onClick={() => { setCostOpen(true); setProductOpen(false); setExportOpen(false); }}><Clock3 size={15}/><span>Cost & time</span></button>
          <a className="icon-button subtle studio-account" aria-label={studio.session?.user ? "Sign out of product library" : "Sign in to save products online"} title={studio.session?.user ? "Sign out of product library" : "Sign in to save products online"} href={studio.session?.user ? "/signout-with-chatgpt?return_to=/" : "/signin-with-chatgpt?return_to=/"} target="_top"><UserRound size={16}/></a>
          <span className="save-status">
            <i />
            {saveFailed ? "Not saved" : saved ? "Saved on this device" : "Saving…"}
          </span>
          <button
            className="icon-button subtle"
            title="Open project"
            aria-label="Open project"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} />
          </button>
          <div className="export-wrap">
            <button
              className="button outline small"
              onClick={() => setExportOpen(!exportOpen)}
            >
              Export <ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="dropdown">
                <button
                  onClick={() => {
                    exportProject();
                    setExportOpen(false);
                  }}
                >
                  <Download size={15} />
                  Project file <small>.json</small>
                </button>
                <button onClick={capture}>
                  <Camera size={15} />
                  {Place} image <small>.png</small>
                </button>
              </div>
            )}
          </div>
          <button
            className="button gold small"
            onClick={() => {
              setLayoutName("My new layout");
              setModal("save");
            }}
          >
            <Plus size={15} />
            Save a layout
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside
          className={`inventory-panel ${mobilePanel === "items" ? "mobile-open" : ""}`}
          inert={presenting}
        >
          <button className="panel-rail" type="button" aria-label={`Show ${pieces} panel`} aria-expanded={false} aria-controls="inventory-content" onClick={()=>togglePanel("leftCollapsed")}>
            <PanelLeftOpen size={17}/><span>{activeCount.toString().padStart(2, "0")}</span>
          </button>
          <div className="panel-content" id="inventory-content">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MAKE IT YOURS</span>
              <h2>
                In your {place}{" "}
                <span>{activeCount.toString().padStart(2, "0")}</span>
              </h2>
            </div>
            <button
              className="mobile-close icon-button"
              aria-label={`Close ${pieces} panel`}
              onClick={() => setMobilePanel(null)}
            >
              <X size={18} />
            </button>
            <button className="panel-collapse icon-button subtle" type="button" aria-label={`Hide ${pieces} panel`} aria-expanded={true} aria-controls="inventory-content" onClick={()=>togglePanel("leftCollapsed")}>
              <PanelLeftClose size={16}/>
            </button>
          </div>
          <div className="inventory-list">
            {layout.items.map((item) => {
              const Icon = kindIcons[item.kind];
              return (
                <div
                  key={item.id}
                  className={`item-row ${item.id === selectedId ? "selected" : ""} ${!item.visible ? "item-hidden" : ""}`}
                >
                  <button
                    className="item-select"
                    aria-label={`Select ${item.name}`}
                    onClick={() => select(item.id)}
                  >
                    <span className={`item-icon kind-${item.kind}`}>
                      <Icon size={19} strokeWidth={1.5} />
                    </span>
                    <span className="item-label">
                      <strong>{item.name}</strong>
                      <small>
                        {Math.round(item.dimensions.width * 100)} ×{" "}
                        {Math.round(item.dimensions.depth * 100)} cm
                      </small>
                    </span>
                    {item.locked && <Lock size={11} />}
                  </button>
                  <button
                    className="visibility-button"
                    aria-label={`${item.visible ? "Hide" : "Show"} ${item.name}`}
                    title={item.visible ? "Hide item" : "Show item"}
                    onClick={() =>
                      editItem(item.id, { visible: !item.visible })
                    }
                  >
                    {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
          <button className="add-furniture" onClick={() => setModal("catalog")}>
            <Plus size={16} />
            Add {pieces}<span>↗</span>
          </button>
          <div className="structure-card">
            <div className="structure-icon">
              <Layers3 size={19} strokeWidth={1.4} />
            </div>
            <div>
              <strong>The {place} itself</strong>
              <span>{space === "retail" ? "Walls, entrance & floor" : "Walls, windows & floor"}</span>
            </div>
            <button
              className="icon-button"
              aria-label={`Edit ${place} dimensions`}
              onClick={() => {
                setRoomDraft(clone(project.room));
                setModal("room");
              }}
            >
              <Settings2 size={15} />
            </button>
          </div>
          <div className="inventory-bottom">
            <div className="scan-badge">
              <span className="scan-orbit">
                <Box size={16} />
              </span>
              <span>
                <strong>{space === "retail" ? "Starts from a sample floor plan" : "Built from your walkthrough"}</strong>
                <small>Measurements are estimated</small>
              </span>
            </div>
            <button
              className="text-link"
              onClick={() => setModal("references")}
            >
              Your reference library <ArrowUpRight size={13} />
            </button>
          </div>
          </div>
        </aside>
        <section
          className="stage"
          data-mode={mode}
          aria-label={`${Place} design workspace`}
        >
          <RoomCanvas
            state={sceneState}
            onSelect={select}
            onMove={onMove}
            onController={(c) => (controller.current = c)}
            onReady={() => { sceneFinished.current ??= performance.now(); setReady(true); }}
            onError={setSceneError}
          />
          <div className="stage-heading">
            <div className="eyebrow">
              <span className="tiny-line" />A SPACE FOR POSSIBILITIES
            </div>
            <h1>
              A little shift.
              <br />
              <em>A whole new {place}.</em>
            </h1>
            <p>Select a piece. Try something new in its place.</p>
          </div>
          <div className="viewport-tools">
            <div className="history-tools">
              <button
                className="icon-button"
                aria-label="Undo"
                disabled={!past.length || !!replacementDraft || !!productPreview || productOpen || costOpen || presenting}
                onClick={undo}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                disabled={!future.length || !!replacementDraft || !!productPreview || productOpen || costOpen || presenting}
                onClick={redo}
              >
                <Redo2 size={16} />
              </button>
              <span />
              <button
                className="icon-button"
                aria-label="Reset view"
                onClick={() => controller.current?.resetView()}
              >
                <Maximize2 size={15} />
              </button>
            </div>
            <button
              className="room-size"
              onClick={() => {
                setRoomDraft(clone(project.room));
                setModal("room");
              }}
            >
              <Ruler size={13} />
              {project.room.width.toFixed(1)} × {project.room.depth.toFixed(1)}{" "}
              m<span>EST.</span>
            </button>
          </div>
          {!ready && !sceneError && (
            <div className="stage-loading">
              <span />
              {space === "retail" ? "Setting up your store…" : "Making room for you…"}
            </div>
          )}
          {sceneError && (
            <div className="scene-error">
              <Box size={26} />
              <strong>The 3D view couldn’t start</strong>
              <p>{sceneError}</p>
              <small>
                Your {pieces} and layout controls are still available.
              </small>
            </div>
          )}
          <LayoutAgentComposer ref={agentInput} space={space} value={layoutRequest} busy={agentBusy} attempt={agentAttempt} disabled={presenting} hidden={presenting||mode==='walk'||!!replacementDraft||!!productPreview} reply={layoutReply} onStop={stopAgent} canReset={project.activeLayoutId!=='original'&&project.layouts.some(l=>l.id==='original')} onChange={setLayoutRequest} onAsk={askLayout} onDismiss={()=>setLayoutReply(null)}/>
          <div className="stage-bottom">
            <div className="view-options">
              <button
                className={wallsVisible ? "active" : ""}
                aria-label="Toggle walls"
                aria-pressed={wallsVisible}
                onClick={() => setWallsVisible(!wallsVisible)}
              >
                <Layers3 size={14} />
                <span>Walls</span>
              </button>
              <button
                className={showClearances ? "active" : ""}
                aria-label="Toggle clearance guides"
                aria-pressed={showClearances}
                onClick={() => setShowClearances(!showClearances)}
              >
                <Ruler size={14} />
                <span>Clearances</span>
              </button>
            </div>
            <div className="mode-switch" aria-label="View mode" inert={presenting}>
              {(
                [
                  { id: "plan", Icon: Grid2X2, label: "2D plan" },
                  { id: "orbit", Icon: Box, label: "3D view" },
                  { id: "walk", Icon: Footprints, label: "Walk inside" },
                ] as const
              ).map(({ id, Icon, label }) => (
                <button
                  key={id}
                  className={mode === id ? "active" : ""}
                  aria-pressed={mode === id}
                  onClick={() => setMode(id)}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
            <button
              className="icon-button help-button"
              aria-label="Navigation help"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={18} />
            </button>
          </div>
          <div className="stage-instructions">
            <MousePointer2 size={11} />
            {mode === "walk"
              ? "Drag to look · WASD or arrows to walk"
              : mode === "plan"
                ? "Select an item, then drag to move · Scroll to zoom"
                : "Drag to orbit · Scroll to zoom · Click an item to make a move"}
          </div>
          <div className="room-compass">
            <span>VIEW</span>
            <i>↑</i>
          </div>
          <button
            className="mobile-furniture-button"
            onClick={() => setMobilePanel("items")}
          >
            <Menu size={16} />
            {Pieces} <span>{activeCount}</span>
          </button>
        </section>
        <aside
          className={`properties-panel ${mobilePanel === "properties" ? "mobile-open" : ""} ${walkthrough.view?'walkthrough-panel':''}`}
        >
          {walkthrough.view ? <LayoutExplainerPanel {...walkthrough.view} space={space} onToggle={walkthrough.toggle} onNext={walkthrough.next} onPrevious={walkthrough.previous} onReplay={walkthrough.replay} onClose={cancelWalkthrough} onFinish={walkthrough.finish} onSeek={walkthrough.seek} onSpeed={walkthrough.speed}/> : productPreview && productPreview.layoutId === layout.id ? (
            <ProductPreviewPanel space={spaceOf(project)} product={productPreview.product} candidate={productPreview.candidate} original={layout.items.find(i => i.id === productPreview.originalId) ?? null} layout={layout} room={project.room} showAfter={showReplacement} onCompare={setShowReplacement} onFocus={() => controller.current?.focusItem?.(productPreview.candidate.id)} onBack={() => { const preview = productPreview; setProductPreview(null); openProducts(layout.items.find(i => i.id === preview.originalId) ?? null, preview.product.id); }} onConfirm={() => {
              const preview = productPreview;
              if (preview.layoutId !== layout.id || (preview.originalId && (!layout.items.some(i => i.id === preview.originalId) || layout.items.find(i => i.id === preview.originalId)?.locked))) { notify("The layout changed. Review this product again before using it."); return; }
              const accepted = editLayout(l => { if (preview.originalId) l.items = l.items.map(i => i.id === preview.originalId ? clone(preview.candidate) : i); else l.items.push(clone(preview.candidate)); });
              if (accepted) { setSelectedId(preview.candidate.id); setProductPreview(null); setTab("object"); notify(`Product saved. Undo restores the previous ${place} layout.`); }
            }} />
          ) : replacementDraft && selected ? (
            <ReplacementPanel
              original={selected}
              onProductLink={() => openProducts(selected)}
              candidate={replacementDraft}
              layout={layout}
              room={project.room}
              space={space}
              showAfter={showReplacement}
              onCompare={setShowReplacement}
              onChange={setReplacementDraft}
              onCancel={() => setReplacementDraft(null)}
              onFocus={() => controller.current?.focusItem?.(selected.id)}
              onConfirm={() => {
                const accepted = editLayout((l) => {
                  const index = l.items.findIndex(
                    (i) => i.id === replacementDraft.id,
                  );
                  if (index >= 0) l.items[index] = clone(replacementDraft);
                });
                if (accepted) {
                  setReplacementDraft(null);
                  notify(
                    "Replacement saved. Undo brings your previous piece back.",
                  );
                }
                return accepted;
              }}
            />
          ) : (
            <>
              <div className="property-tabs">
                <button
                  className={tab === "object" ? "active" : ""}
                  onClick={() => setTab("object")}
                >
                  <Move size={14} />
                  Object
                </button>
                <button
                  className={tab === "finishes" ? "active" : ""}
                  onClick={() => {
                    setTab("finishes");
                    setMobilePanel("properties");
                  }}
                >
                  <Palette size={14} />
                  Finishes
                </button>
                <button
                  className="mobile-close icon-button"
                  aria-label="Close properties"
                  onClick={() => setMobilePanel(null)}
                >
                  <X size={16} />
                </button>
              </div>
              {tab === "object" && selected ? (
                <>
                  <div className="selected-object">
                    <span className="eyebrow">
                      {selected.dimensionSource === "product"
                        ? "NEW POSSIBILITY"
                        : space === "retail" ? "YOUR FIXTURE" : "YOUR FURNITURE"}
                    </span>
                    <div className="selected-title">
                      <h2>{selected.name}</h2>
                      <button
                        className="icon-button"
                        aria-label={
                          selected.locked ? "Unlock object" : "Lock object"
                        }
                        onClick={() =>
                          editItem(selected.id, { locked: !selected.locked })
                        }
                      >
                        {selected.locked ? (
                          <Lock size={15} />
                        ) : (
                          <Unlock size={15} />
                        )}
                      </button>
                    </div>
                    <div className="object-preview">
                      {(selected.assetId?.startsWith('local:')?selectedProductPhoto:selected.assetId||kindsForSpace("room").includes(selected.kind))&&<img
                        className="object-render-preview"
                        src={selected.assetId?.startsWith('local:')?selectedProductPhoto:`/assets/thumbnails/${selected.assetId?.startsWith("builtin:") ? selected.assetId.slice(8) : selected.kind}.png`}
                        alt={selected.name}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />}
                      <span
                        className={`preview-platform preview-${selected.kind}`}
                      >
                        {(() => {
                          const Icon = selected.assetId?.startsWith('local:')?Box:kindIcons[selected.kind];
                          return <Icon size={65} strokeWidth={0.85} />;
                        })()}
                      </span>
                      <span className="object-preview-label">
                        {kindNames[selected.kind]}
                      </span>
                    </div>
                  </div>
                  <div className="primary-object-actions">
                    <button
                      className="button gold"
                      aria-label="Replace this piece"
                      disabled={selected.locked}
                      onClick={() => {
                        setReplacementDraft(
                          createReplacementDraft(selected, selected),
                        );
                        setShowReplacement(true);
                        setMode("orbit");
                      }}
                    >
                      Try a replacement <ArrowUpRight size={14} />
                    </button>
                    <button className="focus-piece product-link-entry" onClick={() => openProducts(selected)}><Link2 size={13}/>Have a product link?</button>
                    <button
                      className="focus-piece"
                      onClick={() =>
                        controller.current?.focusItem?.(selected.id)
                      }
                    >
                      Focus on this piece <Maximize2 size={12} />
                    </button>
                    {missingModel && (
                      <p className="missing-model-note">
                        This model is not stored in this browser. Replace it
                        with the original GLB to restore its appearance.
                      </p>
                    )}
                  </div>
                  <div className="property-section">
                    <div className="section-label">
                      DIMENSIONS
                      <button
                        onClick={() =>
                          commit((p) => {
                            p.unit = p.unit === "cm" ? "in" : "cm";
                          })
                        }
                      >
                        {project.unit}
                        <ChevronDown size={10} />
                      </button>
                    </div>
                    <div className="dimension-grid">
                      {(["width", "depth", "height"] as const).map((axis) => (
                        <label key={axis}>
                          <span>{axis}</span>
                          <div>
                            <DimensionInput
                              key={`${selected.id}-${project.unit}-${axis}`}
                              label={`Object ${axis}`}
                              min={convert(DIMENSION_LIMITS[axis].min)}
                              max={convert(DIMENSION_LIMITS[axis].max)}
                              unit={project.unit}
                              value={convert(selected.dimensions[axis])}
                              disabled={selected.locked}
                              onCommit={(value) => changeDimension(axis, value)}
                              onInvalidValue={notify}
                            />
                            <small>{project.unit}</small>
                          </div>
                        </label>
                      ))}
                    </div>
                    <p className="dimension-entry-help">
                      Enter or click outside to apply · Esc cancels
                    </p>
                    <label className="measurement-check">
                      <input
                        type="checkbox"
                        checked={selected.dimensionSource !== "estimated"}
                        disabled={selected.locked}
                        onChange={(e) =>
                          editItem(selected.id, {
                            dimensionSource: e.target.checked
                              ? "measured"
                              : "estimated",
                          })
                        }
                      />
                      <span>I’ve checked these measurements</span>
                    </label>
                  </div>
                  <div className="property-section">
                    <div className="section-label">
                      ROTATION
                      <span>
                        {Math.round(
                          ((((selected.rotation * 180) / Math.PI) % 360) +
                            360) %
                            360,
                        )}
                        °
                      </span>
                    </div>
                    <div className="rotate-controls">
                      <button
                        disabled={selected.locked}
                        aria-label="Rotate left"
                        onClick={() =>
                          editItem(selected.id, {
                            rotation: selected.rotation - Math.PI / 2,
                          })
                        }
                      >
                        <RotateCcw size={14} />
                        90° left
                      </button>
                      <button
                        disabled={selected.locked}
                        aria-label="Rotate right"
                        onClick={() =>
                          editItem(selected.id, {
                            rotation: selected.rotation + Math.PI / 2,
                          })
                        }
                      >
                        90° right
                        <RotateCw size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="property-section">
                    <div className="section-label">MATERIAL COLOR</div>
                    <div className="swatches">
                      {furnitureColors.map((c) => (
                        <button
                          key={c}
                          className={selected.color === c ? "chosen" : ""}
                          style={{ background: c }}
                          aria-label={`Object color ${c}`}
                          onClick={() => editItem(selected.id, { color: c })}
                        >
                          {selected.color === c && <Check size={12} />}
                        </button>
                      ))}
                      <label
                        className="custom-color"
                        title="Custom object color"
                      >
                        <Plus size={13} />
                        <input
                          aria-label="Custom object color"
                          type="color"
                          value={selected.color}
                          onChange={(e) =>
                            editItem(selected.id, { color: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div
                    className={`fit-note ${selectedIssues.length ? "has-issues" : ""}`}
                  >
                    <span>
                      {selectedIssues.length ? (
                        <Ruler size={15} />
                      ) : (
                        <Check size={15} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {selectedIssues.length
                          ? "A little adjustment needed"
                          : selected.dimensionSource === "estimated"
                            ? "Looks good in this draft"
                            : "No placement conflicts"}
                      </strong>
                      <p>
                        {selectedIssues.length
                          ? selectedIssues[0].message
                          : selected.dimensionSource === "estimated"
                            ? "Confirm dimensions before deciding on a tight fit."
                            : "Based on the dimensions entered."}
                      </p>
                    </div>
                  </div>
                  <div className="object-actions">
                    <button
                      onClick={() => {
                        const item = {
                          ...clone(selected),
                          id: crypto.randomUUID(),
                          name: selected.name + " copy",
                          position: {
                            x: selected.position.x + 0.3,
                            z: selected.position.z + 0.3,
                          },
                          locked: false,
                        };
                        if (editLayout((l) => l.items.push(item)))
                          setSelectedId(item.id);
                      }}
                    >
                      <Copy size={13} />
                      Duplicate
                    </button>
                    <button
                      onClick={() =>
                        editItem(selected.id, { visible: !selected.visible })
                      }
                    >
                      {selected.visible ? (
                        <EyeOff size={13} />
                      ) : (
                        <Eye size={13} />
                      )}{" "}
                      {selected.visible ? "Put aside" : "Bring back"}
                    </button>
                    <button
                      className="delete-object"
                      aria-label="Delete object"
                      disabled={selected.locked}
                      onClick={deleteSelected}
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </>
              ) : tab === "object" ? (
                <div className="empty-properties">
                  <div className="empty-symbol">
                    <MousePointer2 size={27} strokeWidth={1} />
                  </div>
                  <span className="eyebrow">EVERYTHING HAS A PLACE</span>
                  <h2>
                    What would you
                    <br />
                    like to move?
                  </h2>
                  <p>
                    Select something in the {place} or from your {pieces} list to
                    explore its possibilities.
                  </p>
                  <div className="empty-divider" />
                  <div className="tip">
                    <span>01</span>
                    <p>Click a piece to select it.</p>
                  </div>
                  <div className="tip">
                    <span>02</span>
                    <p>Move it, or try a replacement.</p>
                  </div>
                  <div className="tip">
                    <span>03</span>
                    <p>Compare the result before committing.</p>
                  </div>
                  <button
                    className="button outline"
                    onClick={() => setModal("catalog")}
                  >
                    <Plus size={14} />
                    Find something new
                  </button>
                </div>
              ) : (
                <div className="finishes-content">
                  <span className="eyebrow">SET THE MOOD</span>
                  <h2>
                    A fresh coat.
                    <br />A fresh feeling.
                  </h2>
                  <p>Try a quieter neutral or a little more personality.</p>
                  <div className="property-section">
                    <div className="section-label">
                      {place.toUpperCase()} WALLS
                      <label className="custom-color">
                        <Plus size={12} />
                        <input
                          aria-label="Custom wall color"
                          type="color"
                          value={layout.wallColor}
                          onChange={(e) =>
                            editLayout((l) => (l.wallColor = e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <div className="swatches large">
                      {colors.map((c) => (
                        <button
                          key={c}
                          className={layout.wallColor === c ? "chosen" : ""}
                          style={{ background: c }}
                          aria-label={`Wall color ${c}`}
                          onClick={() => editLayout((l) => (l.wallColor = c))}
                        >
                          {layout.wallColor === c && <Check size={15} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="property-section">
                    <div className="section-label">
                      ACCENT WALL
                      <label className="custom-color">
                        <Plus size={12} />
                        <input
                          aria-label="Custom accent color"
                          type="color"
                          value={layout.accentColor}
                          onChange={(e) =>
                            editLayout((l) => (l.accentColor = e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <div className="swatches large">
                      {colors.map((c) => (
                        <button
                          key={c}
                          className={layout.accentColor === c ? "chosen" : ""}
                          style={{ background: c }}
                          aria-label={`Accent color ${c}`}
                          onClick={() => editLayout((l) => (l.accentColor = c))}
                        >
                          {layout.accentColor === c && <Check size={15} />}
                        </button>
                      ))}
                    </div>
                    <small className="muted-note">
                      Applied to the back wall.
                    </small>
                  </div>
                  <div className="finish-note">
                    <Palette size={17} />
                    <p>
                      Colors are a preview. Lighting and your screen affect how
                      paint appears.
                    </p>
                  </div>
                </div>
              )}
              <div className="properties-footer">
                <span
                  className={`status-dot ${issues.length ? "warning" : ""}`}
                />
                {issues.length
                  ? `${issues.length} placement ${issues.length === 1 ? "note" : "notes"}`
                  : space === "retail" ? "Space to move, space to browse" : "Room to move, room to breathe"}
                <button
                  aria-label="Show placement notes"
                  onClick={() => {
                    setShowClearances(true);
                    notify(
                      issues.length
                        ? issues
                            .map((i) => i.message)
                            .slice(0, 2)
                            .join(" ")
                        : "No overlaps or doorway conflicts in this draft. Dimensions still need verification.",
                    );
                  }}
                >
                  <ArrowUpRight size={12} />
                </button>
              </div>
            </>
          )}
        </aside>
      </main>
      <section className="layouts-section" aria-label="Saved layouts">
        <button className="layouts-toggle icon-button subtle" type="button" aria-label={panels.layoutsCollapsed?"Show layout cards":"Hide layout cards"} aria-expanded={!panels.layoutsCollapsed} aria-controls="layout-cards" onClick={()=>togglePanel("layoutsCollapsed")}>
          {panels.layoutsCollapsed?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
        </button>
        {panels.layoutsCollapsed&&<div className="layout-pills" role="group" aria-label="Layouts">
          <span className="eyebrow">LAYOUTS</span>
          {project.layouts.map(l=><button key={l.id} type="button" className={l.id===layout.id?"active":""} aria-pressed={l.id===layout.id} disabled={presenting} onClick={()=>startPreset(l.id)}>{l.name}</button>)}
        </div>}
        <div className="layouts-intro">
          <span className="eyebrow">SAME {place.toUpperCase()}, NEW POSSIBILITIES</span>
          <h2>Find your flow.</h2>
          <p>Choose a layout. Watch it come together.</p>
        </div>
        <div className="layout-cards" id="layout-cards">
          {project.layouts.map((l, index) => (
            <div className="layout-card-wrap" key={l.id}>
            <button
              className={`layout-card ${l.id === layout.id ? "active" : ""}`}
              aria-label={`Switch to ${l.name}`}
              aria-pressed={l.id === layout.id}
              aria-busy={presenting&&walkthrough.view?.plan.toId===l.id}
              onClick={() => startPreset(l.id)}
            >
              <MiniPlan layout={l} project={project} />
              <div className="layout-card-text">
                <span className="layout-number">
                  {(index + 1).toString().padStart(2, "0")}
                  {l.id === "original" && <small>ORIGINAL</small>}
                </span>
                <strong>{l.name}</strong>
                <small>{l.description}</small>
              </div>
              <span className="layout-check">
                {l.id === layout.id ? (
                  <Check size={13} />
                ) : (
                  <ArrowUpRight size={13} />
                )}
              </span>
            </button>
            {l.id!=='original'&&<button className="layout-delete" aria-label={`Delete ${l.name}`} disabled={presenting} onClick={()=>deleteLayout(l.id)}><X size={12}/></button>}
            </div>
          ))}
          <button
            className="new-layout-card"
            disabled={presenting}
            aria-label="Create layout"
            onClick={() => {
              setLayoutName("My new layout");
              setModal("save");
            }}
          >
            <Plus size={23} strokeWidth={1} />
            <span>Your next idea</span>
          </button>
        </div>
      </section>
      <footer className="page-footer">
        <span>
          <i />A {place} that feels a little more like you.
        </span>
        <span>
          Dimensions estimated <span className="footer-sep">·</span>
          <button
            onClick={() => {
              setRoomDraft(clone(project.room));
              setModal("room");
            }}
          >
            Make it to measure <ArrowUpRight size={11} />
          </button>
        </span>
      </footer>
      <div className="mobile-toolbar">
        <button onClick={() => setMobilePanel("items")}>
          <Layers3 size={17} />
          {Pieces}
        </button>
        <button
          onClick={() => {
            setTab("finishes");
            setMobilePanel("properties");
          }}
        >
          <Palette size={17} />
          Finishes
        </button>
        <button onClick={() => setModal("catalog")}>
          <Plus size={18} />
          Add new
        </button>
        <button
          onClick={() => {
            setLayoutName("My new layout");
            setModal("save");
          }}
        >
          <Save size={17} />
          Save
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => importProject(e.target.files?.[0])}
      />
      <input
        ref={mediaInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
            .filter(
              (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
            )
            .slice(0, Math.max(0, 12 - references.length));
          setReferences((r) => [
            ...r,
            ...files.map((f) => ({
              name: f.name,
              url: URL.createObjectURL(f),
              type: f.type,
            })),
          ]);
          if (files.length) notify("References added for this session.");
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {productOpen && <ProductWorkbench space={space} autoStart={autoStartProduct} onSourceChange={changeProductSource} pipelineSession={studio.pipelineSession} pipelineJobs={studio.pipelineJobs} onCancelGeneration={studio.cancelGeneration} storageNote={studio.storageNote} original={productTarget} initialProductId={initialProductId} roomId={project.id!} roomName={projectName} products={studio.products} session={studio.session} onResolve={studio.resolve} onSave={studio.save} onTry={tryProduct} onClose={() => setProductOpen(false)} onImportModel={studio.importModel} onAddImage={studio.addImage} onGenerate={generateProduct}/>}
      {costOpen && <CostTimePanel space={space} storageNote={studio.storageNote} operations={studio.operations} products={studio.products} roomId={project.id!} roomName={projectName} onClose={() => setCostOpen(false)}/>}
      {prompt && (
        <div className="modal-backdrop space-prompt-backdrop">
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={prompt.kind === "conflict" ? "Changed in another tab" : prompt.kind === "unsaved" ? "Changes not saved" : prompt.kind === "earlier-store" ? "Your earlier store" : "Leave this replacement"}
          >
            {prompt.kind === "conflict" ? (
              <>
                <h2>Changed in another tab.</h2>
                <p>This {place} was saved in another tab while you had unsaved changes here. Choose which version to keep.</p>
                <div className="space-prompt-actions">
                  <button autoFocus className="button gold" onClick={() => resolveConflict(false)}>Load the newer version</button>
                  <button className="button outline" onClick={() => resolveConflict(true)}>Keep my changes</button>
                  <button className="button outline" onClick={exportProject}>Export my version</button>
                </div>
              </>
            ) : prompt.kind === "earlier-store" ? (
              <>
                <h2>Your earlier store is still here.</h2>
                <p>The store now starts as the 20 × 28 m flagship. The store you saved before is still kept in this browser. Open it to carry on where you left off, and Undo brings the flagship back. Or keep the flagship; your earlier store stays saved.</p>
                <div className="space-prompt-actions">
                  <button autoFocus className="button gold" onClick={openEarlierStore}>Open my earlier store</button>
                  <button className="button outline" onClick={() => setPrompt(null)}>Keep the flagship</button>
                </div>
              </>
            ) : prompt.kind === "unsaved" ? (
              <>
                <h2>Your changes aren’t saved.</h2>
                <p>Browser storage is full or unavailable. Export a copy, or switch anyway and they stay in this tab until it closes.</p>
                <div className="space-prompt-actions">
                  <button autoFocus className="button gold" onClick={exportProject}>Export project</button>
                  <button className="button outline" onClick={() => { const retry = prompt.retry; setPrompt(null); retry?.(); }}>Switch anyway</button>
                  <button className="button outline" onClick={() => setPrompt(null)}>Stay here</button>
                </div>
              </>
            ) : (
              <>
                <h2>Leave this replacement?</h2>
                <p>Switching closes the piece you’re trying. Your saved layout stays as it is.</p>
                <div className="space-prompt-actions">
                  <button autoFocus className="button gold" onClick={() => setPrompt(null)}>Stay here</button>
                  <button className="button outline" onClick={() => { const retry = prompt.retry; setPrompt(null); retry?.(); }}>Discard and switch</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "catalog"
                ? `Add ${pieces}`
                : modal === "room"
                  ? `${Place} dimensions`
                  : modal === "save"
                    ? "Save a layout"
                    : modal === "references"
                      ? "Reference library"
                      : "Navigation help"
            }
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "catalog" ? (
              <>
                <span className="eyebrow">MAKE SPACE FOR SOMETHING NEW</span>
                <h2>A new possibility.</h2>
                <p>Start with a piece, then give it the dimensions you need.</p>
                <button className="product-catalog-entry" onClick={() => openProducts(null)}><Link2 size={23}/><span><strong>Try a product link</strong><small>Amazon, Flipkart, or your own specifications and 3D model</small></span><ArrowUpRight size={20}/></button>
                <div className="catalog-grid">
                  {kindsForSpace(space).map((kind) => {
                    const Icon = kindIcons[kind];
                    return (
                      <button key={kind} onClick={() => addItem(kind)}>
                        <span>
                          <Icon size={38} strokeWidth={1} />
                        </span>
                        <strong>{kindNames[kind]}</strong>
                        <small>
                          Add to your {place} <Plus size={11} />
                        </small>
                      </button>
                    );
                  })}
                </div>
                <div className="catalog-note">
                  <Ruler size={16} />
                  <span>
                    Trying a purchase? Enter the seller’s outer dimensions and
                    mark them as checked.
                  </span>
                </div>
              </>
            ) : modal === "room" ? (
              <>
                <span className="eyebrow">A LITTLE MORE CERTAINTY</span>
                <h2>Make it to measure.</h2>
                <p>
                  These are starting estimates. Use your {place}’s inside
                  measurements to get a more useful fit.
                </p>
                <div className="room-dimensions">
                  {(["width", "depth", "height"] as const).map((axis) => (
                    <label key={axis}>
                      <span>{Place} {axis}</span>
                      <div>
                        <input
                          aria-label={`${Place} ${axis}`}
                          type="number"
                          min={axis === "height" ? 2.1 : 2}
                          max={axis === "height" ? 8 : 30}
                          step="0.05"
                          value={roomDraft[axis]}
                          onChange={(e) =>
                            setRoomDraft((r) => ({
                              ...r,
                              [axis]: Number(e.target.value),
                            }))
                          }
                        />
                        <small>m</small>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="muted-note">
                  Door and window positions are approximate. Confirm openings
                  before choosing a tight layout.
                </p>
                <button
                  className="button gold"
                  disabled={(["width", "depth", "height"] as const).some(
                    (a) =>
                      !Number.isFinite(roomDraft[a]) ||
                      roomDraft[a] < (a === "height" ? 2.1 : 2) ||
                      roomDraft[a] > (a === "height" ? 8 : 30),
                  )}
                  onClick={() => {
                    commit((p) => {
                      p.room = {
                        ...roomDraft,
                        door: {
                          ...roomDraft.door,
                          offset: Math.min(
                            roomDraft.door.offset,
                            roomDraft.width / 2 -
                              roomDraft.door.width / 2 -
                              0.1,
                          ),
                        },
                      };
                    });
                    setModal(null);
                    notify(
                      `${Place} dimensions updated. Check your ${pieces} placement.`,
                    );
                  }}
                >
                  Update {place} <ArrowUpRight size={15} />
                </button>
              </>
            ) : modal === "save" ? (
              <>
                <span className="eyebrow">KEEP THE POSSIBILITY</span>
                <h2>Give this layout a name.</h2>
                <p>
                  Your current arrangement and wall colors will be saved
                  together. Your original layout stays available.
                </p>
                <label className="name-input">
                  <span>LAYOUT NAME</span>
                  <input
                    autoFocus
                    maxLength={40}
                    value={layoutName}
                    onChange={(e) => setLayoutName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveLayout();
                    }}
                  />
                </label>
                <button
                  className="button gold"
                  disabled={!layoutName.trim() || project.layouts.length >= 12}
                  onClick={saveLayout}
                >
                  Save layout <Check size={15} />
                </button>
                <small className="muted-note">
                  Saved in this browser. Export a project file to move between
                  devices.
                </small>
              </>
            ) : modal === "references" ? (
              <>
                <span className="eyebrow">THE {place.toUpperCase()} YOU STARTED WITH</span>
                <h2>Your reference library.</h2>
                <p>
                  Add photos or a narrated walkthrough to refer to while
                  arranging. Files stay in this browser session.
                </p>
                <button
                  className="upload-zone"
                  onClick={() => mediaInput.current?.click()}
                >
                  <Upload size={26} strokeWidth={1} />
                  <strong>Add photos or a video</strong>
                  <span>Choose files from your device</span>
                </button>
                <div className="reference-grid">
                  {references.map((r, index) => (
                    <figure key={r.url}>
                      {r.type.startsWith("video/") ? (
                        <video src={r.url} controls playsInline />
                      ) : (
                        <img src={r.url} alt={r.name} />
                      )}
                      <figcaption>
                        {r.name}
                        <button
                          aria-label={`Remove reference ${r.name}`}
                          onClick={() => {
                            URL.revokeObjectURL(r.url);
                            setReferences((old) =>
                              old.filter((_, i) => i !== index),
                            );
                          }}
                        >
                          <X size={13} />
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <small className="muted-note">
                  References help you compare appearances. Adding a file does
                  not automatically scan or measure the {place}.
                </small>
              </>
            ) : (
              <>
                <span className="eyebrow">FIND YOUR WAY AROUND</span>
                <h2>{space === "retail" ? "Walk the floor." : "Make yourself at home."}</h2>
                <div className="help-grid">
                  <div>
                    <Box size={22} />
                    <strong>Explore in 3D</strong>
                    <p>
                      Drag an empty area to orbit. Scroll or pinch to zoom.
                      Click a {space === "retail" ? "fixture" : "piece of furniture"} to select it.
                    </p>
                  </div>
                  <div>
                    <Move size={22} />
                    <strong>Make a move</strong>
                    <p>
                      Drag a selected piece to move it along the floor. Use its
                      panel to rotate, resize, recolor or put it aside. Press R
                      to rotate.
                    </p>
                  </div>
                  <div>
                    <Footprints size={22} />
                    <strong>Walk inside</strong>
                    <p>
                      Drag to look around. Use WASD, arrow keys or the on-screen
                      buttons to walk. {space === "retail" ? "Fixtures block" : "Furniture blocks"} your path.
                    </p>
                  </div>
                  <div>
                    <Save size={22} />
                    <strong>Keep your ideas</strong>
                    <p>
                      Changes save on this device. Save a layout to compare
                      ideas, or export your project to keep a portable copy.
                      Ctrl/⌘ Z undoes a change.
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
