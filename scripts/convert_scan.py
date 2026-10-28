"""Convert a locally reconstructed USDZ furniture object into a portable GLB.

Usage: uv run --python 3.11 --with bpy==4.5.15 python scripts/convert_scan.py input.usdz output.glb
The object retains its appearance; confirm real outer dimensions in Roomshift.
"""
from pathlib import Path
import sys
import bpy

if len(sys.argv) != 3:
    raise SystemExit("Usage: convert_scan.py INPUT.usdz OUTPUT.glb")
source, output = (Path(p).expanduser().resolve() for p in sys.argv[1:])
if not source.is_file() or source.suffix.lower() not in {".usdz", ".usd", ".usdc", ".usda"}:
    raise SystemExit("Choose an existing USD/USDZ object file.")
if output.suffix.lower() != ".glb" or output.exists():
    raise SystemExit("Choose a new .glb output path.")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=str(source))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise SystemExit("The scan did not contain mesh geometry.")
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_materials="EXPORT")
if output.read_bytes()[:4] != b"glTF":
    raise SystemExit("Export did not produce a GLB file.")
print(f"Saved {output} ({output.stat().st_size:,} bytes). Confirm dimensions when importing.")
