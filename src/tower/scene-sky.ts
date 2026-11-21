import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const HDRI_URL = '/assets/tower/sky/kloofendal_43d_clear_puresky_512.hdr';
const HDRI_SUN_AZIMUTH = Math.atan2(Math.cos(0.2 * Math.PI), Math.sin(0.2 * Math.PI));

export interface SkyEnvironment {
  fogColor: THREE.Color;
  ready: Promise<void>;
  dispose(): void;
}

export function sunDirection(elevationDeg: number, azimuthDeg: number) {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export const SKY_INTENSITY = 0.42;

export function createSkyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sunDir: THREE.Vector3, onChange: () => void): SkyEnvironment {
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u.turbidity.value = 1.2;
  u.rayleigh.value = 2.6;
  u.mieCoefficient.value = 0.002;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  const skyScene = new THREE.Scene();
  skyScene.add(sky);

  const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 5000, cubeTarget);
  cubeCam.update(renderer, skyScene);

  const fogColor = new THREE.Color('#b9cde0');
  try {
    const px = new Uint16Array(4 * 16);
    let r = 0;
    let g = 0;
    let b = 0;
    for (const face of [0, 1, 4, 5]) {
      renderer.readRenderTargetPixels(cubeTarget, 124, 128, 4, 1, px, face);
      for (let i = 0; i < 4; i++) {
        r += THREE.DataUtils.fromHalfFloat(px[i * 4]);
        g += THREE.DataUtils.fromHalfFloat(px[i * 4 + 1]);
        b += THREE.DataUtils.fromHalfFloat(px[i * 4 + 2]);
      }
    }
    if (r + g + b > 0.01 && Number.isFinite(r + g + b)) fogColor.setRGB(r / 16, g / 16, b / 16, THREE.LinearSRGBColorSpace);
  } catch {
    fogColor.set('#b9cde0');
  }
  fogColor.multiply(new THREE.Color(0.93, 0.98, 1.06));
  const haze = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: { fog: { value: new THREE.Vector3(fogColor.r, fogColor.g, fogColor.b) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 fog; varying vec3 vDir; void main(){ float f = 1.0 - smoothstep(-0.004, 0.018, vDir.y); float t = 0.96 * smoothstep(-0.004, 0.03, vDir.y); vec3 blue = fog * mix(vec3(0.46, 0.64, 1.0), vec3(0.2, 0.4, 0.98), smoothstep(0.006, 0.08, vDir.y)); gl_FragColor = vec4(mix(blue, fog, f), max(f, t)); }',
    }),
  );
  skyScene.add(haze);
  cubeCam.update(renderer, skyScene);
  scene.background = cubeTarget.texture;
  scene.backgroundIntensity = SKY_INTENSITY;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyEnv = pmrem.fromScene(skyScene, 0, 1, 5000);
  scene.environment = skyEnv.texture;
  let hdrEnv: THREE.WebGLRenderTarget | null = null;
  let disposed = false;

  const ready = new HDRLoader()
    .loadAsync(HDRI_URL)
    .then((tex) => {
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      hdrEnv = pmrem.fromEquirectangular(tex);
      tex.dispose();
      scene.environment = hdrEnv.texture;
      const want = Math.atan2(sunDir.x, sunDir.z);
      scene.environmentRotation.set(0, want - HDRI_SUN_AZIMUTH, 0);
      onChange();
    })
    .catch(() => undefined);

  return {
    fogColor: fogColor.clone().multiplyScalar(SKY_INTENSITY),
    ready,
    dispose() {
      disposed = true;
      if (scene.background === cubeTarget.texture) scene.background = null;
      scene.environment = null;
      cubeTarget.dispose();
      skyEnv.dispose();
      hdrEnv?.dispose();
      pmrem.dispose();
      sky.geometry.dispose();
      haze.geometry.dispose();
      (haze.material as THREE.Material).dispose();
      (sky.material as THREE.Material).dispose();
    },
  };
}
