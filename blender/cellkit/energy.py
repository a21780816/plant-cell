"""葉綠體、粒線體、過氧化體。

三種都由「沿一條軸的一串環」組成的表面（_tube）生成：橢球、彎曲的膠囊、球都是它的特例。
剖開的個體是「外殼 + 薄壁內襯 + 內部構造」：外殼表面是 main，剖面的環與內襯是 cut，
內部構造（葉綠餅、嵴、結晶核）各自是一個 part。網格都在個體的局部座標建好，
最後以旋轉與平移放進世界座標，所以每個個體都完全落在它的碰撞球內。

局部座標：x 為長軸、y 為剖面法線（保留 y 較小的那一半）、z 為扁的方向。
"""
import math

import bpy
import numpy as np

from . import common as C

# ----------------------------------------------------------------------------
# 規格
# ----------------------------------------------------------------------------
CHLORO_AXES = (0.62, 0.36, 0.24)
CHLORO_RADIUS = 0.62
CHLORO_WALL = 0.035
CHLORO_CUT_Y = 0.08  # 剖面略高於中心，讓葉綠餅能完整落在保留的那半
GRANA_R, GRANA_H, GRANA_PITCH, GRANA_N = 0.09, 0.0125, 0.03, 6
# 六疊葉綠餅的 (x, y, 傾斜角, z 位移)：y 是往保留側的深度；傾斜與上下位移讓各疊在剖面上錯落
GRANA_LAYOUT = [
    (-0.410, -0.059, -0.17, -0.008),
    (-0.223, -0.153, 0.16, 0.026),
    (-0.067, -0.018, -0.14, -0.026),
    (0.062, -0.176, 0.17, 0.030),
    (0.260, -0.135, -0.16, -0.020),
    (0.426, -0.019, 0.14, 0.008),
]

MITO_RADIUS = 0.48
MITO_R = 0.2
MITO_HALF_STRAIGHT = 0.275  # 兩端半球之間的軸長一半；總長 = 2 * (0.275 + 0.2) = 0.95
MITO_WALL = 0.028

PEROX_RADIUS = 0.25
PEROX_R = 0.2
PEROX_WALL = 0.022

ACCEPT_CORTEX = 1.24


# ----------------------------------------------------------------------------
# 網格基礎
# ----------------------------------------------------------------------------
def _dedupe(face):
    out = []
    for v in face:
        if not out or out[-1] != v:
            out.append(v)
    while len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else None


def _quad(a, b, c, d):
    return _dedupe([a, b, c, d])


def _tube(stations, nphi, half, disp=None):
    """沿軸的環狀表面。stations: [(c, U, V, ru, rv, pole)]，環上的點 = c + ru cosφ U + rv sinφ V。
    half=True 時 φ 只走 0 到 -π（y 軸方向為 V 時即 y <= c.y 那一半，端點恰在 y 平面上）。
    pole=True 的站只有一個頂點。回傳 (頂點, 各頂點所屬環中心, 面, 各站的頂點索引)。"""
    if half:
        ang = -math.pi * np.arange(nphi + 1) / nphi
    else:
        ang = 2 * math.pi * np.arange(nphi) / nphi
    cs, sn = np.cos(ang), np.sin(ang)
    if half:
        cs[0], sn[0], cs[-1], sn[-1] = 1.0, 0.0, -1.0, 0.0
    ncol = len(ang)
    verts, ctrs, idx = [], [], []
    for c, U, V, ru, rv, pole in stations:
        c, U, V = np.asarray(c, float), np.asarray(U, float), np.asarray(V, float)
        if pole:
            verts.append(c)
            ctrs.append(c)
            idx.append([len(verts) - 1] * ncol)
        else:
            base = len(verts)
            pts = c + (ru * cs)[:, None] * U + (rv * sn)[:, None] * V
            verts.extend(pts)
            ctrs.extend([c] * ncol)
            idx.append(list(range(base, base + ncol)))
    P = np.array(verts)
    if disp is not None:
        P = disp(P)
    faces = []
    for j in range(len(stations) - 1):
        for i in range(ncol - 1 if half else ncol):
            i2 = i + 1 if half else (i + 1) % ncol
            f = _quad(idx[j][i], idx[j][i2], idx[j + 1][i2], idx[j + 1][i])
            if f:
                faces.append(f)
    return P, np.array(ctrs), faces, idx


def _face_normal(P):
    n = np.zeros(3)
    for k in range(len(P)):
        n += np.cross(P[k], P[(k + 1) % len(P)])
    return n


def _orient(V, faces, ref):
    """ref(face_vertex_indices, centroid) -> 期望的外向量。整組面一起翻（格點的繞向一致）。"""
    tot = 0.0
    for f in faces:
        P = V[f]
        tot += float(np.dot(_face_normal(P), ref(f, P.mean(0))))
    return [f[::-1] for f in faces] if tot < 0 else faces


def _orient_outward(V, faces, ctrs, sign=1.0):
    faces = _orient(V, faces, lambda f, cen: cen - ctrs[f].mean(0))
    return faces if sign > 0 else [f[::-1] for f in faces]


def _loop_wrap(idx):
    return _dedupe(list(idx[-1]))


def _loop_half(idx):
    col0 = [r[0] for r in idx]
    colN = [r[-1] for r in idx]
    return _dedupe(col0 + colN[::-1])


def _ring_faces(A, B):
    faces = []
    for k in range(len(A)):
        k2 = (k + 1) % len(A)
        f = _quad(A[k], A[k2], B[k2], B[k])
        if f:
            faces.append(f)
    return faces


def _join(parts):
    """[(V, F)] -> (V, F)"""
    vs, fs, off = [], [], 0
    for V, F in parts:
        vs.append(np.asarray(V))
        fs.extend([[i + off for i in f] for f in F])
        off += len(V)
    return np.vstack(vs), fs


def _shell(outer_st, inner_st, nphi, half, disp, y_fix=None):
    """外殼（main）與剖面（cut = 薄環 + 內襯）。inner_st 為 None 時是不剖開的封閉外殼。"""
    V, ctr, F, idx = _tube(outer_st, nphi, half, disp)
    if y_fix is not None:
        V[idx[-1], 1] = y_fix
    F = _orient_outward(V, F, ctr)
    main = (V, F)
    if inner_st is None:
        return main, None
    Vi, ctri, Fi, idxi = _tube(inner_st, nphi, half, None)
    if y_fix is not None:
        Vi[idxi[-1], 1] = y_fix
    Fi = _orient_outward(Vi, Fi, ctri, sign=-1.0)
    if half:
        la, lb = _loop_half(idx), _loop_half(idxi)
    else:
        la, lb = _loop_wrap(idx), _loop_wrap(idxi)
    # 剖面的環：外殼切口一圈 + 內襯切口一圈，面朝 +y（朝向鏡頭那一側）
    n = len(la)
    Vr = np.vstack([V[la], Vi[lb]])
    ring = _ring_faces(list(range(n)), list(range(n, 2 * n)))
    ring = _orient(Vr, ring, lambda f, cen: np.array([0.0, 1.0, 0.0]))
    return main, _join([(Vi, Fi), (Vr, ring)])


def _ell_stations(axes, y0, M, wall=0.0):
    """以 y 為極軸的橢球站。y0=None 為完整橢球；否則只到平面 y = y0（含）為止，保留 y <= y0。
    wall > 0 時各半軸各縮 wall（內襯）。"""
    a, b, c = (ax - wall for ax in axes)
    th0 = 0.0 if y0 is None else math.acos(y0 / b)
    ths = math.pi - (math.pi - th0) * np.arange(M + 1) / M
    st = []
    for j, th in enumerate(ths):
        s = math.sin(th)
        y = b * math.cos(th)
        pole = j == 0 or (y0 is None and j == M)
        if j == M and y0 is not None:
            y = y0
        st.append(((0.0, y, 0.0), (1, 0, 0), (0, 0, 1), a * s, c * s, pole))
    return st


# ----------------------------------------------------------------------------
# 世界座標與建立物件
# ----------------------------------------------------------------------------
def _make_obj(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [list(map(int, f)) for f in faces])
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def _rand_rot(rng):
    q = np.array([rng.gauss(0, 1) for _ in range(4)])
    w, x, y, z = q / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def _camera_frame(rng=None):
    """代表個體的局部座標：x 朝鏡頭右方、y（剖面法線）朝 CAMERA_DIR、z 朝鏡頭上方。
    給 rng 時改為「大致朝向」：法線偏轉最多約 8 度，並繞法線隨機轉一個角度。"""
    d = _unit(C.CAMERA_DIR)
    if rng is not None:
        side = np.cross(d, (0, 0, 1))
        e = rng.uniform(-0.14, 0.14) * _unit(side) + rng.uniform(-0.14, 0.14) * _unit(np.cross(d, side))
        d = _unit(d + e)
    right = _unit(np.cross(d, (0, 0, 1)))
    up = np.cross(right, d)
    if rng is None:
        return np.column_stack([right, d, up])
    psi = rng.uniform(-0.7, 0.7)
    x = math.cos(psi) * right + math.sin(psi) * up
    z = -math.sin(psi) * right + math.cos(psi) * up
    return np.column_stack([x, d, z])


def _emit(oid, p, R, radius, pieces):
    """pieces: {part: [(V, F)]}（局部座標，原點為碰撞球中心）→ 世界座標、建立根節點與網格。"""
    p = np.asarray(p, float)
    world = {}
    allv = []
    for part, lst in pieces.items():
        V, F = _join(lst)
        W = V @ R.T + p
        world[part] = (W, F)
        allv.append(W)
    allv = np.vstack(allv)
    far = float(np.max(np.linalg.norm(allv - p, axis=1)))
    if far > radius + 1e-6:
        raise ValueError(f"{oid}：幾何超出碰撞半徑（{far:.4f} > {radius}）")
    center = (allv.min(0) + allv.max(0)) / 2
    root = C.new_instance(oid, tuple(float(x) for x in center))
    order = ["main", "cut"] + [k for k in world if k not in ("main", "cut")]
    for part in order:
        if part not in world:
            continue
        W, F = world[part]
        obj = _make_obj(f"{root.name}_{part}", W, F)
        C.add_part(root, obj, part)
        if part == "core":
            obj.data.shade_flat()  # 結晶核稜角分明，與周圍圓潤的外殼形成對比
    return root


# ----------------------------------------------------------------------------
# 葉綠體
# ----------------------------------------------------------------------------
def _chloro_disp(rng):
    ph = [rng.uniform(0, 6.28) for _ in range(3)]
    a = np.array(CHLORO_AXES)

    def f(P):
        u = P / a
        g = (
            0.5 * np.sin(6.0 * u[:, 0] + 2.0 * u[:, 2] + ph[0])
            + 0.3 * np.sin(5.0 * u[:, 1] - 3.0 * u[:, 0] + ph[1])
            + 0.2 * np.sin(9.0 * u[:, 2] + 4.0 * u[:, 1] + ph[2])
        )
        return P * (1.0 - 0.025 * (0.5 + 0.5 * g))[:, None]  # 只往內縮，不超出碰撞半徑

    return f


def _disc():
    """一片圓盤（軸沿 z、中心在原點）：圓潤的邊。"""
    R, h = GRANA_R, GRANA_H
    prof = [(0.0, h, True)]
    for a in np.radians(np.arange(90, -91, -30)):
        prof.append((R - h + h * math.cos(a), h * math.sin(a), False))
    prof.append((0.0, -h, True))
    st = [((0, 0, z), (1, 0, 0), (0, 1, 0), r, r, pole) for r, z, pole in prof]
    V, ctr, F, _ = _tube(st, 20, False)
    F = _orient_outward(V, F, ctr)
    return V, F


def _ry(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _grana():
    dV, dF = _disc()
    parts = []
    axes = []
    for x, y, t, dz in GRANA_LAYOUT:
        Ry = _ry(t)
        ctr = np.array([x, y, dz])
        axes.append((ctr, Ry @ np.array([0, 0, 1.0])))
        for k in range(GRANA_N):
            zk = (k - (GRANA_N - 1) / 2) * GRANA_PITCH
            parts.append(((dV + np.array([0, 0, zk])) @ Ry.T + ctr, dF))
    # 疊與疊之間的細薄片（沿 x 順序連成一串，高度交錯）
    levels = [1, 4, 2, 3, 1]
    for i in range(len(axes) - 1):
        zl = (levels[i] - (GRANA_N - 1) / 2) * GRANA_PITCH
        P0 = axes[i][0] + axes[i][1] * zl
        P1 = axes[i + 1][0] + axes[i + 1][1] * zl
        e = P1 - P0
        L = float(np.linalg.norm(e))
        e = e / L
        thin = _unit(np.array([0, 0, 1.0]) - e * e[2])
        wide = np.cross(e, thin)
        Rr = np.column_stack([e, thin, wide])
        st = _ell_stations((L / 2 + 0.01, 0.0065, 0.03), None, 10)
        V, ctr, F, _ = _tube(st, 14, False)
        F = _orient_outward(V, F, ctr)
        parts.append((V @ Rr.T + (P0 + P1) / 2, F))
    return _join(parts)


def _check_grana():
    a, b, c = (ax - CHLORO_WALL for ax in CHLORO_AXES)
    for x, y, t, dz in GRANA_LAYOUT:
        Ry = _ry(t)
        for k in range(GRANA_N):
            zk = (k - (GRANA_N - 1) / 2) * GRANA_PITCH
            for de, r in ((0.0, GRANA_R), (GRANA_H, GRANA_R - GRANA_H), (-GRANA_H, GRANA_R - GRANA_H)):
                ph = np.linspace(0, 2 * math.pi, 48, endpoint=False)
                loc = np.stack([r * np.cos(ph), r * np.sin(ph), np.full_like(ph, zk + de)], axis=1)
                P = loc @ Ry.T + np.array([x, y, dz])
                f = (P[:, 0] / a) ** 2 + (P[:, 1] / b) ** 2 + (P[:, 2] / c) ** 2
                if f.max() > 0.985 or P[:, 1].max() > CHLORO_CUT_Y - 0.003:
                    raise ValueError("葉綠餅排列超出葉綠體內襯")


def _chloroplast_pieces(rng, cut):
    disp = _chloro_disp(rng)
    if not cut:
        main, _ = _shell(_ell_stations(CHLORO_AXES, None, 26), None, 44, False, disp)
        return {"main": [main]}
    outer = _ell_stations(CHLORO_AXES, CHLORO_CUT_Y, 26)
    inner = _ell_stations(CHLORO_AXES, CHLORO_CUT_Y, 26, wall=CHLORO_WALL)
    main, cutm = _shell(outer, inner, 44, False, disp, y_fix=CHLORO_CUT_Y)
    _check_grana()
    return {"main": [main], "cut": [cutm], "grana": [_grana()]}


# ----------------------------------------------------------------------------
# 粒線體
# ----------------------------------------------------------------------------
class _MitoShape:
    """略彎的膠囊：中心線在 x-z 平面內彎曲（彎的程度與方向由 a1、a2 決定），半徑沿長度略有起伏。"""

    def __init__(self, a1, a2, phase):
        LH = MITO_HALF_STRAIGHT
        s = np.linspace(-LH, LH, 600)
        th = a1 * s + a2 * s * s
        x = np.concatenate([[0.0], np.cumsum((np.cos(th[1:]) + np.cos(th[:-1])) / 2 * np.diff(s))])
        z = np.concatenate([[0.0], np.cumsum((np.sin(th[1:]) + np.sin(th[:-1])) / 2 * np.diff(s))])
        self.s, self.th = s, th
        self.x = x - np.interp(0.0, s, x)
        self.z = z - np.interp(0.0, s, z)
        self.phase = phase

    def frame(self, sv):
        th = float(np.interp(sv, self.s, self.th))
        c = np.array([np.interp(sv, self.s, self.x), 0.0, np.interp(sv, self.s, self.z)])
        T = np.array([math.cos(th), 0.0, math.sin(th)])
        N = np.array([-math.sin(th), 0.0, math.cos(th)])
        return c, T, N, np.array([0.0, 1.0, 0.0])

    def radius(self, sv):
        LH = MITO_HALF_STRAIGHT
        u = (sv + LH) / (2 * LH)
        return MITO_R * (1.0 - 0.09 * (0.5 + 0.5 * math.sin(2 * math.pi * 1.3 * u + self.phase)))

    def stations(self, wall, ncen=19, ncap=8):
        LH = MITO_HALF_STRAIGHT
        st = []
        c0, T0, N0, B = self.frame(-LH)
        Re = self.radius(-LH) - wall
        for k in range(ncap, 0, -1):
            al = (math.pi / 2) * k / ncap
            st.append((c0 - T0 * Re * math.sin(al), N0, B, Re * math.cos(al), Re * math.cos(al), k == ncap))
        for sv in np.linspace(-LH, LH, ncen):
            c, T, N, B = self.frame(sv)
            r = self.radius(sv) - wall
            st.append((c, N, B, r, r, False))
        c1, T1, N1, B = self.frame(LH)
        Re = self.radius(LH) - wall
        for k in range(1, ncap + 1):
            al = (math.pi / 2) * k / ncap
            st.append((c1 + T1 * Re * math.sin(al), N1, B, Re * math.cos(al), Re * math.cos(al), k == ncap))
        return st


def _plate(shape, sv, top, ph, thick=0.014, nA=12, nB=10):
    """一片從內壁伸進來的波浪狀隔板（嵴）。top=True 從 +z 側伸入，否則從 -z 側。"""
    c, T, N, B = shape.frame(sv)
    ri = shape.radius(sv) - MITO_WALL
    ext = ri + 0.006  # 根部略微嵌進內襯，避免縫隙
    zc = -0.28 * ri if top else 0.28 * ri
    zend = ext if top else -ext
    Vs, front, back = [], [], []

    def mid(y, z):
        w = 0.016 * math.sin(2 * math.pi * 1.25 * z / ri + ph) + 0.008 * math.sin(2 * math.pi * 1.6 * y / ri + 0.7 * ph)
        return c + N * z + B * y + T * w

    for ia in range(nA + 1):
        z = zc + (zend - zc) * ia / nA
        hy = math.sqrt(max(ext * ext - z * z, 0.0))
        if ia == nA:
            m = mid(-0.004, z)
            Vs.append(m + T * thick / 2)
            Vs.append(m - T * thick / 2)
            front.append([len(Vs) - 2] * (nB + 1))
            back.append([len(Vs) - 1] * (nB + 1))
            continue
        rf, rb = [], []
        for ib in range(nB + 1):
            m = mid(-0.004 - hy * ib / nB, z)
            Vs.append(m + T * thick / 2)
            rf.append(len(Vs) - 1)
            Vs.append(m - T * thick / 2)
            rb.append(len(Vs) - 1)
        front.append(rf)
        back.append(rb)
    V = np.array(Vs)
    cen = V.mean(0)

    def grid(g):
        out = []
        for ia in range(nA):
            for ib in range(nB):
                f = _quad(g[ia][ib], g[ia][ib + 1], g[ia + 1][ib + 1], g[ia + 1][ib])
                if f:
                    out.append(f)
        return out

    Ff = _orient(V, grid(front), lambda f, c_: T)
    Fb = _orient(V, grid(back), lambda f, c_: -T)
    rim_a = [_quad(front[0][ib], front[0][ib + 1], back[0][ib + 1], back[0][ib]) for ib in range(nB)]
    rim_y = [_quad(front[ia][0], front[ia + 1][0], back[ia + 1][0], back[ia][0]) for ia in range(nA)]
    rim_w = [_quad(front[ia][nB], front[ia + 1][nB], back[ia + 1][nB], back[ia][nB]) for ia in range(nA)]
    out = []
    for grp in (rim_a, rim_y, rim_w):
        grp = [f for f in grp if f]
        out += _orient(V, grp, lambda f, c_: c_ - cen)
    return V, Ff + Fb + out


def _mito_pieces(rng, shape, cut):
    if not cut:
        V, ctr, F, _ = _tube(shape.stations(0.0, ncen=17, ncap=8), 32, False)
        return {"main": [(V, _orient_outward(V, F, ctr))]}
    main, cutm = _shell(shape.stations(0.0), shape.stations(MITO_WALL), 28, True, None)
    plates = []
    LH = MITO_HALF_STRAIGHT - 0.005
    n = 9
    for i in range(n):
        sv = -LH + 2 * LH * i / (n - 1)
        plates.append(_plate(shape, sv, i % 2 == 0, rng.uniform(0, 6.28)))
    return {"main": [main], "cut": [cutm], "cristae": [_join(plates)]}


# ----------------------------------------------------------------------------
# 過氧化體
# ----------------------------------------------------------------------------
def _perox_disp(rng):
    K = 150
    D = np.array([[rng.gauss(0, 1) for _ in range(3)] for _ in range(K)])
    D /= np.linalg.norm(D, axis=1, keepdims=True)
    sig2 = 0.125 ** 2

    def f(P):
        n = np.linalg.norm(P, axis=1, keepdims=True)
        u = P / np.where(n > 1e-9, n, 1.0)
        bump = np.exp(-(1.0 - np.clip(u @ D.T, -1, 1)) / sig2).sum(axis=1)
        return P * (1.0 + 0.022 * np.clip(bump - 0.9, -0.9, 2.0))[:, None]

    return f


def _crystal(rng):
    """稜角分明的六角柱加尖頂結晶（局部座標，略不規則）。回傳 (頂點, 面)。"""
    R, H, tip = 0.05, 0.05, 0.04
    off = rng.uniform(0, 1.0)
    top, bot = [], []
    for k in range(6):
        a = off + k * math.pi / 3
        jt, jb = 1 + rng.uniform(-0.08, 0.08), 1 + rng.uniform(-0.08, 0.08)
        top.append((R * jt * math.cos(a), H + rng.uniform(-0.008, 0.008), R * jt * math.sin(a)))
        bot.append((R * jb * math.cos(a), -H + rng.uniform(-0.008, 0.008), R * jb * math.sin(a)))
    V = np.array(top + bot + [(0.0, H + tip, 0.0), (0.0, -H - tip, 0.0)])
    F = []
    for k in range(6):
        k2 = (k + 1) % 6
        F.append([k, k2, 6 + k2, 6 + k])
        F.append([12, k2, k])
        F.append([13, 6 + k, 6 + k2])
    ctr = V.mean(0)
    out = []
    for f in F:
        P = V[f]
        out.append(f if np.dot(_face_normal(P), P.mean(0) - ctr) > 0 else f[::-1])
    return V, out


def _perox_pieces(rng, cut):
    disp = _perox_disp(rng)
    axes = (PEROX_R, PEROX_R, PEROX_R)
    if not cut:
        main, _ = _shell(_ell_stations(axes, None, 32), None, 60, False, disp)
        return {"main": [main]}
    main, cutm = _shell(
        _ell_stations(axes, 0.0, 32), _ell_stations(axes, 0.0, 32, wall=PEROX_WALL), 60, False, disp, y_fix=0.0
    )
    cV, cF = _crystal(rng)
    # 長軸大致橫躺（與剖面法線夾 65 到 90 度），從剖面看得到柱面與尖頂
    tilt = math.radians(rng.uniform(65, 90))
    Rx = np.array([[1, 0, 0], [0, math.cos(tilt), -math.sin(tilt)], [0, math.sin(tilt), math.cos(tilt)]])
    cV = cV @ (_ry(rng.uniform(0, 2 * math.pi)) @ Rx).T
    cV = cV + np.array([0.0, -0.006 - cV[:, 1].max(), 0.0])
    if np.max(np.linalg.norm(cV, axis=1)) > PEROX_R - PEROX_WALL - 0.01:
        raise ValueError("結晶核超出過氧化體內襯")
    return {"main": [main], "cut": [cutm], "core": [(cV, cF)]}


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def _outward(p):
    """細胞膜方向（cavity_sdf 增加最快的方向，單位向量）。"""
    g = np.zeros(3)
    for k in range(3):
        e = np.zeros(3)
        e[k] = 1e-3
        g[k] = C.cavity_sdf(np.asarray(p) + e) - C.cavity_sdf(np.asarray(p) - e)
    return _unit(g)


def _flat_frame(rng, p):
    """扁的那面（局部 z）朝向最近的細胞膜，長軸繞該法線隨機轉。"""
    z = _outward(p)
    helper = np.array([1.0, 0, 0]) if abs(z[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = _unit(np.cross(z, helper))
    e2 = np.cross(z, e1)
    a = rng.uniform(0, 2 * math.pi)
    x = math.cos(a) * e1 + math.sin(a) * e2
    return np.column_stack([x, np.cross(z, x), z])


def build(ctx):
    rng = ctx.rng
    rep = C.REP_POS

    # 1. 三個代表個體（剖面朝向預設鏡頭、不隨機轉向）
    ctx.reserve("chloroplast", rep["chloroplast"], CHLORO_RADIUS)
    _emit("chloroplast", rep["chloroplast"], _camera_frame(), CHLORO_RADIUS, _chloroplast_pieces(rng, True))
    shape = _MitoShape(1.35, 0.0, 0.6)
    ctx.reserve("mitochondrion", rep["mitochondrion"], MITO_RADIUS)
    _emit("mitochondrion", rep["mitochondrion"], _camera_frame(), MITO_RADIUS, _mito_pieces(rng, shape, True))
    ctx.reserve("peroxisome", rep["peroxisome"], PEROX_RADIUS)
    _emit("peroxisome", rep["peroxisome"], _camera_frame(), PEROX_RADIUS, _perox_pieces(rng, True))

    # 2. 葉綠體：其餘 9 個，掀開區內 3 個（1 個剖開）、區外 6 個；只放在皮層
    cortex = lambda p: -C.cavity_sdf(p) <= ACCEPT_CORTEX  # noqa: E731
    plan = [(True, True), (True, False), (True, False)] + [(False, False)] * 6
    for want_cut, is_cut in plan:
        p = ctx.sample_free(CHLORO_RADIUS, want_cut, accept=cortex)
        ctx.reserve("chloroplast", p, CHLORO_RADIUS)
        R = _camera_frame(rng) if is_cut else _flat_frame(rng, p)
        _emit("chloroplast", p, R, CHLORO_RADIUS, _chloroplast_pieces(rng, is_cut))

    # 3. 粒線體：其餘 7 個，掀開區內 3 個、區外 4 個；各有不同的彎法
    for want_cut in [True] * 3 + [False] * 4:
        p = ctx.sample_free(MITO_RADIUS, want_cut)
        ctx.reserve("mitochondrion", p, MITO_RADIUS)
        sgn = rng.choice((-1.0, 1.0))
        shape = _MitoShape(sgn * rng.uniform(0.8, 1.7), rng.uniform(-1.6, 1.6), rng.uniform(0, 6.28))
        _emit("mitochondrion", p, _rand_rot(rng), MITO_RADIUS, _mito_pieces(rng, shape, False))

    # 4. 過氧化體：其餘 4 個，掀開區內 1 個、區外 3 個
    for want_cut in [True] + [False] * 3:
        p = ctx.sample_free(PEROX_RADIUS, want_cut)
        ctx.reserve("peroxisome", p, PEROX_RADIUS)
        _emit("peroxisome", p, _rand_rot(rng), PEROX_RADIUS, _perox_pieces(rng, False))

    tris = 0
    for o in bpy.data.objects:
        if o.type == "MESH":
            tris += sum(len(q.vertices) - 2 for q in o.data.polygons)
    print(f"[energy] 三角面 {tris}")
