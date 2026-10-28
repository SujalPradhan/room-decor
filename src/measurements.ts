export type DimensionAxis = "width" | "depth" | "height";
export const DIMENSION_LIMITS = {
  width: { min: 0.05, max: 20 },
  depth: { min: 0.05, max: 20 },
  height: { min: 0.02, max: 10 },
} as const;

export function toDisplayUnits(metres: number, unit: "cm" | "in"): number {
  return Number((metres * (unit === "cm" ? 100 : 1 / 0.0254)).toFixed(4));
}

export function fromDisplayUnits(value: number, unit: "cm" | "in"): number {
  return Number((value * (unit === "cm" ? 0.01 : 0.0254)).toFixed(5));
}

export function parseNumericDraft(
  raw: string,
  min: number,
  max: number,
): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
