# Phone photos to an editable furniture object

The phone is the capture device; the laptop is the editing and reconstruction workspace. Keep the room as separate objects so a reconstructed bed can replace a bed template without replacing the walls or other furniture.

## What works now

- The editor accepts local, embedded-resource GLB files. It normalizes the object to a bottom-center pivot, scales it to the entered outer dimensions, and preserves it as one movable furniture component.
- Replacement preview keeps the existing position and rotation. Before/After does not move the camera; confirmation is one undoable change.
- A photograph can be shown beside a candidate as an appearance reference. Uploading that image does not silently generate a model or recover scale.
- Imported GLBs stay in this browser's IndexedDB. A project JSON contains their IDs, not the binary files; keep the original GLB when transferring work to another browser.

## Local Mac reconstruction route

Apple's `PhotogrammetrySession.isSupported` returned **true** on this Apple M4 laptop. The checked-in Swift tool compiles and its capability probe passes. A full reconstruction has not been validated with the supplied compressed room pan; it needs a suitable object-focused photo sequence. [Apple object creation](https://developer.apple.com/documentation/realitykit/creating-3d-objects-from-photographs).

As a practical starting capture, take 60–100 sharp original photos around a single stationary object, keeping roughly 70% overlap. Capture the front, both sides, visible rear, top and low views of legs/edges where accessible. Walk between viewpoints, keep one camera/lens and steady diffuse lighting, and avoid moving bedding or curtains between shots. Do not move heavy furniture solely to expose hidden surfaces. The exact count is a working protocol, not a guarantee. [Apple capture guidance](https://developer.apple.com/documentation/realitykit/capturing-photographs-for-realitykit-object-capture).

Copy the original photos to a new folder on the laptop; do not use resized WhatsApp copies for this purpose. Then:

```sh
swift scripts/object-capture.swift --check
swift scripts/object-capture.swift /path/to/bed-photos /path/to/bed.usdz
uv run --python 3.11 --with bpy==4.5.15 python scripts/convert_scan.py /path/to/bed.usdz /path/to/bed.glb
```

In Roomshift select the existing piece, choose **Try a replacement**, then **Bring your own 3D model**. Enter the object's real outer dimensions before confirming. Ordinary Android photos can provide appearance and geometry evidence, but without calibrated depth/scale metadata the dimensions still need checking.

The Swift tool runs locally and refuses to overwrite an existing output file. The conversion tool is a reproducible bridge; a generated USDZ fixture was imported and exported successfully as GLB, including its material. This validates the format bridge; a real photo dataset is still needed to evaluate reconstruction quality. Original photos are not uploaded to a model provider or committed to GitHub.

## Alternative generated models

The same GLB import path can accept output from Blender, StableFast3D, Hunyuan or other tools. Check the generator's hardware requirements and license before adopting it. Single-image models may invent the rear or underside; visual plausibility does not establish dimensions or construction. [Model comparison and local hardware decision](REALISM_PLAN.md).
