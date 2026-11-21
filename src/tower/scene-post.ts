import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function isSoftwareGL(renderer: THREE.WebGLRenderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, clipList: THREE.Plane[], hidden: () => THREE.Object3D[]) {
  const software = isSoftwareGL(renderer);
  let aoOn = !software;
  let composer: EffectComposer | null = null;
  let gtao: GTAOPass | null = null;
  let width = 1;
  let height = 1;
  const slow: number[] = [];
  let frames = 0;

  const build = () => {
    const target = new THREE.WebGLRenderTarget(width * renderer.getPixelRatio(), height * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, width, height);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.normalMaterial.clippingPlanes = clipList;
    gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 2, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    const pass = gtao;
    const render = pass.render.bind(pass);
    pass.render = (...args: Parameters<GTAOPass['render']>) => {
      const list = hidden().filter((o) => o.visible);
      list.forEach((o) => (o.visible = false));
      render(...args);
      list.forEach((o) => (o.visible = true));
    };
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
  };

  const drop = () => {
    if (!composer) return;
    gtao?.dispose();
    composer.passes.forEach((p) => p.dispose());
    composer.renderTarget1.dispose();
    composer.renderTarget2.dispose();
    composer.dispose();
    composer = null;
    gtao = null;
  };

  return {
    get ao() {
      return aoOn;
    },
    software,
    setSize(w: number, h: number) {
      width = w;
      height = h;
      composer?.setPixelRatio(renderer.getPixelRatio());
      composer?.setSize(w, h);
    },
    setRadius(radius: number) {
      gtao?.updateGtaoMaterial({ radius, thickness: radius });
    },
    render() {
      if (!aoOn) {
        renderer.render(scene, camera);
        return;
      }
      if (!composer) build();
      frames++;
      const measure = frames > 8 && slow.length < 6;
      if (measure) renderer.getContext().finish();
      const t0 = performance.now();
      composer!.render();
      if (measure) {
        renderer.getContext().finish();
        slow.push(performance.now() - t0);
        if (slow.length === 6) {
          const sorted = [...slow].sort((a, b) => a - b);
          if (sorted[3] > 40) {
            aoOn = false;
            drop();
          }
        }
      }
    },
    dispose() {
      drop();
    },
  };
}
