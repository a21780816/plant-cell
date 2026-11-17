"""標記約定實測：建立帶自訂屬性的物件，匯出 tests/fixtures/tag_spike.glb。
用法：node scripts/run-blender.mjs blender/spike_tags.py
"""
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "tag_spike.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def empty(name, parent=None, loc=(0.0, 0.0, 0.0), **props):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.location = loc
    if parent is not None:
        o.parent = parent
    for k, v in props.items():
        o[k] = v
    return o


def box(name, parent, loc, **props):
    bpy.ops.mesh.primitive_cube_add(size=0.5, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.location = loc
    o.parent = parent
    for k, v in props.items():
        o[k] = v
    return o


mito = empty("mitochondrion_0", loc=(0.0, 0.0, 0.0), organelle="mitochondrion", inst=0, rep=1)
box("mito_main", mito, (0.0, 0.0, 0.0), organelle="mitochondrion", part="main")
box("mito_cristae", mito, (0.6, 0.0, 0.0), organelle="mitochondrion", part="cristae")

wall = empty("cell_wall_0", loc=(2.0, 0.0, 0.0), organelle="cell_wall", inst=0, rep=1)
box("wall_main", wall, (0.0, 0.0, 0.0), organelle="cell_wall", part="main")
empty("wall_anchor", parent=wall, loc=(0.0, 0.0, 0.5), anchor=1)

lid = empty("lid_root", loc=(4.0, 0.0, 0.0), lid=1)
box("lid_wall", lid, (0.0, 0.0, 0.0), organelle="cell_wall", part="cut")

bpy.ops.object.select_all(action="DESELECT")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_extras=True,
    export_apply=True,
    export_texcoords=False,
    export_tangents=False,
    use_selection=False,
)
print("已匯出", OUT)
