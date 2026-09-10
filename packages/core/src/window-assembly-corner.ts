import type { WindowBox } from './window-tree.js';

/**
 * 转角拼接（M2）纯几何层：把「链上各段的夹角」换算成每个单元的**显示变换**（刚体旋转+平移）。
 *
 * 空间分离不变式（务必遵守）：
 * - layoutAssembly 的 trees/units/combiners/bbox 是**加工空间（展开态）**，永不旋转，喂 BOM/校验/下料。
 * - 本模块产出的 UnitPlacement 是**显示空间**，唯一消费者是 2D 渲染器 / 编辑器叠加层与指针逆变换 / 3D。
 * - angleDeg=180 ⇒ 每段 deflection=0 ⇒ 所有 placement 恒等 ⇒ 显示空间 ≡ 加工空间 ≡ M1b 行为。
 *
 * 链式前向运动学：unit0 恒等；unit_i 由 unit_{i-1} 的显示变换再「绕铰点 Q_i 转 δ_i」得到，
 * 铰点是整条链的不动点，因此上游几何永不移动。D_i(p) = R(θ_i)·p + b_i。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 单元显示变换：display = R(rotationDeg)·unfolded + translate（度，屏幕 y 向下、顺时针为正，与 Konva 一致） */
export interface UnitPlacement {
  rotationDeg: number;
  translate: Vec2;
}

export const IDENTITY_PLACEMENT: UnitPlacement = { rotationDeg: 0, translate: { x: 0, y: 0 } };

/** 预设夹角（度）：180=直线拼樘，135/90=转角。仅 axis==='x' 生效 */
export const CORNER_ANGLE_PRESETS: readonly number[] = [180, 135, 90];
export const DEFAULT_CORNER_ANGLE_DEG = 180;

export const COMBINER_LABEL = '拼樘料';
export const CORNER_LABEL = '转角料';

/** 张开方向：-1=第二腿朝屏幕**右上**张开（δ<0：腿的 +x 轴转到向上、+y 轴转到向右）；+1=镜像到左下 */
export const CORNER_TURN_SIGN = -1;

/** 归一化夹角：非 axis==='x' 或非预设值（含旧数据缺字段）一律回落到 180，永不产生非法角度 */
export function normalizeAngleDeg(c: { axis: 'x' | 'y'; angleDeg?: number }): number {
  if (c.axis !== 'x') return DEFAULT_CORNER_ANGLE_DEG;
  const v = c.angleDeg ?? DEFAULT_CORNER_ANGLE_DEG;
  return (CORNER_ANGLE_PRESETS as readonly number[]).includes(v) ? v : DEFAULT_CORNER_ANGLE_DEG;
}

export function isCornerCombiner(c: { axis: 'x' | 'y'; angleDeg?: number }): boolean {
  return normalizeAngleDeg(c) !== DEFAULT_CORNER_ANGLE_DEG;
}

/** 显示名：转角→「转角料」，直线→「拼樘料」 */
export function combinerDisplayLabel(c: { axis: 'x' | 'y'; angleDeg?: number }): string {
  return isCornerCombiner(c) ? CORNER_LABEL : COMBINER_LABEL;
}

/** 该拼樘段相对上一腿的偏转角（度）：180⇒0，135⇒∓45，90⇒∓90 */
export function jointDeflectionDeg(angleDeg: number): number {
  return CORNER_TURN_SIGN * (DEFAULT_CORNER_ANGLE_DEG - angleDeg);
}

const DEG = Math.PI / 180;

/** 标准旋转矩阵（与 Konva ctx.rotate 同向）：x'=x·cos−y·sin，y'=x·sin+y·cos */
export function rotateDeg(p: Vec2, deg: number): Vec2 {
  const r = deg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

export function applyPlacement(p: UnitPlacement, v: Vec2): Vec2 {
  const r = rotateDeg(v, p.rotationDeg);
  return { x: r.x + p.translate.x, y: r.y + p.translate.y };
}

/** 逆变换：display 点 → 展开态点（指针拾取/拖拽用） */
export function invertPlacement(p: UnitPlacement, v: Vec2): Vec2 {
  const d = { x: v.x - p.translate.x, y: v.y - p.translate.y };
  return rotateDeg(d, -p.rotationDeg);
}

/** 仅方向向量的逆旋转（拖拽增量用，不含平移） */
export function invertDelta(p: UnitPlacement, d: Vec2): Vec2 {
  return rotateDeg(d, -p.rotationDeg);
}

export function aabb(points: Vec2[]): WindowBox {
  if (points.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 旋转后矩形的外接 AABB（仅用于显示外接，绝不回喂 BOM） */
export function transformBox(p: UnitPlacement, b: WindowBox): WindowBox {
  return aabb([
    applyPlacement(p, { x: b.x, y: b.y }),
    applyPlacement(p, { x: b.x + b.w, y: b.y }),
    applyPlacement(p, { x: b.x, y: b.y + b.h }),
    applyPlacement(p, { x: b.x + b.w, y: b.y + b.h }),
  ]);
}

/** 铰点（展开态坐标）+ 该段偏转角；joints[0] 为锚，deflectionDeg 必为 0 */
export interface JointKinematic {
  pivotUnfolded: Vec2;
  deflectionDeg: number;
}

/**
 * 前向运动学链合成。返回长度 = joints.length 的 placement 数组（下标与 units 对齐）。
 * unit0 恒等；unit_i = Rot(Q_i, δ_i) ∘ unit_{i-1}，Q_i 为铰点的 display 位置（不动点）。
 * 递推：θ_i = θ_{i-1}+δ_i；b_i = R(δ_i)·b_{i-1} + (I − R(δ_i))·Q_i。
 */
export function composePlacementChain(joints: JointKinematic[]): UnitPlacement[] {
  const out: UnitPlacement[] = [];
  let theta = 0;
  let b: Vec2 = { x: 0, y: 0 };
  for (let i = 0; i < joints.length; i++) {
    if (i === 0) {
      out.push({ rotationDeg: 0, translate: { x: 0, y: 0 } });
      continue;
    }
    const delta = joints[i].deflectionDeg;
    const upstream: UnitPlacement = { rotationDeg: theta, translate: b };
    const Q = applyPlacement(upstream, joints[i].pivotUnfolded); // 铰点 display 位置
    const rb = rotateDeg(b, delta);
    const rQ = rotateDeg(Q, delta);
    const newb: Vec2 = { x: rb.x + (Q.x - rQ.x), y: rb.y + (Q.y - rQ.y) };
    theta = theta + delta;
    b = newb;
    out.push({ rotationDeg: theta, translate: b });
  }
  return out;
}

/** 载入旧数据时补齐 angleDeg（归一化），保证缺字段/非法值回落到 180。泛型以兼容 WindowAssembly 结构 */
export function withDefaultAngles<
  T extends { combiners: Array<{ axis: 'x' | 'y'; angleDeg?: number }> },
>(a: T): T {
  return { ...a, combiners: a.combiners.map((c) => ({ ...c, angleDeg: normalizeAngleDeg(c) })) };
}
