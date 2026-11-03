import { describe, expect, it } from "vitest";
import {
  KINDS,
  RETAIL_KINDS,
  ROOM_KINDS,
  canStand,
  createFurnitureItem,
  createInitialProject,
  createRetailProject,
  getFootprint,
  kindsForSpace,
  parseProject,
  serializeProject,
  spaceOf,
  validateLayout,
  validatePlacement,
} from "../src/domain";
import { readLayoutAgentResult } from "../src/layout-agent-client";
import {
  buildLayoutExplanation,
  openFloorArea,
} from "../src/layout-explainer";
import type { LayoutAgentResult } from "../src/layout-agent-types";
import type { FurnitureItem, ItemKind, Layout, Position, Project } from "../src/types";

const RETAIL_ONLY: ItemKind[] = [
  "display-table",
  "wall-display",
  "testing-bar",
  "consultation-station",
  "hero-plinth",
  "checkout-counter",
  "lounge-bench",
];
const project = createRetailProject();
const room = project.room;

/** Staff work the zone behind the counter, so it does not need a customer aisle. */
function behindCheckout(a: FurnitureItem, b: FurnitureItem) {
  return (
    a.kind === "checkout-counter" &&
    b.position.z < a.position.z - a.dimensions.depth / 2
  );
}
function segmentGap(a: Position, b: Position, c: Position, d: Position) {
  const toSegment = (p: Position, s: Position, e: Position) => {
    const dx = e.x - s.x,
      dz = e.z - s.z,
      t = Math.max(
        0,
        Math.min(1, ((p.x - s.x) * dx + (p.z - s.z) * dz) / (dx * dx + dz * dz || 1)),
      );
    return Math.hypot(p.x - s.x - t * dx, p.z - s.z - t * dz);
  };
  return Math.min(
    toSegment(a, c, d),
    toSegment(b, c, d),
    toSegment(c, a, b),
    toSegment(d, a, b),
  );
}
function gap(a: FurnitureItem, b: FurnitureItem) {
  const pa = getFootprint(a),
    pb = getFootprint(b);
  let best = Infinity;
  pa.forEach((p, i) =>
    pb.forEach((q, j) => {
      best = Math.min(
        best,
        segmentGap(p, pa[(i + 1) % 4], q, pb[(j + 1) % 4]),
      );
    }),
  );
  return best;
}
/** Floods from the door with a 1.2 m wide body, so reached cells are true customer aisles. */
function aisleReach(layout: Layout) {
  const step = 0.1,
    radius = 0.6,
    key = (x: number, z: number) => `${x},${z}`,
    start = { x: 0, z: 54 },
    seen = new Set([key(start.x, start.z)]),
    queue = [start];
  while (queue.length) {
    const { x, z } = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        nz = z + dz;
      if (
        seen.has(key(nx, nz)) ||
        !canStand({ x: nx * step, z: nz * step }, layout.items, room, radius)
      )
        continue;
      seen.add(key(nx, nz));
      queue.push({ x: nx, z: nz });
    }
  }
  return [...seen].map((cell) => {
    const [x, z] = cell.split(",").map(Number);
    return { x: x * step, z: z * step };
  });
}

describe("Space kinds", () => {
  it("lists the nine room kinds and the eleven retail kinds", () => {
    expect(ROOM_KINDS).toHaveLength(9);
    expect(RETAIL_KINDS).toEqual([
      ...RETAIL_ONLY,
      "plant",
      "stool",
      "chair",
      "shelf",
    ]);
    expect(kindsForSpace("retail")).toEqual(RETAIL_KINDS);
    expect(kindsForSpace("room")).toEqual(ROOM_KINDS);
    expect(kindsForSpace(undefined)).toEqual(ROOM_KINDS);
    expect(new Set(KINDS).size).toBe(16);
  });
  it("hands out copies so callers cannot change the lists", () => {
    kindsForSpace("retail").pop();
    expect(RETAIL_KINDS).toHaveLength(11);
  });
  it("treats projects saved before retail as rooms", () => {
    expect(spaceOf(createInitialProject())).toBe("room");
    expect(spaceOf(project)).toBe("retail");
  });
  it("creates every kind with plausible metre dimensions", () => {
    for (const kind of KINDS) {
      const item = createFurnitureItem(kind);
      expect(item.kind).toBe(kind);
      expect(item.name).toBeTruthy();
      expect(item.dimensions.width).toBeGreaterThan(0.2);
      expect(item.dimensions.width).toBeLessThan(3.5);
      expect(item.dimensions.height).toBeLessThan(room.height);
    }
  });
});

describe("Experiential store project", () => {
  it("is a fresh 9 × 12 × 3.6 m store with a wide front door", () => {
    expect(project).toMatchObject({
      name: "Experiential store",
      space: "retail",
      activeLayoutId: "original",
      room: { width: 9, depth: 12, height: 3.6, door: { wall: "front" } },
    });
    expect(project.room.door.width).toBeGreaterThan(
      createInitialProject().room.door.width,
    );
    expect(project.layouts[0].id).toBe("original");
    expect(new Set(project.layouts.map((l) => l.id)).size).toBe(3);
    expect(new Set(project.layouts.map((l) => l.wallColor)).size).toBe(3);
    expect(new Set(project.layouts.map((l) => l.accentColor)).size).toBe(3);
  });
  it("gives every layout the stations of an experiential store and no room furniture", () => {
    for (const layout of project.layouts) {
      const kinds = layout.items.map((i) => i.kind);
      for (const kind of RETAIL_ONLY) expect(kinds, layout.name).toContain(kind);
      for (const kind of kinds)
        expect(RETAIL_KINDS, layout.name).toContain(kind);
      expect(layout.description.length).toBeLessThanOrEqual(240);
    }
  });
  it.each(project.layouts.map((l) => [l.name, l] as const))(
    "%s has no placement issues",
    (_, layout) => {
      expect(validateLayout(layout, room)).toEqual([]);
    },
  );
  it.each(project.layouts.map((l) => [l.name, l] as const))(
    "%s keeps at least 1.2 m between fixtures that are not grouped",
    (_, layout) => {
      const fixtures = layout.items.filter((i) =>
        RETAIL_ONLY.includes(i.kind),
      );
      const tight: string[] = [];
      for (const a of fixtures)
        for (const b of fixtures) {
          if (a.id >= b.id || behindCheckout(a, b) || behindCheckout(b, a))
            continue;
          const distance = gap(a, b);
          // Under 0.5 m is a deliberate run along a wall or a spine, not a gap anyone walks through.
          if (distance >= 0.5 && distance < 1.2 - 1e-9)
            tight.push(`${a.id} to ${b.id}: ${distance.toFixed(2)} m`);
        }
      expect(tight).toEqual([]);
    },
  );
  it.each(project.layouts.map((l) => [l.name, l] as const))(
    "%s reaches every customer station through a 1.2 m aisle from the door",
    (_, layout) => {
      const reached = aisleReach(layout);
      const stranded = layout.items
        .filter((i) => RETAIL_ONLY.includes(i.kind))
        .filter((item) => {
          const footprint = getFootprint(item),
            // A consultation guest walks to the seat, which stands between the aisle and the vanity.
            reach = item.kind === "consultation-station" ? 1.5 : 0.75;
          return !reached.some((p) =>
            footprint.some(
              (v, i) => segmentGap(p, p, v, footprint[(i + 1) % 4]) < reach,
            ),
          );
        })
        .map((item) => item.id);
      expect(stranded).toEqual([]);
    },
  );
  it("makes Open event clearly the largest open floor", () => {
    const [classic, journey, event] = project.layouts.map((l) =>
      openFloorArea(l, room),
    );
    expect(event).toBeGreaterThan(Math.max(classic, journey) * 2);
    expect(event).toBeGreaterThan(50);
  });
  it("explains a move between layouts by shared item IDs", () => {
    const plan = buildLayoutExplanation(
      project.layouts[0],
      project.layouts[1],
      room,
    );
    expect(plan.steps.filter((s) => s.from && s.to).length).toBeGreaterThan(5);
    expect(plan.endIssueCount).toBe(0);
  });
});

describe("Retail access space", () => {
  const place = (kind: ItemKind, x: number, z: number, rotation = 0) => ({
    ...createFurnitureItem(kind),
    position: { x, z },
    rotation,
  });
  const clearance = (item: FurnitureItem, other: FurnitureItem) =>
    validatePlacement(item, [item, other], room).map((i) => i.code);
  it.each([
    ["wall-display", 1.2],
    ["testing-bar", 1.2],
    ["checkout-counter", 1.5],
    ["consultation-station", 1],
    ["display-table", 1],
  ] as [ItemKind, number][])("%s flags pieces in front of it", (kind, reach) => {
    const item = place(kind, 0, 0),
      front = item.dimensions.depth / 2 + reach;
    expect(clearance(item, place("plant", 0, front))).toContain("clearance");
    expect(clearance(item, place("plant", 0, front + 0.3))).toEqual([]);
  });
  it("allows browsing a display table from both long sides", () => {
    const table = place("display-table", 0, 0);
    expect(clearance(table, place("plant", 0, -1))).toContain("clearance");
  });
  it("lets a seat sit at a consultation vanity but not block a testing bar", () => {
    expect(
      clearance(place("consultation-station", 0, 0), place("chair", 0, 0.8)),
    ).toEqual([]);
    expect(
      clearance(place("testing-bar", 0, 0), place("stool", 0, 0.8)),
    ).toContain("clearance");
  });
  it("does not add access space to plinths or benches", () => {
    expect(clearance(place("hero-plinth", 0, 0), place("plant", 0, 0.9))).toEqual(
      [],
    );
    expect(
      clearance(place("lounge-bench", 0, 0), place("plant", 0, 0.7)),
    ).toEqual([]);
  });
});

describe("Saving a space", () => {
  it("round trips a retail project unchanged", () => {
    const reopened = parseProject(serializeProject(project));
    expect(reopened).toEqual(project);
    expect(reopened.space).toBe("retail");
  });
  it("keeps room as an explicit value and omits an absent one", () => {
    const initial = createInitialProject();
    expect(
      parseProject(serializeProject({ ...initial, space: "room" })).space,
    ).toBe("room");
    const opened = parseProject(serializeProject(initial));
    expect("space" in opened).toBe(false);
    expect(opened).toEqual(initial);
  });
  it.each(["office", "", null, 1, true])("rejects space %j", (space) => {
    expect(() => parseProject(JSON.stringify({ ...project, space }))).toThrow(
      "Unknown space type",
    );
  });
  it("accepts an agent rearrangement of a retail layout", () => {
    const current = project.layouts[0];
    const layout: Layout = {
      ...current,
      id: "agent-1",
      items: current.items.map((item) =>
        item.id === "hero"
          ? { ...item, position: { x: 0, z: 2 } }
          : item,
      ),
    };
    const result = readLayoutAgentResult(
      {
        action: "rearrange",
        reply: "Moved the plinth.",
        model: "test",
        provider: "test",
        elapsedMs: 1,
        reasons: {},
        layout,
      } as unknown as LayoutAgentResult,
      project,
    );
    expect(result.action === "rearrange" && result.layout.items[0].kind).toBe(
      "hero-plinth",
    );
  });
});

describe("contents decide the space when a project opens", () => {
  const withItem = (project: Project, kind: ItemKind, space?: unknown) => {
    const copy = structuredClone(project);
    copy.layouts[0].items.push({ ...createFurnitureItem(kind), position: { x: 0, z: 0 } });
    if (space === undefined) delete copy.space;
    else (copy as { space?: unknown }).space = space;
    return JSON.stringify(copy);
  };
  const noSpace = (project: Project) => { const copy = structuredClone(project); delete copy.space; return JSON.stringify(copy); };
  it("makes a retail-only file a store whatever it claims", () => {
    expect(parseProject(noSpace(createRetailProject())).space).toBe("retail");
    expect(parseProject(JSON.stringify({ ...createRetailProject(), space: "room" })).space).toBe("retail");
  });
  it("leaves a legacy bedroom exactly as it was", () => {
    const legacy = createInitialProject();
    expect("space" in parseProject(JSON.stringify(legacy))).toBe(false);
    expect(parseProject(JSON.stringify({ ...legacy, space: "room" })).space).toBe("room");
  });
  it("rejects bedroom furniture in a store and mixed files", () => {
    expect(() => parseProject(withItem(createRetailProject(), "bed", "retail"))).toThrow("Could not open this store: A project cannot mix bedroom furniture (bed) with store fixtures");
    expect(() => parseProject(withItem(createInitialProject(), "testing-bar"))).toThrow(/cannot mix/);
    expect(() => parseProject(JSON.stringify({ ...createInitialProject(), space: "retail" }))).toThrow("Could not open this store: A store cannot hold bedroom furniture");
  });
  it("names the store in failures, and the room otherwise", () => {
    expect(() => parseProject("nonsense", "retail")).toThrow("Could not open this store: The file is not valid JSON.");
    expect(() => parseProject("nonsense")).toThrow("Could not open this room: The file is not valid JSON.");
    expect(() => parseProject(JSON.stringify({ ...createRetailProject(), unit: "ft" }))).toThrow("Could not open this store: Use centimetres or inches.");
    expect(() => parseProject(JSON.stringify({ ...createInitialProject(), unit: "ft" }))).toThrow("Could not open this room: Use centimetres or inches.");
  });
  it("names the store when a piece leaves it", () => {
    const store = createRetailProject(), piece = { ...store.layouts[0].items[0], position: { x: 40, z: 0 } };
    expect(validatePlacement(piece, [piece], store.room, "retail")[0].message).toBe("Arrival hero plinth extends outside the store.");
    expect(validatePlacement(piece, store.layouts[0].items, store.room)[0].message).toBe("Arrival hero plinth extends outside the store.");
    const room = createInitialProject(), bed = { ...room.layouts[0].items[0], position: { x: 40, z: 0 } };
    expect(validatePlacement(bed, [bed], room.room)[0].message).toBe("Wooden bed extends outside the room.");
  });
  it("names the catalogue piece after its kind and keeps preset names", () => {
    expect(createFurnitureItem("consultation-station").name).toBe("Consultation station");
    expect(createRetailProject().layouts[0].items.find((item) => item.id === "consult-a")!.name).toBe("Consultation vanity A");
  });
});
