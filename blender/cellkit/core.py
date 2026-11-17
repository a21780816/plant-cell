"""細胞核心：中央液泡、細胞核（含核孔、染色質）、核仁。

液泡：細胞內最大的構造。以立方體球（細分立方體再正規化）為底，沿橢球法向疊上低頻起伏，成為飽滿的水囊。
細胞核：雙層厚度 0.08 的核膜球殼。朝鏡頭的八分之一（局部 x>0, y<0, z>0）用精確布林切開；
        切面（核膜環與略為內凹的核質剖面）拆成獨立的 cut 物件。核孔與染色質各合併成一個網格。
核仁：帶顆粒感的小球，位置偏離核心，從切口完整露出。
"""
import math

import bmesh
import bpy
import numpy as np

from . import common as C

NC = np.array(C.NUCLEUS["center"], dtype=float)
NR = C.NUCLEUS["radius"]
SHELL_T = 0.08
NR_IN = NR - SHELL_T
RECESS = 0.06  # 核質剖面比核膜切面內凹的深度，讓核膜厚度看得出來
NUCLEOLUS_R = 0.42
NUCLEOLUS_OFF = np.array((0.15, -0.1, 0.1))
OCTANT = np.array((1.0, -1.0, 1.0)) / math.sqrt(3.0)  # 切口中心方向（局部）


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


def _drop(obj):
    me = obj.data
    bpy.data.objects.remove(obj)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


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
    used = sorted({v for i in idx for v in faces[i]})
    remap = {v: k for k, v in enumerate(used)}
    return co[used], [[remap[v] for v in faces[i]] for i in idx]


def _solid_volume(verts, faces):
    bm = bmesh.new()
    for p in verts:
        bm.verts.new(tuple(p))
    bm.verts.ensure_lookup_table()
    for q in faces:
        bm.faces.new([bm.verts[i] for i in q])
    vol = bm.calc_volume(signed=True)
    bm.free()
    return vol


def _check_closed_outward(name, verts, faces):
    vol = _solid_volume(verts, faces)
    if vol <= 0:
        raise RuntimeError(f"{name} 的體積為負或零（{vol:.4f}），面的方向錯了")


def _ico(radius, subdivisions):
    """正二十面體球，回傳 (頂點 (N,3), 三角面)。法向朝外。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    v = np.array([tuple(p.co) for p in bm.verts])
    f = [[x.index for x in face.verts] for face in bm.faces]
    bm.free()
    return v, f


def _cube_sphere(n):
    """細分立方體正規化成球（每面 n x n 個四邊形）。回傳單位球頂點與四邊形面。"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=n - 1, use_grid_fill=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    v = np.array([tuple(p.co) for p in bm.verts])
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    f = [[x.index for x in face.verts] for face in bm.faces]
    bm.free()
    return v, f


def _rotation(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def _box(lo, hi):
    v = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    # 頂點序 index = 4*ix + 2*iy + iz
    f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
    obj = _make_obj("core_cutter", v, f)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def _boolean(verts, faces, cutter, operation):
    obj = _make_obj("core_tmp_bool", verts, faces)
    mod = obj.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.solver = "EXACT"
    mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    co, fc = _read(me)
    bpy.data.meshes.remove(me)
    _drop(obj)
    return co, fc


def _on_planes(co, face, planes, tol=4e-4):
    for ax, val in planes:
        if all(abs(co[v][ax] - val) < tol for v in face):
            return True
    return False


def _split_planes(co, faces, planes):
    cap = [i for i, f in enumerate(faces) if _on_planes(co, f, planes)]
    cs = set(cap)
    rest = [i for i in range(len(faces)) if i not in cs]
    return rest, cap


def _tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def _merge(parts):
    vs, fs, off = [], [], 0
    for v, f in parts:
        vs.append(v)
        fs += [[i + off for i in q] for q in f]
        off += len(v)
    return np.vstack(vs), fs


def _bbox_center(*cos):
    allv = np.vstack([c for c in cos if len(c)])
    return (allv.min(0) + allv.max(0)) / 2


# ----------------------------------------------------------------------------
# 液泡
# ----------------------------------------------------------------------------
def _vacuole_field(u, rng):
    """單位方向 u (N,3) 上的低頻起伏，回傳值域約 [-1, 1]。幾個寬的凸包與凹窪，加兩個低頻波。"""
    d = np.zeros(len(u))
    lobes = [
        (+1.0, 0.9),
        (+0.8, 0.8),
        (-0.9, 0.7),
        (+0.6, 0.6),
        (-0.7, 0.8),
        (+0.5, 0.5),
    ]
    for amp, width in lobes:
        c = rng.normal(size=3)
        c /= np.linalg.norm(c)
        d += amp * np.exp((u @ c - 1.0) / (width * 0.55))
    for _ in range(2):
        w = rng.normal(size=3)
        w /= np.linalg.norm(w)
        d += 0.35 * np.sin(1.7 * (u @ w) * math.pi + rng.uniform(0, 2 * math.pi))
    return d


def _build_vacuole(ctx):
    rng = np.random.default_rng(ctx.seed)
    u, quads = _cube_sphere(30)
    axes = np.array(C.VACUOLE["axes"])
    amp = C.VACUOLE["ripple"] * 0.95
    d = _vacuole_field(u, rng)
    d = d - d.mean()
    d = amp * d / np.max(np.abs(d))
    nrm = u / axes
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    co = np.array(C.VACUOLE["center"]) + u * axes + nrm * d[:, None]
    _check_closed_outward("液泡", co, quads)
    obj = _make_obj("vacuole_main", co, quads)
    center = _bbox_center(co)
    root = C.new_instance("vacuole", center)
    C.add_part(root, obj, "main")
    # 錨點：VACUOLE 中心沿 CAMERA_DIR 打到表面的點
    cam = np.array(C.CAMERA_DIR) / np.linalg.norm(C.CAMERA_DIR)
    hit, loc, _n, _i = obj.ray_cast(tuple(C.VACUOLE["center"]), tuple(cam))
    if not hit:
        raise RuntimeError("液泡錨點：從中心沿鏡頭方向沒有打到表面")
    C.add_anchor(root, tuple(loc))
    return co, tuple(loc), center


# ----------------------------------------------------------------------------
# 細胞核
# ----------------------------------------------------------------------------
def _pore_template(n=16):
    """單一核孔：繞 +z 軸的旋轉體（z = 離球面的高度），外緣微凸成環，中央是略高於球面的暗色底。"""
    prof = [(0.125, -0.004), (0.108, 0.020), (0.086, 0.030), (0.066, 0.022), (0.054, 0.009)]
    pts, faces = [], []
    ang = (np.arange(n) + 0.5) * 2 * math.pi / n
    for rho, h in prof:
        for a in ang:
            pts.append((rho * math.cos(a), rho * math.sin(a), h))
    for i in range(len(prof) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            faces.append([i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k])
    c = len(pts)
    pts.append((0.0, 0.0, 0.009))
    last = (len(prof) - 1) * n
    for k in range(n):
        k2 = (k + 1) % n
        faces.append([last + k, last + k2, c])
    return np.array(pts), faces


def _fib(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], axis=1)


def _build_pores(rot):
    tv, tf = _pore_template()
    dirs = _fib(84) @ rot.T
    m = 0.15  # 切口邊緣留白，核孔不被切到
    keep = ~((dirs[:, 0] > -m) & (dirs[:, 1] < m) & (dirs[:, 2] > -m))
    dirs = dirs[keep]
    parts = []
    for n in dirs:
        helper = np.array((0.0, 0.0, 1.0)) if abs(n[2]) < 0.9 else np.array((1.0, 0.0, 0.0))
        e1 = np.cross(helper, n)
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(n, e1)
        basis = np.stack([e1, e2, n], axis=1)  # 右手系：e1 x e2 = n
        v = NC + n * NR + tv @ basis.T
        parts.append((v, tf))
    v, f = _merge(parts)
    # 檢查：每個面的法向都要朝外
    p = v[np.array([q[0] for q in f])]
    a = v[np.array([q[1] for q in f])] - p
    b = v[np.array([q[2] for q in f])] - p
    nn = np.cross(a, b)
    out = np.einsum("ij,ij->i", nn, p - NC)
    if np.any(out <= 0):
        raise RuntimeError("核孔有朝內的面")
    return v, f, len(dirs)


def _tube(path, r, sides=6, cap_steps=(35.0, 65.0, 85.0)):
    """沿 path (N,3) 的圓管，兩端以近似半球收口。回傳 (頂點, 面)，法向朝外。"""
    n = len(path)
    tan = np.gradient(path, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    helper = np.array((0.0, 0.0, 1.0)) if abs(tan[0][2]) < 0.9 else np.array((1.0, 0.0, 0.0))
    nv = np.cross(tan[0], helper)
    nv /= np.linalg.norm(nv)
    frames = []
    for i in range(n):
        nv = nv - np.dot(nv, tan[i]) * tan[i]
        nv /= np.linalg.norm(nv)
        frames.append((nv.copy(), np.cross(tan[i], nv)))
    ang = np.arange(sides) * 2 * math.pi / sides
    rings = []  # (圓心, 半徑, N, B)
    caps = [math.radians(a) for a in cap_steps]
    for phi in reversed(caps):
        rings.append((path[0] - tan[0] * r * math.sin(phi), r * math.cos(phi), *frames[0]))
    for i in range(n):
        rings.append((path[i], r, *frames[i]))
    for phi in caps:
        rings.append((path[-1] + tan[-1] * r * math.sin(phi), r * math.cos(phi), *frames[-1]))
    pts, faces = [], []
    for c, rr, a, b in rings:
        for t in ang:
            pts.append(c + rr * (math.cos(t) * a + math.sin(t) * b))
    m = len(rings)
    for i in range(m - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append([i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k])
    p0 = len(pts)
    pts.append(path[0] - tan[0] * r)
    pts.append(path[-1] + tan[-1] * r)
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append([p0, k2, k])
        faces.append([(m - 1) * sides + k, (m - 1) * sides + k2, p0 + 1])
    return np.array(pts), faces


def _chromatin_path(rng, nucleolus_c):
    """纏繞在核仁周圍的一條染色質路徑：以朝切口的方向為中心做李沙育迴圈，半徑 0.6~0.8，再壓回核膜內。"""
    # 中心方向：切口軸向隨機偏 ≤ 25 度
    c = OCTANT + rng.normal(size=3) * 0.28
    c /= np.linalg.norm(c)
    helper = np.array((0.0, 0.0, 1.0)) if abs(c[2]) < 0.9 else np.array((1.0, 0.0, 0.0))
    e1 = np.cross(c, helper)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(c, e1)
    # 振幅偏大：路徑繞在核仁頂端的外圍（約 45~60 度的環），讓核仁頂部露出來
    amp = rng.uniform(0.95, 1.5)
    w1 = 1
    w2 = int(rng.choice([1, 1, 2]))
    w3 = int(rng.choice([2, 3]))
    p1, p2, p3 = rng.uniform(0, 2 * math.pi, 3)
    t = np.linspace(0, 2 * math.pi, 130)
    a1 = amp * (1.0 + 0.18 * np.sin(2 * t + p3))
    d = c[None, :] + a1[:, None] * (np.cos(w1 * t + p1)[:, None] * e1 + np.sin(w2 * t + p2)[:, None] * e2)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    r = 0.66 + 0.07 * np.sin(w3 * t + p3)
    pts = nucleolus_c + d * r[:, None]
    limit = NR_IN - 0.09
    for _ in range(3):  # 壓回核膜內並平滑
        rel = pts - NC
        dist = np.linalg.norm(rel, axis=1)
        over = dist > limit
        pts[over] = NC + rel[over] * (limit / dist[over])[:, None]
        k = np.array([1, 2, 3, 2, 1], dtype=float)
        k /= k.sum()
        pad = np.pad(pts, ((2, 2), (0, 0)), mode="edge")
        pts = sum(k[i] * pad[i : i + len(pts)] for i in range(5))
    rel = pts - NC
    dist = np.linalg.norm(rel, axis=1)
    pts = np.where((dist > limit)[:, None], NC + rel * (limit / dist)[:, None], pts)
    # 離核仁至少 0.58，免得穿進顆粒
    rel = pts - nucleolus_c
    dist = np.linalg.norm(rel, axis=1)
    pts = np.where((dist < 0.58)[:, None], nucleolus_c + rel * (0.58 / dist)[:, None], pts)
    return pts


def _build_nucleus(ctx):
    rng = np.random.default_rng(ctx.seed + 1)
    rot = _rotation(0.037, 0.021, 0.053)  # 避免網格邊剛好落在切割平面上

    # --- 核膜（球殼）---
    ov, of = _ico(NR, 5)
    iv, if_ = _ico(NR_IN, 5)
    ov, iv = ov @ rot.T + NC, iv @ rot.T + NC
    shell = _merge([(ov, of), (iv, [list(reversed(q)) for q in if_])])
    _check_closed_outward("核膜", *shell)

    big = 10.0
    cutter0 = _box((NC[0], NC[1] - big, NC[2]), (NC[0] + big, NC[1], NC[2] + big))
    sco, sf = _boolean(shell[0], shell[1], cutter0, "DIFFERENCE")
    _drop(cutter0)
    planes0 = ((0, NC[0]), (1, NC[1]), (2, NC[2]))
    body_i, ring_i = _split_planes(sco, sf, planes0)
    main_v, main_f = _sub(sco, sf, body_i)
    ring_v, ring_f = _sub(sco, sf, ring_i)

    # --- 核質剖面：內球減去內凹一點的切割體，只留平面上的面 ---
    ball_v, ball_f = _ico(NR_IN, 5)
    ball_v = ball_v @ rot.T + NC
    d = RECESS
    cutter1 = _box(
        (NC[0] - d, NC[1] - big, NC[2] - d), (NC[0] + big, NC[1] + d, NC[2] + big)
    )
    bco, bf = _boolean(ball_v, ball_f, cutter1, "DIFFERENCE")
    _drop(cutter1)
    planes1 = ((0, NC[0] - d), (1, NC[1] + d), (2, NC[2] - d))
    _rest, disc_i = _split_planes(bco, bf, planes1)
    disc_v, disc_f = _sub(bco, bf, disc_i)
    if not disc_f or not ring_f:
        raise RuntimeError("核切面是空的")
    cut_v, cut_f = _merge([(ring_v, ring_f), (disc_v, disc_f)])

    # --- 核孔 ---
    pore_v, pore_f, pore_n = _build_pores(rot)

    # --- 染色質 ---
    nuc_c = NC + NUCLEOLUS_OFF
    cv, cf = [], []
    for _ in range(6):
        v, f = _tube(_chromatin_path(rng, nuc_c), 0.03)
        _check_closed_outward("染色質", v, f)
        cf += [[i + len(cv) for i in q] for q in f]
        cv += v.tolist()
    chrom_v = np.array(cv)
    far = float(np.max(np.linalg.norm(chrom_v - NC, axis=1)))
    if far > NR_IN - 0.02:
        raise RuntimeError(f"染色質穿出核膜內側：最遠 {far:.3f}")

    objs = {
        "main": _make_obj("nucleus_main", main_v, main_f),
        "cut": _make_obj("nucleus_cut", cut_v, cut_f),
        "pore": _make_obj("nucleus_pore", pore_v, pore_f),
        "chromatin": _make_obj("nucleus_chromatin", chrom_v, cf),
    }
    center = _bbox_center(main_v, cut_v, pore_v, chrom_v)
    root = C.new_instance("nucleus", center)
    for part, obj in objs.items():
        C.add_part(root, obj, part)
    # 錨點：切口邊緣（z = 0 的那條弧）朝鏡頭最近處，位於核膜中層
    arc = np.array((1.0, -1.0, 0.0)) / math.sqrt(2.0)
    anchor = NC + arc * (NR - SHELL_T / 2)
    C.add_anchor(root, tuple(anchor))
    return center, tuple(anchor), pore_n


# ----------------------------------------------------------------------------
# 核仁
# ----------------------------------------------------------------------------
def _build_nucleolus(ctx):
    rng = np.random.default_rng(ctx.seed + 2)
    v, f = _ico(1.0, 5)
    n = len(v)
    h = np.zeros(n)
    # 顆粒：許多小而圓的凸點
    for c in _fib(110):
        c = c + rng.normal(size=3) * 0.04
        c /= np.linalg.norm(c)
        sig = rng.uniform(0.16, 0.24)
        a = rng.uniform(0.025, 0.045)
        ang2 = np.clip(1.0 - v @ c, 0.0, None) * 2.0  # ≈ 夾角平方
        h += a * np.exp(-ang2 / (2 * sig * sig))
    # 低頻的不規則
    for _ in range(3):
        w = rng.normal(size=3)
        w /= np.linalg.norm(w)
        h += 0.012 * np.sin(2.2 * (v @ w) * math.pi + rng.uniform(0, 2 * math.pi))
    h = np.clip(h, 0.0, 0.07)
    co = NC + NUCLEOLUS_OFF + v * (NUCLEOLUS_R + h)[:, None]
    _check_closed_outward("核仁", co, f)
    obj = _make_obj("nucleolus_main", co, f)
    root = C.new_instance("nucleolus", _bbox_center(co))
    C.add_part(root, obj, "main")
    return _bbox_center(co)


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def build(ctx):
    _vco, v_anchor, v_center = _build_vacuole(ctx)
    n_center, n_anchor, pore_n = _build_nucleus(ctx)
    nu_center = _build_nucleolus(ctx)
    tris = {
        o.name: _tri_count(o) for o in bpy.data.objects if o.type == "MESH"
    }
    print(
        f"[core] 三角面 {sum(tris.values())} {tris}；核孔 {pore_n}；"
        f"根 液泡 {tuple(np.round(v_center, 3))} 核 {tuple(np.round(n_center, 3))} "
        f"核仁 {tuple(np.round(nu_center, 3))}；錨點 液泡 {tuple(np.round(v_anchor, 3))} "
        f"核 {tuple(np.round(n_anchor, 3))}"
    )
