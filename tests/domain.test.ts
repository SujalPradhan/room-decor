import { describe, expect, it } from "vitest";
import {
  canStand,
  createFurnitureItem,
  createInitialProject,
  getFootprint,
  parseProject,
  serializeProject,
  validateLayout,
  validatePlacement,
} from "../src/domain";
import type { FurnitureItem } from "../src/types";

const make = (
  x: number,
  z: number,
  width = 1,
  depth = 1,
  rotation = 0,
): FurnitureItem => ({
  ...createFurnitureItem("desk"),
  position: { x, z },
  dimensions: { width, depth, height: 0.75 },
  rotation,
});
const room = createInitialProject().room;
describe("Furniture placement", () => {
  it("keeps every supplied alternative inside the room without physical intersections or door conflicts", () => {
    for (const layout of createInitialProject().layouts)
      expect(
        validateLayout(layout, room).filter((i) => i.severity === "error"),
        layout.name,
      ).toEqual([]);
  });
  it("rotates a footprint with the same convention as Three.js", () => {
    const points = getFootprint(make(0, 0, 2, 1, Math.PI / 2));
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(0.5);
    expect(Math.max(...points.map((p) => p.z))).toBeCloseTo(1);
    expect(points[0].x).toBeCloseTo(-0.5);
    expect(points[0].z).toBeCloseTo(1);
  });
  it("uses oriented geometry instead of overlapping axis-aligned envelopes", () => {
    const a = make(0, 0, 2, 0.2, Math.PI / 4),
      b = make(0.5, 0.5, 2, 0.2, Math.PI / 4);
    expect(
      validatePlacement(a, [a, b], room).some((i) => i.code === "overlap"),
    ).toBe(false);
  });
  it("detects rotated overlaps and deduplicates one physical collision", () => {
    const a = make(0, 0, 1, 1),
      b = make(0.35, 0, 1, 1, Math.PI / 4);
    const layout = { ...createInitialProject().layouts[0], items: [a, b] };
    expect(
      validateLayout(layout, room).filter((i) => i.code === "overlap"),
    ).toHaveLength(1);
  });
  it("allows exact edge contact but rejects a rotated corner outside the room", () => {
    const a = make(-0.5, 0),
      b = make(0.5, 0);
    expect(
      validatePlacement(a, [b], room).some((i) => i.code === "overlap"),
    ).toBe(false);
    expect(
      validatePlacement(make(1.6, 0, 1, 1, Math.PI / 4), [], room).some(
        (i) => i.code === "outside",
      ),
    ).toBe(true);
  });
  it("uses the door swing sector rather than blocking every point in its square bounds", () => {
    const blocked = make(1.1, 2, 0.2, 0.2),
      clear = make(1.67, 1.61, 0.1, 0.1);
    expect(
      validatePlacement(blocked, [], room).some((i) => i.code === "door"),
    ).toBe(true);
    expect(
      validatePlacement(clear, [], room).some((i) => i.code === "door"),
    ).toBe(false);
  });
  it("checks available height and ignores hidden objects", () => {
    const tall = {
      ...make(0, 0),
      dimensions: { width: 1, depth: 1, height: 4 },
    };
    expect(
      validatePlacement(tall, [], room).some((i) => i.code === "outside"),
    ).toBe(true);
    const hidden = { ...make(0, 0), visible: false };
    expect(
      validatePlacement(make(0, 0), [hidden], room).some(
        (i) => i.code === "overlap",
      ),
    ).toBe(false);
    expect(validatePlacement({ ...tall, visible: false }, [], room)).toEqual(
      [],
    );
  });
  it("reports wardrobe access space separately from physical overlap", () => {
    const wardrobe = {
      ...createFurnitureItem("wardrobe"),
      position: { x: 0, z: -1 },
    };
    const obstruction = make(0, -0.3, 0.3, 0.3);
    const issues = validatePlacement(wardrobe, [obstruction], room);
    expect(issues.some((i) => i.code === "clearance")).toBe(true);
    expect(issues.some((i) => i.code === "overlap")).toBe(false);
  });
});
describe("Walking collision", () => {
  it("passes through the door into a bounded landing but never through another wall", () => {
    expect(canStand({ x: 1.3, z: 2.65 }, [], room)).toBe(true);
    expect(canStand({ x: 0, z: 2.65 }, [], room)).toBe(false);
    expect(canStand({ x: 1.3, z: 3.1 }, [], room)).toBe(false);
    expect(canStand({ x: 2, z: 0 }, [], room)).toBe(false);
  });
  it("checks the player radius against rotated furniture and refreshes after a move", () => {
    const furniture = make(0, 0, 2, 0.3, Math.PI / 4);
    expect(canStand({ x: 0, z: 0 }, [furniture], room)).toBe(false);
    expect(
      canStand(
        { x: 0, z: 0 },
        [{ ...furniture, position: { x: 1, z: 1 } }],
        room,
      ),
    ).toBe(true);
    expect(canStand({ x: 0.6, z: 0.6 }, [furniture], room)).toBe(true);
  });
});
describe("Project files", () => {
  it("round-trips layouts, transforms, hidden state and measurement provenance", () => {
    const project = createInitialProject();
    project.layouts[0].items[0].visible = false;
    project.layouts[0].items[0].dimensionSource = "measured";
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
  it("rejects malformed files, unsupported versions and missing active layouts", () => {
    expect(() => parseProject("{")).toThrow(/JSON/);
    expect(() => parseProject("null")).toThrow();
    const project = createInitialProject();
    expect(() =>
      parseProject(JSON.stringify({ ...project, version: 2 })),
    ).toThrow(/version/);
    expect(() =>
      parseProject(JSON.stringify({ ...project, activeLayoutId: "missing" })),
    ).toThrow(/active layout/);
  });
  it("rejects negative dimensions, non-finite values and duplicate IDs", () => {
    const project = createInitialProject();
    project.layouts[0].items[0].dimensions.width = -1;
    expect(() => parseProject(JSON.stringify(project))).toThrow(/Width/);
    project.layouts[0].items[0].dimensions.width = Infinity;
    expect(() => parseProject(JSON.stringify(project))).toThrow(/Width/);
    const duplicate = createInitialProject();
    duplicate.layouts[0].items[1].id = duplicate.layouts[0].items[0].id;
    expect(() => parseProject(JSON.stringify(duplicate))).toThrow(/unique/);
  });
  it("rejects unknown types, malformed colors, giant files and excessive object counts", () => {
    const p = createInitialProject();
    expect(() =>
      parseProject(
        JSON.stringify({
          ...p,
          layouts: [{ ...p.layouts[0], wallColor: "red" }],
        }),
      ),
    ).toThrow(/Colors/);
    const items = Array.from({ length: 81 }, () =>
      createFurnitureItem("plant"),
    );
    expect(() =>
      parseProject(
        JSON.stringify({ ...p, layouts: [{ ...p.layouts[0], items }] }),
      ),
    ).toThrow(/80/);
    expect(() => parseProject(" ".repeat(2_000_001))).toThrow(/large/);
    const bad = JSON.parse(serializeProject(p));
    bad.layouts[0].items[0].kind = "unknown";
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/furniture type/);
  });
  it("sanitizes extra properties instead of preserving executable or prototype fields", () => {
    const project = JSON.parse(serializeProject(createInitialProject()));
    project.__protoPayload = "discard";
    project.room.surprise = "discard";
    const restored = parseProject(JSON.stringify(project));
    expect(restored).not.toHaveProperty("__protoPayload");
    expect(restored.room).not.toHaveProperty("surprise");
  });
});
