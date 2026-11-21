import * as THREE from 'three';

export interface CameraPose {
  p: [number, number, number];
  t: [number, number, number];
}

export interface PeerMarker {
  id: string;
  label: string;
  color: string;
  pose: CameraPose;
}

interface Entry {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  label: THREE.Sprite;
  labelTex: THREE.CanvasTexture;
  key: string;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  goalPos: THREE.Vector3;
  goalLook: THREE.Vector3;
}

function labelTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 88;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(16,20,28,0.88)';
  g.beginPath();
  g.roundRect(4, 4, 312, 80, 40);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(44, 44, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '600 38px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  const t = text.length > 12 ? `${text.slice(0, 11)}…` : text;
  g.fillText(t, 72, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const validPose = (pose: CameraPose | null | undefined): pose is CameraPose =>
  !!pose && Array.isArray(pose.p) && Array.isArray(pose.t) && pose.p.length === 3 && pose.t.length === 3 && pose.p.every(finite) && pose.t.every(finite);

export function createPeerLayer(scene: THREE.Scene) {
  const group = new THREE.Group();
  scene.add(group);
  const bodyGeo = new THREE.BoxGeometry(0.9, 0.62, 1.1);
  const lensGeo = new THREE.ConeGeometry(0.42, 0.7, 20, 1, true);
  lensGeo.rotateX(-Math.PI / 2);
  lensGeo.translate(0, 0, 0.85);
  const lensMat = new THREE.MeshStandardMaterial({ color: '#1d2129', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  const entries = new Map<string, Entry>();
  const tmp = new THREE.Vector3();

  const removeEntry = (e: Entry) => {
    group.remove(e.group);
    e.bodyMat.dispose();
    e.labelTex.dispose();
    (e.label.material as THREE.SpriteMaterial).dispose();
  };

  const set = (peers: PeerMarker[]) => {
    const seen = new Set<string>();
    for (const pm of peers) {
      if (!pm || typeof pm.id !== 'string' || !validPose(pm.pose)) continue;
      seen.add(pm.id);
      const key = `${pm.label}|${pm.color}`;
      let e = entries.get(pm.id);
      if (e && e.key !== key) {
        removeEntry(e);
        entries.delete(pm.id);
        e = undefined;
      }
      const goalPos = new THREE.Vector3(...pm.pose.p);
      const goalLook = new THREE.Vector3(...pm.pose.t);
      if (!e) {
        const g = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: pm.color, roughness: 0.45, emissive: new THREE.Color(pm.color), emissiveIntensity: 0.35 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        body.add(lens);
        g.add(body);
        const labelTex = labelTexture(pm.label || 'Guest', pm.color);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
        label.scale.set(0.16, 0.044, 1);
        label.center.set(0.5, -0.6);
        label.renderOrder = 12;
        g.add(label);
        group.add(g);
        e = { group: g, body, bodyMat, label, labelTex, key, pos: goalPos.clone(), look: goalLook.clone(), goalPos, goalLook };
        entries.set(pm.id, e);
      } else {
        e.goalPos.copy(goalPos);
        e.goalLook.copy(goalLook);
      }
    }
    for (const [id, e] of [...entries]) {
      if (!seen.has(id)) {
        removeEntry(e);
        entries.delete(id);
      }
    }
  };

  const step = (dt: number, camera: THREE.Camera) => {
    let busy = false;
    const k = 1 - Math.exp(-dt * 10);
    entries.forEach((e) => {
      if (e.pos.distanceToSquared(e.goalPos) > 1e-6 || e.look.distanceToSquared(e.goalLook) > 1e-6) {
        e.pos.lerp(e.goalPos, k);
        e.look.lerp(e.goalLook, k);
        busy = true;
      } else {
        e.pos.copy(e.goalPos);
        e.look.copy(e.goalLook);
      }
      e.group.position.copy(e.pos);
      e.body.lookAt(tmp.copy(e.look));
      const d = camera.position.distanceTo(e.pos);
      e.body.scale.setScalar(Math.max(0.15, d * 0.022));
    });
    return busy;
  };

  const dispose = () => {
    entries.forEach(removeEntry);
    entries.clear();
    scene.remove(group);
    bodyGeo.dispose();
    lensGeo.dispose();
    lensMat.dispose();
  };

  return { group, set, step, dispose, get size() { return entries.size; } };
}
