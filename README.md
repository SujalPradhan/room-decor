# Roomshift

A browser room editor based on the user's room walkthrough and photographs. Rearrange grouped furniture, try new pieces at explicit dimensions, compare layouts, recolor walls and walk through the room.

The interface follows the visual direction of [Dream Room](https://github.com/Jivraj-18/dream-room-blender). This implementation and its furniture models were authored separately. Blender-generated grouped GLB assets load into a Three.js renderer, with procedural fallbacks.

## Run

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Open the printed local address. To test from an Android phone connected by USB:

```sh
adb reverse tcp:5173 tcp:5173
```

Then open `http://127.0.0.1:5173` on the phone.

## Use

- Select furniture from the room or inventory, then drag it on the floor.
- Change dimensions, rotate, lock, duplicate, recolor or put an item aside.
- Use 2D plan, orbit and walk views. Walking supports keyboard and touch controls and checks furniture collisions.
- Try saved layouts or create a named copy. Editing Original creates an alternative automatically.
- Use Finishes to change the room and accent-wall colors.
- Use Export for a portable project JSON or a room PNG. Open a JSON project with the upload button.
- Add photo/video references from the reference library. These remain in memory for the current session.

Projects save in this browser's local storage. They do not synchronize across devices; export and import to transfer them. Hosted access is owner-private. Source media is not included in this repository or deployed site.

## Accuracy and scope

The initial 4.2 × 4.8 × 2.85 m room and furniture dimensions are **estimates**, not recovered measurements. Door/window positions and hidden geometry are interpretations. Measure the relevant dimensions before deciding on a tight fit or purchase. The checked-measurements control records the user's confirmation; it is not an automatic measurement.

Placement checks cover oriented footprints, room bounds, entry-door swing and furniture use clearances. Walk mode checks a body-radius obstacle model and doorway passage. It is not a building-compliance or delivery-route assessment. The editor does not currently perform native ARCore capture, automatic photo reconstruction or product scraping.

## Validation

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover geometry, doorway movement, default layouts and strict project import. Browser tests exercise the real rendered scene, grouping/dragging, undo/redo, dimensions, visibility, finishes, layout persistence, import/export and touch controls. GitHub Actions runs these checks for pushes and pull requests.

The asset rebuild validates GLB structure, semantic roots, normalized bounds, grounded pivots and editable materials. See [asset notes](public/assets/ASSETS.md) for the Blender reproduction command. See [validation record](docs/VALIDATION.md) for observed results and limits.

## Project notes

- [Product and technical plan](docs/PROJECT_PLAN.md)
- [Video observations](docs/VIDEO_REVIEW.md)
- [Capture guide](docs/CAPTURE_GUIDE.md)
- [Reference audit](docs/REFERENCE_REPO_AUDIT.md)

The production bundle includes React, Three.js and Lucide under their respective open-source licenses. Fonts are requested from Google Fonts; font availability does not affect editor behavior.
