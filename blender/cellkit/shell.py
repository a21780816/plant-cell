"""細胞外殼：細胞壁、細胞膜、細胞質、原生質絲，以及可掀開的蓋子。

作法：圓角盒表面以格點投影生成（細胞壁外表面疊上纖維起伏），兩層表面合成封閉的殼，
用精確布林運算切出掀開區（差集是本體、交集是蓋子），再把落在切割平面上的面分出成獨立的 cut 物件。
"""
import math

import bmesh
import bpy
import numpy as np

from . import common as C

H = np.array(C.CELL_HALF)
R0 = C.CORNER_R
INS = {
    "wall_out": 0.0,
    "wall_in": C.WALL_T,
    "mem_out": C.WALL_T + C.GAP,
    "mem_in": C.WALL_T + C.GAP + C.MEMBRANE_T,
    "cyto": C.WALL_T + C.GAP + C.MEMBRANE_T + 0.015,
}
RIPPLE_AMP = 0.014


# ----------------------------------------------------------------------------
# 圓角盒表面
# ----------------------------------------------------------------------------
def _ticks(h, r, flat_step, rim_n):
    c = h - r
    nflat = max(1, int(math.ceil(2 * c / flat_step)))
    flat = np.linspace(-c, c, nflat + 1)
    rim = c + r * np.arange(1, rim_n + 1) / rim_n
    return np.concatenate([-rim[::-1], flat, rim])


def rbox_surface(d, flat_step, rim_n=5):
    """向內縮 d 的圓角盒表面：回傳 (頂點 (N,3)、單位外法向 (N,3)、四邊形面)。"""
    half = H - d
    r = R0 - d
    c = half - r  # 三軸相同的常數
    ticks = [_ticks(half[a], r, flat_step, rim_n) for a in range(3)]
    n = [len(t) - 1 for t in ticks]
    vid, pts, faces = {}, [], []

    def vert(ix):
        v = vid.get(ix)
        if v is None:
            v = vid[ix] = len(pts)
            pts.append((ticks[0][ix[0]], ticks[1][ix[1]], ticks[2][ix[2]]))
        return v

    for a in range(3):
        b, cc = (a + 1) % 3, (a + 2) % 3
        for side in (0, 1):
            for jb in range(n[b]):
                for jc in range(n[cc]):
                    quad = []
                    for db, dc in ((0, 0), (1, 0), (1, 1), (0, 1)):
                        ix = [0, 0, 0]
                        ix[a] = n[a] if side else 0
                        ix[b] = jb + db
                        ix[cc] = jc + dc
                        quad.append(vert(tuple(ix)))
                    if side == 0:
                        quad.reverse()
                    faces.append(quad)
    P = np.array(pts)
    q = np.clip(P, -c, c)
    off = P - q
    nrm = off / np.linalg.norm(off, axis=1, keepdims=True)
    return q + r * nrm, nrm, faces


# ----------------------------------------------------------------------------
# 細胞壁纖維起伏（向量化，位置的函數，因此切面兩側完全連續）
# ----------------------------------------------------------------------------
def _ripple(P, n):
    out = np.zeros(len(P))
    for a in range(3):
        b, c = (a + 1) % 3, (a + 2) % 3
        # 纖維沿 b 軸延伸、略為彎曲；沿 c 軸起伏
        t = 5.2 * P[:, c] + 1.7 * np.sin(0.55 * P[:, b] + 1.9 * a) + 0.6 * np.sin(1.3 * P[:, b] - 0.7 * a)
        f = 0.7 * np.sin(t) + 0.3 * np.sin(2.1 * t + 0.8 * np.sin(0.9 * P[:, b]))
        out += (n[:, a] ** 2) * f
    return RIPPLE_AMP * out


def _grad_normal(field, P, eps=1e-3):
    g = np.zeros_like(P)
    for k in range(3):
        e = np.zeros(3)
        e[k] = eps
        g[:, k] = (field(P + e) - field(P - e)) / (2 * eps)
    return g / np.linalg.norm(g, axis=1, keepdims=True)


def _unit_grad_sdf(P, half, r):
    return _grad_normal(lambda Q: C.rbox_sdf(Q, half, r), P)


def _field_wall_out(Q):
    n0 = _unit_grad_sdf(Q, H, R0)
    return C.rbox_sdf(Q, H, R0) - _ripple(Q, n0)


def _surface_normals(P, kinds):
    """每個頂點取最近那層表面的解析法向。kinds: [(d, sign, field 或 None)]。"""
    best = np.full(len(P), np.inf)
    out = np.zeros_like(P)
    for d, sign, field in kinds:
        half, r = H - d, R0 - d
        dist = np.abs(C.rbox_sdf(P, half, r))
        nrm = _grad_normal(field, P) if field is not None else _unit_grad_sdf(P, half, r)
        sel = dist < best
        out[sel] = sign * nrm[sel]
        best[sel] = dist[sel]
    return out


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
    return co[used], [[remap[v] for v in faces[i]] for i in idx], np.array(used)


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


def _boolean(src_mesh_data, cutter, operation):
    """對 (verts, faces) 與 cutter 做精確布林，回傳 (co, faces)。"""
    obj = _make_obj("tmp_bool", *src_mesh_data)
    mod = obj.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.solver = "EXACT"
    mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    co, faces = _read(me)
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(me)
    return co, faces


def _solid(parts):
    """封閉殼的 (verts, faces)，並驗證體積為正（外向）。"""
    v, f = _merge(parts)
    bm = bmesh.new()
    for p in v:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in f:
        bm.faces.new([bm.verts[i] for i in q])
    vol = bm.calc_volume(signed=True)
    bm.free()
    if vol <= 0:
        raise RuntimeError(f"殼體積為負（{vol:.3f}），面的方向錯了")
    return v, f


def _finish_part(name, co, faces, normals_kinds=None, flat=False):
    obj = _make_obj(name, co, faces)
    me = obj.data
    if normals_kinds is not None:
        me.shade_smooth()
        nrm = _surface_normals(co, normals_kinds)
        me.normals_split_custom_set_from_vertices([tuple(x) for x in nrm])
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
# (軸向 'x+' 等, 另兩軸座標)。前 7 條剛好落在切割平面上，會被剖開。
_PD_PLACES = [
    ("z+", (-2.2, -1.5)),   # 頂面，位於 x = CUT_X
    ("z+", (-2.2, 0.15)),   # 頂面，位於 x = CUT_X
    ("z+", (1.4, 0.8)),     # 頂面，位於 y = CUT_Y
    ("y-", (-2.2, 1.3)),    # 前面，位於 x = CUT_X
    ("y-", (1.2, -1.4)),    # 前面，位於 z = CUT_Z
    ("x+", (0.8, 0.8)),     # 右端面，位於 y = CUT_Y
    ("x+", (-1.2, -1.4)),   # 右端面，位於 z = CUT_Z
    ("z+", (-3.5, -0.9)),
    ("z+", (-3.1, 1.7)),
    ("x-", (0.6, 1.1)),
    ("x-", (-1.6, -0.5)),
    ("y+", (-3.0, 0.6)),
    ("y+", (1.5, -1.0)),
    ("z-", (0.5, -0.8)),
    ("z-", (-2.5, 1.5)),
    ("y-", (-3.6, 0.5)),
]
_AXIS = {"x": 0, "y": 1, "z": 2}


def _tube(center, axis, n=16, r0=0.07, r_collar=0.15):
    """一條原生質絲：沿 axis 的旋轉體，兩端各有一圈小環。center 為壁外表面上的點。"""
    ai = _AXIS[axis[0]]
    sgn = 1.0 if axis[1] == "+" else -1.0
    a = np.zeros(3)
    a[ai] = sgn
    e1 = np.zeros(3)
    e1[(ai + 1) % 3] = 1.0
    e2 = np.cross(a, e1)
    # 沿壁法向的剖面 t：0 = 外表面，-WALL_T = 內表面
    t_in_end, t_out_end = -C.WALL_T - 0.03, 0.035
    bump = [(dt, math.cos(math.pi * dt / 0.08) ** 2) for dt in (-0.04, -0.03, -0.015, 0.0, 0.015, 0.03, 0.04)]
    prof = [(t_in_end, r0)]
    for tc in (-C.WALL_T, 0.0):
        for dt, w in bump:
            prof.append((tc + dt, r0 + (r_collar - r0) * w))
    prof.append((t_out_end, r0))
    # 去除過近的重複點（-WALL_T 附近與端點可能重疊）
    clean = [prof[0]]
    for t, r in prof[1:]:
        if t > clean[-1][0] + 1e-6:
            clean.append((t, r))
    prof = clean
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
    pts.append(center + a * t_in_end)
    pts.append(center + a * t_out_end)
    for k in range(n):
        k2 = (k + 1) % n
        faces.append([c0, k2, k])
        faces.append([c0 + 1, (m - 1) * n + k, (m - 1) * n + k2])
    pts = np.array(pts)
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in faces:
        bm.faces.new([bm.verts[i] for i in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    out_f = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return pts, out_f


def _wall_surface_point(axis, uv):
    ai = _AXIS[axis[0]]
    sgn = 1.0 if axis[1] == "+" else -1.0
    p = np.zeros(3)
    p[ai] = sgn * H[ai]
    others = [k for k in range(3) if k != ai]  # 依 x, y, z 順序，uv 就是另外兩軸的座標
    p[others[0]], p[others[1]] = uv
    return p


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def build(ctx):
    cutter = _cutter()
    stats = {}

    # --- 細胞壁 ---
    wo, wno, wfo = rbox_surface(INS["wall_out"], 0.27)
    wo = wo + wno * _ripple(wo, wno)[:, None]
    wi, _, wfi = rbox_surface(INS["wall_in"], 0.9)
    wall_solid = _solid([(wo, wfo, False), (wi, wfi, True)])
    wall_kinds = [(INS["wall_out"], 1.0, _field_wall_out), (INS["wall_in"], -1.0, None)]

    # --- 細胞膜 ---
    mo, _, mfo = rbox_surface(INS["mem_out"], 0.9)
    mi, _, mfi = rbox_surface(INS["mem_in"], 0.9)
    mem_solid = _solid([(mo, mfo, False), (mi, mfi, True)])
    mem_kinds = [(INS["mem_out"], 1.0, None), (INS["mem_in"], -1.0, None)]

    # --- 細胞質 ---
    cy, _, cyf = rbox_surface(INS["cyto"], 1.2)
    cyto_solid = _solid([(cy, cyf, False)])

    lid_parts = []  # (organelle, part, co, faces, kinds)

    # 細胞壁、細胞膜：本體 + 蓋子
    shell_items = []
    for oid, solid, kinds in (("cell_wall", wall_solid, wall_kinds), ("cell_membrane", mem_solid, mem_kinds)):
        body = _boolean(solid, cutter, "DIFFERENCE")
        lid = _boolean(solid, cutter, "INTERSECT")
        shell_items.append((oid, body, lid, kinds))

    cyto_body = _boolean(cyto_solid, cutter, "DIFFERENCE")
    bpy.data.objects.remove(cutter)

    # --- 原生質絲（合併成一個網格，再剖開）---
    tv, tf = [], []
    for ax, uv in _PD_PLACES:
        v, f = _tube(_wall_surface_point(ax, uv), ax)
        tf += [[i + len(tv) for i in q] for q in f]
        tv += v.tolist()
    cutter2 = _cutter(0.006)
    pd_co, pd_faces = _boolean((np.array(tv), tf), cutter2, "DIFFERENCE")
    bpy.data.objects.remove(cutter2)

    # --- 組裝 ---
    objs_by_id = {}
    lid_geo = []
    for oid, body, lid, kinds in shell_items:
        bco, bf = body
        bi, ci = _split_cap(bco, bf)
        mv, mf, mused = _sub(bco, bf, bi)
        cv, cf, _ = _sub(bco, bf, ci)
        lco, lf = lid
        li, lci = _split_cap(lco, lf)
        lmv, lmf, _ = _sub(lco, lf, li)
        lcv, lcf, _ = _sub(lco, lf, lci)
        lid_geo.append(lmv)
        lid_geo.append(lcv)
        objs_by_id[oid] = {
            "geo": _bbox_center(mv, cv),
            "main": _finish_part(f"{oid}_main", mv, mf, kinds),
            "cut": _finish_part(f"{oid}_cut", cv, cf),
            "lid_main": _finish_part(f"{oid}_lid_main", lmv, lmf, kinds),
            "lid_cut": _finish_part(f"{oid}_lid_cut", lcv, lcf),
            "cut_co": cv,
        }

    cyto_obj = _make_obj("cytoplasm_main", cyto_body[0], cyto_body[1])
    pd_obj = _make_obj("plasmodesmata_main", pd_co, pd_faces)

    # 個體根節點與標記
    for oid in ("cell_wall", "cell_membrane"):
        d = objs_by_id[oid]
        root = C.new_instance(oid, d["geo"])
        C.add_part(root, d["main"], "main")
        C.add_part(root, d["cut"], "cut")
        if oid == "cell_wall":
            C.add_anchor(root, (-3.6, 0.0, 3.2))
        else:
            C.add_anchor(root, (-2.2, -1.2, 2.85))
    lid_root = bpy.data.objects.new("lid", None)
    lid_root.empty_display_type = "PLAIN_AXES"
    lid_root.empty_display_size = 0.3
    lid_root.location = tuple(_bbox_center(*lid_geo))
    lid_root["lid"] = 1
    bpy.context.scene.collection.objects.link(lid_root)
    for oid in ("cell_wall", "cell_membrane"):
        d = objs_by_id[oid]
        d["lid_main"]["organelle"] = oid
        d["lid_cut"]["organelle"] = oid
        C.add_part(lid_root, d["lid_main"], "main")
        C.add_part(lid_root, d["lid_cut"], "cut")

    root = C.new_instance("cytoplasm", _bbox_center(cyto_body[0]))
    C.add_part(root, cyto_obj, "main")
    C.add_anchor(root, (-2.2, -2.0, 1.6))

    root = C.new_instance("plasmodesmata", _bbox_center(pd_co))
    C.add_part(root, pd_obj, "main")
    C.add_anchor(root, (-2.2, -1.5, 3.06))

    tris = sum(_tri_count(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"[shell] 三角面 {tris}")
