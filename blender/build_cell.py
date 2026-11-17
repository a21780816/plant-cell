"""植物細胞 Blender 建置入口。

用法：node scripts/run-blender.mjs blender/build_cell.py [--only a,b] [--out path.glb] [--preview path.png]
  --only      只建指定模組（逗號分隔）；此時預設輸出 assets/parts/<第一個模組>.glb
  --out       輸出 glb 路徑（預設 assets/plant_cell.glb）
  --preview   建完後以 EEVEE 從四個角度算圖，拼成 2x2、1600x1200 的 png
"""
import argparse
import importlib
import math
import os
import struct
import sys
import tempfile
import zlib

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True  # 不在 blender/ 底下留下 __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from cellkit import common as C  # noqa: E402

MODULES = ["shell", "core", "energy", "endomembrane"]
MAX_RETRIES = 20
VIEW_W, VIEW_H = 800, 600


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="build_cell.py")
    ap.add_argument("--only", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--preview", default=None)
    return ap.parse_args(argv)


def pick_modules(only):
    mods = [m.strip() for m in only.split(",") if m.strip()] if only else list(MODULES)
    unknown = [m for m in mods if m not in MODULES]
    if unknown:
        raise SystemExit(f"未知的模組：{', '.join(unknown)}（可用：{', '.join(MODULES)}）")
    missing = [m for m in mods if not os.path.isfile(os.path.join(HERE, "cellkit", m + ".py"))]
    if missing:
        raise SystemExit(f"缺少模組檔案：{', '.join(m + '.py' for m in missing)}")
    return mods


def build_all(mods):
    seed = C.SEED
    for attempt in range(MAX_RETRIES):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        ctx = C.Ctx(seed)
        try:
            for m in mods:
                importlib.import_module(f"cellkit.{m}").build(ctx)
            return seed
        except C.PlacementError as e:
            print(f"[build] 種子 {seed} 放置失敗：{e}；改用種子 {seed + 1} 重建")
            seed += 1
    raise SystemExit(f"連續 {MAX_RETRIES} 次放置失敗，放棄")


# ----------------------------------------------------------------------------
# 預覽
# ----------------------------------------------------------------------------
def _linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _write_png(path, rgb8):
    h, w, _ = rgb8.shape
    raw = b"".join(b"\x00" + rgb8[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


def _lid_objects():
    lids = [o for o in bpy.data.objects if o.get("lid") == 1]
    out = []
    for r in lids:
        out.append(r)
        out.extend(r.children_recursive)
    return out


def _aim(obj, direction):
    obj.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()


def render_preview(path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = VIEW_W, VIEW_H
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 48
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"

    world = bpy.data.worlds.new("preview_world")
    scene.world = world
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.62, 0.64, 0.66, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.lens = 55
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def make_sun(name, strength):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = strength
        d.angle = math.radians(8)
        o = bpy.data.objects.new(name, d)
        scene.collection.objects.link(o)
        return o

    key, fill = make_sun("key", 3.2), make_sun("fill", 1.1)

    dirs = {
        "base": C.CAMERA_DIR,
        "top": (0.12, -0.30, 1.0),
        "back": tuple(-x for x in C.CAMERA_DIR),
    }
    views = [("base", True), ("base", False), ("top", True), ("back", True)]
    lid_objs = _lid_objects()
    dist = 25.0
    tmpdir = tempfile.mkdtemp(prefix="cellprev_")
    tiles = []
    for i, (dname, lid_hidden) in enumerate(views):
        d = Vector(dirs[dname]).normalized()
        cam.location = d * dist
        _aim(cam, -d)
        right = d.cross(Vector((0, 0, 1))).normalized()
        up = right.cross(d).normalized()
        # 主光從鏡頭左上方照入，補光從右下
        key_dir = (d + up * 0.9 - right * 0.7).normalized()
        fill_dir = (d - up * 0.2 + right * 1.0).normalized()
        key.location = key_dir * 30
        _aim(key, -key_dir)
        fill.location = fill_dir * 30
        _aim(fill, -fill_dir)
        for o in lid_objs:
            o.hide_render = lid_hidden
        scene.render.filepath = os.path.join(tmpdir, f"v{i}.exr")
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(scene.render.filepath)
        img.colorspace_settings.name = "Non-Color"
        px = np.array(img.pixels[:], dtype=np.float32).reshape(VIEW_H, VIEW_W, 4)[::-1, :, :3]
        tiles.append(px)
        bpy.data.images.remove(img)
        os.remove(scene.render.filepath)
    for o in lid_objs:
        o.hide_render = False
    os.rmdir(tmpdir)

    top = np.concatenate([tiles[0], tiles[1]], axis=1)
    bottom = np.concatenate([tiles[2], tiles[3]], axis=1)
    full = np.concatenate([top, bottom], axis=0)
    rgb8 = (_linear_to_srgb(full) * 255 + 0.5).astype(np.uint8)
    _write_png(path, rgb8)
    print("已輸出預覽", path)

    for o in (cam, key, fill):
        bpy.data.objects.remove(o)
    bpy.data.worlds.remove(world)


def main():
    args = parse_args()
    C.validate_layout()
    mods = pick_modules(args.only)
    if args.out:
        out = os.path.abspath(args.out)
    elif args.only:
        out = os.path.join(ROOT, "assets", "parts", mods[0] + ".glb")
    else:
        out = os.path.join(ROOT, "assets", "plant_cell.glb")
    seed = build_all(mods)
    C.export_glb(out)
    print(f"已匯出 {out}（種子 {seed}）")
    if args.preview:
        render_preview(os.path.abspath(args.preview))


if __name__ == "__main__":
    main()
