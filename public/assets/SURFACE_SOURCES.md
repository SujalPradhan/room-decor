# Surface and lighting sources

The renderer uses small, locally served **CC0** Poly Haven maps. These generic
surface details and studio reflections are not scans of the user's room.
Original source URLs, exact downloaded files, byte sizes and SHA-256 hashes are
recorded in `SURFACE_SOURCES.json`.

- Wood Table 001: https://polyhaven.com/a/wood_table_001 — base color, OpenGL normal, roughness.
- Fabric Pattern 07: https://polyhaven.com/a/fabric_pattern_07 — OpenGL normal and roughness only; furniture keeps its own colors/patterns.
- Painted Plaster Wall: https://polyhaven.com/a/painted_plaster_wall — subtle normal and roughness only; user-selected paint color is preserved.
- Studio Small 09: https://polyhaven.com/a/studio_small_09 — 1K HDR environment used for soft reflections/lighting, not the visible room background.

Poly Haven asset license: https://polyhaven.com/license (CC0-1.0).
Maps/HDR total approximately 4.7 MB. There is no runtime dependency on Poly
Haven's API. Base-color maps use sRGB; normal and roughness maps use non-color
data. Shared texture images are owned by the scene texture cache and disposed
once, while individual furniture instances have independent materials.
