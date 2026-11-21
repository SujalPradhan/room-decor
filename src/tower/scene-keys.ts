import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ORBIT_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, -1, 0],
  ArrowUp: [0, -1, 0],
  KeyS: [0, 1, 0],
  ArrowDown: [0, 1, 0],
  KeyA: [-1, 0, 0],
  ArrowLeft: [-1, 0, 0],
  KeyD: [1, 0, 0],
  ArrowRight: [1, 0, 0],
  KeyQ: [0, 0, 1],
  Minus: [0, 0, 1],
  NumpadSubtract: [0, 0, 1],
  KeyE: [0, 0, -1],
  Equal: [0, 0, -1],
  NumpadAdd: [0, 0, -1],
};

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
};

export function createKeyControls(container: HTMLElement, camera: THREE.PerspectiveCamera, controls: OrbitControls, wake: () => void, enabled: () => boolean) {
  const held = new Set<string>();
  let shift = false;
  const vel = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const sph = new THREE.Spherical();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const pan = new THREE.Vector3();

  const onDown = (e: KeyboardEvent) => {
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    shift = e.shiftKey;
    if (!ORBIT_KEYS[e.code]) return;
    e.preventDefault();
    held.add(e.code);
    wake();
  };
  const onUp = (e: KeyboardEvent) => {
    shift = e.shiftKey;
    held.delete(e.code);
  };
  const onBlur = () => {
    held.clear();
    shift = false;
  };
  container.addEventListener('keydown', onDown);
  container.addEventListener('keyup', onUp);
  container.addEventListener('blur', onBlur);

  const step = (dt: number) => {
    const goal = new THREE.Vector3();
    if (enabled()) held.forEach((k) => goal.add(new THREE.Vector3(...ORBIT_KEYS[k])));
    const k = 1 - Math.exp(-dt * 12);
    vel.lerp(goal, k);
    if (vel.lengthSq() < 1e-5) {
      vel.set(0, 0, 0);
      return held.size > 0;
    }
    offset.copy(camera.position).sub(controls.target);
    const dist = offset.length();
    if (shift && (vel.x || vel.y)) {
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      pan.copy(right).multiplyScalar(vel.x).addScaledVector(fwd, -vel.y).multiplyScalar(dist * 0.55 * dt);
      controls.target.add(pan);
      camera.position.add(pan);
    } else {
      sph.setFromVector3(offset);
      sph.theta += vel.x * 1.3 * dt;
      sph.phi += vel.y * 0.9 * dt;
      sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi));
      sph.makeSafe();
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
    }
    if (vel.z) {
      offset.copy(camera.position).sub(controls.target);
      const nd = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * Math.exp(vel.z * 1.1 * dt)));
      offset.setLength(nd);
      camera.position.copy(controls.target).add(offset);
    }
    camera.lookAt(controls.target);
    return true;
  };

  const dispose = () => {
    container.removeEventListener('keydown', onDown);
    container.removeEventListener('keyup', onUp);
    container.removeEventListener('blur', onBlur);
  };

  return { step, dispose };
}
