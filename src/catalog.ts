import type { Dimensions, ItemKind } from "./types";

export interface CatalogAsset {
  id: string;
  name: string;
  kind: ItemKind;
  dimensions: Dimensions;
  color: string;
  description: string;
  thumbnail: string;
}

const asset = (
  root: string,
  name: string,
  kind: ItemKind,
  dimensions: Dimensions,
  color: string,
  description: string,
): CatalogAsset => ({
  id: `builtin:${root}`,
  name,
  kind,
  dimensions,
  color,
  description,
  thumbnail: `/assets/thumbnails/${root}.png`,
});

/** Authored examples, not listings for purchasable products. Dimensions are estimates. */
export const ASSET_CATALOG: CatalogAsset[] = [
  asset(
    "bed",
    "Wooden bed",
    "bed",
    { width: 1.4, depth: 2.05, height: 0.85 },
    "#9b8d80",
    "A wooden frame with a raised headboard and soft bedding.",
  ),
  asset(
    "bed-platform",
    "Oak platform bed",
    "bed",
    { width: 1.55, depth: 2.12, height: 0.7 },
    "#a77b50",
    "A low oak platform with a broad timber frame.",
  ),
  asset(
    "bed-upholstered",
    "Upholstered bed",
    "bed",
    { width: 1.7, depth: 2.18, height: 1.1 },
    "#c2b4a2",
    "A padded fabric headboard and upholstered frame.",
  ),
  asset(
    "wardrobe",
    "Classic wardrobe",
    "wardrobe",
    { width: 1.25, depth: 0.55, height: 2.05 },
    "#524b43",
    "A freestanding cabinet with hinged doors.",
  ),
  asset(
    "wardrobe-sliding",
    "Sliding wardrobe",
    "wardrobe",
    { width: 1.6, depth: 0.62, height: 2.2 },
    "#b8aa94",
    "A wider storage cabinet with sliding door fronts.",
  ),
  asset(
    "desk",
    "Green work desk",
    "desk",
    { width: 1.2, depth: 0.6, height: 0.76 },
    "#365d50",
    "A simple work surface on a dark metal frame.",
  ),
  asset(
    "desk-oak",
    "Oak writing desk",
    "desk",
    { width: 1.4, depth: 0.65, height: 0.75 },
    "#b88e62",
    "A warm timber work surface with a lighter silhouette.",
  ),
  asset(
    "chair",
    "Office chair",
    "chair",
    { width: 0.62, depth: 0.62, height: 1.08 },
    "#3d4541",
    "A cushioned swivel chair with a supportive back.",
  ),
  asset(
    "chair-task",
    "Mesh task chair",
    "chair",
    { width: 0.68, depth: 0.68, height: 1.15 },
    "#465753",
    "An adjustable task chair with an open back.",
  ),
  asset(
    "floor-bed",
    "Floor mattress",
    "floor-bed",
    { width: 1.05, depth: 1.65, height: 0.14 },
    "#944c45",
    "A separate low mattress for a flexible sleeping corner.",
  ),
  asset(
    "pedestal-fan",
    "Standing fan",
    "pedestal-fan",
    { width: 0.5, depth: 0.5, height: 1.25 },
    "#dfd7c5",
    "A freestanding fan with a round base.",
  ),
  asset(
    "stool",
    "Small stool",
    "stool",
    { width: 0.35, depth: 0.35, height: 0.42 },
    "#7f6248",
    "A compact wooden seat or bedside surface.",
  ),
  asset(
    "plant",
    "Potted plant",
    "plant",
    { width: 0.42, depth: 0.42, height: 0.88 },
    "#5a7650",
    "An illustrative leafy plant in a floor pot.",
  ),
  asset(
    "shelf",
    "Open shelf",
    "shelf",
    { width: 0.8, depth: 0.35, height: 1.65 },
    "#ad835b",
    "Open timber storage with a slim footprint.",
  ),
];

export function getCatalogAsset(
  assetId: string | undefined,
): CatalogAsset | undefined {
  return ASSET_CATALOG.find((asset) => asset.id === assetId);
}

export function isSupportedAssetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (ASSET_CATALOG.some((asset) => asset.id === value) ||
      /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ))
  );
}
