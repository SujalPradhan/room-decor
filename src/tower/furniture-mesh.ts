import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Piece } from './model';

export interface FurnitureKit {
  build(piece: Piece, glow?: boolean): THREE.Group;
  dispose(): void;
}

export function createFurnitureKit(): FurnitureKit {
  const geos = new Map<string, THREE.BufferGeometry>();
  const mats = new Map<string, THREE.MeshStandardMaterial>();

  const rbox = (w: number, h: number, d: number, r = 0.03) => {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    const key = `r${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${rr.toFixed(3)}`;
    let g = geos.get(key);
    if (!g) {
      g = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.002, rr));
      geos.set(key, g);
    }
    return g;
  };
  const cyl = (rt: number, rb: number, h: number, seg = 16) => {
    const key = `c${rt.toFixed(3)}|${rb.toFixed(3)}|${h.toFixed(3)}|${seg}`;
    let g = geos.get(key);
    if (!g) {
      g = new THREE.CylinderGeometry(rt, rb, h, seg);
      geos.set(key, g);
    }
    return g;
  };
  const ball = (r: number, detail = 1) => {
    const key = `s${r.toFixed(3)}|${detail}`;
    let g = geos.get(key);
    if (!g) {
      g = new THREE.IcosahedronGeometry(r, detail);
      geos.set(key, g);
    }
    return g;
  };
  const mat = (color: string | number, rough = 0.72, metal = 0, emissive = 0) => {
    const c = new THREE.Color(color as THREE.ColorRepresentation);
    const key = `${c.getHexString()}|${rough}|${metal}|${emissive}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
      if (emissive) {
        m.emissive = c.clone();
        m.emissiveIntensity = emissive;
      }
      mats.set(key, m);
    }
    return m;
  };

  const shade = (hex: string, k: number) => {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l * k)));
    return `#${c.getHexString()}`;
  };

  const add = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  const WOOD = '#9b7650';
  const DARK = '#2c2c30';
  const WHITE = '#ece8e0';

  const legs4 = (g: THREE.Group, w: number, d: number, h: number, inset: number, m: THREE.Material, r = 0.02) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, cyl(r, r * 0.8, h, 8), m, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset));
  };

  function sofa(g: THREE.Group, p: Piece, arms = true) {
    const { w, d, h } = p;
    const body = mat(p.color, 0.9);
    const cush = mat(shade(p.color, 1.12), 0.92);
    const leg = mat(DARK, 0.5, 0.3);
    const legH = 0.1;
    const seatH = h * 0.38;
    const armW = arms ? Math.min(0.2, w * 0.14) : 0;
    add(g, rbox(w, seatH - legH, d, 0.05), body, 0, legH + (seatH - legH) / 2, 0);
    add(g, rbox(w, h - seatH, d * 0.24, 0.06), body, 0, seatH + (h - seatH) / 2, -d / 2 + d * 0.12);
    if (arms) for (const s of [-1, 1]) add(g, rbox(armW, h * 0.62 - legH, d, 0.06), body, s * (w / 2 - armW / 2), legH + (h * 0.62 - legH) / 2, 0);
    const inner = w - armW * 2;
    const n = w > 1.5 ? 3 : w > 1.0 ? 2 : 1;
    const cd = d * 0.7;
    for (let i = 0; i < n; i++) add(g, rbox(inner / n - 0.01, 0.12, cd, 0.05), cush, -inner / 2 + (i + 0.5) * (inner / n), seatH + 0.06, d * 0.12);
    for (let i = 0; i < n; i++) add(g, rbox(inner / n - 0.04, h * 0.3, 0.14, 0.06), cush, -inner / 2 + (i + 0.5) * (inner / n), seatH + h * 0.2, -d / 2 + d * 0.3).rotation.x = -0.18;
    legs4(g, w, d, legH, 0.08, leg);
  }

  function bed(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const frame = mat(shade(WOOD, 0.85), 0.7);
    const sheet = mat(WHITE, 0.95);
    const cover = mat(p.color, 0.95);
    const pillow = mat('#f6f3ee', 0.95);
    const baseH = 0.22;
    add(g, rbox(w, baseH, d, 0.03), frame, 0, baseH / 2 + 0.06, 0);
    add(g, rbox(w - 0.06, 0.2, d - 0.1, 0.07), sheet, 0, baseH + 0.16, 0.03);
    add(g, rbox(w - 0.04, 0.05, d * 0.62, 0.025), cover, 0, baseH + 0.275, d * 0.17);
    add(g, rbox(w - 0.04, 0.2, 0.05, 0.02), cover, 0, baseH + 0.18, d * 0.48).scale.y = 1;
    add(g, rbox(w + 0.06, h * 1.15, 0.08, 0.03), mat(p.color, 0.8), 0, (h * 1.15) / 2, -d / 2 - 0.04);
    const n = w > 1.0 ? 2 : 1;
    for (let i = 0; i < n; i++) add(g, rbox(Math.min(0.62, (w - 0.2) / n - 0.06), 0.13, 0.36, 0.06), pillow, -((n - 1) * (w / n)) / 2 + i * (w / n), baseH + 0.34, -d / 2 + 0.28);
    legs4(g, w, d, 0.06, 0.04, mat(DARK, 0.5, 0.3));
  }

  function table(g: THREE.Group, p: Piece, topT = 0.04) {
    const { w, d, h } = p;
    const top = mat(p.color, 0.55);
    const leg = mat(shade(p.color, 0.7), 0.6);
    add(g, rbox(w, topT, d, 0.015), top, 0, h - topT / 2, 0);
    legs4(g, w, d, h - topT, 0.06, leg, 0.025);
  }

  function chair(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const seatH = h * 0.52;
    const m = mat(p.color, 0.7);
    const leg = mat(shade(p.color, 0.6), 0.6);
    add(g, rbox(w, 0.05, d, 0.02), m, 0, seatH, 0);
    add(g, rbox(w, h - seatH, 0.04, 0.02), m, 0, seatH + (h - seatH) / 2, -d / 2 + 0.02);
    legs4(g, w, d, seatH, 0.03, leg, 0.016);
  }

  function officeChair(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const m = mat(p.color, 0.75);
    const metal = mat('#38383d', 0.4, 0.5);
    add(g, cyl(0.03, 0.03, h * 0.38, 10), metal, 0, h * 0.19 + 0.03, 0);
    add(g, rbox(w * 0.9, 0.08, d * 0.9, 0.04), m, 0, h * 0.42, 0.02);
    add(g, rbox(w * 0.85, h * 0.46, 0.07, 0.035), m, 0, h * 0.7, -d * 0.4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = add(g, rbox(0.3, 0.03, 0.04, 0.012), metal, Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14);
      arm.rotation.y = -a;
    }
  }

  function wardrobe(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const body = mat(p.color, 0.6);
    const door = mat(shade(p.color, 1.08), 0.55);
    const handle = mat('#c9b27a', 0.3, 0.8);
    add(g, rbox(w, h, d, 0.02), body, 0, h / 2, 0);
    const n = Math.max(2, Math.round(w / 0.5));
    const dw = (w - 0.04) / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.02 + (i + 0.5) * dw;
      add(g, rbox(dw - 0.012, h - 0.06, 0.02, 0.008), door, x, h / 2, d / 2 + 0.006);
      add(g, rbox(0.014, 0.22, 0.016, 0.006), handle, x + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.05), h * 0.5, d / 2 + 0.026);
    }
  }

  function tvUnit(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const m = mat(p.color, 0.55);
    const leg = mat(DARK, 0.5, 0.3);
    const legH = 0.12;
    add(g, rbox(w, h - legH, d, 0.02), m, 0, legH + (h - legH) / 2, 0);
    for (let i = 1; i < 3; i++) add(g, rbox(0.012, h - legH - 0.06, 0.01, 0.004), mat(shade(p.color, 0.6)), -w / 2 + (w * i) / 3, legH + (h - legH) / 2, d / 2 + 0.003);
    legs4(g, w, d, legH, 0.06, leg);
    const tvW = Math.min(1.5, w * 0.78);
    add(g, rbox(tvW, tvW * 0.56, 0.035, 0.012), mat('#111114', 0.25, 0.4), 0, h + tvW * 0.28 + 0.14, 0);
    add(g, rbox(0.3, 0.12, 0.1, 0.01), mat('#111114', 0.4), 0, h + 0.06, 0);
  }

  function rug(g: THREE.Group, p: Piece) {
    const { w, d } = p;
    add(g, rbox(w, 0.018, d, 0.008), mat(p.color, 1), 0, 0.011, 0).castShadow = false;
    const inner = add(g, rbox(w * 0.82, 0.02, d * 0.82, 0.008), mat(shade(p.color, 0.84), 1), 0, 0.012, 0);
    inner.castShadow = false;
  }

  function bookshelf(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const m = mat(p.color, 0.6);
    add(g, rbox(w, h, d, 0.015), m, 0, h / 2, 0);
    const rows = Math.max(3, Math.round(h / 0.38));
    const cols = ['#c9503c', '#3c6e8f', '#d8b25a', '#4f7a5a', '#8a6fa3', '#e8e2d4'];
    for (let r = 0; r < rows; r++) {
      const y = 0.06 + r * ((h - 0.1) / rows);
      add(g, rbox(w - 0.04, 0.02, d - 0.03, 0.005), mat(shade(p.color, 1.15)), 0, y, 0.01);
      let x = -w / 2 + 0.06;
      let k = (r * 3) % cols.length;
      while (x < w / 2 - 0.12) {
        const bw = 0.03 + ((k * 7) % 4) * 0.01;
        const bh = 0.16 + ((k * 5) % 3) * 0.04;
        add(g, rbox(bw, bh, d * 0.65, 0.004), mat(cols[k % cols.length], 0.8), x + bw / 2, y + 0.01 + bh / 2, 0.02);
        x += bw + 0.004;
        k++;
        if (k % 7 === 0) x += 0.14;
      }
    }
  }

  function plant(g: THREE.Group, p: Piece) {
    const { w, h } = p;
    const potH = Math.min(0.38, h * 0.3);
    add(g, cyl(w * 0.4, w * 0.3, potH, 14), mat('#d8cfc0', 0.8), 0, potH / 2, 0);
    const leaf = mat(p.color, 0.85);
    const lh = h - potH;
    const spots: [number, number, number, number][] = [
      [0, 0.45, 0, 0.5],
      [0.12, 0.7, 0.05, 0.38],
      [-0.1, 0.62, -0.08, 0.4],
      [0.04, 0.9, -0.04, 0.3],
    ];
    for (const [x, y, z, s] of spots) add(g, ball(w * s, 1), leaf, x * w, potH + y * lh, z * w);
  }

  function lamp(g: THREE.Group, p: Piece) {
    const { w, h } = p;
    add(g, cyl(w * 0.4, w * 0.4, 0.025, 20), mat('#2a2a2e', 0.4, 0.6), 0, 0.0125, 0);
    add(g, cyl(0.011, 0.011, h, 8), mat('#2a2a2e', 0.4, 0.6), 0, h / 2, 0);
    const s = add(g, cyl(w * 0.34, w * 0.46, h * 0.18, 20), mat('#ffe3b0', 0.9, 0, 0.8), 0, h - h * 0.09, 0);
    s.castShadow = false;
  }

  function catTree(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const post = mat('#c8b08a', 1);
    const pad = mat(p.color, 1);
    add(g, rbox(w, 0.06, d, 0.02), pad, 0, 0.03, 0);
    add(g, cyl(0.045, 0.045, h, 10), post, 0, h / 2, 0);
    add(g, rbox(w * 0.7, 0.05, d * 0.7, 0.02), pad, 0, h * 0.55, 0);
    add(g, rbox(w * 0.8, 0.07, d * 0.8, 0.025), pad, 0, h - 0.035, 0);
    add(g, rbox(w * 0.5, w * 0.4, d * 0.5, 0.06), pad, 0, 0.06 + w * 0.2, 0);
  }

  function crib(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const m = mat(p.color, 0.6);
    add(g, rbox(w, 0.04, d, 0.01), m, 0, 0.3, 0);
    add(g, rbox(w - 0.08, 0.1, d - 0.08, 0.04), mat('#f4efe8', 0.95), 0, 0.37, 0);
    const bars = Math.round(d / 0.1);
    for (const s of [-1, 1]) {
      add(g, rbox(0.03, 0.03, d, 0.01), m, s * (w / 2 - 0.015), h, 0);
      for (let i = 0; i < bars; i++) add(g, cyl(0.008, 0.008, h - 0.3, 6), m, s * (w / 2 - 0.015), 0.3 + (h - 0.3) / 2, -d / 2 + 0.03 + (i * (d - 0.06)) / (bars - 1));
    }
    for (const s of [-1, 1]) add(g, rbox(w, h - 0.05, 0.035, 0.01), m, 0, (h - 0.05) / 2 + 0.05, s * (d / 2 - 0.0175)).scale.y = s < 0 ? 1 : 0.8;
    legs4(g, w, d, 0.3, 0.03, m, 0.025);
  }

  function beanBag(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const b = add(g, ball(0.5, 2), mat(p.color, 1), 0, h * 0.5, 0);
    b.scale.set(w, h, d);
    b.scale.multiplyScalar(1);
  }

  function shoeRack(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const m = mat(p.color, 0.6);
    add(g, rbox(w, 0.025, d, 0.008), m, 0, h, 0);
    add(g, rbox(0.025, h, d, 0.008), m, -w / 2 + 0.0125, h / 2, 0);
    add(g, rbox(0.025, h, d, 0.008), m, w / 2 - 0.0125, h / 2, 0);
    for (let i = 0; i < 3; i++) add(g, rbox(w, 0.02, d * 0.9, 0.006), m, 0, 0.06 + (i * (h - 0.08)) / 2.5, 0);
    for (let i = 0; i < 4; i++) add(g, rbox(0.1, 0.07, 0.22, 0.03), mat(i % 2 ? '#e8e2d4' : '#3c4a6e', 0.9), -w / 2 + 0.14 + i * (w - 0.28) / 3, 0.1, 0);
  }

  function sideTable(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const m = mat(p.color, 0.55);
    add(g, rbox(w, 0.035, d, 0.015), m, 0, h - 0.0175, 0);
    add(g, rbox(w - 0.04, h * 0.3, d - 0.04, 0.012), m, 0, h - 0.035 - h * 0.15, 0);
    legs4(g, w, d, h * 0.5, 0.04, mat(shade(p.color, 0.6), 0.5), 0.015);
  }

  function desk(g: THREE.Group, p: Piece) {
    const { w, d, h } = p;
    const top = mat(p.color, 0.5);
    const leg = mat(shade(p.color, 0.6), 0.5);
    add(g, rbox(w, 0.035, d, 0.012), top, 0, h - 0.0175, 0);
    add(g, rbox(0.03, h - 0.035, d - 0.06, 0.01), leg, -w / 2 + 0.03, (h - 0.035) / 2, 0);
    add(g, rbox(0.03, h - 0.035, d - 0.06, 0.01), leg, w / 2 - 0.03, (h - 0.035) / 2, 0);
    add(g, rbox(w * 0.5, 0.012, 0.3, 0.005), mat('#2d2f36', 0.3, 0.4), -w * 0.12, h + 0.006, -d * 0.18);
    add(g, rbox(0.34, 0.22, 0.012, 0.005), mat('#16171b', 0.3, 0.4), -w * 0.12, h + 0.14, -d * 0.3);
  }

  const builders: Record<Piece['kind'], (g: THREE.Group, p: Piece) => void> = {
    sofa: (g, p) => sofa(g, p, true),
    armchair: (g, p) => sofa(g, p, true),
    'coffee-table': (g, p) => table(g, p, 0.04),
    'tv-unit': tvUnit,
    rug,
    'dining-table': (g, p) => table(g, p, 0.045),
    'dining-chair': chair,
    'bed-double': bed,
    'bed-queen': bed,
    'bed-single': bed,
    wardrobe,
    'side-table': sideTable,
    desk,
    'office-chair': officeChair,
    bookshelf,
    plant,
    'floor-lamp': lamp,
    'cat-tree': catTree,
    crib,
    'bean-bag': beanBag,
    'shoe-rack': shoeRack,
  };

  return {
    build(piece, glow = false) {
      const g = new THREE.Group();
      (builders[piece.kind] ?? ((gg, p) => add(gg, rbox(p.w, p.h, p.d), mat(p.color), 0, p.h / 2, 0)))(g, piece);
      if (glow) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(piece.w + 0.08, piece.h + 0.08, piece.d + 0.08),
          new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false }),
        );
        box.position.y = piece.h / 2;
        box.userData.glow = true;
        g.add(box);
      }
      return g;
    },
    dispose() {
      for (const g of geos.values()) g.dispose();
      for (const m of mats.values()) m.dispose();
      geos.clear();
      mats.clear();
    },
  };
}
