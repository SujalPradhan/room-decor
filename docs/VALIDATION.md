# Validation record

28 October 2026. This records observed checks, not a claim of measurement accuracy.

## Room data and placement

- 15 Vitest tests pass on Node 22.12 with Vitest 5.0.5.
- Tests cover valid initial layouts, oriented footprints, overlap/room/door conflicts, hidden items, walking radius/doorway movement, import bounds, malformed data and project roundtrips.
- Production TypeScript checking and Vite build pass.
- Full dependency audit reports zero known vulnerabilities at the time of validation.

## Browser editor

All twelve Playwright workflows passed in one uninterrupted final run (59.4 seconds), exercising Chromium with real WebGL rendering. The earlier development-server refresh during formatting was resolved before this run.

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

The connected POCO X5 Pro reports Android 14, gyroscope and accelerometer features, and an installed ARCore package. USB forwarding was configured for the local editor. The phone was asleep and locked when browser verification was attempted, and Chrome remote inspection was unavailable. The user was asked to unlock it; actual device interaction/performance is not yet claimed. Mobile browser emulation passes, but it does not establish on-device frame rate or battery behavior.

No native ARCore scanning or reconstruction pipeline has been run. Room and object dimensions, opening positions and hidden geometry remain estimated until measured. Local project storage is per browser; references are session-only. These limits are surfaced in the application and README.

## Hosting and source

The source is tracked in the private GitHub repository with issues for data/placement, editor, Blender assets and validation/publication. GitHub Actions is configured to run install, unit tests, production build and the browser suite on application changes. Deployment uses a static build and owner-private Sites access. Exact CI and deployment results are recorded at handoff.
