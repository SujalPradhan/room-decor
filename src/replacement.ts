import type {
  Dimensions,
  FurnitureItem,
  Layout,
  PlacementIssue,
  RoomSpec,
} from "./types";
import { validatePlacement } from "./domain";

/** A candidate occupies the original's floor-center slot, at the same yaw. */
export function createReplacementDraft(
  original: FurnitureItem,
  candidate: FurnitureItem,
): FurnitureItem {
  return {
    ...structuredClone(candidate),
    id: original.id,
    position: { ...original.position },
    rotation: original.rotation,
    visible: true,
    locked: false,
  };
}

/** Preview never changes the saved layout or counts both old and new footprints. */
export function previewReplacement(
  layout: Layout,
  candidate: FurnitureItem,
): Layout {
  if (!layout.items.some((item) => item.id === candidate.id))
    throw new Error("The piece being replaced is no longer in this layout.");
  return {
    ...structuredClone(layout),
    items: layout.items.map((item) =>
      structuredClone(item.id === candidate.id ? candidate : item),
    ),
  };
}

export interface ReplacementEvaluation {
  issues: PlacementIssue[];
  requiresMeasurement: boolean;
  delta: Dimensions;
}

export function evaluateReplacement(
  layout: Layout,
  room: RoomSpec,
  candidate: FurnitureItem,
): ReplacementEvaluation {
  const original = layout.items.find((item) => item.id === candidate.id);
  if (!original)
    throw new Error("The piece being replaced is no longer in this layout.");
  const preview = previewReplacement(layout, candidate);
  const allIssues = preview.items.flatMap((item) =>
    validatePlacement(item, preview.items, room),
  );
  const seen = new Set<string>();
  const issues = allIssues.filter((issue) => {
    if (!issue.itemIds.includes(candidate.id)) return false;
    const key = `${issue.code}:${issue.code === "clearance" ? issue.itemIds.join(":") : [...issue.itemIds].sort().join(":")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    issues,
    // Room dimensions/opening locations currently have no measured provenance.
    // Product dimensions alone therefore cannot establish verified room fit.
    requiresMeasurement: true,
    delta: {
      width: candidate.dimensions.width - original.dimensions.width,
      depth: candidate.dimensions.depth - original.dimensions.depth,
      height: candidate.dimensions.height - original.dimensions.height,
    },
  };
}
