# Original realistic furniture library

This library is authored in Blender 4.5.15 LTS using
`scripts/build_furniture_realistic.py`. It preserves the original v1 library
at `furniture.glb` and exports a separate `furniture-realistic.glb`.

The existing furniture is informed by the user's descriptions and room
references. These are authored interpretations, not photogrammetry results,
not generated hidden geometry claimed as measurements, and not exact product
models. Five replacement variants are original conceptual furniture designs.
No external furniture mesh or source photograph is embedded.

## Assets

| Root name | Model details |
|---|---|
| `bed` | Curved timber headboard and footboard, structural rails and slats, piped mattress, squared soft pillows and seams, irregular draped patterned duvet, blue throw. |
| `wardrobe` | Three separately modeled hinged doors, routed seams, side/back/top panels, metal handles and lock. |
| `desk` | Green work surface, visible timber edge, square tubular steel legs, foot rails and frame apron. |
| `chair` | Shaped seat/back/lumbar upholstery, head cushion, swept arm supports, piston, five-star base and twin casters. |
| `floor-bed` | Red patterned cover with border/medallion, rounded padding and sewn edge piping. |
| `pedestal-fan` | Curved front/back wire grille, concentric rings, orange aged rim, blades, motor, telescopic stand and weighted foot. |
| `stool` | Rounded timber seat, four legs and lower stretchers. |
| `plant` | Tapered terracotta pot with rolled rim, soil, curved stems and individually shaped/ridged leaves. |
| `shelf` | Oak panels, books with spine labels, ceramic vase and decorative bowl. |
| `bed-platform` | Low walnut plinth, slatted headboard detail, cream bedding and sage throw. |
| `bed-upholstered` | Padded surround and vertical headboard channels, upholstered frame, cream bedding and slate throw. |
| `wardrobe-sliding` | Oak body, overlapping sliding panels, smoked reflective panel and metal tracks. |
| `desk-oak` | Oak work surface, steel frame, drawer/pull and cable grommet. |
| `chair-task` | Sage upholstery, stitched back channels, warm-white frame and twin casters. |

Loose desk accessories are excluded from the desk asset's dimensions. A laptop
lid must not change the height used to fit a desk into the room.

## PBR and runtime contract

All roots are independently cloneable and have identity transforms. Their
geometry is normalized to X `[-0.5, 0.5]`, Y `[0, 1]`, Z `[-0.5, 0.5]` in glTF's
Y-up coordinates. The pivot is bottom center. Set the cloned model's scale to
`(width, height, depth)`, then apply floor position and yaw to its instance.

Every mesh has UV coordinates. Embedded original textures include albedo,
roughness and tangent-space normal maps. Wood and fabric use small repeating
maps; the bedding/floor-mattress patterns use 512-pixel maps. Maps are authored
with deterministic mathematical patterns, not derived from external images.

Each primary material is named `BODY_<root-name>` and has
`editableColor: true`. Materials and meshes have `surface` metadata identifying
`wood`, `fabric`, `paint` or `metal`. Other semantic names begin `WOOD_`,
`FABRIC_`, `PAINT_` or `METAL_`. Preserve embedded maps and the model's default
appearance until the user explicitly chooses a color tint. Additional surface
maps may be provided by the renderer when a material has none.

Root extras include `kind`, `defaultColor`, `sourceDimensions`, `pivot`,
`units`, `authoredWith`, `normalizedDimensions` and `meshCount`.
`sourceDimensions` records nominal authoring proportions, not observed room
measurements. Furniture collision and access clearances remain separate simple
footprints in the project data.

## Rebuild and previews

```sh
uv run --python 3.11 --with bpy==4.5.15 python scripts/build_furniture_realistic.py
```

Use `--skip-thumbnails` for geometry/PBR export without the preview render pass.
The complete build creates fourteen 384 × 384 PNG product previews under
`thumbnails/`, using actual asset geometry, a neutral studio ground, three area
lights and CPU Cycles rendering. The previews are model renders, not image
generation outputs. It also saves the editable source locally at
`artifacts/furniture-realistic.blend` (ignored by Git), with the assets arranged
in a grid for editing. Build dependencies are not delivered to the browser.

## Validation

`thumbnails/geometry-report.json` records the final binary size, triangle count,
embedded image count and per-asset geometry metrics. The build independently
parses the delivered GLB and asserts:

- Valid GLB 2.0 magic, version, chunk type and declared file length.
- Exactly the fourteen expected roots and identity transforms.
- All root bounds normalized to the expected unit box and contacting the floor.
- UV coordinates present on every exported mesh primitive.
- Exactly fourteen primary recolorable materials.
- Library size below 15 MB and aggregate geometry below 250,000 triangles.

The latest build passes these checks. Individual thumbnail images were visually
reviewed, including timber and upholstered beds, the three-door cupboard,
green/oak desks, chair variants, floor mattress, plant and wire-cage fan.
Self-review corrected mattress/duvet intersections, throw support, excessive
wood-grain contrast and fabric micro-normal strength. Browser rendering and
interaction are validated by the application tests separately.
