"""Build original grouped furniture assets with Blender's Python API.

Run with Blender: blender --background --factory-startup --python scripts/build_furniture.py
Or with the official bpy wheel: uv run --python 3.11 --with bpy==4.5.15 python scripts/build_furniture.py

No external meshes, textures, or photographs are embedded. Furniture shapes are
interpretations of the user's descriptions and reference images, not scans.
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "furniture.glb"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)


def mat(name, color, roughness=0.7, metallic=0.0):
    m = bpy.data.materials.new("BODY_" + name.removesuffix(".primary") if name.endswith(".primary") else name)
    m["editableColor"] = name.endswith(".primary")
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    rgb = tuple(int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    # Convert CSS sRGB values to the linear colors Blender's shader expects.
    p.inputs["Base Color"].default_value = tuple(
        c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb
    ) + (1,)
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Metallic"].default_value = metallic
    return m


wood = mat("warm-walnut", "#73503c")
wood_light = mat("oak-edge", "#ad8560")
dark = mat("charcoal-metal", "#333c38", 0.4, 0.3)
ivory = mat("cotton-ivory", "#e4dfd0")
pink = mat("rose-pillow", "#c9989b")
blue = mat("blue-throw", "#557a92")
bed_primary = mat("bed.primary", "#b4a291")
wardrobe_primary = mat("wardrobe.primary", "#565653")
wardrobe_panel = mat("wardrobe-door", "#5e5e59")
desk_primary = mat("desk.primary", "#3c6b5a")
chair_primary = mat("chair.primary", "#474f49")
floor_primary = mat("floor-bed.primary", "#9f5053")
fan_primary = mat("pedestal-fan.primary", "#e0d9c5")
stool_primary = mat("stool.primary", "#8a674b")
plant_primary = mat("plant.primary", "#58714e")
pot = mat("terracotta", "#b17b5b")
shelf_primary = mat("shelf.primary", "#b38d63")
brass = mat("brushed-brass", "#bca16b", 0.35, 0.6)
screen = mat("laptop-screen", "#263b34", 0.35)
book_mats = [mat("book-sage", "#80907b"), mat("book-oat", "#ddd1b6"), mat("book-clay", "#b88370")]

CURRENT = None
ROOTS = []


def adopt(obj, name, material):
    obj.name = name
    obj.parent = CURRENT
    obj.data.materials.append(material)
    obj["asset_kind"] = CURRENT.name
    obj["recolorable"] = bool(material.get("editableColor", False))
    return obj


def box(name, loc, size, material, bevel=0.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = adopt(bpy.context.object, name, material)
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new("Soft furniture edges", "BEVEL")
        mod.width = min(bevel, min(size) / 3)
        mod.segments = 3
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for face in o.data.polygons:
            face.use_smooth = True
        mod = o.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def ellipsoid(name, loc, size, material, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=0.5, location=loc)
    o = adopt(bpy.context.object, name, material)
    o.scale = size
    for face in o.data.polygons:
        face.use_smooth = True
    return o


def cylinder(name, loc, radius, height, material, vertices=24, rotation=None, radius_top=None):
    if radius_top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=loc)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius_top, depth=height, location=loc)
    o = adopt(bpy.context.object, name, material)
    if rotation:
        o.rotation_euler = rotation
    for face in o.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return o


def rod(name, a, b, radius, material, vertices=8):
    a, b = Vector(a), Vector(b)
    o = cylinder(name, (a + b) / 2, radius, (b - a).length, material, vertices)
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return o


def group(kind, source_dimensions):
    global CURRENT
    CURRENT = bpy.data.objects.new(kind, None)
    bpy.context.collection.objects.link(CURRENT)
    CURRENT["kind"] = kind
    CURRENT["sourceDimensions"] = json.dumps(source_dimensions)
    CURRENT["pivot"] = "bottom-center"
    CURRENT["units"] = "normalized"
    CURRENT["authoredWith"] = "Blender " + bpy.app.version_string
    ROOTS.append(CURRENT)


def bed():
    group("bed", {"width": 1.45, "depth": 2.08, "height": 0.91})
    for x in [-0.62, 0.62]:
        for y in [-0.86, 0.86]:
            box("Bed wooden leg", (x, y, 0.15), (0.11, 0.11, 0.3), wood)
    box("Bed timber frame", (0, 0, 0.29), (1.45, 2.08, 0.22), wood, 0.025)
    box("Bed inset border", (0, 0, 0.40), (1.43, 2.04, 0.045), wood_light)
    box("Bed mattress", (0, 0, 0.48), (1.36, 1.98, 0.16), ivory, 0.045)
    box("Bed linen", (0, -0.15, 0.575), (1.38, 1.65, 0.055), bed_primary, 0.025)
    # Broad bands suggest the original patterned linen without embedding photos.
    for y in [-0.71, -0.28, 0.15, 0.58]:
        box("Cotton woven band", (0, y, 0.606), (1.37, 0.09, 0.008), ivory, 0.003)
    for x in [-0.35, 0.35]:
        ellipsoid("Dusty pink pillow", (x, 0.70, 0.62), (0.60, 0.43, 0.15), pink)
    box("Headboard", (0, 0.995, 0.58), (1.45, 0.07, 0.67), wood, 0.035)
    box("Footboard", (0, -0.995, 0.43), (1.45, 0.07, 0.40), wood, 0.025)
    box("Blue folded throw", (0.30, -0.51, 0.64), (0.63, 0.60, 0.07), blue, 0.025)


def wardrobe():
    group("wardrobe", {"width": 1.1, "depth": 0.58, "height": 1.95})
    box("Cupboard plinth", (0, 0, 0.045), (1.06, 0.54, 0.09), dark)
    box("Cupboard body", (0, 0.01, 1.00), (1.1, 0.56, 1.90), wardrobe_primary, 0.015)
    for x in [-0.274, 0.274]:
        box("Cupboard door", (x, -0.285, 1.0), (0.536, 0.025, 1.84), wardrobe_panel, 0.008)
    for x in [-0.052, 0.052]:
        rod("Cupboard handle", (x, -0.325, 0.89), (x, -0.325, 1.06), 0.009, brass)
    cylinder("Cupboard lock", (0.10, -0.309, 0.83), 0.016, 0.012, brass, rotation=(math.pi/2, 0, 0))


def desk():
    group("desk", {"width": 1.2, "depth": 0.60, "height": 0.76})
    for x in [-0.53, 0.53]:
        for y in [-0.23, 0.23]:
            box("Desk metal leg", (x, y, 0.355), (0.045, 0.045, 0.71), dark, 0.006)
    box("Desk green tabletop", (0, 0, 0.74), (1.20, 0.60, 0.055), desk_primary, 0.012)
    for x in [-0.53, 0.53]:
        box("Desk side rail", (x, 0, 0.10), (0.035, 0.47, 0.035), dark, 0.004)
    # Keep loose desktop items out of this normalized furniture asset: otherwise
    # a laptop lid would count toward the desk's height and shrink the tabletop.


def chair():
    group("chair", {"width": 0.62, "depth": 0.62, "height": 1.05})
    cylinder("Chair gas lift", (0, 0, 0.27), 0.035, 0.43, dark)
    for i in range(5):
        a = i * 2 * math.pi / 5
        end = (0.27 * math.cos(a), 0.27 * math.sin(a), 0.065)
        rod("Chair radial base", (0, 0, 0.12), end, 0.018, dark)
        ellipsoid("Chair caster", (end[0], end[1], 0.04), (0.06, 0.045, 0.08), dark, 12, 8)
    box("Chair seat", (0, 0, 0.48), (0.52, 0.50, 0.105), chair_primary, 0.05)
    box("Chair back", (0, 0.22, 0.76), (0.46, 0.09, 0.52), chair_primary, 0.04)
    ellipsoid("Chair headrest", (0, 0.24, 1.0), (0.30, 0.13, 0.13), chair_primary)
    for x in [-0.27, 0.27]:
        rod("Chair arm support", (x, 0.07, 0.44), (x, 0.07, 0.66), 0.016, dark)
        box("Chair armrest", (x, -0.015, 0.67), (0.075, 0.30, 0.045), dark, 0.018)


def floor_bed():
    group("floor-bed", {"width": 0.95, "depth": 1.85, "height": 0.13})
    box("Floor mattress base", (0, 0, 0.057), (0.95, 1.85, 0.114), floor_primary, 0.04)
    box("Floor mattress piping", (0, 0, 0.11), (0.94, 1.83, 0.018), ivory, 0.007)
    box("Floor mattress cover", (0, 0, 0.123), (0.91, 1.80, 0.012), floor_primary, 0.004)
    for x in [-0.42, 0.42]:
        box("Cover border", (x, 0, 0.131), (0.018, 1.72, 0.002), ivory, 0)
    for y in [-0.82, 0.82]:
        box("Cover border", (0, y, 0.131), (0.84, 0.018, 0.002), ivory, 0)
    for x in [-0.24, 0, 0.24]:
        for y in [-0.60, -0.30, 0, 0.30, 0.60]:
            ellipsoid("Woven cover motif", (x, y, 0.134), (0.055, 0.055, 0.006), ivory, 12, 6)


def fan():
    group("pedestal-fan", {"width": 0.45, "depth": 0.39, "height": 1.21})
    ellipsoid("Fan weighted foot", (0, 0.025, 0.035), (0.39, 0.34, 0.07), fan_primary)
    cylinder("Fan stand", (0, 0.025, 0.44), 0.023, 0.80, fan_primary)
    cylinder("Fan rear motor", (0, 0.04, 0.99), 0.065, 0.14, dark, rotation=(math.pi/2, 0, 0))
    # Three pale blades sit behind a light wire grille.
    for i in range(3):
        a = 2 * math.pi * i / 3
        blade = ellipsoid("Fan blade", (0.10 * math.sin(a), -0.05, 0.99 + 0.10 * math.cos(a)), (0.13, 0.012, 0.25), ivory)
        blade.rotation_euler.y = -a
    for radius in [0.07, 0.12, 0.17, 0.215]:
        bpy.ops.mesh.primitive_torus_add(major_segments=36, minor_segments=6, location=(0, -0.075, 0.99), major_radius=radius, minor_radius=0.003)
        o = adopt(bpy.context.object, "Fan guard ring", fan_primary)
        o.rotation_euler.x = math.pi/2
    for i in range(16):
        a = i * math.pi / 8
        rod("Fan guard spoke", (0, -0.079, 0.99), (0.215 * math.cos(a), -0.079, 0.99 + 0.215 * math.sin(a)), 0.0025, fan_primary, 6)
    cylinder("Fan hub", (0, -0.088, 0.99), 0.039, 0.025, fan_primary, rotation=(math.pi/2, 0, 0))


def stool():
    group("stool", {"width": 0.36, "depth": 0.36, "height": 0.40})
    for x in [-0.13, 0.13]:
        for y in [-0.13, 0.13]:
            box("Stool leg", (x, y, 0.18), (0.045, 0.045, 0.36), stool_primary)
    box("Stool seat", (0, 0, 0.377), (0.36, 0.36, 0.046), stool_primary, 0.018)
    for y in [-0.13, 0.13]:
        box("Stool brace", (0, y, 0.12), (0.26, 0.025, 0.04), wood_light)


def plant():
    group("plant", {"width": 0.42, "depth": 0.42, "height": 0.82})
    cylinder("Plant pot", (0, 0, 0.14), 0.12, 0.28, pot, 28, radius_top=0.155)
    cylinder("Pot soil", (0, 0, 0.283), 0.143, 0.018, wood, 24)
    for i in range(9):
        a = i * 2.39996
        h = 0.43 + (i % 4) * 0.10
        spread = 0.12 + (i % 3) * 0.025
        tip = (math.cos(a) * spread, math.sin(a) * spread, h)
        rod("Plant stem", (0, 0, 0.28), tip, 0.004, plant_primary)
        leaf = ellipsoid("Plant leaf", tip, (0.09, 0.20, 0.035), plant_primary)
        leaf.rotation_euler = (0.6, 0.35, -a)


def shelf():
    group("shelf", {"width": 0.8, "depth": 0.32, "height": 1.4})
    for x in [-0.375, 0.375]:
        box("Shelf side", (x, 0, 0.70), (0.05, 0.32, 1.4), shelf_primary)
    for z in [0.06, 0.49, 0.92, 1.36]:
        box("Shelf board", (0, 0, z), (0.78, 0.32, 0.045), shelf_primary)
    box("Shelf back", (0, 0.15, 0.70), (0.74, 0.018, 1.32), wood_light, 0)
    for i in range(8):
        z = 0.51 if i < 4 else 0.94
        x = -0.27 + (i % 4) * 0.07
        box("Shelf book", (x, -0.015, z + 0.14), (0.055, 0.22, 0.28 + (i % 2) * 0.035), book_mats[i % 3], 0.002)
    ellipsoid("Shelf ceramic", (0.21, 0, 0.17), (0.15, 0.15, 0.18), ivory)


for build in [bed, wardrobe, desk, chair, floor_bed, fan, stool, plant, shelf]:
    build()

# Bake normalized geometry beneath identity roots. Root.scale can then be set
# directly to FurnitureItem width/height/depth by the browser without replacing
# a source transform. Blender is Z-up; the exporter converts to glTF Y-up.
bpy.context.view_layer.update()
summary = []
for root in ROOTS:
    meshes = [o for o in root.children_recursive if o.type == "MESH"]
    pts = [o.matrix_world @ vertex.co for o in meshes for vertex in o.data.vertices]
    low = Vector(tuple(min(v[i] for v in pts) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in pts) for i in range(3)))
    extent = high - low
    center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    norm = Matrix.Diagonal((1 / extent.x, 1 / extent.y, 1 / extent.z, 1)) @ Matrix.Translation(-center)
    for obj in meshes:
        obj.data.transform(norm @ obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
    root["normalizedDimensions"] = "1,1,1"
    root["meshCount"] = len(meshes)
    summary.append({"kind": root.name, "meshes": len(meshes), "vertices": sum(len(o.data.vertices) for o in meshes), "sourceBounds": list(extent)})

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", export_yup=True,
    export_extras=True, export_animations=False, export_cameras=False,
    export_lights=False, export_apply=True)

# Validate the delivered binary, not only the authoring objects. These checks
# catch exporter axis conversion and hierarchy mistakes that break placement.
blob = OUT.read_bytes()
magic, version, file_length = struct.unpack_from("<4sII", blob)
assert magic == b"glTF" and version == 2 and file_length == len(blob)
json_length, chunk_type = struct.unpack_from("<II", blob, 12)
assert chunk_type == 0x4E4F534A
document = json.loads(blob[20 : 20 + json_length])
nodes = document["nodes"]
root_indices = document["scenes"][document.get("scene", 0)]["nodes"]
assert {nodes[i]["name"] for i in root_indices} == {root.name for root in ROOTS}
for root_index in root_indices:
    stack, low, high = [root_index], [math.inf] * 3, [-math.inf] * 3
    while stack:
        node = nodes[stack.pop()]
        stack.extend(node.get("children", []))
        assert not any(k in node for k in ("matrix", "rotation", "translation", "scale")), node["name"]
        if "mesh" in node:
            for primitive in document["meshes"][node["mesh"]]["primitives"]:
                accessor = document["accessors"][primitive["attributes"]["POSITION"]]
                low = [min(low[i], accessor["min"][i]) for i in range(3)]
                high = [max(high[i], accessor["max"][i]) for i in range(3)]
    assert all(abs(a - b) < 2e-5 for a, b in zip(low, (-0.5, 0, -0.5))), (nodes[root_index]["name"], low)
    assert all(abs(a - b) < 2e-5 for a, b in zip(high, (0.5, 1, 0.5))), (nodes[root_index]["name"], high)
assert len([m for m in document["materials"] if m.get("extras", {}).get("editableColor")]) == 9
assert not document.get("images") and not document.get("textures")
print("ASSET_VALIDATION_PASS: GLB2, nine roots, identity transforms, normalized bounds, floor contact, editable materials, no embedded media")
print(json.dumps({"blender": bpy.app.version_string, "output": str(OUT), "bytes": OUT.stat().st_size, "assets": summary}, indent=2))
