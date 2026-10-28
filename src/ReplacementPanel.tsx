import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ImagePlus,
  LoaderCircle,
  PackagePlus,
  Upload,
  X,
} from "lucide-react";
import type { FurnitureItem, Layout, RoomSpec } from "./types";
import { ASSET_CATALOG } from "./catalog";
import { createFurnitureItem } from "./domain";
import { createReplacementDraft, evaluateReplacement } from "./replacement";
import { storeLocalModel, removeLocalModel } from "./local-assets";

interface Props {
  original: FurnitureItem;
  candidate: FurnitureItem;
  layout: Layout;
  room: RoomSpec;
  showAfter: boolean;
  onCompare: (after: boolean) => void;
  onChange: (item: FurnitureItem) => void;
  onConfirm: () => boolean;
  onCancel: () => void;
  onFocus: () => void;
}
export default function ReplacementPanel({
  original,
  candidate,
  layout,
  room,
  showAfter,
  onCompare,
  onChange,
  onConfirm,
  onCancel,
  onFocus,
}: Props) {
  const [category, setCategory] = useState(original.kind),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [photo, setPhoto] = useState<string | null>(null);
  const modelInput = useRef<HTMLInputElement>(null),
    photoInput = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    imported = useRef<string[]>([]),
    confirmedId = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const id of imported.current)
        if (id !== confirmedId.current) void removeLocalModel(id);
    };
  }, []);
  const evaluation = evaluateReplacement(layout, room, candidate);
  const options = ASSET_CATALOG.filter((a) => a.kind === category);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );
  const choose = (entry: (typeof ASSET_CATALOG)[number]) => {
    const item = createFurnitureItem(entry.kind);
    Object.assign(item, {
      name: entry.name,
      assetId: entry.id,
      dimensions: { ...entry.dimensions },
      color: entry.color,
    });
    onChange(createReplacementDraft(original, item));
    onCompare(true);
    setError("");
  };
  const dimension = (axis: "width" | "depth" | "height", value: string) => {
    const cm = Number(value);
    if (!Number.isFinite(cm) || cm <= 0 || cm > 1000) return;
    onChange({
      ...candidate,
      dimensions: { ...candidate.dimensions, [axis]: Math.max(0.05, cm / 100) },
      dimensionSource: "estimated",
    });
    onCompare(true);
  };
  const importModel = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const stored = await storeLocalModel(file);
      imported.current.push(stored.assetId);
      if (!alive.current) {
        await removeLocalModel(stored.assetId);
        return;
      }
      onChange(
        createReplacementDraft(original, {
          ...candidate,
          assetId: stored.assetId,
          color: "#ffffff",
          name: stored.name.replace(/\.glb$/i, "").slice(0, 70),
          dimensionSource: "estimated",
        }),
      );
      onCompare(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This model could not be opened.",
      );
    } finally {
      if (alive.current) setLoading(false);
      if (modelInput.current) modelInput.current.value = "";
    }
  };
  return (
    <div className="replacement-workbench">
      <header className="replacement-header">
        <button onClick={onCancel} aria-label="Cancel replacement">
          <ChevronLeft size={14} />
          Back to object
        </button>
        <span className="eyebrow">SAME SPACE. NEW POSSIBILITY.</span>
        <h2>Try a different piece.</h2>
        <p>
          Replacing <strong>{original.name}</strong>
        </p>
      </header>
      <div className="replacement-scroll">
        <div className="comparison-switch" aria-label="Replacement comparison">
          <button
            className={!showAfter ? "active" : ""}
            onClick={() => onCompare(false)}
          >
            Before
          </button>
          <button
            className={showAfter ? "active" : ""}
            onClick={() => onCompare(true)}
          >
            After <ArrowLeftRight size={12} />
          </button>
          <button
            className="focus-candidate"
            aria-label="Focus replacement"
            onClick={onFocus}
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="replacement-category">
          <label htmlFor="replacement-category">EXPLORE THE COLLECTION</label>
          <select
            id="replacement-category"
            disabled={loading}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {[...new Set(ASSET_CATALOG.map((a) => a.kind))].map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="replacement-catalog">
          {options.map((entry) => (
            <button
              key={entry.id}
              className={candidate.assetId === entry.id ? "chosen" : ""}
              onClick={() => choose(entry)}
              disabled={loading}
              aria-label={`Try ${entry.name}`}
            >
              <div>
                <img
                  src={entry.thumbnail}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.opacity = "0";
                  }}
                />
                {candidate.assetId === entry.id && (
                  <span>
                    <Check size={11} />
                  </span>
                )}
              </div>
              <strong>{entry.name}</strong>
              <small>
                {Math.round(entry.dimensions.width * 100)} ×{" "}
                {Math.round(entry.dimensions.depth * 100)} cm
              </small>
            </button>
          ))}
        </div>
        <button
          className="import-model-button"
          onClick={() => modelInput.current?.click()}
          disabled={loading}
        >
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <PackagePlus size={17} />
          )}
          <span>
            <strong>
              {loading ? "Preparing your model…" : "Bring your own 3D model"}
            </strong>
            <small>Blender, a scan or another 3D tool · GLB</small>
          </span>
          <Upload size={13} />
        </button>
        <input
          type="file"
          ref={modelInput}
          accept=".glb,model/gltf-binary"
          hidden
          onChange={(e) => importModel(e.target.files?.[0])}
        />
        {error && (
          <p className="replacement-error" role="alert">
            {error}
          </p>
        )}
        <div className="candidate-specs">
          <span className="eyebrow">THE PIECE YOU’RE TRYING</span>
          <h3>{candidate.name}</h3>
          <div className="dimension-grid">
            {(["width", "depth", "height"] as const).map((axis) => (
              <label key={axis}>
                <span>{axis}</span>
                <div>
                  <input
                    disabled={loading}
                    aria-label={`Replacement ${axis}`}
                    type="number"
                    min="5"
                    max="1000"
                    value={Math.round(candidate.dimensions[axis] * 100)}
                    onChange={(e) => dimension(axis, e.target.value)}
                  />
                  <small>cm</small>
                </div>
              </label>
            ))}
          </div>
          <label className="measurement-check">
            <input
              type="checkbox"
              disabled={loading}
              checked={candidate.dimensionSource !== "estimated"}
              onChange={(e) =>
                onChange({
                  ...candidate,
                  dimensionSource: e.target.checked ? "product" : "estimated",
                })
              }
            />
            <span>Dimensions checked against the actual piece</span>
          </label>
          <p className="model-scale-note">
            The model is scaled to these outer dimensions.
          </p>
        </div>
        <div className="dimension-comparison">
          <div>
            <span>Compared with your current piece</span>
            <RulerLine />
          </div>
          {(["width", "depth", "height"] as const).map((axis) => (
            <p key={axis}>
              <span>{axis}</span>
              <strong>
                {Math.round(original.dimensions[axis] * 100)}
                <i>→</i>
                {Math.round(candidate.dimensions[axis] * 100)} cm
              </strong>
              <small
                className={
                  candidate.dimensions[axis] > original.dimensions[axis]
                    ? "bigger"
                    : ""
                }
              >
                {candidate.dimensions[axis] === original.dimensions[axis]
                  ? "same"
                  : `${candidate.dimensions[axis] > original.dimensions[axis] ? "+" : ""}${Math.round((candidate.dimensions[axis] - original.dimensions[axis]) * 100)} cm`}
              </small>
            </p>
          ))}
        </div>
        <div
          className={`replacement-fit ${evaluation.issues.some((i) => i.severity === "error") ? "has-conflict" : ""}`}
        >
          <span>
            <Check size={15} />
          </span>
          <div>
            <strong>
              {evaluation.issues.some((i) => i.severity === "error")
                ? "Check the placement"
                : evaluation.issues.length
                  ? "A little clearance to check"
                  : "No conflicts in this draft"}
            </strong>
            <p>
              {evaluation.issues[0]?.message ??
                "Room dimensions are estimated. Measure the available space before buying."}
            </p>
          </div>
        </div>
        <button
          className="photo-reference-button"
          onClick={() => photoInput.current?.click()}
        >
          <ImagePlus size={16} />
          {photo ? "Change photo reference" : "Have a photo of the piece?"}
          <ArrowUpRight size={12} />
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && f.type.startsWith("image/"))
              setPhoto(URL.createObjectURL(f));
          }}
        />
        {photo && (
          <figure className="candidate-reference">
            <img src={photo} alt="Your furniture photo reference" />
            <figcaption>
              Appearance reference · this session
              <button
                aria-label="Remove photo reference"
                onClick={() => setPhoto(null)}
              >
                <X size={12} />
              </button>
            </figcaption>
          </figure>
        )}
        <p className="photo-reference-hint">
          A photo helps you compare appearance. Choose a model or import a GLB
          to define its 3D shape.
        </p>
      </div>
      <footer className="replacement-footer">
        <span>Preview only. Your layout is unchanged.</span>
        <button
          className="button gold"
          disabled={loading}
          onClick={() => {
            if (onConfirm()) confirmedId.current = candidate.assetId ?? null;
          }}
        >
          Use this piece <Check size={14} />
        </button>
        <button className="cancel-replacement" onClick={onCancel}>
          Keep my current piece
        </button>
      </footer>
    </div>
  );
}
function RulerLine() {
  return <span className="ruler-line">↔</span>;
}
