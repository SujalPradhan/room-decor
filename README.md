# Roomshift — Laptop Studio

A local room editor focused on realistic furniture replacement. Phone photos provide appearance/capture input; the laptop provides the main editing workspace. This iteration is developed on `realism-laptop`, preserving the first release on `main`.

## Open on the laptop

Double-click **Open Roomshift.command**, or run:

```sh
npm ci
npm run laptop
```

The launcher opens `http://127.0.0.1:5174` and keeps the local server in its terminal window. Press Ctrl+C there to stop it. Node.js 22.12 or later is required. This realism iteration runs locally.

## Replace a piece

1. Select furniture in the room or inventory and choose **Try a replacement**.
2. Choose a detailed library model or **Bring your own 3D model** using a GLB from Blender, a scan or another 3D tool.
3. Enter its outer dimensions. **Before / After** uses the same camera and position; the old footprint appears as a faint comparison outline.
4. Choose **Use this piece**, or keep the current piece. Confirmation is one undoable change. Preview and cancellation do not save changes.

The collection contains 14 authored models, including timber/platform/upholstered beds, two wardrobe designs, green/oak desks and chair variants. PBR textures, cloth folds, more faithful silhouettes, natural camera framing, local HDR lighting and contact shading improve the original view. [Asset details](public/assets/REALISTIC_ASSETS.md), [generic surface sources](public/assets/SURFACE_SOURCES.md).

You can still drag, rotate, resize, hide, duplicate and lock furniture; recolor walls; use plan/orbit/walk views; save layout alternatives; and export project JSON or PNG. Editing Original preserves it and creates an alternative. Walkthrough is secondary to furniture editing.

## Phone photos and imported models

Add a photo beside a replacement as an appearance reference, or add photo/video references from the reference library. References remain in the browser session. Adding a photo does not claim to recover a measured 3D object automatically.

Imported GLBs are validated and stored in this browser's IndexedDB. Project JSON contains model IDs, not binary files. Keep the original GLB when transferring work to another browser; unavailable models show an editable placeholder and a relinking note. The importer accepts embedded-resource GLB 2 files up to 30 MB; externally referenced resources or decoder-dependent compression must first be exported as a self-contained model.

Apple Object Capture is supported on this M4 Mac. An optional local reconstruction tool and USDZ-to-GLB bridge are provided for a suitable object-focused photo sequence. The capability probe and a generated USDZ conversion fixture pass; real reconstruction quality still needs a good photo dataset. [Photo workflow and commands](docs/PHONE_PHOTOS_TO_OBJECT.md), [model/hardware research](docs/REALISM_PLAN.md).

## Dimensions and storage

Initial room and furniture dimensions are **estimates**, not recovered measurements. Door/window positions and hidden geometry are interpreted from the supplied evidence. Confirm dimensions before deciding a tight fit or purchase. Placement checks cover oriented footprints, room bounds, entry-door swing and usage clearances; they are not a delivery-route or compliance assessment.

Layouts save per browser in local storage. JSON export/import transfers project data. Original room photos and video are not included in GitHub or sent to model providers. Generic materials, HDR lighting and fonts are served locally. The editor has no required runtime cloud service.

## Validation and reproduction

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

For the development server on 5174:

```sh
ROOMSHIFT_BASE_URL=http://127.0.0.1:5174 npm run test:e2e
```

The Blender rebuild validates 14 roots, portable maps, UVs, normalized bounds and floor pivots. The local editable source is retained under ignored `artifacts/furniture-realistic.blend`; the build script recreates it. [Laptop validation](docs/LAPTOP_VALIDATION.md), [first-release and POCO validation](docs/VALIDATION.md).

The interface follows the visual direction of [Dream Room](https://github.com/Jivraj-18/dream-room-blender); application code and furniture are independently authored. Runtime dependencies include React, Three.js and Lucide under their respective open-source licenses. Generic Poly Haven maps are CC0; authored materials are recorded with the assets.
