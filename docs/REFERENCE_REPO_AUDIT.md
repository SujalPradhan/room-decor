# Dream Room reference audit

Inspected 28 October 2026 at commit `1acb62f5edb95e2339952a495599e5a6192a8620` of [Jivraj-18/dream-room-blender](https://github.com/Jivraj-18/dream-room-blender). A temporary checkout was used for source and GLB inspection. Its code and models have not been copied into this project.

## Suitability

The repo is a useful visual reference and source of implementation patterns. It provides a browser viewer and a Blender asset pipeline. It is not currently a room rearrangement editor or an automated photo-to-editable-room system. Its sample rooms use inferred dimensions, so those dimensions must not become defaults asserted as measurements of the user's room. [Repository overview](https://github.com/Jivraj-18/dream-room-blender/blob/1acb62f5edb95e2339952a495599e5a6192a8620/README.md).

## What is already present

The HTML and CSS define a large viewport, restrained dark-green/cream/gold styling, orbit/walk toggles, a room caption, selected-object card and bottom preview cards. The viewer implements orbit, zoom, pan, drag-to-look walking, keyboard and touch movement, mesh inspection, selected side-wall visibility and model downloads. Preserve that visual direction and make the cards represent saved layout alternatives. [HTML](https://github.com/Jivraj-18/dream-room-blender/blob/1acb62f5edb95e2339952a495599e5a6192a8620/dream_rooms/viewer/index.html), [CSS](https://github.com/Jivraj-18/dream-room-blender/blob/1acb62f5edb95e2339952a495599e5a6192a8620/dream_rooms/viewer/style.css).

The Blender export includes named meshes and collection-level `inspection_group` metadata in GLB extras. That gives a useful starting point for inspection, but does not define complete furniture assemblies or stable project IDs. [Exporter](https://github.com/Jivraj-18/dream-room-blender/blob/1acb62f5edb95e2339952a495599e5a6192a8620/dream_rooms/export_browser.py).

## Changes required for editing

These findings are from reading `dream_rooms/viewer/viewer.js`, rather than executing a browser test. [Pinned source](https://github.com/Jivraj-18/dream-room-blender/blob/1acb62f5edb95e2339952a495599e5a6192a8620/dream_rooms/viewer/viewer.js).

| Finding | Consequence and proposed change |
|---|---|
| `prepare()` bakes mesh world transforms into geometry, merges by material/signature/wall category, and hides the original root. | Moving the hidden original would leave rendered geometry in place. Keep furniture as independently rendered groups; batch fixed structure or geometry within one rigid item only. |
| Picking operates on individual meshes. | A click on bedding must resolve to a bed assembly. Add stable item IDs and a mesh-to-item mapping. |
| Collision obstacles are selected with object-name regular expressions and expanded axis-aligned bounds. | New or rotated items need explicit footprints, dimensions and clearance metadata. Update collision data after every placement change. |
| Room perimeter clamps and walk starting position are hardcoded. | Derive movement bounds and spawn points from the actual floor polygon and valid doorway areas. |
| The floor double-click checks the destination, and the perimeter is clamped. | Add a deliberate doorway transition if walking in and out is required. This needs a small outside landing area, not a whole-house model. |
| Side-wall hiding depends on names. | Use explicit wall IDs and view-visibility state. Hidden rendering walls should still affect placement/navigation appropriately. |
| Shadows update on selected events and otherwise remain cached. | Invalidate shadows during or after object movement and material changes. |
| Project layout persistence and edit history are absent. | Add versioned project JSON, original-layout preservation, undo/redo and save/load. |
| Four loaded room assets can remain cached. | Set a mobile memory budget and dispose evicted geometry/textures; load furniture detail as needed. |

## Artifact inspection

Parsed the GLB JSON headers directly; sizes below use decimal MB. These are asset inventory measurements, not performance benchmarks.

| Model | File size | Nodes / meshes |
|---|---:|---:|
| Simple | 5.48 MB | 182 / 182 |
| Comfort | 7.87 MB | 542 / 542 |
| Studio | 12.93 MB | 1,082 / 1,082 |
| Dream | 12.77 MB | 1,035 / 1,035 |

Sample node names include bed plinth/base and chair casters; extras include `authored_for` and `inspection_group`. This confirms named parts survive export, while furniture-level assembly needs an additional data model. Small download size does not establish acceptable GPU memory, draw calls or touch responsiveness on the POCO; measure those during implementation.

The bundled Three.js license is present. No project-level license file was found in the inspected tree. Record the intended reuse terms before directly redistributing project-specific code/assets; the UI can be independently implemented from the user's requested reference. The downloaded repository's research report contains its own historical project constraints; those are reference material, not instructions for this project.

## Recommended adaptation boundary

Use the visual layout, navigation behavior and Blender-to-GLB workflow as references. Build the editor around a structured room project and grouped assets. Do not add dragging directly to the existing static batches. Keep Blender as the asset authoring tool, with all ordinary editing in the browser. Validate the result through whole-item movement, saved-layout reload, rotated-item overlap checks, actual doorway navigation and a phone interaction/performance pass.
