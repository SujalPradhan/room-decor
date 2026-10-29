# Roomshift — Laptop Studio

A local room editor focused on realistic furniture replacement. Phone photos provide appearance/capture input; the laptop provides the main editing workspace. The current editor is maintained on `main`. The stable version before product-link work is preserved as `roomshift-stable-2026-10-28`.

Public studio: https://roomshift-studio.dearmacaw4.chatgpt.site

## Open on the laptop

Double-click **Open Roomshift.command**, or run:

```sh
npm ci
npm run laptop
```

The launcher opens `http://127.0.0.1:5176` and keeps the local server in its terminal window. Press Ctrl+C there to stop it. Node.js 24 (or 22.13 or later) is required. The local launcher runs the same editor on your laptop.

## Product links and processing history

Choose **Add furniture → Try a product link**, or select an existing piece and choose **Have a product link?** Paste an Amazon India or Flipkart link, or paste specifications when the page cannot be read. Review the category, variant and three outer dimensions. Unknown measurements remain blank; check all three before trying the size. The preview uses approximate furniture geometry unless you import a detailed GLB. Confirm to make one undoable layout change. **My products** keeps drafts for later.

**Cost & time** records newly instrumented work, elapsed/stage time, engine/provider/model, credit usage and cost basis, with filters and CSV export. Existing assets have no reconstructed billing history. Browser work is stored on this device; signed-in server lookups/uploads are stored in your account. Local work means no external inference charge; hosting and device resource costs are not metered.

**Paid generation is disabled**, including at the server. No API key is required for the available workflows. The provider adapter is mock-tested; no live generation or provider billing has been validated.

The public app works without an account for local editing. Sign in through the account icon for a private online product library and uploads. Room layouts remain device-local. Project exports contain asset IDs; keep your GLB originals. Product drafts and cost history are stored separately from layout undo.

## Replace a piece

1. Select furniture in the room or inventory and choose **Try a replacement**.
2. Choose a detailed library model or **Bring your own 3D model** using a GLB from Blender, a scan or another 3D tool.
3. Enter its outer dimensions. **Before / After** uses the same camera and position; the old footprint appears as a faint comparison outline.
4. Choose **Use this piece**, or keep the current piece. Confirmation is one undoable change. Preview and cancellation do not save changes.

The collection contains 14 authored models, including timber/platform/upholstered beds, two wardrobe designs, green/oak desks and chair variants. PBR textures, cloth folds, more faithful silhouettes, natural camera framing, local HDR lighting and contact shading improve the original view. [Asset details](public/assets/REALISTIC_ASSETS.md), [generic surface sources](public/assets/SURFACE_SOURCES.md).

You can still drag, rotate, resize, hide, delete, duplicate and lock furniture; recolor walls; use plan/orbit/walk views; save layout alternatives; and export project JSON or PNG. Editing Original preserves it and creates an alternative. Walkthrough is secondary to furniture editing.

## Edit dimensions and delete

Select a piece and use **Delete** in its properties, or press Delete/Backspace outside a text field. Locked pieces must be unlocked first. Ctrl/⌘Z restores a deleted piece; Ctrl/⌘Shift+Z or Ctrl/⌘Y redoes the change.

Dimension fields keep your typing until you press Enter, Tab, or click outside. Type the full number (for example, 150), including decimals. Escape cancels; empty or out-of-range entries keep the previous dimension. Each finished dimension edit is one undo step. Resizing a piece marks its measurements as estimated until checked again.

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
ROOMSHIFT_BASE_URL=http://127.0.0.1:5176 npm run test:e2e
```

The Blender rebuild validates 14 roots, portable maps, UVs, normalized bounds and floor pivots. The local editable source is retained under ignored `artifacts/furniture-realistic.blend`; the build script recreates it. [Laptop validation](docs/LAPTOP_VALIDATION.md), [first-release and POCO validation](docs/VALIDATION.md).

The interface follows the visual direction of [Dream Room](https://github.com/Jivraj-18/dream-room-blender); application code and furniture are independently authored. Runtime dependencies include React, Three.js and Lucide under their respective open-source licenses. Generic Poly Haven maps are CC0; authored materials are recorded with the assets.

## Stable checkpoint and proposed next work

[PR #7](https://github.com/SujalPradhan/room-decor/pull/7) merged the current realistic editor into `main`. The annotated tag [`roomshift-stable-2026-10-28`](https://github.com/SujalPradhan/room-decor/tree/roomshift-stable-2026-10-28) preserves the application deployed as public version 3 (source commit `e422ba5`). Retain the tag when implementing later features.

The proposed next release adds product-link intake, reviewed product dimensions, detailed model generation, and a Cost & time tab. Implementation awaits plan review. [Full proposal](docs/PRODUCT_LINK_PLAN.md), [tracking issue #8](https://github.com/SujalPradhan/room-decor/issues/8).
