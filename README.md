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

Choose **Add furniture → Try a product link**, or select an existing piece and choose **Have a product link?** Paste an Amazon India or Flipkart link and select **Create model**. The implemented laptop-worker pilot collects photos and dimensions, reviews image evidence with Foundry, and reconstructs an approximate textured GLB using local TripoSR and Blender. Processing starts without manual dimension confirmation. **My products** retains the draft, progress and output. Review the dimensions before trying it in the room; placement requires explicit confirmation and creates one undoable layout change. Manual specifications, photo uploads and GLB imports remain recovery options.

**Cost & time** records instrumented work, actual returned tokens, image count, engine/provider/model and observed stage/elapsed times, with filters and CSV export. Foundry monetary cost remains **unknown** until reconciled against account usage and pricing. Existing assets have no reconstructed billing history. Local 3D reconstruction has no external 3D API fee; device, electricity and hosting/storage costs are unmetered.

**Paid Meshy generation remains source-disabled**, including at the server. Foundry evidence review uses the configured LLM account token and may incur account charges. No direct-provider price is assumed. The public app supports device-local editing without an account; sign in for the private product library, uploads, model queue and results. Room layouts remain device-local, and product/cost history is separate from layout undo. Keep original GLBs when transferring projects between browsers.

Double-click **Start Roomshift Generator.command** on the configured Mac to open the public studio and start its outgoing-only worker. Keep the Mac awake and its terminal open; Ctrl+C stops it. The launcher stops after three jobs or one idle hour. There is no inbound laptop port. Foundry credentials stay on the Mac; the site needs only the shared worker credential for this pipeline alongside private job/asset storage. Server limits allow one active job per person, three attempts per person and six globally per UTC day, and one running reconstruction globally. Failed/cancelled attempts count. Cancellation, leases and product revision checks protect against stale results.

On 29 October 2026, a real localhost end-to-end run of the supplied Flipkart recliner completed in 33.83 seconds, including Foundry and local 3D processing. This release connects the public studio to the configured laptop worker. Only this recliner has been validated with live reconstruction; Amazon links and other categories are best-effort and unbenchmarked. [Pipeline and limits](docs/AUTOMATIC_PRODUCT_PIPELINE.md), [Foundry evidence/metering](docs/FOUNDRY_INTEGRATION.md), [local setup and quality limits](docs/RECLINER_EXPERIMENT.md).

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

For the development server on 5176:

```sh
ROOMSHIFT_BASE_URL=http://127.0.0.1:5176 npm run test:e2e
```

The Blender rebuild validates 14 roots, portable maps, UVs, normalized bounds and floor pivots. The local editable source is retained under ignored `artifacts/furniture-realistic.blend`; the build script recreates it. [Laptop validation](docs/LAPTOP_VALIDATION.md), [first-release and POCO validation](docs/VALIDATION.md).

The interface follows the visual direction of [Dream Room](https://github.com/Jivraj-18/dream-room-blender); application code and furniture are independently authored. Runtime dependencies include React, Three.js and Lucide under their respective open-source licenses. Generic Poly Haven maps are CC0; authored materials are recorded with the assets.

## Stable checkpoint and product-link work

[PR #7](https://github.com/SujalPradhan/room-decor/pull/7) merged the current realistic editor into `main`. The annotated tag [`roomshift-stable-2026-10-28`](https://github.com/SujalPradhan/room-decor/tree/roomshift-stable-2026-10-28) preserves the application deployed as public version 3 (source commit `e422ba5`). Retain the tag when implementing later features.

Product-link intake, reviewed dimensions, My products and Cost & time are implemented. The laptop-worker model pilot is implemented and locally validated. [Original proposal](docs/PRODUCT_LINK_PLAN.md), [current pipeline](docs/AUTOMATIC_PRODUCT_PIPELINE.md), [tracking issue #8](https://github.com/SujalPradhan/room-decor/issues/8).
