"""所有建模模組共用的工具：座標常數、禁入區判斷、標記、材質、匯出。

座標為 Blender 座標（Z 朝上）。匯出後 (x, y, z) 變成 three.js 的 (x, z, -y)。
本檔是版面常數的唯一來源，修改前請先確認計畫檔的「座標與版面」表。

資料形狀（給其他模組用）：
  CELL_HALF            (hx, hy, hz)  細胞壁外表面半寬
  CAVITY_HALF          (hx, hy, hz)  空腔（細胞膜內側）半寬
  CUT_X / CUT_Y / CUT_Z               掀開區界線：x >= CUT_X and y <= CUT_Y and z >= CUT_Z
  VACUOLE              {'center', 'axes', 'ripple'}
  NUCLEUS              {'center', 'radius'}
  NUCLEUS_ZONE         {'center', 'radius'}
  RER                  {'axis', 'min_dot', 'radii'}
  SER                  {'axis', 'min_dot', 'r_min', 'r_max', 'zone_min_dot', 'zone_radius'}
  GOLGI                {'centers', 'zone_radius'}
  REP_POS              {id: (x, y, z)}  葉綠體、粒線體、過氧化體的代表個體位置
"""
import json
import math
import os
import random

import bmesh
import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PALETTE_PATH = os.path.join(ROOT, "shared", "palette.json")

# ----------------------------------------------------------------------------
# 座標與版面常數
# ----------------------------------------------------------------------------
CELL_HALF = (5.0, 3.5, 3.2)
CORNER_R = 1.0
WALL_T = 0.28
GAP = 0.04
MEMBRANE_T = 0.06
_INSET = WALL_T + GAP + MEMBRANE_T  # 0.38
CAVITY_HALF = tuple(h - _INSET for h in CELL_HALF)  # (4.62, 3.12, 2.82)
CAVITY_R = CORNER_R - _INSET  # 0.62

CUT_X, CUT_Y, CUT_Z = -2.2, 0.8, -1.4

VACUOLE = {"center": (-1.6, 0.9, -0.2), "axes": (2.7, 1.95, 2.1), "ripple": 0.10}
NUCLEUS = {"center": (2.7, -0.6, 0.6), "radius": 1.15}
NUCLEUS_ZONE = {"center": NUCLEUS["center"], "radius": 1.80}
RER = {"axis": (-0.75, 0.55, 0.35), "min_dot": 0.1, "radii": (1.30, 1.42, 1.54, 1.66)}
SER = {
    "axis": (0.35, -0.45, -0.8),
    "min_dot": 0.55,
    "r_min": 1.35,
    "r_max": 1.95,
    "zone_min_dot": 0.5,
    "zone_radius": 2.05,
}
GOLGI = {"centers": [(-0.3, -2.2, 0.2), (-3.3, -2.1, -1.5)], "zone_radius": 0.75}
REP_POS = {
    "chloroplast": (-1.2, -2.4, 1.7),
    "mitochondrion": (0.9, -2.5, -0.7),
    "peroxisome": (0.5, -2.6, 1.6),
}
CAMERA_DIR = (0.62, -0.62, 0.48)
SEED = 20261117

# validate_layout 用：代表個體的標稱清空半徑（只用於版面驗算，不限制各模組實際尺寸）
REP_CLEARANCE = {"chloroplast": 0.70, "mitochondrion": 0.60, "peroxisome": 0.45}
MIN_GAP = 0.1

# 預覽用半透明度（只影響預覽圖與 glb 內的 Blender 材質，網頁端會重新指定材質）
PREVIEW_ALPHA = {"cytoplasm": 0.15, "vacuole": 0.45}
# add_part 平滑著色時，二面角超過此值的邊保持銳利（弧度）
SHARP_ANGLE = math.radians(50.0)


# ----------------------------------------------------------------------------
# 幾何判斷
# ----------------------------------------------------------------------------
def _np(p):
    return np.asarray(p, dtype=float)


def _unit(v):
    v = _np(v)
    return v / np.linalg.norm(v)


def in_cut(p):
    return bool(p[0] >= CUT_X and p[1] <= CUT_Y and p[2] >= CUT_Z)


def rbox_sdf(p, half, r):
    """圓角盒有號距離（負值在內）。p 可為單點或 (N, 3)。"""
    p = _np(p)
    q = np.abs(p) - (_np(half) - r)
    return (
        np.linalg.norm(np.maximum(q, 0.0), axis=-1)
        + np.minimum(np.max(q, axis=-1), 0.0)
        - r
    )


def cavity_sdf(p):
    return float(rbox_sdf(p, CAVITY_HALF, CAVITY_R))


def inside_cavity(p, margin=0.0):
    return cavity_sdf(p) <= -margin


def _sector_sdf(P, apex, axis, min_dot, radius):
    """球形扇區（以 apex 為頂點、軸向 axis、方向內積 > min_dot、半徑 radius）的
    有號距離；P 可為 (N, 3) 或單點。外側為精確距離，內側為到邊界距離的近似。"""
    P = _np(P)
    single = P.ndim == 1
    P = np.atleast_2d(P) - _np(apex)
    ax = _unit(axis)
    a = P @ ax
    rho = np.linalg.norm(P - a[:, None] * ax, axis=1)
    d = np.hypot(a, rho)
    alpha = math.acos(min_dot)
    ca, sa = math.cos(alpha), math.sin(alpha)
    theta = np.arctan2(rho, a)
    t = a * ca + rho * sa
    tc = np.clip(t, 0.0, radius)
    outside_cone = np.hypot(a - tc * ca, rho - tc * sa)
    out = np.where(theta <= alpha, d - radius, outside_cone)
    # 內側：取到球面與到錐面的較近者（負值）
    inside = np.maximum(d - radius, -(d * np.sin(np.maximum(alpha - theta, 0.0))))
    out = np.where((theta <= alpha) & (d <= radius), inside, out)
    return float(out[0]) if single else out


class PlacementError(RuntimeError):
    pass


class Ctx:
    """建模時共用的狀態：亂數與已保留的球。"""

    def __init__(self, seed=SEED):
        self.seed = seed
        self.rng = random.Random(seed)
        self.reserved = []  # (name, (x, y, z), radius)

    def is_free(self, center, radius):
        c = _np(center)
        if cavity_sdf(c) > -radius:
            return False
        v = VACUOLE
        semi = _np(v["axes"]) + (0.15 + radius)
        if float(np.sum(((c - _np(v["center"])) / semi) ** 2)) < 1.0:
            return False
        if np.linalg.norm(c - _np(NUCLEUS_ZONE["center"])) < NUCLEUS_ZONE["radius"] + radius:
            return False
        s = SER
        if (
            _sector_sdf(c, NUCLEUS["center"], s["axis"], s["zone_min_dot"], s["zone_radius"])
            < radius
        ):
            return False
        for g in GOLGI["centers"]:
            if np.linalg.norm(c - _np(g)) < GOLGI["zone_radius"] + radius:
                return False
        for _name, rc, rr in self.reserved:
            if np.linalg.norm(c - _np(rc)) < rr + radius:
                return False
        return True

    def reserve(self, name, center, radius):
        if not self.is_free(center, radius):
            raise ValueError(f"無法保留 {name}：中心 {tuple(center)}、半徑 {radius} 不在可用空間內")
        self.reserved.append((name, tuple(float(x) for x in center), float(radius)))

    def sample_free(self, radius, want_cut, tries=5000, accept=None):
        rng = self.rng
        lo = [-h for h in CAVITY_HALF]
        hi = list(CAVITY_HALF)
        for _ in range(tries):
            p = (rng.uniform(lo[0], hi[0]), rng.uniform(lo[1], hi[1]), rng.uniform(lo[2], hi[2]))
            if not self.is_free(p, radius):
                continue
            if in_cut(p) != bool(want_cut):
                continue
            if want_cut and not (
                p[0] - radius >= CUT_X and p[1] + radius <= CUT_Y and p[2] - radius >= CUT_Z
            ):
                continue
            if accept is not None and not accept(p):
                continue
            return p
        raise PlacementError(
            f"在 {tries} 次嘗試內找不到半徑 {radius} 的可用位置（want_cut={want_cut}）"
        )


# ----------------------------------------------------------------------------
# 版面驗算
# ----------------------------------------------------------------------------
def _fib_sphere(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], axis=1)


def validate_layout():
    """固定位置的構造都要在空腔內、兩兩間隙不小於 MIN_GAP，否則 raise ValueError。"""
    unit = _fib_sphere(40000)
    v = VACUOLE
    ell_pts = _np(v["center"]) + unit * (_np(v["axes"]) + v["ripple"])

    # 構造：name -> ('sphere', c, r) | ('ellipsoid', pts) | ('sector', apex, axis, min_dot, R)
    shapes = {
        "vacuole": ("ellipsoid", ell_pts),
        "nucleus_zone": ("sphere", _np(NUCLEUS_ZONE["center"]), NUCLEUS_ZONE["radius"]),
        "ser_zone": (
            "sector",
            _np(NUCLEUS["center"]),
            SER["axis"],
            SER["zone_min_dot"],
            SER["zone_radius"],
        ),
    }
    for i, g in enumerate(GOLGI["centers"]):
        shapes[f"golgi{i}"] = ("sphere", _np(g), GOLGI["zone_radius"])
    for k, c in REP_POS.items():
        shapes[f"rep_{k}"] = ("sphere", _np(c), REP_CLEARANCE[k])

    def dist_to(shape, P):
        """點 P (N,3) 到 shape 的有號距離。"""
        if shape[0] == "sphere":
            return np.linalg.norm(P - shape[1], axis=1) - shape[2]
        if shape[0] == "sector":
            return _sector_sdf(P, shape[1], shape[2], shape[3], shape[4])
        # ellipsoid 以取樣點近似：到最近取樣點的距離（外側）
        raise ValueError("ellipsoid 不直接求距離")

    def gap(a, b):
        sa, sb = shapes[a], shapes[b]
        if sa[0] == "ellipsoid" and sb[0] == "ellipsoid":
            raise ValueError("不支援兩個橢球互比")
        if sa[0] == "ellipsoid":
            sa, sb = sb, sa
        if sb[0] == "ellipsoid":
            pts = sb[1]
            if sa[0] == "sphere":
                return float(np.min(np.linalg.norm(pts - sa[1], axis=1)) - sa[2])
            return float(np.min(dist_to(sa, pts)))
        if sa[0] == "sphere":
            return float(dist_to(sb, sa[1][None, :])[0] - sa[2])
        if sb[0] == "sphere":
            return float(dist_to(sa, sb[1][None, :])[0] - sb[2])
        raise ValueError("不支援兩個扇區互比")

    # 1. 都在空腔內
    rng = np.random.default_rng(1)
    contain = dict(shapes)
    contain["ser_zone"] = ("sector", _np(NUCLEUS["center"]), SER["axis"], SER["min_dot"], SER["r_max"])
    for name, s in contain.items():
        if s[0] == "sphere":
            pts = s[1] + _fib_sphere(2000) * s[2]
        elif s[0] == "ellipsoid":
            pts = s[1]
        else:
            ax = _unit(s[2])
            n = 20000
            dirs = rng.normal(size=(n * 3, 3))
            dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
            dirs = dirs[dirs @ ax >= s[3]][:n]
            pts = s[1] + dirs * s[4] * np.cbrt(rng.uniform(size=(len(dirs), 1)))
        out = float(np.max(rbox_sdf(pts, CAVITY_HALF, CAVITY_R)))
        if out > 0:
            raise ValueError(f"版面不合：{name} 超出空腔 {out:.3f}")

    # 2. 兩兩間隙（細胞核區與粗糙內質網同屬 NUCLEUS_ZONE；與平滑內質網區本來就相連，不比）
    names = list(shapes)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            if {a, b} == {"nucleus_zone", "ser_zone"}:
                continue
            if shapes[a][0] == "ellipsoid" and shapes[b][0] == "ellipsoid":
                continue
            g = gap(a, b)
            if g < MIN_GAP:
                raise ValueError(f"版面不合：{a} 與 {b} 的間隙 {g:.3f} 小於 {MIN_GAP}")

    # 3. 粗糙內質網與平滑內質網的扇形區不重疊（半角之和 <= 兩軸夾角）
    cos_between = float(_unit(RER["axis"]) @ _unit(SER["axis"]))
    between = math.acos(max(-1.0, min(1.0, cos_between)))
    if math.acos(RER["min_dot"]) + math.acos(SER["min_dot"]) > between:
        raise ValueError("版面不合：粗糙內質網與平滑內質網的扇形區重疊")
    # 4. 粗糙內質網最外層要在細胞核禁入球內
    if max(RER["radii"]) >= NUCLEUS_ZONE["radius"]:
        raise ValueError("版面不合：粗糙內質網超出細胞核禁入球")
    # 5. 細胞核本體要在細胞核禁入球內，且與平滑內質網內緣仍有間隙
    if NUCLEUS["radius"] >= SER["r_min"]:
        raise ValueError("版面不合：細胞核與平滑內質網內緣重疊")


# ----------------------------------------------------------------------------
# 材質
# ----------------------------------------------------------------------------
_PALETTE = None


def _palette():
    global _PALETTE
    if _PALETTE is None:
        with open(PALETTE_PATH, encoding="utf-8") as f:
            _PALETTE = json.load(f)
    return _PALETTE


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    h = h.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i : i + 2], 16) / 255.0) for i in (0, 2, 4))


def material_for(organelle_id, part):
    """依 palette 取得材質（以名稱 `<id>.<part>` 在 bpy.data.materials 內快取）。"""
    pal = _palette()
    if organelle_id not in pal:
        raise KeyError(f"palette 沒有 {organelle_id}")
    if part not in pal[organelle_id]:
        raise KeyError(f"palette 的 {organelle_id} 沒有 part '{part}'（有：{', '.join(pal[organelle_id])}）")
    name = f"{organelle_id}.{part}"
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    rgb = hex_to_linear(pal[organelle_id][part])
    mat.diffuse_color = (*rgb, 1.0)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    alpha = PREVIEW_ALPHA.get(organelle_id)
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    return mat


# ----------------------------------------------------------------------------
# 標記與匯出
# ----------------------------------------------------------------------------
def _link(obj):
    scene = bpy.context.scene
    if obj.name not in scene.collection.objects:
        scene.collection.objects.link(obj)


def _parent_keep_world(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_basis.inverted()


def new_instance(organelle_id, location):
    """建立個體根節點（Empty）。同一 id 的第一個自動 rep=1。location 應為該個體的幾何中心。"""
    n = sum(
        1
        for o in bpy.data.objects
        if o.type == "EMPTY" and o.get("organelle") == organelle_id and "inst" in o
    )
    root = bpy.data.objects.new(f"{organelle_id}_{n}", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.2
    root.location = tuple(location)
    root["organelle"] = organelle_id
    root["inst"] = n
    root["rep"] = 1 if n == 0 else 0
    _link(root)
    return root


def add_part(root, mesh_obj, part="main"):
    """把網格掛到根節點下（保持世界座標），寫入 organelle / part，指定材質並平滑著色。
    organelle 取自 root；root 沒有 organelle（例如蓋子根）時用 mesh_obj 上已寫好的值。"""
    organelle = root.get("organelle", mesh_obj.get("organelle"))
    if organelle is None:
        raise ValueError(f"{mesh_obj.name}：根節點與網格都沒有 organelle")
    _link(mesh_obj)
    _parent_keep_world(mesh_obj, root)
    mesh_obj["organelle"] = organelle
    mesh_obj["part"] = part
    me = mesh_obj.data
    me.materials.clear()
    me.materials.append(material_for(organelle, part))
    if not me.has_custom_normals:
        bm = bmesh.new()
        bm.from_mesh(me)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > SHARP_ANGLE:
                e.smooth = False
        bm.to_mesh(me)
        bm.free()


def add_anchor(root, location):
    """在個體根底下加一個錨點 Empty（anchor=1）。location 為世界座標。"""
    a = bpy.data.objects.new(f"{root.name}_anchor", None)
    a.empty_display_type = "SPHERE"
    a.empty_display_size = 0.08
    a.location = tuple(location)
    a["anchor"] = 1
    _link(a)
    _parent_keep_world(a, root)


def _check_tags_before_export():
    """匯出前檢查：每個掛進場景的網格要有 organelle，且祖先鏈上有個體根（inst）或蓋子根（lid）。"""
    problems = []
    bpy.context.view_layer.update()  # 剛 link 或剛刪除的物件要先同步
    for o in bpy.context.view_layer.objects:
        if o is None or o.type != "MESH":
            continue
        if o.get("organelle") is None:
            problems.append(f"{o.name}：缺 organelle")
            continue
        p = o.parent
        while p is not None and "inst" not in p and "lid" not in p:
            p = p.parent
        if p is None:
            problems.append(f"{o.name}：沒有個體根（inst）或蓋子根（lid）祖先")
    if problems:
        raise ValueError("匯出前標記檢查未通過：\n" + "\n".join(problems))


def export_glb(path):
    """匯出整個場景為 glb（蓋子一定在；不匯出相機與燈光）。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    _check_tags_before_export()
    bpy.context.view_layer.update()
    in_layer = {o for o in bpy.context.view_layer.objects if o is not None}
    hidden = []  # (物件, hide_render, hide_viewport, hide_get 或 None)
    for o in bpy.data.objects:
        hg = o.hide_get() if o in in_layer else None
        if o.hide_render or o.hide_viewport or hg:
            hidden.append((o, o.hide_render, o.hide_viewport, hg))
            o.hide_render = False
            o.hide_viewport = False
            if hg:
                o.hide_set(False)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_extras=True,
        export_apply=True,
        export_texcoords=False,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        use_selection=False,
    )
    for o, hr, hv, hg in hidden:
        o.hide_render = hr
        o.hide_viewport = hv
        if hg:
            o.hide_set(True)
