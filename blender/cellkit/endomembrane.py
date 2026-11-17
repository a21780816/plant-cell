"""內質網、核糖體、高基氏體、細胞骨架。

作法：
- 粗糙內質網：4 層沿細胞核球面彎曲的皺褶薄片（極座標網格、封閉有厚度的實體，邊緣是波浪狀圓邊），
  用精確布林運算挖出大小不一的孔洞。
- 核糖體：低面數小球，貼在薄片表面（隨機泊松分布）；游離的 14 群各約 10 顆。
- 平滑內質網：把管網骨架交給 Skin 修改器 + 細分曲面，三叉接點自然融合成平順的管子。
- 高基氏體：6 片彎成弓形的扁囊（中間薄、邊緣鼓）巢狀疊起，旁邊散著出芽的小泡。
- 細胞骨架：沿細胞膜內側走的微管與伸向細胞核附近的微絲，以平行傳輸框架掃出的細管。
"""
import math
import random

import bmesh
import bpy
import mathutils.kdtree
import numpy as np

from . import common as C

NC = np.array(C.NUCLEUS["center"], dtype=float)
NUC_R = C.NUCLEUS["radius"]
VC = np.array(C.VACUOLE["center"], dtype=float)
VAX = np.array(C.VACUOLE["axes"], dtype=float)
CAM = np.array(C.CAMERA_DIR, dtype=float)
CAM = CAM / np.linalg.norm(CAM)
TWO_PI = 2.0 * math.pi

# 薄片
SHEET_H = 0.025  # 薄片半厚（總厚 0.05）
RER_PHI_N = 72
RER_RHO_N = 16
RER_RIM_N = 5
EDGE_MAX = math.acos(C.RER["min_dot"]) - 0.025  # 邊緣最大極角，留圓邊與波浪的餘裕
RIB_R = 0.045
RIB_NUC_MIN = 1.20 + 0.056  # 球心距核心下限：加上最大球半徑（0.045 x 1.07 x 1.06 約 0.051）後仍 >= 1.20
VAC_PAD = 0.10  # 液泡表面起伏上限


# ----------------------------------------------------------------------------
# 基本工具
# ----------------------------------------------------------------------------
def _unit(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


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


def _evaluated(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    co, faces = _read(me)
    bpy.data.meshes.remove(me)
    return co, faces


def _orient(verts, faces):
    """讓封閉實體的面都朝外（每個互不相連的殼各自判斷），回傳 (verts, faces)，體積必須為正。"""
    bm = bmesh.new()
    for p in verts:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in faces:
        bm.faces.new([bm.verts[i] for i in q])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    vol = bm.calc_volume(signed=True)
    out = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    if vol <= 0:
        raise ValueError(f"封閉實體體積為負（{vol:.4f}），面的方向錯了")
    return np.asarray(verts, dtype=float), out


def _merge(parts):
    """parts: [(verts, faces)] → (verts, faces)"""
    vs, fs, off = [], [], 0
    for v, f in parts:
        v = np.asarray(v, dtype=float)
        vs.append(v)
        fs.extend([[i + off for i in q] for q in f])
        off += len(v)
    return np.vstack(vs), fs


def _bbox_center(co):
    return (co.min(0) + co.max(0)) / 2


def _tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def _uv_sphere(seg, rings):
    """單位球：2 個極點加 (rings-1) 圈緯線。回傳 (verts, faces)。"""
    v = [(0.0, 0.0, 1.0)]
    for j in range(1, rings):
        lat = math.pi * j / rings
        for i in range(seg):
            a = TWO_PI * i / seg
            v.append((math.sin(lat) * math.cos(a), math.sin(lat) * math.sin(a), math.cos(lat)))
    v.append((0.0, 0.0, -1.0))
    f = []
    for i in range(seg):
        f.append([0, 1 + i, 1 + (i + 1) % seg])
    for j in range(rings - 2):
        b0, b1 = 1 + j * seg, 1 + (j + 1) * seg
        for i in range(seg):
            i2 = (i + 1) % seg
            f.append([b0 + i, b1 + i, b1 + i2, b0 + i2])
    last = len(v) - 1
    b = 1 + (rings - 2) * seg
    for i in range(seg):
        f.append([last, b + (i + 1) % seg, b + i])
    return np.array(v), f


def _rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def _balls(centers, radii, seg, rings, rng, squash=0.08):
    """在每個中心放一顆（略不規則的）低面數小球，合併成 (verts, faces)。"""
    tv, tf = _uv_sphere(seg, rings)
    parts = []
    for c, r in zip(centers, radii):
        sc = np.array([1 + rng.uniform(-squash, squash) for _ in range(3)])
        rot = _rot_z(rng.uniform(0, TWO_PI))
        parts.append(((tv * sc) @ rot.T * r + c, tf))
    return _merge(parts)


# ----------------------------------------------------------------------------
# 掃管（平行傳輸框架）
# ----------------------------------------------------------------------------
def _tube(path, radius, sides=8):
    """沿折線 path (N,3) 掃出半徑 radius 的封閉細管，兩端各一個圓頂。回傳 (verts, faces)。"""
    path = np.asarray(path, dtype=float)
    n = len(path)
    tan = np.gradient(path, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    ref = np.array([0.0, 0.0, 1.0]) if abs(tan[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    nrm = _unit(np.cross(tan[0], ref))
    frames = []
    for i in range(n):
        if i > 0:
            # 把上一個法向轉到新的切線上
            ax = np.cross(tan[i - 1], tan[i])
            s = np.linalg.norm(ax)
            if s > 1e-9:
                ax /= s
                ang = math.atan2(s, float(tan[i - 1] @ tan[i]))
                nrm = nrm * math.cos(ang) + np.cross(ax, nrm) * math.sin(ang) + ax * (ax @ nrm) * (1 - math.cos(ang))
            nrm = _unit(nrm - tan[i] * (nrm @ tan[i]))
        frames.append((nrm, np.cross(tan[i], nrm)))
    ang = np.arange(sides) * TWO_PI / sides
    verts = []
    for i in range(n):
        N_, B_ = frames[i]
        for a in ang:
            verts.append(path[i] + radius * (math.cos(a) * N_ + math.sin(a) * B_))
    faces = []
    for i in range(n - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append([i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k])
    c0 = len(verts)
    verts.append(path[0] - tan[0] * radius * 0.8)
    verts.append(path[-1] + tan[-1] * radius * 0.8)
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append([c0, k2, k])
        faces.append([c0 + 1, (n - 1) * sides + k, (n - 1) * sides + k2])
    return _orient(verts, faces)


# ----------------------------------------------------------------------------
# 封閉薄片（粗糙內質網、高基氏體共用）
# ----------------------------------------------------------------------------
def _sheet(P, H, hint, n_phi, n_rho, rim_n):
    """有厚度的圓盤形封閉實體。
    P(rho, phi)：中面上的點（rho 0..1 由中心到邊緣；rho=0 時與 phi 無關），可向量化。
    H(rho, phi)：半厚。hint(rho, phi)：期望的上表面外法向（只用來決定正負）。
    邊緣是半圓形的圓邊。回傳 (verts, faces)。"""
    phis = np.arange(n_phi) * TWO_PI / n_phi
    rhos = np.arange(1, n_rho + 1) / n_rho
    PH, RH = np.meshgrid(phis, rhos, indexing="ij")
    mid = P(RH, PH)
    eps = 1e-4
    dr = P(RH + eps, PH) - P(RH - eps, PH)
    dp = P(RH, PH + eps) - P(RH, PH - eps)
    n = np.cross(dr, dp)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    sgn = np.sign(np.sum(n * hint(RH, PH), axis=-1))
    n *= sgn[..., None]
    h = H(RH, PH)[..., None]
    top = mid + h * n
    bot = mid - h * n
    t_out = dr[:, -1] / np.linalg.norm(dr[:, -1], axis=-1, keepdims=True)
    E, nE, hE = mid[:, -1], n[:, -1], h[:, -1]
    rings = [top[:, j] for j in range(n_rho)]
    for a in np.linspace(0, math.pi, rim_n + 1)[1:-1]:
        rings.append(E + hE * (math.cos(a) * nE + math.sin(a) * t_out))
    rings += [bot[:, j] for j in range(n_rho - 1, -1, -1)]
    pole = P(np.zeros(1), np.zeros(1))[0]
    n_pole = _unit(n[:, 0].mean(axis=0))
    h_pole = float(H(np.zeros(1), np.zeros(1))[0])
    verts = [pole + h_pole * n_pole, pole - h_pole * n_pole]
    for r in rings:
        verts.extend(r)
    verts = np.array(verts)
    faces = []
    base = 2
    for r in range(len(rings) - 1):
        for k in range(n_phi):
            k2 = (k + 1) % n_phi
            faces.append(
                [base + r * n_phi + k, base + r * n_phi + k2, base + (r + 1) * n_phi + k2, base + (r + 1) * n_phi + k]
            )
    for k in range(n_phi):
        k2 = (k + 1) % n_phi
        faces.append([0, base + k2, base + k])
        faces.append([1, base + (len(rings) - 1) * n_phi + k, base + (len(rings) - 1) * n_phi + k2])
    return _orient(verts, faces)


# ----------------------------------------------------------------------------
# 粗糙內質網
# ----------------------------------------------------------------------------
_A = _unit(C.RER["axis"])
_S = _unit(C.SER["axis"])
_E1 = _unit(_S - (_S @ _A) * _A)  # 朝向平滑內質網那一側
_E2 = np.cross(_A, _E1)


def _dir(th, ph):
    th, ph = np.asarray(th, dtype=float), np.asarray(ph, dtype=float)
    return (
        np.cos(th)[..., None] * _A
        + np.sin(th)[..., None] * (np.cos(ph)[..., None] * _E1 + np.sin(ph)[..., None] * _E2)
    )


def _to_thph(d):
    d = np.asarray(d, dtype=float)
    th = np.arccos(np.clip(d @ _A, -1, 1))
    ph = np.arctan2(d @ _E2, d @ _E1)
    return th, ph


def _outside_vacuole(p, pad):
    q = (np.asarray(p, dtype=float) - VC) / (VAX + VAC_PAD + pad)
    return np.sum(q * q, axis=-1) >= 1.0


class _Layer:
    """第 k 層薄片：球面皺褶 + 波浪狀邊緣（極座標 theta, phi；theta 為與軸的夾角）。"""

    def __init__(self, k):
        self.k = k
        self.r0 = C.RER["radii"][k]
        self.base = (1.22, 1.30, 1.17, 1.27)[k]
        phi = np.linspace(0, TWO_PI, 361)
        raw = (
            self.base
            + 0.07 * np.sin(3 * phi + 1.3 * k)
            + 0.05 * np.sin(5 * phi + 2.1 * k + 0.4)
            + 0.025 * np.sin(9 * phi + 3.3 * k)
        )
        raw = np.minimum(raw, EDGE_MAX)
        lim = self._limit(phi[:-1])
        lim = np.append(lim, lim[0])
        e = np.minimum(raw, lim)
        # 在空腔與液泡限制處圓滑收邊：循環移動平均後再與限制取小
        core = e[:-1]
        for _ in range(3):
            core = (np.roll(core, 2) + np.roll(core, 1) + core + np.roll(core, -1) + np.roll(core, -2)) / 5.0
        core = np.minimum(core, lim[:-1])
        self.limited = bool(np.any(lim < raw - 1e-6))
        self.tab = np.append(core, core[0])
        self.phi_tab = phi

    def _limit(self, phis):
        th = np.arange(0.0, EDGE_MAX + 1e-9, 0.01)
        PH, TH = np.meshgrid(phis, th, indexing="ij")
        ok = np.ones(PH.shape, dtype=bool)
        for off in (-0.075, 0.075):
            p = NC + (self.r0 + off) * _dir(TH, PH)
            ok &= C.rbox_sdf(p, C.CAVITY_HALF, C.CAVITY_R) <= -0.12
            ok &= _outside_vacuole(p, 0.06)
        good = np.cumprod(ok, axis=1).astype(bool)
        first_bad = np.where(good.all(axis=1), len(th), np.argmin(good, axis=1))
        idx = np.maximum(first_bad - 1 - 5, 0)  # 再往內縮 0.05 弧度
        out = th[np.minimum(idx, len(th) - 1)]
        return np.where(good.all(axis=1), EDGE_MAX, out)

    def edge(self, ph):
        return np.interp(np.mod(ph, TWO_PI), self.phi_tab, self.tab)

    def radius(self, th, ph):
        # 極點（th=0）處皺褶振幅要連續地降到 0，否則半徑會隨方位角跳動而在中心捏出尖點
        env = (0.35 + 0.65 * np.clip(th / 1.2, 0, 1)) * (1.0 - np.exp(-((th / 0.3) ** 2)))
        common = (
            0.6 * np.sin(4 * ph + 2.6 * th + 0.7 * np.sin(2 * ph + 0.5))
            + 0.4 * np.sin(7 * ph - 2.0 * th + 1.1)
            + 0.22 * np.sin(11 * ph + 4.1 * th + 0.3)
        )
        own = np.sin(5 * ph + 3.1 * th + 1.3 * self.k)
        return self.r0 + env * (0.040 * common + 0.010 * own)

    def P(self, th, ph):
        return NC + self.radius(th, ph)[..., None] * _dir(th, ph)

    def P_rho(self, rho, ph):
        return self.P(rho * self.edge(ph), ph)

    def frame(self, th, ph):
        """(點, 單位外法向, 沿 theta 增加的單位切向)"""
        th, ph = np.asarray(th, dtype=float), np.asarray(ph, dtype=float)
        e = 1e-4
        p = self.P(th, ph)
        dt = self.P(th + e, ph) - self.P(th - e, ph)
        dp = self.P(th, ph + e) - self.P(th, ph - e)
        n = np.cross(dt, dp)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        n *= np.sign(np.sum(n * (p - NC), axis=-1))[..., None]
        t = dt / np.linalg.norm(dt, axis=-1, keepdims=True)
        return p, n, t

    def solid(self):
        return _sheet(
            self.P_rho,
            lambda rho, ph: np.full(np.shape(rho), SHEET_H),
            lambda rho, ph: _dir(rho * self.edge(ph), ph),
            RER_PHI_N,
            RER_RHO_N,
            RER_RIM_N,
        )


def _make_holes(layer, rng, count):
    """隨機挑大小不一的孔洞：每個是 dict（中心點、法向、切向、半徑、輪廓扰動）。"""
    holes = []
    for _ in range(3000):
        if len(holes) >= count:
            break
        ph = rng.uniform(0, TWO_PI)
        th = rng.uniform(0.3, max(0.35, float(layer.edge(ph)) - 0.2))
        rad = rng.uniform(0.17, 0.42)
        ratio = rng.uniform(0.65, 1.0)
        rot = rng.uniform(0, math.pi)
        p, n, t = layer.frame(th, ph)
        t2 = np.cross(n, t)
        m = [rng.uniform(0, TWO_PI) for _ in range(2)]
        # 輪廓取樣，檢查不碰邊、不碰極點、不與其他孔重疊
        cand = {"p": p, "n": n, "t": t, "t2": t2, "rad": rad, "ratio": ratio, "rot": rot, "m": m, "r0": layer.r0}
        ring = _hole_ring(cand)
        d = _unit_rows(ring - NC)
        tt, pp = _to_thph(d)
        if np.any(tt > layer.edge(pp) - 0.09) or np.any(tt < 0.12):
            continue
        if any(np.linalg.norm(p - h["p"]) < rad * 1.1 + h["rad"] * 1.1 + 0.10 for h in holes):
            continue
        holes.append(cand)
    if len(holes) < count:
        raise ValueError(f"粗糙內質網第 {layer.k} 層只挖得出 {len(holes)} 個孔（要 {count} 個）")
    return holes


def _unit_rows(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


HOLE_SIDES = 24
HOLE_HALF = 0.16  # 切刀沿徑向的半高：遠大於薄片半厚加皺褶起伏（約 0.025 + 0.05）


def _hole_ring(h):
    """孔洞輪廓：在孔中心的切平面上取 HOLE_SIDES 個點（略不規則的橢圓）。
    碰撞檢查與切刀都用這一份，兩邊才不會失去同步。"""
    a = np.arange(HOLE_SIDES) * TWO_PI / HOLE_SIDES
    rr = h["rad"] * (1 + 0.09 * np.sin(2 * a + h["m"][0]) + 0.05 * np.sin(3 * a + h["m"][1]))
    loc = np.stack([rr * np.cos(a), h["ratio"] * rr * np.sin(a)], axis=1)
    cr, sr = math.cos(h["rot"]), math.sin(h["rot"])
    loc = loc @ np.array([[cr, sr], [-sr, cr]])
    return h["p"] + loc[:, :1] * h["t"] + loc[:, 1:] * h["t2"]


def _hole_cutter(holes):
    """切刀的側壁沿「由細胞核中心射出的徑向」，不論薄片多彎、皺褶多深都會切穿。"""
    parts = []
    sides = HOLE_SIDES
    for h in holes:
        ring = _hole_ring(h)
        d = _unit_rows(ring - NC)
        dc = _unit(h["p"] - NC)
        r0 = h["r0"]
        v = [NC + (r0 + HOLE_HALF) * dc, NC + (r0 - HOLE_HALF) * dc]
        v += list(NC + (r0 + HOLE_HALF) * d) + list(NC + (r0 - HOLE_HALF) * d)
        f = []
        for k in range(sides):
            k2 = (k + 1) % sides
            f.append([2 + k, 2 + sides + k, 2 + sides + k2, 2 + k2])
            f.append([0, 2 + k, 2 + k2])
            f.append([1, 2 + sides + k2, 2 + sides + k])
        parts.append(_orient(v, f))
    return _merge(parts)


def _cut_holes(solid, holes):
    # 皺褶使四邊形不共面；先切成三角形再布林，否則精確布林在孔緣會留下背對背的零面積重複面
    sv, sf = solid
    tri = []
    for q in sf:
        tri += [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] if len(q) == 4 else [q]
    body = _make_obj("rer_tmp_body", sv, tri)
    cutter = _make_obj("rer_tmp_cutter", *_hole_cutter(holes))
    mod = body.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    co, faces = _evaluated(body)
    _drop(body)
    _drop(cutter)
    # 布林在切刀棱線恰好擦過薄片格點時，會產生相距不到 1e-4 量級的頂點與由它們組成的零面積三角形；
    # 把這些近乎重合的頂點焊起來（連同塌縮的面一起消掉），之後仍由 _mesh_integrity 逐項驗證。
    bm = bmesh.new()
    for p in co:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for q in faces:
        bm.faces.new([bm.verts[i] for i in q])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1.5e-4)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts])
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return co, faces


# ----------------------------------------------------------------------------
# 核糖體
# ----------------------------------------------------------------------------
_RIB_PLAN = [
    # (層, 面 +1 朝外 / -1 朝內, 顆數, 離表面的高度)
    (0, -1, 60, 0.028),  # 最靠細胞核的一面：淨空不足的地方放不下，差額由下一列（最外層朝外）補
    (3, +1, 200, 0.030),
    (0, +1, 80, -0.004),
    (1, +1, 80, -0.004),
    (2, +1, 80, -0.004),
]


def _attached_ribosomes(layers, holes_by_layer, rng):
    """回傳 [(中心, 層, rho)]。"""
    out = []
    cos_max = math.cos(EDGE_MAX)
    carry = 0
    for k, side, count, off in _RIB_PLAN:
        count += carry
        carry = 0
        lay = layers[k]
        pts = []
        tries = 0
        while len(pts) < count and tries < 60000:
            tries += 1
            u = rng.uniform(cos_max, 1.0)
            th = math.acos(u)
            ph = rng.uniform(0, TWO_PI)
            e = float(lay.edge(ph))
            if th > 0.93 * e or th < 0.12:
                continue
            p, n, _t = lay.frame(th, ph)
            c = p + side * n * (SHEET_H + off)
            if not (C.cavity_sdf(c) <= -0.07 and bool(_outside_vacuole(c, 0.05))):
                continue
            if np.linalg.norm(c - NC) < RIB_NUC_MIN:  # 核糖體最外緣不得侵入細胞核周圍（核孔凸起到約 1.18）
                continue
            if any(np.linalg.norm(p - h["p"]) < h["rad"] * 1.35 + 0.07 for h in holes_by_layer[k]):
                continue
            if pts and np.min(np.linalg.norm(np.array([q[0] for q in pts]) - c, axis=1)) < 0.115:
                continue
            pts.append((c, k, th / e, side))
        if len(pts) < count:
            if side == -1:
                carry = count - len(pts)
            else:
                raise ValueError(f"第 {k} 層薄片只放得下 {len(pts)} 顆核糖體（要 {count} 顆）")
        out.extend(pts)
    return out


def _free_ribosome_cluster(rng, n=10):
    """球內隨機排開、彼此不相碰的 n 個相對位置（半徑 0.155 內）。"""
    pts = []
    for _ in range(4000):
        if len(pts) >= n:
            break
        v = np.array([rng.gauss(0, 1) for _ in range(3)])
        v = v / np.linalg.norm(v) * 0.155 * rng.random() ** (1 / 3)
        if all(np.linalg.norm(v - q) >= 0.098 for q in pts):
            pts.append(v)
    if len(pts) < n:
        raise ValueError("游離核糖體群排不下")
    return pts


# ----------------------------------------------------------------------------
# 平滑內質網
# ----------------------------------------------------------------------------
_SU = _unit(_A - (_A @ _S) * _S)  # 朝向粗糙內質網那一側
_SV = np.cross(_S, _SU)


def _sdir(psi_deg, chi_deg):
    psi, chi = math.radians(psi_deg), math.radians(chi_deg)
    return math.cos(psi) * _S + math.sin(psi) * (math.cos(chi) * _SU + math.sin(chi) * _SV)


def _arc_points(p0, p1, rng, seg_len=0.22, bump=0.07):
    """沿球殼從 p0 到 p1 的圓滑曲線（方向球面內插、半徑內插加起伏、再加一點側向擺動）。"""
    d0, d1 = _unit(p0 - NC), _unit(p1 - NC)
    r0, r1 = np.linalg.norm(p0 - NC), np.linalg.norm(p1 - NC)
    ang = math.acos(float(np.clip(d0 @ d1, -1, 1)))
    length = max(ang * 0.5 * (r0 + r1), 0.2)
    n = max(3, int(round(length / seg_len)))
    t = np.linspace(0, 1, n + 1)
    if ang < 1e-6:
        d = np.repeat(d0[None], n + 1, 0)
    else:
        d = (np.sin((1 - t) * ang)[:, None] * d0 + np.sin(t * ang)[:, None] * d1) / math.sin(ang)
    r = r0 + (r1 - r0) * t + rng.uniform(-bump, bump) * np.sin(math.pi * t)
    side = np.cross(d0, d1)
    side = side / np.linalg.norm(side) if np.linalg.norm(side) > 1e-9 else _SU
    wob = rng.uniform(-0.05, 0.05) * np.sin(math.pi * t)
    d = _unit_rows(d + wob[:, None] * side)
    pts = NC + r[:, None] * d
    pts[0], pts[-1] = p0, p1
    return pts


TUBE_R = 0.065
SMOOTH_K = 0.12  # 管與管匯合處的圓滑融合寬度
VOXEL = 0.039


def _capsule_d(P, a, b, r):
    ba = b - a
    pa = P - a
    h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r


def _smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def _ser_field(curves):
    """curves: [(折線點 (n,3), 半徑 (n-1,))]。同一條管內取硬最小，管與管之間用圓滑最小融合。"""

    def f(P):
        d = None
        for pts, rad in curves:
            de = None
            for i in range(len(pts) - 1):
                c = _capsule_d(P, pts[i], pts[i + 1], rad[i])
                de = c if de is None else np.minimum(de, c)
            d = de if d is None else _smin(d, de, SMOOTH_K)
        return d

    return f


def _surface_nets(field, lo, hi, h):
    """Naive surface nets：回傳 (verts, quad faces)。field 在表面內為負。"""
    nx, ny, nz = (int(math.ceil((hi[i] - lo[i]) / h)) + 2 for i in range(3))
    xs = lo[0] + h * np.arange(nx)
    ys = lo[1] + h * np.arange(ny)
    zs = lo[2] + h * np.arange(nz)
    G = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1).reshape(-1, 3)
    F = np.empty(len(G))
    step = 200000
    for i in range(0, len(G), step):
        F[i : i + step] = field(G[i : i + step])
    F = F.reshape(nx, ny, nz)
    G = G.reshape(nx, ny, nz, 3)
    neg = F < 0
    cs = (nx - 1, ny - 1, nz - 1)
    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]

    def sl(o):
        return (slice(o[0], o[0] + cs[0]), slice(o[1], o[1] + cs[1]), slice(o[2], o[2] + cs[2]))

    sgn = sum(neg[sl(o)].astype(int) for o in corners)
    active = (sgn > 0) & (sgn < 8)
    acc = np.zeros(cs + (3,))
    cnt = np.zeros(cs)
    for a in corners:
        for b in corners:
            if a < b and sum(abs(x - y) for x, y in zip(a, b)) == 1:
                fa, fb = F[sl(a)], F[sl(b)]
                cross = (fa < 0) != (fb < 0)
                t = np.where(cross, fa / np.where(cross, fa - fb, 1.0), 0.0)
                pa, pb = G[sl(a)], G[sl(b)]
                acc += np.where(cross[..., None], pa + (pb - pa) * t[..., None], 0.0)
                cnt += cross
    vid = -np.ones(cs, dtype=np.int64)
    idx = np.argwhere(active)
    vid[active] = np.arange(len(idx))
    verts = acc[active] / cnt[active][:, None]
    faces = []
    for axis in range(3):
        a1, a2 = (axis + 1) % 3, (axis + 2) % 3
        lo_n = neg[tuple(slice(0, s - 1) if d == axis else slice(None) for d, s in enumerate(neg.shape))]
        hi_n = neg[tuple(slice(1, None) if d == axis else slice(None) for d, s in enumerate(neg.shape))]
        e = np.argwhere(lo_n != hi_n)  # 邊起點 (沿 axis 方向的邊)
        for q in e:
            if q[a1] < 1 or q[a2] < 1:
                continue
            cells = []
            for d1, d2 in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
                c = list(q)
                c[a1] += d1
                c[a2] += d2
                cells.append(vid[tuple(c)])
            if min(cells) < 0:
                continue
            faces.append(cells)
    return verts, faces


def _ser_mesh(nodes, edges, rng, connectors=()):
    """nodes: {名稱: 位置}；edges: [(a, b)]。以隱函數（圓滑聯集的膠囊）建立管網並用 surface nets 取面，
    頂點投影回曲面，法向取自隱函數梯度，三叉接點因此平順融合。
    connectors 是連接管（接到粗糙內質網的那幾條）的邊；回傳 (verts, faces, normals, 各頂點是否屬於連接管)。
    屬於哪一條管，以離哪條管的中心線最近判定。"""
    curves = []
    for a, b in edges:
        pts = _arc_points(nodes[a], nodes[b], rng, seg_len=0.12)
        ph = rng.uniform(0, TWO_PI)
        t = np.linspace(0, 1, len(pts) - 1)
        rad = TUBE_R + 0.004 * np.sin(2 * math.pi * 1.5 * t + ph)
        curves.append((pts, rad))
    field = _ser_field(curves)
    allp = np.vstack([c[0] for c in curves])
    lo = allp.min(0) - 0.2
    hi = allp.max(0) + 0.2
    verts, faces = _surface_nets(field, lo, hi, VOXEL)
    eps = 1e-3

    def grad(P):
        g = np.zeros_like(P)
        for k in range(3):
            e = np.zeros(3)
            e[k] = eps
            g[:, k] = (field(P + e) - field(P - e)) / (2 * eps)
        return g

    for _ in range(3):  # 牛頓法把頂點投影到 field = 0
        fv = field(verts)
        g = grad(verts)
        verts = verts - (fv / np.sum(g * g, axis=1))[:, None] * g
    g = grad(verts)
    nrm = g / np.linalg.norm(g, axis=1, keepdims=True)
    verts, faces = _orient_mesh(verts, faces)
    conn_pts = np.vstack([c[0] for c, e in zip(curves, edges) if tuple(e) in set(connectors)])
    other_pts = np.vstack([c[0] for c, e in zip(curves, edges) if tuple(e) not in set(connectors)])
    d_conn = np.min(np.linalg.norm(verts[:, None] - conn_pts[None], axis=2), axis=1)
    d_other = np.min(np.linalg.norm(verts[:, None] - other_pts[None], axis=2), axis=1)
    is_conn = d_conn < d_other
    return verts, faces, nrm, is_conn


def _orient_mesh(verts, faces):
    """讓每個面的方向與頂點外法向一致不易，改以 bmesh 重算並要求體積為正。"""
    return _orient(verts, faces)


# ----------------------------------------------------------------------------
# 高基氏體
# ----------------------------------------------------------------------------
GOLGI_R0 = 1.35  # 最大那片扁囊的彎曲半徑
GOLGI_G = 0.10  # 片與片的間距
GOLGI_PHI_N = 32
GOLGI_RHO_N = 7


class _Plate:
    def __init__(self, k, rng):
        self.k = k
        s = 1.0 - 0.3 * k / 5.0
        self.a, self.b = 0.55 * s, 0.25 * s
        self.R = GOLGI_R0 - GOLGI_G * k
        self.p = [rng.uniform(0, TWO_PI) for _ in range(3)]

    def outline(self, ph):
        p = self.p
        return (1 + 0.07 * np.sin(3 * ph + p[0]) + 0.045 * np.sin(5 * ph + p[1]) + 0.03 * np.sin(2 * ph + p[2])) / 1.1

    def flat(self, rho, ph):
        o = self.outline(ph)
        return rho * self.a * np.cos(ph) * o, rho * self.b * np.sin(ph) * o

    def bow(self, x, y, z=0.0):
        """平面座標 (x, y, z 為沿凹面（朝彎曲中心）方向的位移) → 弓形上的點。凹面朝 +z。"""
        al = x / self.R
        r = self.R - z
        return np.stack([r * np.sin(al), y + 0 * al, GOLGI_R0 - r * np.cos(al)], axis=-1)

    def P(self, rho, ph):
        x, y = self.flat(rho, ph)
        return self.bow(x, y)

    def hint(self, rho, ph):
        x, _ = self.flat(rho, ph)
        al = x / self.R
        return np.stack([np.sin(al), 0 * al, -np.cos(al)], axis=-1)

    @staticmethod
    def H(rho, ph):
        return 0.011 + 0.019 * rho**3  # 中間薄、邊緣鼓，最厚處 0.06

    def solid(self):
        return _sheet(self.P, self.H, self.hint, GOLGI_PHI_N, GOLGI_RHO_N, 5)


class _NoRoom(Exception):
    """只用於「小泡或形狀排不下」；其他錯誤（例如體積為負）一律原樣往外丟。"""


def _golgi_try(rng):
    """局部座標（凹面朝 +z）的扁囊疊與小泡。回傳 (plate_parts, vesicle_centers, vesicle_radii)。"""
    plates = [_Plate(k, rng) for k in range(6)]
    solids = [p.solid() for p in plates]
    cloud = np.vstack([v for v, _ in solids])
    prov = _bbox_center(cloud)
    cent, rads = [], []
    top = plates[5]

    def clear_ok(c, r):
        if np.linalg.norm(c - prov) > 0.66:
            return False
        if np.min(np.linalg.norm(cloud - c, axis=1)) < r + 0.025:
            return False
        return all(np.linalg.norm(c - q) >= r + rr + 0.02 for q, rr in zip(cent, rads))

    def place(kind):
        for _ in range(4000):
            r = rng.uniform(0.05, 0.09)
            if kind == "edge":
                pl = plates[rng.randrange(1, 6)]
                ph = rng.uniform(0, TWO_PI)
                x, y = pl.flat(1.0, ph)
                d = np.array([x / pl.a**2, y / pl.b**2])
                d /= np.linalg.norm(d)
                gap = 0.03 + r + 0.05
                c = pl.bow(x + d[0] * gap, y + d[1] * gap, rng.uniform(-0.03, 0.03))
            else:
                ph = rng.uniform(0, TWO_PI)
                rho = rng.uniform(0.0, 0.95)
                x, y = top.flat(rho, ph)
                c = top.bow(x, y, 0.03 + r + 0.04 + rng.uniform(0, 0.08))
            c = np.asarray(c, dtype=float)
            if clear_ok(c, r):
                cent.append(c)
                rads.append(r)
                return
        raise _NoRoom("高基氏體的小泡排不下")

    for _ in range(8):
        place("edge")
    for _ in range(6):
        place("concave")
    # 整體（含小泡）要在半徑 0.7 的球內：以包圍盒中心為球心檢查，留一點餘裕
    vc_a, vr_a = np.array(cent), np.array(rads) * 1.12
    cen = _bbox_center(np.vstack([cloud, vc_a - vr_a[:, None], vc_a + vr_a[:, None]]))
    reach = max(np.linalg.norm(cloud - cen, axis=1).max(), (np.linalg.norm(vc_a - cen, axis=1) + vr_a).max())
    if reach > 0.685:
        raise _NoRoom("高基氏體超出半徑 0.7 的球")
    return solids, cent, rads


def _golgi_local(rng):
    """扁囊輪廓與小泡位置是隨機的；偶爾小泡排不下就換一組輪廓重來。"""
    err = None
    for _ in range(30):
        try:
            return _golgi_try(rng)
        except _NoRoom as e:
            err = e
    raise C.PlacementError(f"高基氏體排不出符合的形狀：{err}")


def _golgi_rotation(rep, rng):
    if rep:
        w = np.array([0.0, 0.0, 1.0]) - CAM * CAM[2]
        w = _unit(w)  # 疊的方向與鏡頭垂直
        y0 = _unit(np.cross(w, CAM))
        tilt = math.radians(30.0)
        y = _unit(math.cos(tilt) * CAM + math.sin(tilt) * y0)
        y = _unit(y - w * (y @ w))
        x = np.cross(y, w)
        return np.stack([x, y, w], axis=1)
    q, _r = np.linalg.qr(np.array([[rng.gauss(0, 1) for _ in range(3)] for _ in range(3)]))
    if np.linalg.det(q) < 0:
        q[:, 0] *= -1
    return q


# ----------------------------------------------------------------------------
# 細胞骨架
# ----------------------------------------------------------------------------
def _cortex_points(psi, x, depth):
    """x 處、細胞膜內側 depth 的截面點：由截面中心沿 (cos psi, sin psi) 射線用二分法找到 sdf = -depth。"""
    psi = np.asarray(psi, dtype=float) + np.zeros_like(np.asarray(x, dtype=float))
    x = np.asarray(x, dtype=float) + np.zeros_like(psi)
    depth = np.asarray(depth, dtype=float) + np.zeros_like(psi)
    lo, hi = np.zeros_like(psi), np.full_like(psi, 5.0)
    cy, sz = np.cos(psi), np.sin(psi)
    for _ in range(40):
        mid = (lo + hi) / 2
        p = np.stack([x, mid * cy, mid * sz], axis=-1)
        inside = C.rbox_sdf(p, C.CAVITY_HALF, C.CAVITY_R) <= -depth
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return np.stack([x, lo * cy, lo * sz], axis=-1)


def _free_run(ctx, pts, rad, min_len):
    """把折線切成 is_free 的連續段，回傳最長且長度 >= min_len 的一段（沒有就回 None）。"""
    flags = [ctx.is_free(p, rad) for p in pts]
    best, cur = None, []
    runs = []
    for p, ok in zip(pts, flags):
        if ok:
            cur.append(p)
        else:
            if cur:
                runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    for r in runs:
        r = np.array(r)
        ln = float(np.sum(np.linalg.norm(np.diff(r, axis=0), axis=1))) if len(r) > 1 else 0.0
        if ln >= min_len and (best is None or ln > best[0]):
            best = (ln, r)
    return None if best is None else best[1]


def _resample(path, step):
    path = np.asarray(path, dtype=float)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(round(s[-1] / step)) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, path[:, i]) for i in range(3)], axis=1)


def _microtubules(ctx, rng):
    paths = []
    cut_paths = []
    long_psi = []
    guard = 0
    while len(paths) < 16 and guard < 4000:
        guard += 1
        i = len(paths)
        want_cut = len(cut_paths) < 4 and i % 2 == 0
        depth0 = rng.uniform(0.17, 0.33)
        wob = rng.uniform(0, TWO_PI)
        is_long = i % 8 < 5
        if is_long:  # 長軸
            psi0 = rng.uniform(math.radians(95), math.radians(200)) if want_cut else rng.uniform(0, TWO_PI)
            if any(abs((psi0 - q + math.pi) % TWO_PI - math.pi) < 0.32 for q in long_psi):
                continue
            x = np.linspace(-3.9, 3.9, 40)
            depth = np.clip(depth0 + 0.04 * np.sin(1.3 * x + wob), 0.16, 0.34)
            psi = psi0 + 0.04 * np.sin(0.9 * x + 2 * wob)
            raw = _cortex_points(psi, x, depth)
        else:  # 環向
            x0 = rng.uniform(-3.4, 3.4) if not want_cut else rng.uniform(-1.9, 3.4)
            span = rng.uniform(0.9, 1.9)
            psi0 = rng.uniform(math.radians(60), math.radians(170)) if want_cut else rng.uniform(0, TWO_PI)
            psi = np.linspace(psi0, psi0 + span, 30)
            depth = np.clip(depth0 + 0.03 * np.sin(2.0 * psi + wob), 0.16, 0.34)
            raw = _cortex_points(psi, np.full_like(psi, x0), depth)
        run = _free_run(ctx, raw, 0.07, 0.9)
        if run is None:
            continue
        mid = run[len(run) // 2]
        if want_cut and not C.in_cut(mid):
            continue
        paths.append(_resample(run, 0.26))
        if is_long:
            long_psi.append(psi0)
        if C.in_cut(mid):
            cut_paths.append(len(paths) - 1)
    if len(paths) < 16:
        raise C.PlacementError(f"只排得出 {len(paths)} 條微管（要 16 條）")
    if len(cut_paths) < 4:
        raise C.PlacementError(f"掀開區內只有 {len(cut_paths)} 條微管（至少 4 條）")
    return paths, cut_paths


def _bez(p0, c, p1, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t**2 * p1


def _microfilaments(ctx, rng):
    out = []
    guard = 0
    while len(out) < 12 and guard < 6000:
        guard += 1
        psi = rng.uniform(0, TWO_PI)
        x = rng.uniform(-3.6, 3.6)
        s = _cortex_points(psi, x, rng.uniform(0.16, 0.30))
        d = _unit([rng.gauss(0, 1) for _ in range(3)])
        e = NC + d * rng.uniform(1.95, 2.15)
        if not ctx.is_free(e, 0.07):
            continue
        mid = (s + e) / 2
        off = _unit([rng.gauss(0, 1) for _ in range(3)])
        off = _unit(off - (e - s) * (off @ (e - s)) / ((e - s) @ (e - s)))
        c = mid + off * rng.uniform(0.25, 0.6)
        pts = _bez(s, c, e, 40)
        if np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)) < 1.0:
            continue
        if not all(ctx.is_free(p, 0.07) for p in pts):
            continue
        out.append(_resample(pts, 0.14))
    if len(out) < 12:
        raise C.PlacementError(f"只排得出 {len(out)} 條微絲（要 12 條）")
    return out


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------


def _mesh_integrity(obj, tol=1e-5):
    """對最終要匯出的網格（頂點與面陣列）直接檢查：頂點以 tol 焊接後，
    1) 每條邊的共用面數必須是 2；2) 不得有完全重合的三角形；3) 相鄰面繞向一致且與朝外的角法向一致。
    不經 bmesh.faces.new，所以重複面不會被吞掉。回傳 (非流形邊數, 重複三角形組數, 反向面數)。"""
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3)
    kd = mathutils.kdtree.KDTree(len(co))
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    wid = np.arange(len(co))
    for i, p in enumerate(co):
        for _p, j, _d in kd.find_range(p, tol):
            if wid[j] < wid[i]:
                wid[i] = wid[j]
    for _ in range(3):  # 傳遞閉包
        wid = wid[wid]
    w = wid[tri]
    keep = (w[:, 0] != w[:, 1]) & (w[:, 1] != w[:, 2]) & (w[:, 0] != w[:, 2])
    collapsed = int(np.sum(~keep))  # 焊接後塌縮成線或點的三角形（零面積）
    w = w[keep]
    e = np.sort(np.concatenate([w[:, [0, 1]], w[:, [1, 2]], w[:, [2, 0]]]), axis=1)
    _u, cnt = np.unique(e, axis=0, return_counts=True)
    bad_edges = int(np.sum(cnt != 2))
    de = np.concatenate([w[:, [0, 1]], w[:, [1, 2]], w[:, [2, 0]]])
    _u, inv = np.unique(np.sort(de, axis=1), axis=0, return_inverse=True)
    sign = np.where(de[:, 0] < de[:, 1], 1, -1)
    wind_bad = int(np.sum(np.bincount(inv.ravel(), weights=sign) != 0))  # 同一條邊兩側的繞向必須相反
    t = np.sort(w, axis=1)
    _u, tc = np.unique(t, axis=0, return_counts=True)
    dups = int(np.sum(tc > 1)) + collapsed
    nloop = len(me.loops)
    cn = np.empty(nloop * 3)
    me.corner_normals.foreach_get("vector", cn)
    cn = cn.reshape(-1, 3)
    pn = np.empty(len(me.polygons) * 3)
    me.polygons.foreach_get("normal", pn)
    pn = pn.reshape(-1, 3)
    ls = np.empty(len(me.polygons), dtype=np.int64)
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    flipped = 0
    for s, n_, p in zip(ls, lt, pn):
        if float(cn[s : s + n_].mean(axis=0) @ p) < 0:
            flipped += 1
    return bad_edges, dups, flipped + wind_bad


def _check(name, co, ok_mask_fn, what):
    bad = ~ok_mask_fn(co)
    if np.any(bad):
        raise ValueError(f"{name}：{int(bad.sum())} 個頂點{what}（例：{tuple(np.round(co[bad][0], 3))}）")


def _cavity_ok(co, margin):
    return C.rbox_sdf(co, C.CAVITY_HALF, C.CAVITY_R) <= -margin


def build(ctx):
    rng = random.Random(ctx.seed * 7 + 11)  # 幾何用自己的亂數，與其他模組的取用順序無關
    report = {}

    # ---------------- 粗糙內質網 ----------------
    layers = [_Layer(k) for k in range(4)]
    holes = {k: _make_holes(layers[k], rng, n) for k, n in enumerate((6, 7, 8, 9))}
    rer_parts = []
    for k in range(4):
        rer_parts.append(_cut_holes(layers[k].solid(), holes[k]))
    rer_co, rer_faces = _merge(rer_parts)

    # 錨點：最外層薄片朝鏡頭露出的邊緣上
    phs = np.linspace(0, TWO_PI, 720, endpoint=False)
    edge_pts = layers[3].P(layers[3].edge(phs), phs)
    score = edge_pts @ CAM
    anchor_rer = edge_pts[int(np.argmax(score))]

    rer_obj = _make_obj("rough_er_main", rer_co, rer_faces)
    root = C.new_instance("rough_er", _bbox_center(rer_co))
    C.add_part(root, rer_obj, "main")
    C.add_anchor(root, anchor_rer)
    report["rough_er"] = _tri_count(rer_obj)
    d = np.linalg.norm(rer_co - NC, axis=1)
    if d.min() < 1.20 or d.max() > 1.80:
        raise ValueError(f"粗糙內質網頂點距細胞核中心 {d.min():.3f}~{d.max():.3f}，超出 1.20~1.80")
    _check("粗糙內質網", rer_co, lambda c: _cavity_ok(c, 0.05), "不在空腔內（margin 0.05）")
    _check("粗糙內質網", rer_co, lambda c: _outside_vacuole(c, 0.0), "進入液泡")
    rer_range = (float(d.min()), float(d.max()))
    ax = _unit(C.RER["axis"])
    dots = _unit_rows(rer_co - NC) @ ax
    if dots.min() <= C.RER["min_dot"]:
        raise ValueError(f"粗糙內質網有頂點方向與軸的內積 {dots.min():.4f} <= {C.RER['min_dot']}（超出半邊範圍）")
    bad_e, dup_t, flip_f = _mesh_integrity(rer_obj, 1e-5)
    if bad_e or dup_t or flip_f:
        raise ValueError(
            f"粗糙內質網（焊接容差 1e-5）有 {bad_e} 條非流形邊、{dup_t} 組重複三角形、{flip_f} 個反向面"
        )
    rer_dot_min = float(dots.min())
    # 孔洞要真的切穿：孔洞中心附近不得有該層的任何頂點
    for k, hs in holes.items():
        lco = rer_parts[k][0]  # 只看該層自己的頂點
        for h in hs:
            near = np.linalg.norm(lco - h["p"], axis=1) < 0.5 * h["rad"] * h["ratio"]
            if np.any(near):
                raise ValueError(f"粗糙內質網第 {k} 層的孔洞沒有切穿（孔內仍有 {int(near.sum())} 個頂點）")

    # ---------------- 核糖體（附著的在前，為代表）----------------
    att = _attached_ribosomes(layers, holes, rng)
    centers = np.array([a[0] for a in att])
    rib_v, rib_f = _balls(centers, [RIB_R * rng.uniform(0.93, 1.07) for _ in att], 8, 4, rng, 0.06)
    rib_obj = _make_obj("ribosome_attached_main", rib_v, rib_f)
    root = C.new_instance("ribosome", _bbox_center(rib_v))
    C.add_part(root, rib_obj, "main")
    cand = [a for a in att if a[1] == 3 and a[3] == 1 and a[2] > 0.78]
    anchor_rib = max(cand, key=lambda a: float(a[0] @ CAM))[0]
    C.add_anchor(root, anchor_rib)
    report["ribosome_attached"] = _tri_count(rib_obj)
    _check("附著核糖體", rib_v, lambda c: _cavity_ok(c, 0.02), "不在空腔內")
    rib_d = np.linalg.norm(rib_v - NC, axis=1)
    if rib_d.min() < 1.20:
        raise ValueError(f"附著核糖體有頂點距細胞核中心 {rib_d.min():.3f} < 1.20")
    rib_min, rib_n = float(rib_d.min()), len(att)

    free_c = []
    for i in range(14):
        c = ctx.sample_free(0.2, i < 6)
        ctx.reserve(f"ribosome_free_{i}", c, 0.2)
        free_c.append(np.array(c))
    fc, fr = [], []
    for c in free_c:
        for q in _free_ribosome_cluster(rng):
            fc.append(c + q)
            fr.append(RIB_R * rng.uniform(0.93, 1.07))
    fv, ff = _balls(fc, fr, 8, 4, rng, 0.06)
    fobj = _make_obj("ribosome_free_main", fv, ff)
    root = C.new_instance("ribosome", _bbox_center(fv))
    C.add_part(root, fobj, "main")
    report["ribosome_free"] = _tri_count(fobj)

    # ---------------- 平滑內質網 ----------------
    rer3 = layers[3]
    conn_phi = (0.5, -0.5)
    ends = []
    for ph in conn_phi:
        th = float(rer3.edge(ph)) - 0.02 / rer3.r0 - 0.004
        ends.append(rer3.P(np.array(th), np.array(ph)))
    # 立體的籠狀管網：內圈（較近核）、外圈（較遠）各 3 個接點，由 3 條短柱相連；
    # 外圈上再分出 2 個接點，各伸出一條管到粗糙內質網最外層的邊緣。全部接點都是三叉。
    nodes = {
        "N1": NC + 1.50 * _sdir(16, 60),
        "N2": NC + 1.58 * _sdir(16, 180),
        "N3": NC + 1.46 * _sdir(16, -60),
        "O1": NC + 1.76 * _sdir(40, 75),
        "O2": NC + 1.70 * _sdir(40, -75),
        "O3": NC + 1.77 * _sdir(42, 180),
        "J1": NC + 1.69 * _sdir(36, 22),
        "J2": NC + 1.68 * _sdir(36, -22),
        "E1": ends[0],
        "E2": ends[1],
    }
    edges = [
        ("N1", "N2"), ("N2", "N3"),
        ("N1", "O1"), ("N2", "O3"), ("N3", "O2"),
        ("O1", "J1"), ("J1", "J2"), ("J2", "O2"), ("O2", "O3"), ("O3", "O1"),
        ("J1", "E1"), ("J2", "E2"),
    ]  # fmt: skip
    ser_co, ser_faces, ser_nrm, ser_conn = _ser_mesh(nodes, edges, rng, connectors=(("J1", "E1"), ("J2", "E2")))
    ser_obj = _make_obj("smooth_er_main", ser_co, ser_faces)
    ser_obj.data.shade_smooth()
    ser_obj.data.normals_split_custom_set_from_vertices([tuple(map(float, x)) for x in ser_nrm])
    root = C.new_instance("smooth_er", _bbox_center(ser_co))
    C.add_part(root, ser_obj, "main")
    junctions = [nodes[n] for n in ("N1", "N2", "N3", "O1", "O2", "O3", "J1", "J2")]
    C.add_anchor(root, max(junctions, key=lambda p: float(p @ CAM)))
    report["smooth_er"] = _tri_count(ser_obj)
    _check("平滑內質網", ser_co, lambda c: _cavity_ok(c, 0.1), "不在空腔內（margin 0.1）")
    _check("平滑內質網", ser_co, lambda c: _outside_vacuole(c, 0.0), "進入液泡")
    sd = np.linalg.norm(ser_co - NC, axis=1)
    if sd.min() < 1.30:
        raise ValueError(f"平滑內質網有頂點進入細胞核周圍 1.30 的球（最近 {sd.min():.3f}）")
    # 連接管（接到粗糙內質網最外層邊緣的那 2 條）可以超出扇形區，上限放寬到禁入區半徑；
    # 其餘管網都不得超過 SER 的外半徑。
    lim_main = C.SER["r_max"]
    lim_conn = C.SER["zone_radius"]
    over = np.where(ser_conn, sd > lim_conn, sd > lim_main)
    if np.any(over):
        raise ValueError(
            f"平滑內質網有 {int(over.sum())} 個頂點超出距核心上限"
            f"（一般 {lim_main}、連接管 {lim_conn}；最遠 {sd[over].max():.3f}）"
        )
    ser_max_main = float(sd[~ser_conn].max())
    ser_range = (float(sd.min()), float(sd.max()))

    # ---------------- 高基氏體 ----------------
    gol_max = []
    for gi, gc in enumerate(C.GOLGI["centers"]):
        solids, vc, vr = _golgi_local(rng)
        pv, pf = _merge(solids)
        sv, sf = _balls(vc, vr, 12, 6, rng, 0.1)
        allv = np.vstack([pv, sv])
        cen = _bbox_center(allv)
        rot = _golgi_rotation(gi == 0, rng)
        world = lambda v: (np.asarray(v) - cen) @ rot.T + np.array(gc)  # noqa: E731
        pw, sw = world(pv), world(sv)
        rad = max(np.linalg.norm(pw - gc, axis=1).max(), np.linalg.norm(sw - gc, axis=1).max())
        if rad > 0.70:
            raise ValueError(f"高基氏體 {gi} 超出半徑 0.7 的球（{rad:.3f}）")
        gol_max.append(float(rad))
        _check(f"高基氏體 {gi}", np.vstack([pw, sw]), lambda c: _cavity_ok(c, 0.0), "超出空腔")
        plate_obj = _make_obj(f"golgi_{gi}_main", pw, pf)
        ves_obj = _make_obj(f"golgi_{gi}_vesicle", sw, sf)
        root = C.new_instance("golgi", _bbox_center(np.vstack([pw, sw])))
        C.add_part(root, plate_obj, "main")
        C.add_part(root, ves_obj, "vesicle")
        report[f"golgi_{gi}"] = _tri_count(plate_obj) + _tri_count(ves_obj)

    # ---------------- 細胞骨架 ----------------
    mts, cut_idx = _microtubules(ctx, rng)
    fil = _microfilaments(ctx, rng)
    mv, mf = _merge([_tube(p, 0.022, 8) for p in mts])
    fv2, ff2 = _merge([_tube(p, 0.012, 6) for p in fil])
    mt_obj = _make_obj("cytoskeleton_main", mv, mf)
    fl_obj = _make_obj("cytoskeleton_filament", fv2, ff2)
    root = C.new_instance("cytoskeleton", _bbox_center(np.vstack([mv, fv2])))
    C.add_part(root, mt_obj, "main")
    C.add_part(root, fl_obj, "filament")
    pick = max(cut_idx, key=lambda i: float(mts[i][len(mts[i]) // 2] @ CAM))
    C.add_anchor(root, mts[pick][len(mts[pick]) // 2])
    report["cytoskeleton"] = _tri_count(mt_obj) + _tri_count(fl_obj)
    allcy = np.vstack([mv, fv2])
    _check("細胞骨架", allcy, lambda c: _cavity_ok(c, 0.05), "不在空腔內（margin 0.05）")
    q = (allcy - VC) / (VAX + 0.15)
    if np.any(np.sum(q * q, axis=1) < 1.0):
        raise ValueError("細胞骨架進入液泡（半軸各加 0.15）")
    if np.any(np.linalg.norm(allcy - NC, axis=1) < C.NUCLEUS_ZONE["radius"]):
        raise ValueError("細胞骨架進入 NUCLEUS_ZONE")

    total = sum(report.values())
    print(f"[endomembrane] 三角面 {total}：{report}")
    print(f"[endomembrane] 非流形邊 0、重複三角形 0、反向面 0；附著核糖體 {rib_n} 顆、距核最小 {rib_min:.3f}；粗糙內質網最小內積 {rer_dot_min:.4f}；平滑內質網一般管距核最大 {ser_max_main:.3f}")
    print(
        f"[endomembrane] 自檢：粗糙內質網距核心 {rer_range[0]:.3f}~{rer_range[1]:.3f}；"
        f"平滑內質網距核心 {ser_range[0]:.3f}~{ser_range[1]:.3f}；高基氏體最大半徑 {gol_max}；"
        f"掀開區微管 {len(cut_idx)} 條"
    )
