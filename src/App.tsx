import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  ArrowDownToLine,
  ArrowUpRight,
  BedDouble,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  Fan,
  Footprints,
  Grid2X2,
  Layers3,
  Leaf,
  Lock,
  Maximize2,
  Menu,
  MousePointer2,
  Move,
  Palette,
  PanelTop,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Settings2,
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
  ViewMode,
} from "./types";
import {
  createFurnitureItem,
  createInitialProject,
  parseProject,
  serializeProject,
  validateLayout,
} from "./domain";
import { createRoomScene } from "./scene";

const STORAGE_KEY = "roomshift-project-v1";
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
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
function initialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseProject(saved);
  } catch {}
  return createInitialProject();
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
  useEffect(() => controller.current?.update(state), [state]);
  return <div ref={host} className="canvas-host" data-testid="room-canvas" />;
}

function MiniPlan({ layout, project }: { layout: Layout; project: Project }) {
  return (
    <div className="mini-plan">
      <div className="mini-plan-inner">
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
  const [project, setProject] = useState<Project>(initialProject),
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
    [exportOpen, setExportOpen] = useState(false);
  const [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]),
    [layoutName, setLayoutName] = useState("My new layout"),
    [roomDraft, setRoomDraft] = useState(project.room),
    [references, setReferences] = useState<
      { name: string; url: string; type: string }[]
    >([]);
  const controller = useRef<SceneController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    mediaInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    projectRef = useRef(project),
    referencesRef = useRef(references);
  projectRef.current = project;
  referencesRef.current = references;
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
  const notify = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);
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
  const editItem = useCallback(
    (id: string, changes: Partial<FurnitureItem>) =>
      editLayout((l) => {
        const item = l.items.find((i) => i.id === id);
        if (item) Object.assign(item, changes);
      }),
    [editLayout],
  );
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [clone(project), ...f]);
    setProject(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, project]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, clone(project)]);
    setProject(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, project]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, snapshot);
        setSavedSnapshot(snapshot);
      } catch {
        notify("Storage is unavailable. Export your project to keep a copy.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [snapshot, notify]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.key === "Escape") {
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
  }, [undo, redo, selected, editItem]);
  useEffect(
    () => () => {
      referencesRef.current.forEach((r) => URL.revokeObjectURL(r.url));
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const sceneState = useMemo<SceneState>(
    () => ({
      room: project.room,
      layout,
      selectedId,
      mode,
      wallsVisible,
      showClearances,
    }),
    [project.room, layout, selectedId, mode, wallsVisible, showClearances],
  );
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) {
      setTab("object");
      if (window.innerWidth < 1100) setMobilePanel("properties");
    }
  };
  const onMove = (id: string, position: Position) => {
    const item = layout.items.find((i) => i.id === id);
    if (!item || item.locked) return false;
    return editItem(id, {
      position: {
        x: Math.round(position.x * 100) / 100,
        z: Math.round(position.z * 100) / 100,
      },
    });
  };
  const addItem = (kind: ItemKind) => {
    const item = createFurnitureItem(kind);
    item.position = { x: 0, z: 1.5 };
    if (editLayout((l) => l.items.push(item))) {
      setSelectedId(item.id);
      setModal(null);
      setTab("object");
      notify(`${item.name} added. Drag it into place.`);
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
      notify("Layout saved. Make yourself at home.");
    }
  };
  const importProject = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      notify(
        "Could not open this room: The project is too large (maximum 2 MB).",
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    try {
      const next = parseProject(await file.text());
      commit((p) => Object.assign(p, next));
      setSelectedId(null);
      notify("Project opened successfully.");
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
    try {
      const url = controller.current?.capture();
      if (!url) {
        notify("Wait for the room to finish loading.");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download =
        "roomshift-" + layout.name.toLowerCase().replaceAll(" ", "-") + ".png";
      a.click();
      notify("Room image downloaded.");
    } catch {
      notify("The room image could not be exported.");
    }
    setExportOpen(false);
  };
  const convert = (m: number) =>
    project.unit === "cm"
      ? Math.round(m * 100)
      : Math.round(m * 39.3701 * 10) / 10;
  const fromUnit = (n: number) =>
    project.unit === "cm" ? n / 100 : n / 39.3701;
  const changeDimension = (
    axis: "width" | "depth" | "height",
    value: string,
  ) => {
    if (!selected) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 2000) return;
    editItem(selected.id, {
      dimensions: {
        ...selected.dimensions,
        [axis]: Math.min(10, Math.max(0.05, fromUnit(n))),
      },
      dimensionSource: "estimated",
    });
  };
  const selectedIssues = selected
    ? issues.filter((i) => i.itemIds.includes(selected.id))
    : [];
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Roomshift home">
          <Box size={26} strokeWidth={1.3} />
          <span>
            ROOMSHIFT<span className="brand-dot">®</span>
          </span>
        </a>
        <div className="breadcrumb">
          My spaces <ChevronRight size={12} />
          <span>My bedroom</span>
          <span className="project-count">01</span>
        </div>
        <div className="header-actions">
          <span className="save-status">
            <i />
            {saved ? "Saved on this device" : "Saving…"}
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
                    downloadFile(
                      "roomshift-project.json",
                      serializeProject(project),
                    );
                    setExportOpen(false);
                    notify("Project downloaded.");
                  }}
                >
                  <Download size={15} />
                  Project file <small>.json</small>
                </button>
                <button onClick={capture}>
                  <Camera size={15} />
                  Room image <small>.png</small>
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
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MAKE IT YOURS</span>
              <h2>
                In your room{" "}
                <span>{activeCount.toString().padStart(2, "0")}</span>
              </h2>
            </div>
            <button
              className="mobile-close icon-button"
              aria-label="Close furniture panel"
              onClick={() => setMobilePanel(null)}
            >
              <X size={18} />
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
            Add furniture<span>↗</span>
          </button>
          <div className="structure-card">
            <div className="structure-icon">
              <Layers3 size={19} strokeWidth={1.4} />
            </div>
            <div>
              <strong>The room itself</strong>
              <span>Walls, windows & floor</span>
            </div>
            <button
              className="icon-button"
              aria-label="Edit room dimensions"
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
                <strong>Built from your walkthrough</strong>
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
        </aside>
        <section className="stage" aria-label="Room design workspace">
          <RoomCanvas
            state={sceneState}
            onSelect={select}
            onMove={onMove}
            onController={(c) => (controller.current = c)}
            onReady={() => setReady(true)}
            onError={setSceneError}
          />
          <div className="stage-heading">
            <div className="eyebrow">
              <span className="tiny-line" />A SPACE FOR POSSIBILITIES
            </div>
            <h1>
              A little shift.
              <br />
              <em>A whole new room.</em>
            </h1>
            <p>Your things. A different perspective.</p>
          </div>
          <div className="viewport-tools">
            <div className="history-tools">
              <button
                className="icon-button"
                aria-label="Undo"
                disabled={!past.length}
                onClick={undo}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                disabled={!future.length}
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
              Making room for you…
            </div>
          )}
          {sceneError && (
            <div className="scene-error">
              <Box size={26} />
              <strong>The 3D view couldn’t start</strong>
              <p>{sceneError}</p>
              <small>
                Your furniture and layout controls are still available.
              </small>
            </div>
          )}
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
            <div className="mode-switch" aria-label="View mode">
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
            Furniture <span>{activeCount}</span>
          </button>
        </section>
        <aside
          className={`properties-panel ${mobilePanel === "properties" ? "mobile-open" : ""}`}
        >
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
                    : "YOUR FURNITURE"}
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
                  <span className={`preview-platform preview-${selected.kind}`}>
                    {(() => {
                      const Icon = kindIcons[selected.kind];
                      return <Icon size={65} strokeWidth={0.85} />;
                    })()}
                  </span>
                  <span className="object-preview-label">
                    {kindNames[selected.kind]}
                  </span>
                </div>
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
                        <input
                          aria-label={`Object ${axis}`}
                          type="number"
                          min="1"
                          max="2000"
                          step="1"
                          value={convert(selected.dimensions[axis])}
                          disabled={
                            selected.locked ||
                            selected.dimensionSource === "product"
                          }
                          onChange={(e) =>
                            changeDimension(axis, e.target.value)
                          }
                        />
                        <small>{project.unit}</small>
                      </div>
                    </label>
                  ))}
                </div>
                <label className="measurement-check">
                  <input
                    type="checkbox"
                    checked={selected.dimensionSource !== "estimated"}
                    disabled={selected.dimensionSource === "product"}
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
                      ((((selected.rotation * 180) / Math.PI) % 360) + 360) %
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
                  <label className="custom-color" title="Custom object color">
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
                  {selected.visible ? <EyeOff size={13} /> : <Eye size={13} />}{" "}
                  {selected.visible ? "Put aside" : "Bring back"}
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
                Select something in the room or from your furniture list to
                explore its possibilities.
              </p>
              <div className="empty-divider" />
              <div className="tip">
                <span>01</span>
                <p>Click a piece to select it.</p>
              </div>
              <div className="tip">
                <span>02</span>
                <p>Drag it to try a new spot.</p>
              </div>
              <div className="tip">
                <span>03</span>
                <p>Step inside. See how it feels.</p>
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
                  ROOM WALLS
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
                <small className="muted-note">Applied to the back wall.</small>
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
            <span className={`status-dot ${issues.length ? "warning" : ""}`} />
            {issues.length
              ? `${issues.length} placement ${issues.length === 1 ? "note" : "notes"}`
              : "Room to move, room to breathe"}
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
        </aside>
      </main>
      <section className="layouts-section" aria-label="Saved layouts">
        <div className="layouts-intro">
          <span className="eyebrow">SAME ROOM, NEW POSSIBILITIES</span>
          <h2>Find your flow.</h2>
          <p>Try a different arrangement.</p>
        </div>
        <div className="layout-cards">
          {project.layouts.map((l, index) => (
            <button
              key={l.id}
              className={`layout-card ${l.id === layout.id ? "active" : ""}`}
              aria-label={`Switch to ${l.name}`}
              aria-pressed={l.id === layout.id}
              onClick={() => {
                setProject((p) => ({ ...p, activeLayoutId: l.id }));
                setSelectedId(null);
                setMobilePanel(null);
              }}
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
          ))}
          <button
            className="new-layout-card"
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
          <i />A room that feels a little more like you.
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
          Furniture
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
                ? "Add furniture"
                : modal === "room"
                  ? "Room dimensions"
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
                <div className="catalog-grid">
                  {(Object.keys(kindNames) as ItemKind[]).map((kind) => {
                    const Icon = kindIcons[kind];
                    return (
                      <button key={kind} onClick={() => addItem(kind)}>
                        <span>
                          <Icon size={38} strokeWidth={1} />
                        </span>
                        <strong>{kindNames[kind]}</strong>
                        <small>
                          Add to your room <Plus size={11} />
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
                  These are starting estimates. Use your room’s inside
                  measurements to get a more useful fit.
                </p>
                <div className="room-dimensions">
                  {(["width", "depth", "height"] as const).map((axis) => (
                    <label key={axis}>
                      <span>Room {axis}</span>
                      <div>
                        <input
                          aria-label={`Room ${axis}`}
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
                      "Room dimensions updated. Check your furniture placement.",
                    );
                  }}
                >
                  Update room <ArrowUpRight size={15} />
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
                <span className="eyebrow">THE ROOM YOU STARTED WITH</span>
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
                  not automatically scan or measure the room.
                </small>
              </>
            ) : (
              <>
                <span className="eyebrow">FIND YOUR WAY AROUND</span>
                <h2>Make yourself at home.</h2>
                <div className="help-grid">
                  <div>
                    <Box size={22} />
                    <strong>Explore in 3D</strong>
                    <p>
                      Drag an empty area to orbit. Scroll or pinch to zoom.
                      Click a piece of furniture to select it.
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
                      buttons to walk. Furniture blocks your path.
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
