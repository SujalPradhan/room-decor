import { createFurnitureItem, createRetailProject } from '../../src/domain';
import type { FurnitureItem, ItemKind, Project } from '../../src/types';

/** A synthetic 20 x 28 m flagship store with 70 pieces and 12 layouts: the largest situation the agent must handle. */
const KINDS: ItemKind[] = ['display-table', 'testing-bar', 'hero-plinth', 'lounge-bench', 'plant', 'stool', 'consultation-station'];
export function flagshipStore(pieces = 70): Project {
  const project = createRetailProject(), base = project.layouts[0];
  project.room = { ...project.room, width: 20, depth: 28, door: { ...project.room.door, offset: 0, width: 2.4 } };
  const items: FurnitureItem[] = [];
  for (let index = 0; index < pieces; index++) {
    const kind = index === 0 ? 'checkout-counter' : KINDS[index % KINDS.length], column = index % 7, row = Math.floor(index / 7);
    items.push({ ...createFurnitureItem(kind), id: `piece-${index}`, name: `Piece ${index}`, position: { x: -7.8 + column * 2.6, z: -12.5 + row * 2.4 } });
  }
  project.layouts = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(base), id: index ? `flagship-${index}` : 'original', name: `Flagship ${index}`, description: `Flagship arrangement ${index}`, items: structuredClone(items).map((item, at) => at % 12 === index ? { ...item, visible: false } : item) }));
  project.activeLayoutId = 'original';
  return project;
}
/** Seven moves that land on neighbours, so settling and every store check run: the costliest attempt. */
export function crowdedMoves(project: Project) {
  const items = project.layouts[0].items.filter(item => item.kind !== 'checkout-counter').slice(0, 7);
  return items.map((item, index) => { const target = project.layouts[0].items[(index + 1) * 8]; return { itemId: item.id, x: target.position.x + .3, z: target.position.z, rotationDegrees: 0, reason: 'Closer together.' }; });
}
