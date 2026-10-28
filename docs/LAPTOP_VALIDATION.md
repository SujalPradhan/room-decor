# Laptop realism validation

28 October 2026. This iteration is developed on the `realism-laptop` branch and is also available in the public studio.

## Completed checks

- 31 unit tests pass for room geometry, project validation, replacement immutability, anchor/rotation preservation, fit uncertainty, GLB structure and local asset identity.
- The production TypeScript/Vite build passes.
- Three replacement browser workflows pass: Before/After at the same camera, cancellation without saving/history changes, atomic confirmation and undo, dimension provenance, actual imported GLB rendering, IndexedDB reload, malformed GLB rejection and missing-model fallback in a separate browser.
- The realistic Blender build validates 14 roots, 110,380 triangles, 57 embedded original PBR images, UVs, normalized bounds, bottom-center pivots and editable materials. The GLB is 9,116,196 bytes; 14 actual 384px model previews were rendered.
- Local Apple Object Capture capability probe returns supported. A generated USDZ cube was imported and converted through the Blender bridge to a valid GLB. No claim is made about reconstruction accuracy on the supplied room pan.
- A native browser run identifies **ANGLE Metal Renderer: Apple M4**, and the detailed scene and replacement UI render without JavaScript errors. Software browser tests are reported separately from hardware observations.

All 16 browser workflows passed in one production-build regression run (6.7 minutes) using software WebGL, including the original room workflows and the three replacement/import workflows. The final self-hosted-font build also passed a native M4 browser smoke check with all external requests blocked.

[Realistic room screenshot](screenshots/realistic-laptop.png), [replacement screenshot](screenshots/replacement-laptop.png).

A warmed-up three-second native Metal orbit sample observed about 60 Hz at 1440×1000 CSS pixels and device scale factor2. This is a short spot check, not sustained, thermal or battery validation. [Hardware results](LAPTOP_HARDWARE_RESULTS.json).

## Accuracy limits

This is a richer editable interpretation of the room, not a metrically verified scan. Existing-room silhouettes and colors are guided by the supplied photographs/video; hidden surfaces and dimensions remain estimates. Library replacements are illustrative furniture designs, not seller listings. Photo references do not silently trigger a model generator. Imported model binaries stay per browser; JSON files preserve their IDs only.

The large SAM 3D/TRELLIS textured pipelines are not installed on this 16 GB Mac. Research results and a feasible native-photo route are recorded in [the plan](REALISM_PLAN.md) and [capture workflow](PHONE_PHOTOS_TO_OBJECT.md).

## Deletion and dimension-entry regression checks

The editing update passes 34 unit tests and the production TypeScript/Vite build. Five new production-build browser workflows cover clicking Delete, rendered-object removal, undo/redo, deletion persistence, keyboard deletion outside inputs, lock protection, sequential typing of 150 for all three dimensions, one undo step per finished field, invalid/empty values, Escape cancellation, decimal persistence, editable product dimensions with provenance reset, and confirming a replacement while its dimension field remains focused.

All 16 existing browser workflows also pass: 14 in the broader run and two targeted reruns after fixing test synchronization. The older walking check now waits for actual camera movement instead of a fixed 300 ms delay; the layout-limit drag check waits for the plan camera's first frame before reading hit coordinates. Together, 21 browser workflows passed against the production build using software WebGL.

Imported GLB storage remains intact when a component is deleted, so undo can restore the complete model. Undo history remains session-local; saved project changes persist across reloads.
