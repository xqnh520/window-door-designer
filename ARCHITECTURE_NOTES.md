# 门窗设计软件 — Konva 画布架构优化笔记

> 记录日期：本次迭代
> 范围：`apps/web/src/canvas/` 下全部架构缺陷清理与重构
> 验证：类型检查 ✅ / 构建 ✅ / 测试 7/7 ✅

---

## 一、优化背景

基于对 `apps/web/src/canvas/` 的架构审查，发现以下四类边界问题：

| 编号 | 层 | 问题 |
|---|:---:|---|
| M1-M4 | 数据模型层 | `ShapeModel` 缺 `frameWidth/seriesId/glassInset` 语义字段；内腔边界硬编码在 Controller；sash 写入无校验 |
| T2/T5 | 工具交互层 | 工具无法获取业务上下文（系列/框宽）；拾取逻辑三套并存（hitShape/hostAt/selectAtScreen） |
| C1-C3 | 渲染组件层 | CasementWindow/FixedWindow 使用绝对坐标；组件内嵌交互系统与标注，职责混乱 |
| K1-K9 | 控制器层 | 重复方法声明、定位策略不一致导致图形不显示、死代码残留 |

核心断层：`frameWidth` 只存在于控制器单例状态，**不经过模型**——工具层读不到、撤销/重做无法还原、切换系列无法级联更新。

---

## 二、本次优化内容

### M1-M4：数据模型层（`canvas/model.ts`）

**新增语义字段**（`ShapeModel`）：
```ts
seriesId?: string;   // 型材系列 ID
frameWidth?: number; // 型材宽度 mm
glassInset?: number; // 玻璃内缩量 mm
```

**新增 `calcInnerBox(m)`**：根据 `bbox + frameWidth` 动态计算内腔边界，替代 Controller 硬编码
```ts
export function calcInnerBox(m: ShapeModel): Box {
  const fw = m.frameWidth ?? 60;
  return { x: fw, y: fw, w: Math.max(0, m.bbox.w - fw*2), h: Math.max(0, m.bbox.h - fw*2) };
}
```

**新增 `validateAndAddSash(m, sash)`**：写入前校验扇区矩形是否完全在宿主内腔范围内，越界拒绝并告警。
```ts
export function validateAndAddSash(m: ShapeModel, sash: SashData): boolean {
  // 校验 rect 是否在 calcInnerBox(m) 范围内 → 越界返回 false
  // 通过则 push 到 m.sashes 并返回 true
}
```

**`buildModel` 新增 `defaults` 参数**，支持创建时注入系列/框宽/玻璃内缩量，模型自描述：
```ts
export function buildModel(type, a, b, defaults?: {
  seriesId?: string; frameWidth?: number; glassInset?: number;
}): ShapeModel
```

**`cloneModel` 同步深拷贝**新字段（含 sashes 深拷贝）。

### T2：工具层上下文传递（`canvas/tools/`）

**`DragDrawTool` 新增 `CreateContext`**，绘制工具可在创建模型时读取业务上下文：
```ts
export interface CreateContext {
  seriesId: string;
  frameWidth: number;
  glassInset: number;
}
protected abstract create(a: Pt, b: Pt, context: CreateContext): ShapeModel;
```

**全部工具子类更新**：RectTool / TrapezoidTool / GothicArchTool / ArchTool / LineTool / TextTool 的 `create` 均接收 context 并传给 `buildModel`。

**`CanvasController` 新增三个 getter**：
- `getCurrentSeriesId()` → 当前选中图形的 seriesId，无选中返回 `'series-60'`
- `getFrameWidth()` → `this.frameW`
- `getGlassInset()` → `GLASS_INSET` 常量

### T5：统一拾取管道（`canvas/hitTest.ts`）

新增单一拾取函数，替代三套独立逻辑：
```ts
export interface HitResult { id: string; model: ShapeModel; node: Konva.Group }
export interface HitFilter  { type?: string | string[] }

export function hitTest(
  models: ShapeModel[],
  stage: Konva.Stage,
  screenPt: Pt,
  filter?: HitFilter
): HitResult | null
```
- 从交集点**向上遍历父节点**查找 `wdd-shape` 标记（支持嵌套容器）
- 支持 `filter.type` 类型过滤（替代 hostAt 的 rect 过滤）
- `CanvasController.hitShape` / `hostAt` 内部统一调用 `hitTest`

### C1-C3：组件纯局部坐标改造（`canvas/components/`）

**`CasementWindow`** 重写为**纯视觉组件**：
- C1：移除绝对坐标 `x/y` 参数，删除 `root` Group 与 `origin` 字段，所有子元素直接挂 `this`，从 `(0,0)` 起绘
- C2：剥离全部交互系统（选中高亮 buildHighlight / 手柄 buildHandles / AI 菜单 buildMenu / select/deselect）
- C3：删除 `buildDims()` 与 `refreshHandleDim()`，标注统一由 `annotationLayer` 管理
- 新增外部驱动接口：`setSide / setOpenDir / setLabel`
- 保留渲染内容：外框（45°拼角线）+ 内扇 + 开启三角形 + 把手 + 扇位标注

**`FixedWindow`**：
- `x/y` 改为可选参数，构造函数不再执行 `this.x(opts.x); this.y(opts.y)`
- 子元素全部相对 `(0,0)` 局部坐标绘制

### 控制器层清理（K 系列）

- **K5/K6 定位统一**：`buildGroup` 改为 `const g = new Konva.Group({ x: b.x, y: b.y })`——父级 Group 持有绝对位置，子节点（含组件）全部使用局部坐标
- **K1-K4 重复方法清理**：删除重复的 `select()`、`rebuildNode()`、`beginEdgeDrag()`、`applyEdgeMove()`，以及 SelectedState 组件与其全部引用
- **K9 死代码清理**：删除注释掉的旧 `buildGroup`、旧 `activateTool` 及其它残留注释
- `hitShape` 从 private 改为 public，供 SelectTool 调用

---

## 三、架构现状（优化后）

### 数据流（新）

```text
用户点击「固定窗」工具拖拽
  → DragDrawTool.onMouseUp
    → getCreateContext(c) 读取系列
      → buildModel('rect', a, b, context) → ShapeModel 含 seriesId/frameWidth/glassInset
        → addModel → rebuildNode
          → buildGroup 父级 Group 定位(g.position=b.x,b.y)，FixedWindow 局部坐标渲染

用户点击「平开扇」工具
  → OpenWindowTool.onMouseDown → hostAt(pos) → 统一 hitTest({type:'rect'}) 命中宿主
    → setHost → 缓存内腔
      → onMouseMove → toHostLocal → clampToInner 约束
        → onMouseUp → addSashToModel
          → validateAndAddSash 校验 → 写入 sashes
```

### 职责边界（优化后）

| 层 | 职责 |
|---|---|
| `model.ts` | 数据自描述（bbox + frameWidth + seriesId + sashes）、纯函数（calcInnerBox / validateAndAddSash / sampleOutline） |
| `components/` | 纯视觉渲染，局部坐标 (0,0) 起绘，无交互、无定位、无标注 |
| `tools/` | 从 Controller 读取业务上下文 → 创建带业务字段的模型；统一经 hitTest 拾取 |
| `CanvasController` | 定位唯一所有权（g.position）、事件分发、拾取管道、标注层、历史/撤销 |

### 关键文件清单

| 文件 | 变更 |
|---|---|
| `canvas/model.ts` | +seriesId/frameWidth/glassInset、calcInnerBox、validateAndAddSash、buildModel defaults |
| `canvas/hitTest.ts` | 新建统一拾取管道 |
| `canvas/CanvasController.ts` | 定位统一、getter、hitTest 接入、重复方法清除、死代码清除 |
| `canvas/tools/DragDrawTool.ts` | +CreateContext |
| `canvas/tools/*.ts`（6 个工具） | create 接收 context |
| `canvas/components/CasementWindow.ts` | 重写为纯视觉组件 |
| `canvas/components/FixedWindow.ts` | 移除绝对定位 |

---

## 四、遗留事项（可选，非阻塞）

- [ ] `buildGroup` 对 rect 使用 FixedWindow、对其它面积图形使用 outline 填充——两种渲染路径可进一步统一
- [ ] `OpenWindowTool` 缓存 `this.inner` 在宿主 resize 后可能过期，可改为每次实时调用 `calcInnerBox`
- [ ] `addSashToModel` 仍走全量 `rebuildNode`，可引入增量扇区同步（脏标记）
- [ ] `SelectedState.ts` 文件已无引用，可删除或改造为控制器内非 Transformer 的选中态视觉层

---

## 五、验证

```bash
npm run typecheck  # ✅ 全部工作区通过
npm run build      # ✅ schema + core + web，3273 模块
npm test           # ✅ 7/7 通过（BOM / 报价 / 几何）
```