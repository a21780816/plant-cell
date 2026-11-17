"""細胞外殼：細胞膜、本細胞的細胞壁、中膠層、相鄰細胞的細胞壁、細胞質、原生質絲，以及可掀開的蓋子。

外形是六角柱，每一面是平的，面與面之間是銳利的稜線。由內而外的層次：
  細胞質 | 細胞膜 | (縫隙) | 本細胞的壁 | 中膠層 | 相鄰細胞的壁
六條直立稜上各伸出一片板（兩片相鄰細胞壁夾一片中膠層），末端是平的切口，看得到「壁｜中膠層｜壁」。

作法：每一層先做成實心體（六角柱、或六角柱加六片板的聯集），再用精確布林相減得到各層的殼；
接著用精確布林切出掀開區（差集是本體、交集是蓋子），把落在切割平面上的面分出成獨立的 cut 物件。
"""
import math

import bmesh
import bpy
import numpy as np

from . import common as C

HZ = C.HEX_HALF_Z
T_NB = C.LAMELLA_T + C.NEIGHBOR_WALL_T  # 0.34：相鄰細胞壁外表面相對於本細胞壁外表面的外推量
# 板的末端切口距頂點的距離：伸出長度加上兩層在 120 度轉角處的外推量（T_NB / sin 60 度）
S_END = C.FLANGE_LEN + T_NB / math.sin(math.radians(60.0))
W_LAM = C.LAMELLA_T / 2  # 中膠層板的半寬
W_NB = T_NB - C.LAMELLA_T / 2  # 相鄰細胞壁板（兩片壁夾一片中膠層）的半寬：0.31
Z_NB = HZ + T_NB  # 相鄰細胞壁與伸出的板的半高：3.54
Z_LAM = HZ + C.LAMELLA_T  # 中膠層本體的半高：3.26
BEV = C.EDGE_BEVEL

HEX = np.array(C.hex_vertices())
DIRS = np.array(C.flange_dirs())


# ----------------------------------------------------------------------------
# 六角形輪廓與柱體
# ----------------------------------------------------------------------------
def _edge_normals():
    out = []
    for k in range(6):
        e = HEX[(k + 1) % 6] - HEX[k]
        n = np.array([e[1], -e[0]])
        out.append(n / np.linalg.norm(n))
    return np.array(out)


NORMALS = _edge_normals()


def hex_offset(d):
    """六角形各邊朝外推 d（負值為內縮）後的六個頂點，逆時針，頂點 k 對應 hex_vertices()[k]。"""
    pts = []
    for k in range(6):
        n0, n1 = NORMALS[k - 1], NORMALS[k]
        a = np.array([n0, n1])
        b = np.array([n0 @ HEX[k] + d, n1 @ HEX[k] + d])
        pts.append(np.linalg.solve(a, b))
    return np.array(pts)


def prism(poly, z0, z1):
    """逆時針多邊形的柱體 (頂點 (N,3), 面)；上下蓋是 n 邊形，法向朝外。"""
    n = len(poly)
    v = np.array([(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly])
    f = [list(range(n - 1, -1, -1)), list(range(n, 2 * n))]
    f += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    return v, f


def hex_prism(d, z):
    return prism(hex_offset(d), -z, z)


def flange_outline(off, w):
    """六角形（外推 off）加六片板（半寬 w、伸到 S_END）的聯集輪廓；回傳 (多邊形, 各點是否為凸角)。"""
    out, convex = [], []
    for k in range(6):
        d = DIRS[k]
        p = np.array([-d[1], d[0]])
        v = HEX[k]
        n0, n1 = NORMALS[k - 1], NORMALS[k]
        s_a = (off + w * (n0 @ p)) / (n0 @ d)
        s_b = (off - w * (n1 @ p)) / (n1 @ d)
        out += [v + s_a * d - w * p, v + S_END * d - w * p, v + S_END * d + w * p, v + s_b * d + w * p]
        convex += [False, True, True, False]
    return np.array(out), convex


def slab(k, w, z):
    """第 k 片板：沿 flange_dirs()[k]、半寬 w、半高 z，自頂點起伸到 S_END；末端上下緣有 BEV 的平倒角。"""
    d = DIRS[k]
    p = np.array([-d[1], d[0]])
    v = HEX[k]
    prof = [(0.0, -z), (S_END - BEV, -z), (S_END, -z + BEV), (S_END, z - BEV), (S_END - BEV, z), (0.0, z)]
    pts = []
    for lat in (-w, w):
        for s, zz in prof:
            q = v + s * d + lat * p
            pts.append((q[0], q[1], zz))
    m = len(prof)
    f = [list(range(m - 1, -1, -1)), list(range(m, 2 * m))]
    f += [[i, (i + 1) % m, m + (i + 1) % m, m + i] for i in range(m)]
    # 頂點序：lat=-w 在前。該側面的外向取決於 p 的方向，統一用 bmesh 重算
    return _fix_orientation(np.array(pts), f)


def _fix_orientation(v, f):
    bm = bmesh.new()
    for p in v:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in f:
        bm.faces.new([bm.verts[i] for i in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    out = [[x.index for x in face.verts] for face in bm.faces]
    bm.free()
    return v, out


def neighbor_solid():
    """相鄰細胞壁的外輪廓 N：六角柱（外推 T_NB）聯集六片板，一個擠出體；外緣稜線倒角 BEV。"""
    poly, convex = flange_outline(T_NB, W_NB)
    n = len(poly)
    v, f = prism(poly, -Z_NB, Z_NB)
    bm = bmesh.new()
    for p in v:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in f:
        bm.faces.new([bm.verts[i] for i in q])
    bm.edges.ensure_lookup_table()
    sel = []
    for e in bm.edges:
        a, b = e.verts[0].index, e.verts[1].index
        if (a < n) == (b < n):  # 上或下緣一整圈
            sel.append(e)
        elif a % n == b % n and convex[a % n]:  # 凸角上的直立稜（板的末端兩側）
            sel.append(e)
    bmesh.ops.bevel(
        bm, geom=sel, offset=BEV, offset_type="OFFSET", profile=0.5, segments=1, affect="EDGES"
    )
    co = np.array([tuple(x.co) for x in bm.verts])
    bm.verts.index_update()
    faces = [[x.index for x in face.verts] for face in bm.faces]
    bm.free()
    return co, faces


# ----------------------------------------------------------------------------
# 網格工具
# ----------------------------------------------------------------------------
def _make_obj(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [list(map(int, f)) for f in faces])
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _merge(parts):
    """parts: [(verts, faces, flip)] → (verts, faces)"""
    vs, fs, off = [], [], 0
    for v, f, flip in parts:
        vs.append(v)
        for q in f:
            fs.append([i + off for i in (reversed(q) if flip else q)])
        off += len(v)
    return np.vstack(vs), fs


def _read(me):
    nv = len(me.vertices)
    co = np.empty(nv * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ls = np.empty(len(me.polygons), dtype=np.int32)
    lt = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    vi = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", vi)
    faces = [vi[s : s + t].tolist() for s, t in zip(ls, lt)]
    return co, faces


def _sub(co, faces, idx):
    """取出 faces[idx] 組成的獨立網格（頂點重新編號）。"""
    used = sorted({v for i in idx for v in faces[i]})
    remap = {v: k for k, v in enumerate(used)}
    return co[used], [[remap[v] for v in faces[i]] for i in idx]


_PLANES = ((0, C.CUT_X), (1, C.CUT_Y), (2, C.CUT_Z))


def _is_cap(co, face):
    for ax, val in _PLANES:
        if all(abs(co[v][ax] - val) < 4e-4 for v in face):
            return True
    return False


def _cutter(eps=0.0):
    """掀開區的切割體。eps > 0 時往掀開區內縮，讓留下的物件切面略微凸出（避免與細胞壁切面共面 z-fight）。"""
    lo, hi = (C.CUT_X + eps, -30.0, C.CUT_Z + eps), (30.0, C.CUT_Y - eps, 30.0)
    v = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    # 頂點序：index = 4*ix + 2*iy + iz
    f = [
        [0, 1, 3, 2], [4, 6, 7, 5],  # -x, +x
        [0, 4, 5, 1], [2, 3, 7, 6],  # -y, +y
        [0, 2, 6, 4], [1, 5, 7, 3],  # -z, +z
    ]
    obj = _make_obj("cutter", v, f)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def _boolean(a, b, operation):
    """a 為 (verts, faces)，b 為 (verts, faces) 或物件；精確布林，回傳 (co, faces)。"""
    obj = _make_obj("tmp_bool", *a)
    own = not isinstance(b, bpy.types.Object)
    cutter = _make_obj("tmp_bool_b", *b) if own else b
    mod = obj.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.solver = "EXACT"
    mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    co, faces = _read(me)
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(me)
    if own:
        bpy.data.objects.remove(cutter)
    return co, faces


def _check_solid(name, data):
    v, f = data
    bm = bmesh.new()
    for p in v:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in f:
        bm.faces.new([bm.verts[i] for i in q], )
    vol = bm.calc_volume(signed=True)
    bm.free()
    if vol <= 0:
        raise RuntimeError(f"{name} 體積為負（{vol:.3f}），面的方向錯了")
    return data


def _shell(outer, inner):
    """封閉殼：外表面加反向的內表面。"""
    return _merge([(outer[0], outer[1], False), (inner[0], inner[1], True)])


def _flat(obj):
    """每個面都是平的：自訂法向設成面法向（帶自訂法向的網格 add_part 不會再平滑）。"""
    me = obj.data
    nrm = []
    for p in me.polygons:
        nrm += [tuple(p.normal)] * p.loop_total
    me.normals_split_custom_set(nrm)
    return obj


def _split_cap(co, faces):
    cap_idx = [i for i, f in enumerate(faces) if _is_cap(co, f)]
    capset = set(cap_idx)
    body_idx = [i for i in range(len(faces)) if i not in capset]
    return body_idx, cap_idx


def _bbox_center(*cos):
    allv = np.vstack([c for c in cos if len(c)])
    return (allv.min(0) + allv.max(0)) / 2


def _tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ----------------------------------------------------------------------------
# 原生質絲
# ----------------------------------------------------------------------------
# (種類, 參數, 沿壁面的位置)：
#   ("z+", (x, y), _) / ("z-", (x, y), _)：頂面或底面上的點
#   ("side", k, (u, z))：第 k 個側面，u 為自頂點 k 往頂點 k+1 的比例，z 為高度
# 前 7 條剛好落在切割平面上，會被剖開。
_PD_PLACES = [
    ("z+", (-2.2, -1.5), None),   # 頂面，位於 x = CUT_X
    ("z+", (-2.2, 0.15), None),   # 頂面，位於 x = CUT_X
    ("z+", (1.4, 0.8), None),     # 頂面，位於 y = CUT_Y
    ("side", 4, (0.2609, 1.3)),   # -y 面，位於 x = CUT_X
    ("side", 4, (0.6304, -1.4)),  # -y 面，位於 z = CUT_Z
    ("side", 5, (0.5, -1.4)),     # +x/-y 斜面，位於 z = CUT_Z
    ("side", 0, (0.2286, 0.8)),   # +x/+y 斜面，位於 y = CUT_Y
    ("z+", (-3.5, -0.9), None),
    ("z+", (-3.1, 1.7), None),
    ("z-", (0.5, -0.8), None),
    ("z-", (-2.5, 1.5), None),
    ("side", 1, (0.826, 0.6)),
    ("side", 1, (0.337, -0.8)),
    ("side", 2, (0.5, 0.5)),
    ("side", 3, (0.343, -1.0)),
    ("side", 5, (0.714, 1.5)),
]


def _pd_site(kind, a, b):
    """回傳 (本細胞壁外表面上的點, 外向單位法向)。"""
    if kind == "z+":
        return np.array([a[0], a[1], HZ]), np.array([0.0, 0.0, 1.0])
    if kind == "z-":
        return np.array([a[0], a[1], -HZ]), np.array([0.0, 0.0, -1.0])
    u, z = b
    p = HEX[a] + u * (HEX[(a + 1) % 6] - HEX[a])
    n = NORMALS[a]
    return np.array([p[0], p[1], z]), np.array([n[0], n[1], 0.0])


def _tube(center, normal, n=16, r0=0.07, r_collar=0.15, hb=0.035):
    """一條原生質絲：沿壁法向的旋轉體，貫穿本細胞的壁、中膠層、相鄰細胞的壁；
    兩端各有一圈小環（細胞膜側在本細胞壁內表面，相鄰細胞側在相鄰細胞壁外表面）。
    center 為本細胞壁外表面上的點；剖面 t：0 = 本細胞壁外表面，-WALL_T = 內表面，T_NB = 相鄰壁外表面。"""
    a = normal
    e1 = np.cross(a, [0.0, 0.0, 1.0]) if abs(a[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = e1 / np.linalg.norm(e1)
    e2 = np.cross(a, e1)
    prof = []
    for tc in (-C.WALL_T, T_NB):
        for k in range(-4, 5):
            dt = hb * k / 4
            prof.append((tc + dt, r0 + (r_collar - r0) * math.cos(math.pi * dt / (2 * hb)) ** 2))
    pts, faces = [], []
    ang = (np.arange(n) + 0.5) * 2 * math.pi / n  # 偏半格，避免頂點剛好落在切割平面上
    for t, r in prof:
        for p in ang:
            pts.append(center + a * t + (np.cos(p) * e1 + np.sin(p) * e2) * r)
    m = len(prof)
    for i in range(m - 1):
        for k in range(n):
            k2 = (k + 1) % n
            faces.append([i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k])
    c0 = len(pts)
    pts.append(center + a * prof[0][0])
    pts.append(center + a * prof[-1][0])
    for k in range(n):
        k2 = (k + 1) % n
        faces.append([c0, k2, k])
        faces.append([c0 + 1, (m - 1) * n + k, (m - 1) * n + k2])
    return _fix_orientation(np.array(pts), faces)


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def build(ctx):
    cutter = _cutter()

    # --- 各層實心體與殼 ---
    w_out = hex_prism(0.0, HZ)
    w_in = hex_prism(-C.WALL_T, HZ - C.WALL_T)
    wall_solid = _check_solid("細胞壁", _shell(w_out, w_in))

    m_out = hex_prism(-(C.WALL_T + C.GAP), HZ - C.WALL_T - C.GAP)
    m_in = hex_prism(-(C.WALL_T + C.GAP + C.MEMBRANE_T), HZ - C.WALL_T - C.GAP - C.MEMBRANE_T)
    mem_solid = _check_solid("細胞膜", _shell(m_out, m_in))

    cyto_inset = C.WALL_T + C.GAP + C.MEMBRANE_T + 0.015  # 比細胞膜內表面再縮一點，避免共面
    cyto_solid = _check_solid("細胞質", hex_prism(-cyto_inset, HZ - cyto_inset))

    # 中膠層外輪廓 L：六角柱（外推 LAMELLA_T）聯集六片薄板（板的高度與相鄰壁的板等高）
    lam_out = hex_prism(C.LAMELLA_T, Z_LAM)
    for k in range(6):
        lam_out = _boolean(lam_out, slab(k, W_LAM, Z_NB), "UNION")
    lam_out = _check_solid("中膠層外輪廓", lam_out)
    nb_out = _check_solid("相鄰壁外輪廓", neighbor_solid())

    lamella_solid = _check_solid("中膠層", _boolean(lam_out, w_out, "DIFFERENCE"))
    neighbor_solid_ = _check_solid("相鄰壁", _boolean(nb_out, lam_out, "DIFFERENCE"))

    # --- 掀開區：每層切成本體與蓋子 ---
    layers = {}
    for key, solid in (
        ("wall", wall_solid),
        ("lamella", lamella_solid),
        ("neighbor", neighbor_solid_),
        ("membrane", mem_solid),
    ):
        layers[key] = (_boolean(solid, cutter, "DIFFERENCE"), _boolean(solid, cutter, "INTERSECT"))
    cyto_body = _boolean(cyto_solid, cutter, "DIFFERENCE")
    bpy.data.objects.remove(cutter)

    # --- 原生質絲（合併成一個網格，再剖開）---
    tv, tf = [], []
    for kind, a, b in _PD_PLACES:
        center, nrm = _pd_site(kind, a, b)
        v, f = _tube(center, nrm)
        tf += [[i + len(tv) for i in q] for q in f]
        tv += v.tolist()
    cutter2 = _cutter(0.006)
    pd_co, pd_faces = _boolean((np.array(tv), tf), cutter2, "DIFFERENCE")
    bpy.data.objects.remove(cutter2)

    # --- 拆出切面、建立物件 ---
    pieces = {}  # key -> dict
    for key, (body, lid) in layers.items():
        bco, bf = body
        bi, ci = _split_cap(bco, bf)
        mv, mf = _sub(bco, bf, bi)
        cv, cf = _sub(bco, bf, ci)
        lco, lf = lid
        li, lci = _split_cap(lco, lf)
        lmv, lmf = _sub(lco, lf, li)
        lcv, lcf = _sub(lco, lf, lci)
        pieces[key] = {
            "geo": _bbox_center(mv, cv),
            "lid_geo": [lmv, lcv],
            "main": _flat(_make_obj(f"{key}_main", mv, mf)),
            "cut": _flat(_make_obj(f"{key}_cut", cv, cf)),
            "lid_main": _flat(_make_obj(f"{key}_lid_main", lmv, lmf)),
            "lid_cut": _flat(_make_obj(f"{key}_lid_cut", lcv, lcf)),
        }
    cyto_obj = _flat(_make_obj("cytoplasm_main", cyto_body[0], cyto_body[1]))
    pd_obj = _make_obj("plasmodesmata_main", pd_co, pd_faces)

    # --- 個體根節點與標記 ---
    lid_root = bpy.data.objects.new("lid", None)
    lid_root.empty_display_type = "PLAIN_AXES"
    lid_root.empty_display_size = 0.3
    lid_root.location = tuple(_bbox_center(*[g for d in pieces.values() for g in d["lid_geo"]]))
    lid_root["lid"] = 1
    bpy.context.scene.collection.objects.link(lid_root)

    def make_instance(oid, members, anchor):
        """members: [(pieces 的 key, 本體 part, 切面 part)]。個體根放在所有本體網格的幾何中心。"""
        cos = [_obj_co(pieces[k][which]) for k, _, _ in members for which in ("main", "cut")]
        root = C.new_instance(oid, _bbox_center(*cos))
        for key, part_main, part_cut in members:
            d = pieces[key]
            C.add_part(root, d["main"], part_main)
            C.add_part(root, d["cut"], part_cut)
            d["lid_main"]["organelle"] = oid
            d["lid_cut"]["organelle"] = oid
            C.add_part(lid_root, d["lid_main"], part_main)
            C.add_part(lid_root, d["lid_cut"], part_cut)
        C.add_anchor(root, anchor)

    make_instance("cell_wall", [("wall", "main", "cut"), ("neighbor", "neighbor", "cut")], (-2.2, -2.0, 3.06))
    make_instance("middle_lamella", [("lamella", "main", "cut")], (-2.2, -2.0, 3.23))
    make_instance("cell_membrane", [("membrane", "main", "cut")], (-2.2, -1.2, 2.85))

    root = C.new_instance("cytoplasm", _bbox_center(cyto_body[0]))
    C.add_part(root, cyto_obj, "main")
    C.add_anchor(root, (-2.2, -2.0, 1.6))

    root = C.new_instance("plasmodesmata", _bbox_center(pd_co))
    C.add_part(root, pd_obj, "main")
    C.add_anchor(root, (-2.2, -1.5, 3.23))

    tris = sum(_tri_count(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"[shell] 三角面 {tris}")


def _obj_co(obj):
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)
