import { describe, expect, it } from "vitest";
import {
  KINDS,
  RETAIL_KINDS,
  ROOM_KINDS,
  createFurnitureItem,
  distanceToPolygon,
  createInitialProject,
  createRetailProject,
  getFootprint,
  kindsForSpace,
  parseProject,
  serializeProject,
  spaceOf,
  usageFootprint,
  validateLayout,
  validatePlacement,
} from "../src/domain";
import { readLayoutAgentResult } from "../src/layout-agent-client";
import { unreachable } from "../src/layout-agent-core";
import { matchLayoutIntent } from "../src/layout-intent";
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
  "fragrance-tower",
  "skin-analyzer",
  "beauty-chair",
  "service-cabin",
  "digital-wall",
  "gift-station",
  "mirror-station",
];
const project = createRetailProject();
const room = project.room;
const LAYOUT_IDS = ["original", "discovery-journey", "open-event", "launch-day", "services-first"];
/** Seats and soft pieces sit inside a station's own space, so the spacing rule leaves them out. */
const SEATS: ItemKind[] = ["chair", "stool", "beauty-chair", "plant", "shelf"];
/** Pieces a visitor must be able to walk up to: the agent's must-reach list plus the flagship's services. */
const STATIONS: ItemKind[] = ["checkout-counter", "testing-bar", "consultation-station", "service-cabin", "skin-analyzer", "mirror-station", "gift-station"];

/** Staff work the zone behind the counter, so it does not need a customer aisle. */
function behindCheckout(a: FurnitureItem, b: FurnitureItem) {
  if (a.kind !== "checkout-counter") return false;
  const c = Math.cos(a.rotation), s = Math.sin(a.rotation),
    dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
  // Local depth of b: negative is behind the counter's front.
  return -s * dx + c * dz < -a.dimensions.depth / 2;
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
/** Stations a 1.2 m wide body cannot reach from the door, flooded on a 10 cm grid as the agent checks do. */
function stranded(layout: Layout) {
  const cell = 0.1, body = 0.6, clear = body - cell / 2, columns = Math.round(room.width / cell), rows = Math.round(room.depth / cell);
  const cx = (c: number) => -room.width / 2 + (c + 0.5) * cell, cz = (r: number) => -room.depth / 2 + (r + 0.5) * cell;
  const colAt = (x: number) => Math.max(0, Math.min(columns - 1, Math.floor((x + room.width / 2) / cell))), rowAt = (z: number) => Math.max(0, Math.min(rows - 1, Math.floor((z + room.depth / 2) / cell)));
  const around = (poly: Position[], visit: (index: number, distance: number) => void) => {
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
    for (let r = rowAt(Math.min(...zs) - body); r <= rowAt(Math.max(...zs) + body); r++)
      for (let c = colAt(Math.min(...xs) - body); c <= colAt(Math.max(...xs) + body); c++) visit(r * columns + c, distanceToPolygon({ x: cx(c), z: cz(r) }, poly));
  };
  const blocked = new Uint8Array(columns * rows), reached = new Uint8Array(columns * rows), queue: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) if (Math.abs(cx(c)) > room.width / 2 - clear + 1e-9 || Math.abs(cz(r)) > room.depth / 2 - clear + 1e-9) blocked[r * columns + c] = 1;
  for (const item of layout.items) around(getFootprint(item), (index, distance) => { if (distance < clear) blocked[index] = 1; });
  const doorRow = Math.floor((room.depth - clear) / cell - 0.5 + 1e-9);
  for (let c = colAt(room.door.offset - room.door.width / 2); c <= colAt(room.door.offset + room.door.width / 2); c++) if (!blocked[doorRow * columns + c]) { reached[doorRow * columns + c] = 1; queue.push(doorRow * columns + c); }
  while (queue.length) {
    const index = queue.pop()!, c = index % columns;
    for (const next of [c > 0 ? index - 1 : -1, c < columns - 1 ? index + 1 : -1, index - columns, index + columns])
      if (next >= 0 && next < reached.length && !blocked[next] && !reached[next]) { reached[next] = 1; queue.push(next); }
  }
  return layout.items
    .filter((item) => STATIONS.includes(item.kind))
    .filter((item) => { let ok = false; around(usageFootprint(item)!, (index, distance) => { ok ||= Boolean(reached[index]) && distance <= body; }); return !ok; })
    .map((item) => item.id);
}

describe("Space kinds", () => {
  it("lists the nine room kinds and the eighteen retail kinds", () => {
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
    expect(new Set(KINDS).size).toBe(23);
  });
  it("hands out copies so callers cannot change the lists", () => {
    kindsForSpace("retail").pop();
    expect(RETAIL_KINDS).toHaveLength(18);
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
      // A digital wall is the widest catalogue piece.
      expect(item.dimensions.width).toBeLessThanOrEqual(5);
      expect(item.dimensions.height).toBeLessThan(room.height);
    }
  });
});

describe("Flagship store project", () => {
  it("is a fresh 20 × 28 × 4.5 m store with a wide front entrance", () => {
    expect(project).toMatchObject({
      name: "Experiential store",
      space: "retail",
      activeLayoutId: "original",
      room: { width: 20, depth: 28, height: 4.5, door: { wall: "front", offset: 0, width: 4 } },
    });
    expect(project.layouts.map((l) => l.id)).toEqual(LAYOUT_IDS);
    expect(project.layouts.map((l) => l.name)).toEqual(["Grand flagship", "Discovery journey", "Open event", "Launch day", "Services first"]);
    expect(new Set(project.layouts.map((l) => l.wallColor)).size).toBe(5);
    expect(new Set(project.layouts.map((l) => l.accentColor)).size).toBe(5);
  });
  it("shares one set of pieces across layouts so a switch animates the same fixtures", () => {
    const ids = (l: Layout) => l.items.map((i) => i.id).sort().join();
    for (const layout of project.layouts) expect(ids(layout)).toBe(ids(project.layouts[0]));
  });
  it("gives every layout the zones of a flagship and no room furniture", () => {
    for (const layout of project.layouts) {
      const kinds = layout.items.map((i) => i.kind);
      for (const kind of RETAIL_ONLY) expect(kinds, layout.name).toContain(kind);
      for (const kind of kinds) expect(RETAIL_KINDS, layout.name).toContain(kind);
      expect(layout.items.length, layout.name).toBeLessThanOrEqual(70);
      expect(kinds.filter((k) => k === "service-cabin").length, layout.name).toBeGreaterThanOrEqual(4);
      expect(layout.description.length).toBeLessThanOrEqual(240);
    }
  });
  it.each(project.layouts.map((l) => [l.name, l] as const))(
    "%s has no placement issues",
    (_, layout) => {
      expect(validateLayout(layout, room)).toEqual([]);
      expect(validateLayout(layout, room, "retail")).toEqual([]);
    },
  );
  it.each(project.layouts.map((l) => [l.name, l] as const))(
    "%s keeps at least 1.2 m between fixtures that are not grouped",
    (_, layout) => {
      const fixtures = layout.items.filter((i) => !SEATS.includes(i.kind));
      const close = (a: FurnitureItem, b: FurnitureItem) => gap(a, b) < 0.5;
      const tight: string[] = [];
      for (const a of fixtures)
        for (const b of fixtures) {
          if (a.id >= b.id || behindCheckout(a, b) || behindCheckout(b, a)) continue;
          const distance = gap(a, b);
          // Under 0.5 m is a deliberate run along a wall or a spine, and so is a pair bridged by a piece of that run.
          if (distance < 0.5 || distance >= 1.2 - 1e-9) continue;
          if (fixtures.some((c) => c !== a && c !== b && close(a, c) && close(c, b))) continue;
          tight.push(`${a.id} to ${b.id}: ${distance.toFixed(2)} m`);
        }
      expect(tight).toEqual([]);
    },
  );
  it.each(project.layouts.map((l) => [l.name, l] as const))(
    "%s reaches every checkout, bar, consultation, cabin and service station through a 1.2 m aisle from the door",
    (_, layout) => {
      expect(unreachable(layout, room)).toEqual([]);
      expect(stranded(layout)).toEqual([]);
    },
  );
  it("makes Open event clearly the largest open floor", () => {
    const floors = Object.fromEntries(project.layouts.map((l) => [l.id, openFloorArea(l, room)]));
    const { "open-event": event, ...others } = floors;
    expect(event).toBeGreaterThan(Math.max(...Object.values(others)) * 2.5);
    expect(event).toBeGreaterThan(150);
  });
  it("matches typed requests to the right preset", () => {
    const real = (prompt: string) => matchLayoutIntent(prompt, project.layouts, "original", room).targetId;
    expect(real("we are hosting an event")).toBe("open-event");
    expect(real("a guided journey")).toBe("discovery-journey");
    expect(real("more space")).toBe("open-event");
    expect(real("show launch day")).toBe("launch-day");
  });
  it("explains a move between layouts by shared item IDs in a watchable time", () => {
    const plan = buildLayoutExplanation(project.layouts[0], project.layouts[3], room);
    expect(plan.steps.filter((s) => s.from && s.to).length).toBeGreaterThan(5);
    expect(plan.endIssueCount).toBe(0);
    expect(plan.totalDurationMs).toBeLessThanOrEqual(12000);
  }, 60000);
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
    ["skin-analyzer", 1],
    ["mirror-station", 1],
    ["gift-station", 1.2],
    ["service-cabin", 1.2],
    ["fragrance-tower", 0.9],
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
  it("keeps a fragrance tower clear all the way round", () => {
    const tower = place("fragrance-tower", 0, 0), reach = tower.dimensions.depth / 2 + 0.9;
    for (const [x, z] of [[0, -reach], [reach, 0], [-reach, 0]]) expect(clearance(tower, place("plant", x, z)), `${x},${z}`).toContain("clearance");
    expect(clearance(tower, place("plant", 0, -reach - 0.3))).toEqual([]);
  });
  it("seats a beauty chair at a mirror station", () => {
    expect(clearance(place("mirror-station", 0, 0), place("beauty-chair", 0, 0.65))).toEqual([]);
    expect(clearance(place("skin-analyzer", 0, 0), place("beauty-chair", 0, 0.75))).toContain("clearance");
  });
  it("does not add access space to plinths, benches, chairs or screens", () => {
    expect(clearance(place("beauty-chair", 0, 0), place("plant", 0, 0.7))).toEqual([]);
    expect(clearance(place("digital-wall", 0, 0), place("plant", 0, 0.7))).toEqual([]);
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
