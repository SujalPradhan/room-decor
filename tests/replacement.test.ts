import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createFurnitureItem,
  createInitialProject,
  parseProject,
  serializeProject,
} from "../src/domain";
import { ASSET_CATALOG, isSupportedAssetId } from "../src/catalog";
import {
  createReplacementDraft,
  evaluateReplacement,
  previewReplacement,
} from "../src/replacement";
import {
  MAX_LOCAL_MODEL_BYTES,
  validateGLB,
  storeLocalModel,
} from "../src/local-assets";
import type { FurnitureItem } from "../src/types";

function makeGLB(change?: (json: Record<string, any>) => void): ArrayBuffer {
  const json: Record<string, any> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  change?.(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json)),
    length = Math.ceil(encoded.length / 4) * 4;
  const data = new ArrayBuffer(12 + 8 + length + 8 + 36),
    view = new DataView(data);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, data.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(data, 20, length);
  bytes.fill(32);
  bytes.set(encoded);
  view.setUint32(20 + length, 36, true);
  view.setUint32(24 + length, 0x004e4942, true);
  new Float32Array(data, 28 + length, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return data;
}
function source() {
  const project = createInitialProject();
  return {
    project,
    layout: project.layouts[0],
    original: project.layouts[0].items.find((i) => i.id === "bed")!,
  };
}

describe("Replacement preview", () => {
  it("keeps the existing slot and yaw while applying the new asset and dimensions", () => {
    const { original } = source(),
      candidate = createFurnitureItem("bed");
    original.locked = true;
    original.dimensionSource = "measured";
    candidate.assetId = "builtin:bed-upholstered";
    candidate.name = "New upholstered bed";
    candidate.dimensions = { width: 1.7, depth: 2.18, height: 1.1 };
    candidate.dimensionSource = "product";
    candidate.position = { x: 10, z: 10 };
    candidate.rotation = 0;
    const old = structuredClone(original),
      draft = createReplacementDraft(original, candidate);
    expect(draft).toMatchObject({
      id: original.id,
      position: original.position,
      rotation: original.rotation,
      assetId: candidate.assetId,
      dimensions: candidate.dimensions,
      dimensionSource: "product",
      locked: false,
      visible: true,
    });
    draft.dimensions.width = 1.8;
    draft.position.x = 0;
    expect(original).toEqual(old);
    expect(candidate.dimensions.width).toBe(1.7);
  });
  it("previews exactly one replacement without changing Original, history input or item count", () => {
    const { layout, original } = source(),
      before = structuredClone(layout);
    const draft = createReplacementDraft(original, {
      ...createFurnitureItem("bed"),
      assetId: "builtin:bed-platform",
    });
    const preview = previewReplacement(layout, draft);
    expect(preview.items).toHaveLength(layout.items.length);
    expect(preview.items.filter((i) => i.id === original.id)).toHaveLength(1);
    expect(preview.items.find((i) => i.id === original.id)!.assetId).toBe(
      "builtin:bed-platform",
    );
    preview.items[1].position.x = 100;
    expect(layout).toEqual(before);
  });
  it("does not collide the candidate with the old item occupying the same slot", () => {
    const { project, layout, original } = source(),
      draft = createReplacementDraft(original, original);
    const result = evaluateReplacement(layout, project.room, draft);
    expect(result.issues.some((i) => i.code === "overlap")).toBe(false);
    expect(result.delta).toEqual({ width: 0, depth: 0, height: 0 });
  });
  it("reports new conflicts and signed dimension changes without claiming verified fit", () => {
    const { project, layout, original } = source(),
      candidate = createFurnitureItem("bed");
    candidate.dimensions = { width: 4, depth: 4, height: 1.2 };
    candidate.dimensionSource = "product";
    const draft = createReplacementDraft(original, candidate),
      result = evaluateReplacement(layout, project.room, draft);
    expect(result.issues.some((i) => i.code === "outside")).toBe(true);
    expect(result.issues.some((i) => i.code === "overlap")).toBe(true);
    expect(result.issues.every((i) => i.itemIds.includes(original.id))).toBe(
      true,
    );
    expect(result.delta.width).toBeCloseTo(2.6);
    expect(result.delta.depth).toBeCloseTo(1.95);
    expect(result.requiresMeasurement).toBe(true);
  });
  it("includes other furniture access space blocked by the replacement", () => {
    const { project, layout, original } = source();
    const desk: FurnitureItem = {
      ...createFurnitureItem("desk"),
      id: "desk-test",
      position: { x: 0, z: 0 },
    };
    const old = {
      ...original,
      position: { x: 0, z: 1.2 },
      rotation: 0,
      dimensions: { width: 0.2, depth: 0.2, height: 0.2 },
    };
    const simple = { ...layout, items: [old, desk] };
    const candidate = createReplacementDraft(old, {
      ...createFurnitureItem("stool"),
      dimensions: { width: 0.5, depth: 0.5, height: 0.5 },
    });
    expect(
      evaluateReplacement(simple, project.room, candidate).issues.some(
        (i) => i.code === "clearance" && i.itemIds[0] === desk.id,
      ),
    ).toBe(true);
  });
  it("rejects a stale replacement target instead of silently adding a new item", () => {
    const { layout, project } = source(),
      candidate = createFurnitureItem("plant");
    expect(() => previewReplacement(layout, candidate)).toThrow(/no longer/);
    expect(() => evaluateReplacement(layout, project.room, candidate)).toThrow(
      /no longer/,
    );
  });
});

describe("Catalog and project compatibility", () => {
  it("has unique authored variants and matching thumbnail root names", () => {
    expect(new Set(ASSET_CATALOG.map((a) => a.id)).size).toBe(
      ASSET_CATALOG.length,
    );
    for (const entry of ASSET_CATALOG) {
      expect(isSupportedAssetId(entry.id)).toBe(true);
      expect(entry.thumbnail).toBe(
        `/assets/thumbnails/${entry.id.slice(8)}.png`,
      );
      expect(entry.dimensions.width).toBeGreaterThan(0);
    }
    expect(ASSET_CATALOG.filter((a) => a.kind === "bed")).toHaveLength(3);
  });
  it("round-trips both new optional asset IDs and older files without them", () => {
    const { project, original } = source();
    expect(parseProject(serializeProject(project))).toEqual(project);
    original.assetId = "builtin:bed-platform";
    project.layouts[1].items[0].assetId =
      "local:12345678-1234-4234-8234-123456789abc";
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
  it("rejects URL, malformed, unknown and oversized asset identifiers", () => {
    for (const assetId of [
      "https://example.com/model.glb",
      "data:model",
      "builtin:unknown",
      "local:../../secret",
      "local:not-a-uuid",
      42,
    ]) {
      const { project, original } = source();
      (original as any).assetId = assetId;
      expect(() => parseProject(JSON.stringify(project))).toThrow(/asset ID/);
    }
  });
});

describe("Local GLB validation", () => {
  it("accepts a self-contained GLB 2 triangle and the authored furniture bundle", () => {
    expect(validateGLB(makeGLB())).toEqual({ nodeCount: 1, meshCount: 1 });
    const bytes = readFileSync(
      new URL("../public/assets/furniture.glb", import.meta.url),
    );
    expect(
      validateGLB(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    ).toMatchObject({
      nodeCount: expect.any(Number),
      meshCount: expect.any(Number),
    });
  });
  it("rejects wrong headers, version, length and truncated chunks", () => {
    expect(() => validateGLB(new ArrayBuffer(4))).toThrow(/short/);
    const wrongVersion = makeGLB();
    new DataView(wrongVersion).setUint32(4, 1, true);
    expect(() => validateGLB(wrongVersion)).toThrow(/2.0/);
    const wrongLength = makeGLB();
    new DataView(wrongLength).setUint32(8, 2, true);
    expect(() => validateGLB(wrongLength)).toThrow(/length/);
    const truncated = makeGLB().slice(0, -4);
    new DataView(truncated).setUint32(8, truncated.byteLength, true);
    expect(() => validateGLB(truncated)).toThrow(/chunk length/);
    const invalidJson = makeGLB();
    new Uint8Array(invalidJson)[20] = 33;
    expect(() => validateGLB(invalidJson)).toThrow(/JSON/);
  });
  it("rejects remote, relative and executable resource URIs, including extension metadata", () => {
    for (const uri of [
      "https://example.com/texture.png",
      "file:///tmp/texture.png",
      "../texture.png",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
    ]) {
      expect(() =>
        validateGLB(
          makeGLB((j) => {
            j.images = [{ uri }];
          }),
        ),
      ).toThrow(/external file/);
    }
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.extensions = { custom: { uri: "https://example.com/external" } };
        }),
      ),
    ).toThrow(/external file/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.buffers[0].uri = "mesh.bin";
        }),
      ),
    ).toThrow(/external file/);
  });
  it("accepts embedded data resources but rejects missing or out-of-bounds embedded data", () => {
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.images = [{ uri: "data:image/png;base64,aGVsbG8=" }];
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.buffers[0].byteLength = 100;
        }),
      ),
    ).toThrow(/binary buffer/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.bufferViews[0].byteLength = 100;
        }),
      ),
    ).toThrow(/beyond/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.nodes[0].mesh = 20;
        }),
      ),
    ).toThrow(/outside/);
  });
  it("rejects unsupported required decoders and geometry-free scenes", () => {
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.extensionsRequired = ["KHR_draco_mesh_compression"];
        }),
      ),
    ).toThrow(/decoder/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.meshes = [];
          j.nodes = [];
        }),
      ),
    ).toThrow(/geometry/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.asset.version = "1.0";
        }),
      ),
    ).toThrow(/version/);
  });
  it("rejects cyclic node hierarchies and invalid transforms before scene loading", () => {
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.nodes[0].children = [0];
        }),
      ),
    ).toThrow(/cyclic/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.nodes.push({ children: [0] });
          j.nodes[0].children = [1];
        }),
      ),
    ).toThrow(/cyclic/);
    expect(() =>
      validateGLB(
        makeGLB((j) => {
          j.nodes[0].translation = [0, null, 0];
        }),
      ),
    ).toThrow(/transforms/);
  });
  it("enforces the file size limit before reading or storing a user file", async () => {
    expect(() =>
      validateGLB(new ArrayBuffer(MAX_LOCAL_MODEL_BYTES + 1)),
    ).toThrow(/30 MB/);
    const oversized = {
      name: "oversized.glb",
      size: MAX_LOCAL_MODEL_BYTES + 1,
      arrayBuffer: () => {
        throw new Error("Should not read");
      },
    } as unknown as File;
    await expect(storeLocalModel(oversized)).rejects.toThrow(/30 MB/);
    await expect(storeLocalModel({ name: "mesh.obj" } as File)).rejects.toThrow(
      /glb/,
    );
  });
});
