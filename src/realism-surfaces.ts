import * as THREE from "three";

export type SurfaceKind = "wood" | "fabric" | "plaster" | "paint" | "metal";
/** Shared immutable texture images; each mesh owns its material, not the images. */
export function createSurfaceLibrary(
  renderer: THREE.WebGLRenderer,
  onChange: () => void,
) {
  const textures = new Map<string, THREE.Texture>();
  let disposed = false,
    loaded = 0;
  const definitions = [
    ["wood-color", "wood_table_001_diff_1k.jpg", true],
    ["wood-normal", "wood_table_001_nor_gl_1k.jpg", false],
    ["wood-rough", "wood_table_001_rough_1k.jpg", false],
    ["fabric-normal", "fabric_pattern_07_nor_gl_1k.jpg", false],
    ["fabric-rough", "fabric_pattern_07_rough_1k.jpg", false],
    ["plaster-normal", "painted_plaster_wall_nor_gl_1k.jpg", false],
    ["plaster-rough", "painted_plaster_wall_rough_1k.jpg", false],
  ] as const;
  const loader = new THREE.TextureLoader();
  Promise.all(
    definitions.map(async ([key, file, color]) => {
      try {
        const texture = await loader.loadAsync("/assets/textures/" + file);
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.name = key;
        texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(
          8,
          renderer.capabilities.getMaxAnisotropy(),
        );
        textures.set(key, texture);
        loaded++;
      } catch {
        /* Materials retain a useful neutral fallback offline. */
      }
    }),
  ).then(() => {
    if (!disposed) onChange();
  });
  function apply(
    mat: THREE.Material,
    surface: SurfaceKind,
    options: { albedo?: boolean; normalScale?: number } = {},
  ) {
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;
    if (surface === "metal") {
      mat.envMapIntensity = 0.8;
      return;
    }
    const normal = textures.get(surface + "-normal"),
      rough = textures.get(surface + "-rough");
    if (!mat.normalMap && normal) {
      mat.normalMap = normal;
      mat.normalScale.setScalar(
        options.normalScale ??
          (surface === "wood" ? 0.24 : surface === "fabric" ? 0.22 : 0.035),
      );
    }
    if (!mat.roughnessMap && rough) mat.roughnessMap = rough;
    if (surface === "wood" && options.albedo && !mat.map) {
      mat.map = textures.get("wood-color") ?? null;
    }
    if (surface === "plaster") mat.roughness = 0.98;
    if (surface === "fabric") mat.roughness = 0.96;
    mat.envMapIntensity = 0.75;
    mat.needsUpdate = true;
  }
  return {
    apply,
    get loaded() {
      return loaded;
    },
    dispose() {
      disposed = true;
      textures.forEach((t) => t.dispose());
      textures.clear();
    },
  };
}
