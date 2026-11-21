# Tower Lab assets

Every file here comes from Poly Haven (https://polyhaven.com) and is released under CC0 1.0 (public domain, https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required; sources are listed for traceability.

Models were downloaded as 1k glTF, then converted with Blender 5.2 headless: unused meshes removed, decimated where noted, centred on x/z with the base at y = 0, front facing +Z, textures downscaled to 512 px JPEG, exported as one GLB per furniture kind. Textures were downscaled to 512 px with ImageMagick; lawn and paving were also recoloured.

## Sky

| File | Poly Haven id | Source URL | Notes |
| --- | --- | --- | --- |
| sky/kloofendal_43d_clear_puresky_512.hdr | kloofendal_43d_clear_puresky | https://polyhaven.com/a/kloofendal_43d_clear_puresky | 1k HDR resized to 512 x 256, used for image-based lighting |

## Site and interior textures

| File | Poly Haven id | Source URL | Notes |
| --- | --- | --- | --- |
| textures/lawn_diff.jpg | leafy_grass | https://polyhaven.com/a/leafy_grass | diffuse, hue and saturation shifted greener |
| textures/paving_diff.jpg | large_grey_tiles | https://polyhaven.com/a/large_grey_tiles | diffuse, lightened and desaturated |
| textures/wood_diff.jpg, wood_nor.jpg, wood_rough.jpg | laminate_floor_02 | https://polyhaven.com/a/laminate_floor_02 | living and bedroom floors |
| textures/tile_diff.jpg, tile_nor.jpg, tile_rough.jpg | marble_01 | https://polyhaven.com/a/marble_01 | kitchen and bath floors |
| textures/deck_diff.jpg, deck_nor.jpg, deck_rough.jpg | hinoki_planks | https://polyhaven.com/a/hinoki_planks | balcony deck |

## Furniture models

| File | Kind | Poly Haven id | Source URL | Notes |
| --- | --- | --- | --- | --- |
| furniture/sofa.glb | sofa | sofa_02 | https://polyhaven.com/a/sofa_02 | |
| furniture/armchair.glb | armchair | modern_arm_chair_01 | https://polyhaven.com/a/modern_arm_chair_01 | decimated to 6k triangles |
| furniture/coffee-table.glb | coffee-table | modern_coffee_table_01 | https://polyhaven.com/a/modern_coffee_table_01 | rotated 90 degrees |
| furniture/tv-unit.glb | tv-unit | modern_wooden_cabinet | https://polyhaven.com/a/modern_wooden_cabinet | decimated to 6k triangles |
| furniture/dining-table.glb | dining-table | dining_table | https://polyhaven.com/a/dining_table | tablecloth mesh removed |
| furniture/dining-chair.glb | dining-chair | dining_chair_02 | https://polyhaven.com/a/dining_chair_02 | decimated to 5k triangles |
| furniture/side-table.glb | side-table | side_table_01 | https://polyhaven.com/a/side_table_01 | |
| furniture/desk.glb | desk | small_wooden_table_01 | https://polyhaven.com/a/small_wooden_table_01 | |
| furniture/bookshelf.glb | bookshelf | wooden_display_shelves_01 | https://polyhaven.com/a/wooden_display_shelves_01 | rotated so the open side faces front |
| furniture/plant.glb | plant | potted_plant_01 | https://polyhaven.com/a/potted_plant_01 | decimated from 176k to 22k triangles |

Kinds without a good match (beds, wardrobe, crib, cat tree, bean bag, shoe rack, floor lamp, office chair, rug) are drawn procedurally in src/tower/furniture-mesh.ts.
