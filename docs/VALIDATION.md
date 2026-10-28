# Validation record

28 October 2026. This records observed checks, not a claim of measurement accuracy.

## Room data and placement

- 15 Vitest tests pass on Node 22.12 with Vitest 5.0.5.
- Tests cover valid initial layouts, oriented footprints, overlap/room/door conflicts, hidden items, walking radius/doorway movement, import bounds, malformed data and project roundtrips.
- Production TypeScript checking and Vite build pass.
- Full dependency audit reports zero known vulnerabilities at the time of validation.

## Browser editor

All thirteen Playwright workflows passed against the production preview in one uninterrupted final run (46.3 seconds), exercising Chromium with real WebGL rendering. The earlier development-server refresh during formatting was resolved before this run.

Covered behavior:

- Actual room canvas and Blender asset loading with no page or asset errors.
- Whole-item dimensions/rotation and undo/redo; Original remains unchanged.
- Actual pointer dragging, with rendered coordinates matching saved coordinates.
- Visibility, locking, and restoring furniture.
- Wall finishes, named layout copies and reload persistence.
- Walk mode controls and actual camera movement through the doorway.
- Orthographic wheel zoom and Reset view.
- Project file download/import roundtrip and rejection of malformed files.
- Room resizing and persistence.
- Catalog furniture, duplication, collision feedback and measurement reconfirmation.
- Capacity-limit rejection without lost work or a furniture position left out of sync.
- Touch/mobile panels and a viewport without horizontal page overflow.

Additional independent scene checks verified two-finger plan pinch, screenshot export, scene disposal, grouped Blender loading and rejected-drag rollback. Desktop and mobile framing were visually inspected. [Desktop screenshot](screenshots/desktop.png), [mobile screenshot](screenshots/mobile.png).

## Blender library

Built the nine furniture assets with official Blender Python module `bpy==4.5.15` LTS. The rebuild script verifies GLB2 header/length, all semantic roots, identity transforms, normalized bounds, bottom-center contact, recolorable materials and absence of embedded source photos/textures. All assertions passed. The asset is approximately 727 KB with 141 meshes and 17,514 exported vertices.

## Physical phone status

The unlocked POCO X5 Pro was tested with the production build through USB forwarding, using Chrome155 and its actual Qualcomm Adreno642L renderer (392×766 CSS viewport, device pixel ratio2.75). All nine physical-device checks passed: rendering/layout, touch selection/dimensions, rotate/hide/restore, touch drag, two-finger pinch/reset, finishes/save/reload, touch walking/collision, a short animated frame-time sample, and absence of JavaScript errors. The pre-test project was restored afterwards.

The test caught the floating Furniture button overlapping the Forward walking control. The fix removes that duplicate floating shortcut during walking and gives the movement pad44px targets above other controls. A browser regression now checks all four hit targets and held touchscreen movement.

A three-second movement sample measured179 frame intervals at mean16.71ms, median16.7ms and95th percentile16.8ms (approximately59.9Hz). This is a short spot check, not sustained performance or battery validation. [Actual phone screenshot](screenshots/poco-actual.png), [machine-readable device results](POCO_DEVICE_RESULTS.json).

No native ARCore scanning or reconstruction pipeline has been run. Room and object dimensions, opening positions and hidden geometry remain estimated until measured. Local project storage is per browser; references are session-only. These limits are surfaced in the application and README.

## Hosting and source

The source is tracked in the private GitHub repository with issues for data/placement, editor, Blender assets and validation/publication. GitHub Actions is configured to run install, unit tests, production build and the browser suite on application changes. Deployment uses a static build and owner-private Sites access. Private deployment succeeded for application source commit `f956d67dcbddea4b43bcf5d5bb84db25224cb2f6`: [Open Roomshift](https://roomshift-studio.dearmacaw4.chatgpt.site).

[GitHub Actions run](https://github.com/SujalPradhan/room-decor/actions/runs/40643984979) **passed** installation, unit tests, the production build and all browser workflows on a clean Linux runner (job duration 2 minutes 44 seconds). The [physical-phone follow-up](https://github.com/SujalPradhan/room-decor/issues/5) is complete; hardware checks and the corrective regression passed.
