"""細胞核心：中央液泡、細胞核（含核孔）、核仁、染色質、跨液泡細胞質絲。

液泡：細胞內最大的構造。以立方體球（細分立方體再正規化）為底，沿橢球法向疊上低頻起伏，成為飽滿的水囊。
細胞核：雙層厚度 0.08 的核膜球殼。朝鏡頭的八分之一（局部 x>0, y<0, z>0）用精確布林切開；
        切面（核膜環與略為內凹的核質剖面）拆成獨立的 cut 物件。核孔合併成一個網格。
染色質：獨立的構造（自己的個體根），6 條細線合併成一個網格。
細胞質絲：3 條穿過液泡的細管合併成一個網格，兩端張開接進細胞質。
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
RECESS = 0.42  # 核質剖面比核膜切面內凹的深度：核膜厚度看得出來，且整顆核仁在剖面前方
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


_CAM = np.array(C.CAMERA_DIR, dtype=float) / np.linalg.norm(C.CAMERA_DIR)


def _in_front_cylinder(pts, nucleolus_c, radius):
    """以核仁中心為起點、沿鏡頭方向、半徑 radius 的圓柱（朝鏡頭那一側）內的點的遮罩。"""
    rel = pts - nucleolus_c
    t = rel @ _CAM
    perp = np.linalg.norm(rel - t[:, None] * _CAM, axis=1)
    return (t > 0) & (perp < radius)


def _chromatin_path(rng, nucleolus_c, rmax):
    """繞在核仁後方與側面的一條染色質路徑：以背向鏡頭的方向為中心做迴圈，半徑約 0.66，再壓回核膜內。
    路徑若擋在核仁前面（鏡頭方向圓柱內）就重抽。"""
    for _try in range(200):
        pts = _chromatin_path_try(rng, nucleolus_c, rmax)
        if not np.any(_in_front_cylinder(pts, nucleolus_c, rmax + 0.05 + 0.03)):
            return pts
    raise ValueError("染色質路徑一直擋在核仁前面")


def _chromatin_path_try(rng, nucleolus_c, rmax):
    # 中心方向：與鏡頭方向夾 95~135 度（側面到後方），方位隨機
    helper0 = np.array((0.0, 0.0, 1.0))
    u = np.cross(_CAM, helper0)
    u /= np.linalg.norm(u)
    v = np.cross(_CAM, u)
    th, ph = math.radians(rng.uniform(78, 112)), rng.uniform(0, 2 * math.pi)
    c = math.cos(th) * _CAM + math.sin(th) * (math.cos(ph) * u + math.sin(ph) * v)
    helper = np.array((0.0, 0.0, 1.0)) if abs(c[2]) < 0.9 else np.array((1.0, 0.0, 0.0))
    e1 = np.cross(c, helper)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(c, e1)
    amp = rng.uniform(0.3, 0.6)
    w1 = 1
    w2 = int(rng.choice([1, 1, 2]))
    w3 = int(rng.choice([2, 3]))
    p1, p2, p3 = rng.uniform(0, 2 * math.pi, 3)
    t = np.linspace(0, 2 * math.pi, 130)
    a1 = amp * (1.0 + 0.18 * np.sin(2 * t + p3))
    d = c[None, :] + a1[:, None] * (np.cos(w1 * t + p1)[:, None] * e1 + np.sin(w2 * t + p2)[:, None] * e2)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    r = 0.64 + 0.06 * np.sin(w3 * t + p3)
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
    # 離核仁至少 rmax + 0.09，免得穿進顆粒
    lo = rmax + 0.09
    rel = pts - nucleolus_c
    dist = np.linalg.norm(rel, axis=1)
    pts = np.where((dist < lo)[:, None], nucleolus_c + rel * (lo / dist)[:, None], pts)
    return pts


def _build_nucleus(ctx, nuc_co):
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
    rmax = float(np.max(np.linalg.norm(nuc_co - nuc_c, axis=1)))
    # 核仁必須整顆在三個核質剖面前方（朝切口那一側），且與每個剖面至少留 0.01
    gaps = (
        float(np.min(nuc_co[:, 0] - (NC[0] - d))),
        float(np.min((NC[1] + d) - nuc_co[:, 1])),
        float(np.min(nuc_co[:, 2] - (NC[2] - d))),
    )
    if min(gaps) < 0.01:
        raise ValueError(f"核仁被核質剖面遮住或太近：與三個剖面的最小間隙 {gaps}")
    cv, cf = [], []
    for _ in range(6):
        v, f = _tube(_chromatin_path(rng, nuc_c, rmax), 0.03)
        _check_closed_outward("染色質", v, f)
        cf += [[i + len(cv) for i in q] for q in f]
        cv += v.tolist()
    chrom_v = np.array(cv)
    far = float(np.max(np.linalg.norm(chrom_v - NC, axis=1)))
    if far > NR_IN - 0.02:
        raise RuntimeError(f"染色質穿出核膜內側：最遠 {far:.3f}")
    blocked = int(np.count_nonzero(_in_front_cylinder(chrom_v, nuc_c, rmax + 0.05)))
    if blocked:
        raise ValueError(f"染色質擋在核仁前面：鏡頭方向圓柱內有 {blocked} 個頂點")
    print(
        f"[core] RECESS {d} 核仁最大半徑 {rmax:.3f} 與三剖面最小間隙 {tuple(round(g, 3) for g in gaps)}；"
        f"染色質圓柱內頂點 {blocked}、離核膜內表面最小距離 {NR_IN - far:.3f}"
    )

    objs = {
        "main": _make_obj("nucleus_main", main_v, main_f),
        "cut": _make_obj("nucleus_cut", cut_v, cut_f),
        "pore": _make_obj("nucleus_pore", pore_v, pore_f),
    }
    center = _bbox_center(main_v, cut_v, pore_v)
    root = C.new_instance("nucleus", center)
    for part, obj in objs.items():
        C.add_part(root, obj, part)
    # 錨點：切口邊緣（z = 0 的那條弧）朝鏡頭最近處，位於核膜中層
    arc = np.array((1.0, -1.0, 0.0)) / math.sqrt(2.0)
    anchor = NC + arc * (NR - SHELL_T / 2)
    C.add_anchor(root, tuple(anchor))
    return center, tuple(anchor), pore_n, chrom_v, cf


# ----------------------------------------------------------------------------
# 染色質（獨立構造）
# ----------------------------------------------------------------------------
def _build_chromatin(chrom_v, chrom_f):
    obj = _make_obj("chromatin_main", chrom_v, chrom_f)
    center = _bbox_center(chrom_v)
    root = C.new_instance("chromatin", center)
    C.add_part(root, obj, "main")
    # 錨點：所有染色質頂點中，沿鏡頭方向投影最大的那一個（朝鏡頭、從切口看得到的一段）
    anchor = chrom_v[int(np.argmax(chrom_v @ _CAM))]
    C.add_anchor(root, tuple(anchor))
    return center, tuple(anchor)


# ----------------------------------------------------------------------------
# 跨液泡細胞質絲
# ----------------------------------------------------------------------------
STRAND_R_MID = 0.09
STRAND_R_END = 0.16
STRAND_FLARE = 0.35  # 兩端這麼長的範圍內半徑由中段半徑張開到端口半徑
STRAND_SIDES = 12
STRAND_STEP = 0.05  # 沿長度方向的分段長
STRAND_OFFSET_MAX = 0.10
STRAND_TRIM = 0.4  # 檢查「中段在液泡內」時，兩端各略去的長度
STRAND_MIN_GAP = 0.2


def _strand_path(i, rng):
    """第 i 條絲的中心線 (N,3)、弧長 s (N,)、半徑 (N,)、最大橫向偏移。"""
    near, far = (np.array(p) for p in C.strand_ends(i))
    axis = far - near
    length = float(np.linalg.norm(axis))
    d = axis / length
    helper = np.array((0.0, 0.0, 1.0)) if abs(d[2]) < 0.9 else np.array((1.0, 0.0, 0.0))
    e1 = np.cross(d, helper)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)
    # 橫向偏移：兩端為 0 的 S 形（sin 2πt）加一點同樣兩端為 0 的單向鼓起（sin πt），隨機方向
    ang = rng.uniform(0, 2 * math.pi)
    lat = math.cos(ang) * e1 + math.sin(ang) * e2
    lat2 = np.cross(d, lat)
    a_s = rng.uniform(0.060, 0.080) * rng.choice([-1.0, 1.0])
    a_b = rng.uniform(0.010, 0.025) * rng.choice([-1.0, 1.0])
    n = int(round(length / STRAND_STEP)) + 1
    t = np.linspace(0.0, 1.0, n)
    off = (a_s * np.sin(2 * math.pi * t))[:, None] * lat + (a_b * np.sin(math.pi * t))[:, None] * lat2
    path = near + t[:, None] * axis + off
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    from_end = np.minimum(s, s[-1] - s)
    # 漏斗形：離端點越近張開得越快；在 0.35 處與中段管壁相切（斜率 0）
    k = (1.0 - np.clip(from_end / STRAND_FLARE, 0.0, 1.0)) ** 2
    radius = STRAND_R_MID + (STRAND_R_END - STRAND_R_MID) * k
    return path, s, radius, float(np.max(np.linalg.norm(off, axis=1)))


def _var_tube(path, radius, sides, cap_steps=(35.0, 65.0, 85.0), cap_h=0.05):
    """半徑逐點變化的圓管，兩端以扁平的圓頂封口（突出量 cap_h，免得端口頂到空腔壁）。法向朝外。回傳 (頂點, 面, 每個頂點所屬的路徑索引)。"""
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
    caps = [math.radians(a) for a in cap_steps]
    rings = []  # (圓心, 半徑, N, B, 路徑索引)
    r0, r1 = radius[0], radius[-1]
    for phi in reversed(caps):
        rings.append((path[0] - tan[0] * cap_h * math.sin(phi), r0 * math.cos(phi), *frames[0], 0))
    for i in range(n):
        rings.append((path[i], radius[i], *frames[i], i))
    for phi in caps:
        rings.append((path[-1] + tan[-1] * cap_h * math.sin(phi), r1 * math.cos(phi), *frames[-1], n - 1))
    pts, owner, faces = [], [], []
    for c, rr, a, b, idx in rings:
        for th in ang:
            pts.append(c + rr * (math.cos(th) * a + math.sin(th) * b))
            owner.append(idx)
    m = len(rings)
    for i in range(m - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append([i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k])
    p0 = len(pts)
    pts.append(path[0] - tan[0] * cap_h)
    pts.append(path[-1] + tan[-1] * cap_h)
    owner += [0, n - 1]
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append([p0, k2, k])
        faces.append([(m - 1) * sides + k, (m - 1) * sides + k2, p0 + 1])
    return np.array(pts), faces, np.array(owner)


def _build_strands(ctx):
    rng = np.random.default_rng(ctx.seed + 3)
    ax = np.array(C.VACUOLE["axes"])
    vc = np.array(C.VACUOLE["center"])
    nz = np.array(C.NUCLEUS_ZONE["center"])
    nz_r = C.NUCLEUS_ZONE["radius"]
    per = []  # 每條：頂點
    parts = []
    stats = []
    for i in range(3):
        path, s, radius, off_max = _strand_path(i, rng)
        v, f, owner = _var_tube(path, radius, STRAND_SIDES)
        _check_closed_outward(f"細胞質絲 {i}", v, f)
        if off_max > STRAND_OFFSET_MAX + 1e-9:
            raise ValueError(f"細胞質絲 {i} 的橫向偏移 {off_max:.3f} 超過 {STRAND_OFFSET_MAX}")
        # 中段（去掉兩端各 STRAND_TRIM）所有頂點要在液泡橢球內
        sv = s[owner]
        mid = (sv > STRAND_TRIM) & (sv < s[-1] - STRAND_TRIM)
        level = np.linalg.norm((v[mid] - vc) / ax, axis=1)
        mid_max = float(level.max())
        if mid_max >= 1.0:
            raise ValueError(f"細胞質絲 {i} 的中段有頂點在液泡橢球外：橢球值最大 {mid_max:.4f}")
        sdf = C.cavity_sdf(v)
        if float(sdf.max()) > -0.05:
            raise ValueError(f"細胞質絲 {i} 有頂點離空腔邊界不足 0.05：餘裕 {-float(sdf.max()):.3f}")
        dn = float(np.linalg.norm(v - nz, axis=1).min())
        if dn <= nz_r:
            raise ValueError(f"細胞質絲 {i} 進入細胞核禁入球：離核心最近 {dn:.3f} <= {nz_r}")
        per.append(v)
        parts.append((v, f))
        stats.append((mid_max, -float(sdf.max()), dn, float(s[-1]), off_max, radius[0]))
    gaps = []
    for a in range(3):
        for b in range(a + 1, 3):
            dmin = min(
                float(np.linalg.norm(per[a][k : k + 200, None, :] - per[b][None, :, :], axis=2).min())
                for k in range(0, len(per[a]), 200)
            )
            gaps.append(dmin)
            if dmin < STRAND_MIN_GAP:
                raise ValueError(f"細胞質絲 {a} 與 {b} 的頂點太近：最近距離 {dmin:.3f} < {STRAND_MIN_GAP}")
    sv_all, sf_all = _merge(parts)
    obj = _make_obj("transvacuolar_strand_main", sv_all, sf_all)
    center = _bbox_center(sv_all)
    root = C.new_instance("transvacuolar_strand", center)
    C.add_part(root, obj, "main")
    # 錨點：第 0 條 near 端管子表面上、朝鏡頭方向的一點
    near = np.array(C.strand_ends(0)[0])
    t0 = np.array(C.strand_ends(0)[1]) - near
    t0 /= np.linalg.norm(t0)
    perp = _CAM - (_CAM @ t0) * t0
    perp /= np.linalg.norm(perp)
    anchor = near + perp * STRAND_R_END
    C.add_anchor(root, tuple(anchor))
    print(
        "[core] 細胞質絲 " + "；".join(
            f"#{i} 長 {st[3]:.2f} 橫向偏移 {st[4]:.3f} 中段橢球值最大 {st[0]:.3f} 空腔餘裕 {st[1]:.3f} 離核心最近 {st[2]:.3f}"
            for i, st in enumerate(stats)
        )
        + f"；絲間最近距離 {tuple(round(g, 3) for g in gaps)}"
    )
    return center, tuple(anchor)


# ----------------------------------------------------------------------------
# 核仁
# ----------------------------------------------------------------------------
def _nucleolus_geometry(ctx):
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
    return co, f


def _build_nucleolus(co, f):
    obj = _make_obj("nucleolus_main", co, f)
    root = C.new_instance("nucleolus", _bbox_center(co))
    C.add_part(root, obj, "main")
    return _bbox_center(co)


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def build(ctx):
    _vco, v_anchor, v_center = _build_vacuole(ctx)
    nuc_co, nuc_f = _nucleolus_geometry(ctx)
    n_center, n_anchor, pore_n, chrom_v, chrom_f = _build_nucleus(ctx, nuc_co)
    ch_center, ch_anchor = _build_chromatin(chrom_v, chrom_f)
    nu_center = _build_nucleolus(nuc_co, nuc_f)
    st_center, st_anchor = _build_strands(ctx)
    tris = {
        o.name: _tri_count(o) for o in bpy.data.objects if o.type == "MESH"
    }
    print(
        f"[core] 三角面 {sum(tris.values())} {tris}；核孔 {pore_n}；"
        f"根 液泡 {tuple(np.round(v_center, 3))} 核 {tuple(np.round(n_center, 3))} "
        f"核仁 {tuple(np.round(nu_center, 3))}；錨點 液泡 {tuple(np.round(v_anchor, 3))} "
        f"核 {tuple(np.round(n_anchor, 3))}；"
        f"根 染色質 {tuple(np.round(ch_center, 3))} 錨點 {tuple(np.round(ch_anchor, 3))}；"
        f"根 細胞質絲 {tuple(np.round(st_center, 3))} 錨點 {tuple(np.round(st_anchor, 3))}"
    )
