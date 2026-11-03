# 设计区绘图 评审与修复交接文档

> 生成日期：2026-09-13
> 用途：把「设计区绘图」评审结论转成**可执行任务**，交给后续 AI 工具或工程师逐项修复。
> 可信度：所有 P0/P1 结论都在本仓库代码中逐行核对过，其中撤销失效问题用 node 临时脚本**实测复现**（脚本验证后已删除），文中给出复现方法。涉及的国标/行标条文（GB/T 50104、JGJ 214-2010、JGJ 113 等）于 2026-09-13 实网核验，出处见 §9.3；未能核验的条目已明确标注。
> 补录（2026-09-13）：§5.5「绘图规范性核对（构件绘制 vs 真实门窗图）」为同轮补录，逐条对拍 `window-tree-render.ts` / `window-assembly-render.ts` / `tree-editor.ts` / `palette.ts` / `TreeEditorCanvas.tsx` 的实际画法，新增 T21–T25。
> 阅读顺序：先读 §0（接手须知）→ §1（任务总览）→ 按优先级读 §2 起各任务（含 §5.5 补录）→ §6（验证手段）→ §8（禁止事项）。

---

## 0. 接手须知

### 0.1 技术栈与目录

npm workspaces monorepo：

| 路径 | 说明 |
|---|---|
| `packages/schema` (@wdd/schema) | zod 数据模型：`SeriesSpec`/`ProfileSpec`/`DesignModel`/`WindowTree` 等 |
| `packages/core` (@wdd/core) | 纯几何 + 业务：`outline.ts`（多边形裁剪/内缩）、`window-tree.ts`（容器树模型）、`window-tree-render.ts`（Konva 渲染）、`window-tree-describe.ts`（纯数据描述）、`window-assembly.ts`（拼樘/转角）、`bom*.ts`、`cutting.ts`、`quote*.ts`、`geometry.ts`（legacy） |
| `apps/web` | React + antd + zustand + Konva。设计区控制器 `src/canvas/tree-editor.ts`，状态 `src/store.ts`，界面 `src/components/studio/*` |
| `apps/desktop` / `apps/server` | Electron / NestJS，非本次范围 |

**设计区调用链**（务必先读懂再动手）：

```
store.assembly (WindowAssembly，权威数据)
  └─ store.windowTree = deriveFocused() 里 layoutAssembly(...).trees.get(focusId) 烘焙出的「聚焦单元镜像」
        └─ TreeEditorCanvas (React) → TreeEditorController (tree-editor.ts)
              ├─ layoutTree(tree, {installGap})        // 世界 mm 布局
              ├─ describeWindowTree(tree, installGap)  // 纯数据 TreeRenderElement[]
              ├─ renderWindowTree(...)                 // Konva 节点树
              └─ onChange(newTree) → store.setFocusedTree → coreSetUnitTree(assembly, ...) → deriveFocused
```

### 0.2 常用命令

```bash
npm run typecheck            # 全仓类型检查（必跑）
npm test                     # = npm run test --workspace @wdd/core
                             #   core 的测试跑在 dist 上：它内部先 build 再 node --test dist/test/*.test.js
npm run build                # schema → core → web
npm run dev                  # 构建 schema+core 后起 web dev server
```

单测文件在 `packages/core/test/*.test.ts`（26 个，`node:test` + `assert`）。**改 core 后必须跑 `npm test`**。

### 0.3 权威模型一句话说明

- 树模型：`WindowTree.root` 是 `WindowTreeArea`（比例坐标 xr/yr/wr/hr）；容器区 `children: [area, muntin, area, muntin, ...]`；叶子区挂 `sash`（`WindowSashSpec`：windowType/hingeSide/openDirection/leaves/infill/roleType…）。
- 布局：`layoutTree(tree, { installGap, ... })` 返回 `{ frame: WindowBox, boxes: Map<节点id, WindowBox> }`（世界 mm，原点=洞口左上）。几何规则集中在它的注释里：**外框外轮廓 = 洞口内缩 installGap；内腔 = 外框再缩 frameWidthMm；root 区域即内腔；中梃按厚度占位**。洞口矩形可由 `frame` 反推（`frame.x - installGap` 等），T3 的派生尺寸就从这里取。
- 另有 `layoutContours`（异形/缺边轮廓）与 `layoutAssembly`（多单元拼樘/转角，产出各单元烘焙树）。
- 所有几何尺寸关系**只应有一处公式**；当前存在多套（见 §2 T3/T4）。

### 0.4 调试陷阱（前次已踩，勿重复）

1. **不要** `import ... from './packages/core/dist/src/index.js'` 写 node 脚本——`index.js` 会拉入 `window-tree-render.ts` → `konva` → konva 的 node 入口需要 `canvas` 包，报 `Cannot find module 'canvas'`。请改为按需 import 具体模块（如 `dist/src/window-tree.js`、`dist/src/window-assembly.js`）。
2. 画布世界坐标换算：`worldPoint() = (pointer - stage.pos) / scale`；反算 `toScreen()`。改动缩放/平移（T5）时这两个函数必须同步改。
3. `tree-editor.ts` 里 `INSTALL_GAP` 是**常量**，改 T2 时要全局替换，不要局部改。

---

## 1. 任务总览

| ID | 优先级 | 任务 | 主要文件 | 预估 |
|---|---|---|---|---|
| T1 | **P0** | 撤销/重做对结构编辑失效 | `store.ts`, `window-assembly.ts` | 0.5d |
| T2 | **P0** | `installGap` 硬编码 20，忽略 `series.installGap` | `tree-editor.ts`(20处), `store.ts`, `DesignStudio.tsx` | 0.5d |
| T3 | **P0** | 洞口/外框尺寸三个数据源（面板/画布/导出互相打架） | `store.ts`, `exportPdf.ts`, `DesignStudio.tsx` | 1d |
| T4 | **P0** | 玻璃尺寸无单一公式，且设计区不显示玻璃净尺寸 | `geometry.ts`, `bom-design-model.ts`, `window-tree-render.ts` | 1.5d |
| T5 | **P0** | 缩放不锚定指针、无法平移、resize 复位视图 | `tree-editor.ts` | 1d |
| T6 | **P0** | 导出图含选中高亮/标注/预览 | `tree-editor.ts`, `DesignStudio.tsx` | 0.5d |
| T7 | P1 | 无尺寸链（洞口/框/分格/玻璃分层标注） | `tree-editor.ts`, `window-tree-describe.ts` | 2d |
| T8 | P1 | 拖动中梃无吸附、无实时尺寸气泡 | `tree-editor.ts` | 1.5d |
| T9 | P1 | 已放置扇的开启方向/合页边不可修改；**开启线实/虚线含义与 GB/T 50104 相反**、上悬窗交角位置不符 | `DesignStudio.tsx`, `StudioRightPanel.tsx`, `window-tree-render.ts` | 1d |
| T10 | P1 | 无快捷键体系/右键菜单/多选 | `tree-editor.ts` | 1.5d |
| T11 | P2 | 拖动每帧全量重建 Konva 节点树 | `tree-editor.ts` | 1.5d |
| T12 | P2 | 命中测试靠启发式（最上层+最小面积） | `tree-editor.ts` | 1d |
| T13 | P2 | 线宽/字号 world-mm 与屏幕像素混用，无出图模式 | `window-tree-render.ts` | 1.5d |
| T14 | P2 | 领域常量（互扣量/扇料加宽）硬编码 | `window-tree.ts`, `schema/material.ts` | 0.5d |
| T15 | P2 | `background` 图层建了不用；无网格/底图/墙体参照 | `tree-editor.ts` | 0.5d |
| T16 | P3 | 无图框/标题栏/比例/门窗表 | `exportPdf.ts` | 2d |
| T17 | P3 | 无 DXF 导出 | 新增 `packages/core/src/export-dxf.ts` | 3d |
| T18 | P3 | 无型材断面/节点详图 | `SeriesSpec` + 新渲染 | 3d+ |
| T19 | P3 | 校验结果不落到画布构件上 | `validate-design.ts`, `tree-editor.ts` | 1.5d |
| T20 | P3 | 分格为纯比例，缺「固定尺寸+弹性尺寸」模型 | `window-tree.ts` + 交互 | 5d+ |
| T21 | P1 | 无黑白线框出图模式：整图客户色实心填充、白色系在白底不可见、双色窗无法表达（§5.5.1） | `TreeEditorCanvas.tsx`, `palette.ts`, `window-tree-render.ts` | 1d |
| T22 | P2 | 尺寸标注样式不符制图惯例（起止符号/数字位置/无洞口层）——**并入 T7 执行**（§5.5.2） | `tree-editor.ts` | 并入 T7 |
| T23 | P2 | 图内文字字号是世界 mm，出图比例下不可读——**并入 T13 执行**（§5.5.3） | `window-tree-render.ts` | 并入 T13 |
| T24 | P2 | 玻璃无单玻/中空/夹层图例；`GlassSchema` 无玻璃配置字段——**依赖 T4 字段确认**（§5.5.4） | `window-tree-render.ts`, `material.ts`, `window-tree-describe.ts` | 1d |
| T25 | P2 | 拼樘画成实心灰块、无定位尺寸、数量徽章应仅编辑可见（§5.5.5） | `window-assembly-render.ts` | 0.5d |

依赖关系：T2 → T4（玻璃公式要用真实 installGap/系列参数）；T3 与 T4 有共用改动面（统一从布局派生）；T11 → T8（先解决重建才能做流畅吸附）；T13 → T16/T17（出图线宽标准）；T21 → T13（共用「角色→线宽/配色」表）；T22 并入 T7；T23 并入 T13；T24 → T4；T25 → T7（定位尺寸）。

---

## 2. P0 任务详情

### T1 撤销/重做对结构编辑完全失效

**现象**：分割分格、拖动中梃、放置构件、删除、拖外框边之后按「撤销」——画面不变。只有整窗偏移拖拽可撤销。

**根因**（三个引用共享同一 `root` 对象，快照存的是"变更后"的数据）：

| # | 位置 | 代码 |
|---|---|---|
| 1 | `packages/core/src/window-assembly.ts:327` | `const baked: WindowTree = { ...u.tree, offsetX: ox, offsetY: oy };` ← 浅拷贝，`root` 同引用 |
| 2 | `apps/web/src/store.ts:720-722` | `const baked = layoutAssembly(a, { installGap: ASSEMBLY_INSTALL_GAP }).trees.get(focusId) ?? a.units[0].tree; return { assembly: a, windowTree: { ...baked }, focusedUnitId: focusId };` ← 又一层浅拷贝 |
| 3 | `apps/web/src/store.ts:747-754` | `commitCanvasSnapshot` 里 `const newPast = [...canvPast, assembly];` ← **按引用**入栈 |
| 4 | `apps/web/src/canvas/tree-editor.ts` 各手势 | `moveMuntin`/`resizeTreeEdge` 等**原地 mutate** 树，然后才 `onChange(this.tree)`；而 `setFocusedTree`（`store.ts:600-609`）在**入口处**调用 `commitCanvasSnapshot` |

于是：画布持有的 `windowTree.root` === store 里 assembly 单元的 `tree.root`；手势先改了对象，再入栈，栈里记录的"历史"已经是改完的状态。另：`JSON.stringify(last) === JSON.stringify(assembly)` 这句去重比较在同引用下恒等，属于"碰巧没坏"，不要依赖。

**实测复现**（已跑通，可重跑验证修复）：

```js
// tmp-undo-check.mjs  —— 先 npm run build --workspace @wdd/core
// 注意：不要 import './packages/core/dist/src/index.js'（会拉入 konva→canvas 报错），按需 import 具体模块
import { assemblyFromWindowTree } from './packages/core/dist/src/window-assembly.js';
import { createWindowTree, splitArea } from './packages/core/dist/src/window-tree.js';

const tree = createWindowTree({
  openingW: 1500, openingH: 1500, seriesId: 's1', glassId: 'g-5-12a-5', frameWidthMm: 40, name: 't',
});
const a = assemblyFromWindowTree(tree);
// 模拟画布：拿到的「聚焦镜像」与 store 内的树共享 root（修复前）
const bakedRoot = a.units[0].tree.root;
const ok = splitArea(a.units[0].tree, bakedRoot.id, 'vertical', 0.5);   // true
console.log('分割是否成功:', ok);
console.log('store assembly root 是否被画布改动污染:', !!bakedRoot.children?.length); // 修复前 true
```

修复前输出 `true`（污染）；修复后应为 `false`，且 `canvPast` 入栈的元素与 `assembly` 不同引用。

**修改方案**（推荐组合，改动小且彻底）：

1. `window-assembly.ts:327` 改为深拷贝：`const baked: WindowTree = { ...structuredClone(u.tree), offsetX: ox, offsetY: oy };`（树规模小，无性能顾虑）。
2. `store.ts:721` 的 `windowTree: { ...baked }` 改为 `structuredClone(baked)`。（做完 1、2 后，画布与 store 彻底解耦。）
3. `store.ts:751` 改为 `const newPast = [...canvPast, structuredClone(assembly)];`，并删除同函数的 `JSON.stringify` 去重（改为引用比较 `last !== assembly` 或直接不去重、靠手势入口节流）。
4. 手势入栈时机：`commitCanvasSnapshot` 现在在 `setFocusedTree` 入口调用，属于"变更后"。配合 1-3 即可正确；若要更稳，可让 `tree-editor.ts` 在 `pointerdown` 开始时显式调用一次 `onChangeStart()` → store 里 commit。
5. 顺带把 `moveMuntin` / `resizeFrame`（`window-tree-resize.ts:51-67`）改成返回新树（copy-on-write），从根上消除共享引用。

**验收标准**：修复后依次执行「画外框 → 分割 → 拖中梃 → 放置扇 → 删除 → 拖外框边」，每一步撤销都精确回到上一步，重做回到下一步；`npm test` 全绿；新增 core 单测断言 `assemblyFromWindowTree(tree).units[0].tree.root !== tree.root`。

---

### T2 `installGap` 硬编码 20

**现象**：`series.installGap`（`packages/schema/src/material.ts:109` 已定义）被彻底忽略；设计区一律按 20mm 算洞口↔外框关系。

**证据**（需全部替换）：

| 文件 | 行 | 内容 |
|---|---|---|
| `apps/web/src/canvas/tree-editor.ts` | 78 | `const INSTALL_GAP = 20;` |
| 同上 | 238, 354-355, 371, 461, 471, 501, 743-766, 776, 880, 1065, 1175, 1254, 1346, 1414 | 全部 `layoutTree/renderWindowTree/renderAssembly/describeWindowTree/resizeTreeEdge` 调用 |
| `apps/web/src/store.ts` | 132, 720 | `ASSEMBLY_INSTALL_GAP = 20`（`deriveFocused` 烘焙用） |
| `apps/web/src/components/studio/DesignStudio.tsx` | 279, 301, 309, 427 | `layoutTree/toDesignModel(Assembly)/applyMuntinPattern` |

**后果**：一旦系列安装缝 ≠20（系统窗常规 5~10mm），2D 显示的洞口/外框关系、尺寸标注、外框下料长度全部偏差 2×(20−实际) mm；且 3D/报价若用系列值就与 2D 对不上。

**依据（已核验）**：JGJ 214-2010 7.2.1 洞口宽高允许偏差 ±10mm；干法/湿法安装术语见 2.1.6/2.1.7。地方标准给出了区间——江苏 DB32《居住建筑标准化外窗系统应用技术规程》5.2.11：后装式附框与洞口 **15~20mm**、窗框与附框 **6mm**；广东《系统门窗安装交付标准》5.5.4：洞口 >1500mm 时框与附框四周间隙宜 **6~10mm**；湖南《建筑节能门窗工程技术标准》8.2.1：间隙依保温层厚度与饰面材料确定。→ 说明「一个 installGap」可能不够：**洞口↔附框、附框↔框是两段不同的缝**，且随工法（干法/湿法）、保温与饰面变化。短期先把 `installGap` 统一到系列；中期评估是否拆成 `roughOpeningGapMm`（洞口-附框）与 `frameGapMm`（附框-框）两个字段。

**修改方案**：

1. `tree-editor.ts`：删掉常量，改为成员 `private installGap = 20;` + 公开方法 `setInstallGap(v: number){ this.installGap = v; this.render(); }`；所有调用点用 `this.installGap`。
2. `TreeEditorCanvas.tsx`：加 `useEffect` 读取 `library.series[seriesId].installGap` 并调用 `ctl.setInstallGap(...)`；同时在 `setAssembly` 之前先设 installGap，避免首次布局用旧值。
3. `store.ts`：删除 `ASSEMBLY_INSTALL_GAP`，`deriveFocused` 改为从 `library.series[assembly.seriesId].installGap` 取（store 已持有 library）。
4. `DesignStudio.tsx`：4 处 `installGap: 20` 改为读当前系列。

**验收标准**：把某系列 `installGap` 改成 8，画布上洞口与外框的间隙、尺寸标注、BOM 外框下料长度三者一致（可用 `layoutTree` 输出对拍）；`npm run typecheck` 通过。

**注意**：`SeriesSpecSchema.installGap` 是 `positive()`，无默认值；旧草稿/旧数据里若缺该字段，`hydrateDraft`（`store.ts:611+`）路径要兜底为 20，避免 NaN 扩散。

---

### T3 洞口/外框尺寸三个数据源

**现象**：同一面窗，"总宽"在三个地方可能显示三个数。

| 数据源 | 位置 | 语义 |
|---|---|---|
| 画布尺寸标注 | `tree-editor.ts:739-771` `applyDimEdit`：`this.tree.openingW = Math.round(v + 2 * INSTALL_GAP)` | 改的是树内洞口宽 |
| 右侧面板「总宽/总高」 | `StudioRightPanel.tsx`（disabled 只读） | 读 `store.openingW` |
| 图纸信息弹窗 | `DesignStudio.tsx:1336-1337`：`['洞口尺寸', design.openingW…]`、`['外框尺寸', computeGeometry(design, series)…]` | legacy 值 |
| 导出 PDF 头部表 | `apps/web/src/util/exportPdf.ts:52-57`，被 `DesignStudio.handleExport` 以 `design` 传入 | legacy 值 |
| 导出 PDF 的表体 | `DesignStudio.tsx:539-540` 用 `treeModel` → `computeBomFromDesignModel` | **树**的值 |

`resizeFrame`（`window-tree-resize.ts:51-67`）原地改树 `openingW` 从不回写 store；`replaceWholeWindow`（`DesignStudio.tsx:205-222`）不调用 `setOpeningSize`。→ **同一份 PDF 里表头和表体是两套尺寸**。

**修改方案**：

1. 确立**树为唯一权威**：在 `DesignStudio.tsx` 用 `layoutTree(windowTree, {installGap: series.installGap})`（或 `assembly` 的烘焙结果）派生 `opening/frame` 尺寸，供右面板、图纸信息、导出表头统一使用。
2. `store.openingW/openingH` 降级：仅作为"新建窗口时的初始值"，读取处全部换成派生值；或加 selector `selectDerivedSizes`。
3. `exportPdf.ts` 的 `infoTable` 改为接收 `{ openingW, openingH, frameOuterW, frameOuterH }` 显式参数，不再内部 `computeGeometry`。
4. `applyDimEdit`（`tree-editor.ts:739-771`）保持改树，但改完通过 store 同步一次派生展示（不要反向写 store.openingW 形成双写）。
5. 拖边/替换整窗后，确保右面板"总宽/总高"实时跟随（因为读的是派生值，天然跟随）。

**验收标准**：在画布上把外框左边拖 100mm → 右面板总宽、画布标注、导出 PDF 表头三处数字一致且同步变化；改系列 installGap 后三处同步。

---

### T4 玻璃尺寸无单一公式 + 设计区不显示玻璃净尺寸

**现状**（三处口径）：

| 路径 | 位置 | 公式（单叶平开为例） |
|---|---|---|
| legacy 几何 | `packages/core/src/geometry.ts:81-107` | `glassW = sashW - 2*sashWidth - 2*glassGap` |
| BOM（新） | `packages/core/src/bom-design-model.ts:286-287`（role 路径）、`541-547`（kind 路径） | 同左，但额外处理 `meeting`（对开中缝）与 `panelHeight`（上玻下板） |
| 2D 渲染 | `window-tree-render.ts:719-792` `drawSashAndGlass` | 玻璃矩形 = 扇框内缩 `inset`(=料宽)，**不减 glassGap** |

三者写法相近但分母不同（且 `meeting`/`panel`/异形裁剪系数只在 BOM 里处理），任何一处改动都不会同步到另两处。此外**设计区完全不显示玻璃净尺寸**，用户无法在图上核对下料玻璃大小。

**更深的问题：公式方向可能与真实工艺相反（已核验国标数据）**

当前三套公式都在做「扇内空 − 2×间隙」；而真实玻璃是**嵌入槽内**的，下料尺寸应**大于**可视内空。依据：

- JGJ 214-2010《铝合金门窗工程技术规范》表 5.3.2-1/-2（玻璃最小安装尺寸，mm）：
  - 单玻 t≤6：嵌入深度 b=8、边缘余隙 c=4；t≥8：b=10、c=5；
  - 中空 4+A+4~6+A+6：b=**15**、c=5；8+A+8、10+A+10：b=**17**、c=7。
- JGJ 113-2003《建筑玻璃应用技术规程》7.1.3：**槽口深度 = 边缘余隙 c + 嵌入深度 b**；7.2.2：支承块厚度 = c；JGJ 214-2010 6.3.1：槽底间隙宜 5~7mm。
- 行业下料公式（网络资料，与上述参数自洽）：「玻璃宽度 = 窗扇宽 − 光企宽 − 勾企宽 **+ 玻璃槽深×2 − 玻璃与型材间隙×2**」；「洞口尺寸 − 安装间隙 = 成品框尺寸」。

对照本项目：`SeriesSpec` 只有 `glassGap`（`schema/material.ts:113`，注释"玻璃安装间隙"），**没有槽深/嵌入深度、边缘余隙字段**；`ProfileSchema` 只有 `sectionWidth`，没有任何槽口几何。按中空玻璃 b≈15mm 估算，现行公式给出的玻璃比真实下料尺寸小 **30mm 量级**（每边 ~15mm），足以让下料单报废。**动工前请先与工艺确认 `glassGap` 的真实含义**（见 §7）。

**修改方案**：

0. 先确认工艺口径，然后给 `SeriesSpec` 增字段（建议 `glassRebateDepthMm`（槽深/嵌入深度 b）、`glassEdgeClearanceMm`（边缘余隙 c），保留 `glassGap` 兼容旧数据），公式改为 `玻璃 = 内空 + 2*b − 2*c`；单玻/中空取值不同（见上表），可挂到 `GlassSchema`（玻璃种类）上按厚度/结构取。
1. 在 `packages/core/src` 新增单一解析器（建议 `glazing.ts`）：

```ts
export interface GlazingBox { w: number; h: number; areaScale?: number; /* 异形裁剪系数 */ }
export function resolveGlazingSize(leaf: WindowSashSpec, box: {w:number;h:number}, series: SeriesSpec): GlazingBox
```

   规则集中在此（料宽/glassGap/对开中缝/上玻下板/异形面积系数），并被 `geometry.ts`、`bom-design-model.ts`、`window-tree-describe.ts` 共同调用；`geometry.ts` 的旧实现改为**委托**（保持向后兼容签名）。
2. `window-tree-render.ts` 的玻璃矩形改为从 describe 结果里的 `glazing` 字段取（即 `describeWindowTree` 输出玻璃净尺寸），渲染与算料同源。
3. 设计区选中扇时，在标注层显示玻璃净尺寸（依赖 T7 的标注框架；T4 先做到数据一致，标注可随后）。

**验收标准**：新增单测：对"单叶平开 / 对开 / 上玻下板 / 异形（arch）"四种情形，断言 `resolveGlazingSize` 与 BOM 输出一致（对拍现有 4 个用例：`double-sash.test.ts`、`kfc-door.test.ts`、`irregular-bom.test.ts`、`geometry.test.ts`）；画布上玻璃矩形宽高 = 该函数输出 ±0（视觉可无差，但数值必须来自同一函数）。

---

### T5 视图操作：缩放不锚定、无法平移、resize 复位

**证据**（`apps/web/src/canvas/tree-editor.ts`）：

- `applyTransform()`（277-282）：`this.stage.position({ x: 40, y: 40 })` —— **每次都把视图位置写死**；
- `onWheel`（329-335）：`this.scale *= factor` 后直接 `applyTransform()` + 全量 `this.render()`；未按指针位置修正 offset，缩放时视图跳向固定点；
- `resize(w,h)`（269-275）：按初始 `drawW/drawH` 重算 scale —— **每次容器尺寸变化（展开/收起右面板、窗口缩放、F12 调尺寸）都重置视图**；
- 无中键/空格平移；无双击 fit；无缩放百分比或缩放按钮。

**修改方案**：

1. 把变换状态从单一 `scale` 扩为 `{ scale, tx, ty }`（stage 上就是 `scale + position`）。
2. wheel 用指针锚定：`k = nextScale/scale; tx = p.x - (p.x - tx) * k; ty = p.y - (p.y - ty) * k;`
3. `resize()` 只在**首次**（`!this.hasFitted`）时 fit，之后保持用户视图；提供显式 `fitView()` 绑定双击/按钮。
4. 加平移：中键拖拽或空格拖拽（改 `tx/ty` 后 `batchDraw`）。
5. 性能：wheel 只 `stage.scale/position + batchDraw`，不要全量 `render()`（标注若需屏幕恒定字号，见 T13 统一处理；短期可在缩放结束 100ms 后 render 一次）。

**验收标准**：把鼠标放在窗框右下角滚轮放大——该点在屏幕上的位置保持不动；展开右面板后视图不跳；`worldPoint()`/`toScreen()` 与新变换一致（回归：分割、拖中梃、尺寸标注编辑仍落在正确位置）。

---

### T6 导出图不干净

**现象**：`tree-editor.ts:423-429` `exportImage()` 直接 `this.stage.toDataURL({ pixelRatio: 2 })`，把**选中高亮、尺寸标注、分割/外框预览、命中辅助**全部画进图里；`DesignStudio.handleExport`（549 行）把它塞进三份 PDF。

**修改方案**：

1. `exportImage(opts?: { clean?: boolean; ratio?: number })`：`clean` 时先临时隐藏 `overlayGroup / highlightBox / combinerHighlight / snapGuide / guide 层`（或 clone 一个 stage 副本渲染），导出后恢复。
2. 导出加白底 + 1px 边框 + 可选标题（窗编号/尺寸）。
3. 尺寸标注层做成显式开关（编辑区默认开，导出可选开/关）。
4. 生成 `dataURL` 时按输出 DPI 换算 `pixelRatio`（如 A4 宽 190mm、300dpi → 比例换算），避免目前固定 2 倍在打印时发虚。

**验收标准**：导出 PDF 中图纸无蓝色选中框、无标注浮层；尺寸标注开关可用。

---

## 3. P1 任务详情

### T7 尺寸链（洞口 / 外框 / 分格 / 玻璃 分层标注）

现状：`renderDimensions()`（`tree-editor.ts:492-524`）只画总宽/总高 + 选中格；`pushDimCad`（530-621）做 1/scale 屏幕补偿。真实大样图需要：

- 第 1 层：洞口尺寸（宽/高）；
- 第 2 层：外框尺寸；
- 第 3 层：分格尺寸链（每根中梃定位 = 每格宽/高，链式累加，第一道与最后一道落在框边）；
- 第 4 层：玻璃净尺寸（T4 产出）；
- 选中构件时高亮其关联的两个尺寸段。

**需求依据（已核验）**：门窗深化图深度指南要求立面图标注"主要控制轴线及编号、**立面分格尺寸及定位尺寸**、门窗顶和底标高"，大样图还要标"分格尺寸、**执手高度位置**、节点详图索引、玻璃配置填充图例"（陕西 T/SXBEEA 5.4.2/5.4.4）。→ 除分格尺寸链外，**执手高度**应成为一类可标注项（现有 `sashHandlePlacement` 已算出"距底 600"这类数据，见 `window-tree.ts`）；顶/底标高属整窗级，等 T16 图框时一起做。

做法建议：在 `window-tree-describe.ts` 里输出 `dimensionChains: { axis:'x'|'y'; level:number; items:{from:number;to:number;label:string}[] }[]`（纯数据，可测），`tree-editor` 只负责画与拖。每层可开关（存 UI 状态）。

### T8 拖动吸附 + 实时尺寸气泡

现状：拖动中梃无任何参考线/吸附/数值提示，且每次 mousemove 全量重建（先做 T11）。建议：

- 拖动中显示实时尺寸气泡（左右两格宽度）；
- 吸附候选项：等分位置、相邻格中点、与其它中梃对齐（同轴）、整十/整百、洞口中心线；
- 吸附阈值按屏幕像素（如 6px）换算成世界 mm，保证不同缩放手感一致；
- 已有 `snap.ts`（core）与 `snap.test.ts`，优先扩展复用，不要另起一套。

### T9 开启方向 / 合页边不可修改

现状：**放置瞬间**写死 `hingeSide/openDirection`，之后无 UI 可改。两处来源：
- `apps/web/src/components/studio/DesignStudio.tsx:46-57` `PLACE_SPECS`（分类菜单放置用，全部 `hingeSide:'left', openDirection:'out'`，tiltSlide 为 `'in'`）；
- `apps/web/src/canvas/tree-editor.ts:1482-1499` `specFor()`（工具栏直接放置用，同上）。
右侧面板的"合页"是订单级五金 `HINGE_OPTIONS`（`StudioRightPanel.tsx`），**不是**铰链边，别混。选中扇后应可改：内开/外开、左开/右开、内开内倒、微通风。

做法：`StudioRightPanel` 增加"开启"分组（仅当选中叶子含 `sash` 时出现）→ `setSash` 更新 spec → `setFocusedTree`。渲染侧 `drawOpeningMark`（`window-tree-render.ts:828-844`）已支持左右合页与内外开线型，只需接上。

**符号说明（已核验国标，含两个发现）**：

GB/T 50104《建筑制图标准》表 3.1.1「构造及配件图例」原文（引自 2001 版；2010 版保留同一图例章节，条文号未逐字对照）：

> "立面图上**开启方向线交角的一侧为安装合页的一侧，实线为外开，虚线为内开**"（窗组另有"立面图中的斜线表示窗的开启方向"；推拉窗一条**不含**开启线说明）

对照当前实现（`window-tree-render.ts`）：

| 符号 | 当前实现 | 国标要求 | 结论 |
|---|---|---|---|
| 平开开启线 `drawOpeningMark`（828-844） | 交角在合页侧中点 [符合]；`out`=虚线 `[30,15]`、`in`=实线 | 交角侧=合页 [符合]；**实线=外开、虚线=内开** | [不符] **实/虚线含义相反** |
| 上悬窗 `drawTopHinge`（1062-1072） | 交角画在**自由边（下方，超出扇下沿）**，恒为实线 | 交角应在**合页侧（上方）**；且需实/虚区分外开/内开 | [不符] 位置不符 + 无线型区分 |
| 推拉窗 `drawSliding`（1074+） | 无开启线 | 推拉窗无开启线 | [符合] 已符合 |
| 内开内倒 `drawTiltSlide` / 纱扇 | 按 windoorcraft 实测符号绘制 | **国标无对应图例**（内开内倒、纱窗都不在表 3.1.1 中） | [注意] 保留现符号，但需在图纸说明/图例中注明 |

**修法**：把 `drawOpeningMark` 的 dash 条件改成 `openDir === 'in' ? [30,15] : undefined`；`drawTopHinge` 交角移到上边（合页侧）并接受 `openDir` 参数区分实/虚；提供"图集样式"开关以防个别项目有自定义约定。修正后**开启线本身也要成为可测试的纯数据**（describe 层输出 `openingMark: {apexAt, dashed}`），便于出图/DXF 复用。

### T10 快捷键 / 右键菜单 / 多选

现状：仅 `onKeyDown`（`tree-editor.ts:1466`）支持 Delete。建议补齐：Ctrl+Z/Y（接 T1）、Ctrl+C/V/D（复制分格）、方向键微调（1mm / Shift=10mm）、Esc 取消工具、S 选择/V 分割/…、Shift 加选、右键菜单（删除/等分/插入扇/设为固定/查看尺寸）。多选需要 `focusShapeId` → `Set<string>`，注意 store 与标注层都要改。

---

## 4. P2 任务详情（质量）

### T11 拖动每帧全量重建

`updateMuntinDrag`（`tree-editor.ts:1374-1403`）在 mousemove 里调 `this.render()`；`render()`（431-488）销毁 `renderGroup/contextGroup/overlayGroup/highlightBox/combinerHighlight/dimLayer` 后**整棵重建**（实测单棵树 84 个 Konva 节点：37 Line/33 Rect/8 Group/3 Text/2 Arc/…）。应改为：

- 拖动中只更新受影响节点几何：中梃 `Line.points()`、两侧分格 `Rect` 的 x/width、玻璃矩形；
- 结束（pointerup）才 `onChange` 提交并做一次完整 render；
- `computeLayout()` 结果按 `tree` 引用做 memo，`describeWindowTree` 与 `layoutTree` 不要在一次 render 里重复全树遍历；
- 可评估直接用 Konva 原生 `draggable + dragBoundFunc`（中梃/把手已部分用 drag，见 `sashHandle` 分支）。

### T12 命中测试解析化

`hitNode`（789-839）用"最上层 + 面积最小 + 逐个 `getClientRect()`"的启发式，注释自认透明命中盒可能抢先。改为：`layoutTree(tree).boxes`（areaId→box）+ `outline.ts` 的 `pointInPoly` 解析求交（含斜梃/异形轮廓），命中结果与渲染无关、可单测。

### T13 线宽/字号体系

混用现状：渲染层 18 处 `strokeScaleEnabled:false`（屏幕像素 1~3px）与 15/10/9/3 世界 mm 线宽混用；文字 `fontSize = Math.max(14, Math.round(Math.min(w,h)/14))`（`window-tree-render.ts:152`）是**世界 mm**，被 stage 缩放后缩小时不可读、放大时巨大。建议两种模式：

- **编辑模式**：线宽屏幕恒定（strokeScaleEnabled:false）、字号用屏幕像素（文字放在不缩放的 overlay 里或反算 scale）；
- **出图模式**：全部世界 mm，按 GB 打印线宽（0.25/0.35/0.5）与字高（2.5/3.5mm）驱动，DXF/PDF 输出用这一套。
`describeWindowTree` 输出元素时带上 `role`（frame/sash/glass/dim…），渲染层按角色+模式查表取线宽。

### T14 领域常量进 SeriesSpec

`window-tree.ts` 中 `SASH_WIDTH_BONUS_MM = 10`（`sashWidthOf`）、`DEFAULT_MEETING_MM = 60`、`muntinWidthOf` 默认 40 是业务参数，应移入 `SeriesSpec`（如 `sashWidthBonus?`、`meetingWidth?`、`muntinWidth?`）并给默认值，保持旧数据兼容。窗/门系列取值不同，硬编码会让门类窗型算错。

### T15 background 图层与参照

`tree-editor.ts:214-219` 创建了 `background` 层但从未绘制（全仓库搜 `background.add` 无调用）。建议：浅色网格（100mm/500mm 分级）、洞口外框虚线、可选墙体（`orderConfig.wallThickness` 已有）、可选 3D 朝向提示。

---

## 5. P3 任务详情（出图与深化，摘要）

- **T16 图框/标题栏/比例/门窗表**：`exportPdf.ts` 目前 A4 + 简易表格（`pageCss()` 14mm 边距、`.drawing img{max-height:190mm}`）。需加：图框模板、标题栏（工程名/窗编号/比例/日期/设计人）、比例换算（1:20/1:25）、多窗汇总门窗表。建议先做"单窗大样图"模板。
  - 门窗表字段（已核验，深圳深度规定表 2.3.6）：**类别 / 设计编号 / 洞口尺寸(mm，宽×高) / 樘数 / 采用标准图集及编号 / 备注**；非标窗需单独绘立面图与开启方式；防火窗、救援窗在备注栏区分。
  - 编号建议按 GB/T 50104 图例代号体系（门 M / 窗 C）而非现在的内部标签 `A1/F1/S1/WC`（`specFor`/`PLACE_SPECS` 产生）。
  - 生产下单文件另需字段（陕西 5.6.1）：图号、标准号、材质规格、**下料尺寸**、樘数、总数量、加工参数、签字——现 `buildCuttingPdfHtml` 输出可对照补齐。
- **T17 DXF 导出**：设计区数据已足够（`layoutTree` 的世界 mm 轮廓 + `describeWindowTree` 元素）。最小可用集：LINE/LWPOLYLINE/TEXT/DIMENSION/LAYER。可参考 maker.js（MIT）或自写最小 DXF writer；服务端若要 dwg 转换另议。注意线型（实/虚）、图层命名（框/扇/玻璃/标注）与单位。
- **T18 型材断面/节点详图**：`SeriesSpec` 目前几何字段偏少（`material.ts:105-141` 只有料宽等），加工图需要的框扇搭接、中梃连接、玻璃入槽节点需补断面数据再绘制。
- **T19 校验可视化**：`validate-design.ts` 已有规则，但只在右面板出文字（`StudioRightPanel` 的「设计校验」块）。应把 issue 关联到 `areaId`/构件，在画布上标红并支持点击定位（issue 模型已有 `elementId` 之类字段的话直接接线）。
- **T20 固定/弹性尺寸**：当前分格是纯比例（`xr/yr/wr/hr`），改一格牵连全排。需要引入"某格固定尺寸、相邻格弹性吸收"的尺寸模型（对标 LogiKal Dimensions），属模型级改造，建议单独立项。

---

## 5.5 绘图规范性核对（构件绘制 vs 真实门窗图，2026-09-13 补录）

> 本节把 `window-tree-render.ts`、`window-assembly-render.ts`、`tree-editor.ts`、`palette.ts`、`TreeEditorCanvas.tsx` 的**实际绘制实现**逐条对拍「门窗制图规范 + 真实大样图惯例」。所有位置均按当前工作区逐行核对。
> **共同根因**：代码里没有「编辑视图 / 出图视图」的分层——编辑要屏幕恒定线宽、客户色、辅助标记；出图要图面 mm 线宽、线框、规范符号与图例。两套需求挤在同一条渲染路径上（T13 已提，本节给出全部具体不符点）。

| ID | 不符合项 | 规范/惯例要求 | 主要位置 |
|---|---|---|---|
| T21 | 全图按客户色实心填充；白色系在白底不可见；双色窗无法表达 | 大样图是线框图，颜色只作说明/色卡 | `TreeEditorCanvas.tsx:148-171`, `palette.ts:2-9` |
| T22 | 尺寸起止符号/数字位置不符制图惯例；无洞口尺寸层、画布无洞口线 | 45° 中粗斜短线；数字在尺寸线上方；第一道尺寸对洞口 | `tree-editor.ts:492-524, 530-621` |
| T23 | 图内文字字号是世界 mm，1:20 出图仅 0.7mm 高 | 字高按图面 mm（最小 2.5） | `window-tree-render.ts:152`（把手标签 `960`） |
| T24 | 玻璃无单玻/中空/夹层图例；数据层也无配置字段 | 大样图需玻璃配置填充图例 | `window-tree-render.ts:242-244, 764-775`；`material.ts:143-149` |
| T25 | 拼樘画成实心灰块、无定位尺寸；数量徽章混进图面 | 拼樘是构件：线框绘制 + 定位尺寸 | `window-assembly-render.ts:93-118` |

另有两项并入既有任务：**图线线宽用途分级 → T13**（见 5.5.6）；**构件编号 M/C 体系 → T16**（见 5.5.7）。

### 5.5.1 颜色体系：整图客户色实心填充（T21）

**当前实现**：

- `TreeEditorCanvas.tsx:148-171`：读 `orderConfig.outerColor` → `colorHex()` → `setColors({ frame: profile, sash: profile, glass: mixHex(profile,'#E8F4F8',0.75), inner: mixHex(profile,'#ffffff',0.9), bead: mixHex(profile,'#ffffff',0.34), … })`。即型材=客户色实心填充，玻璃/内腔/压线全部由客户色掺白/掺蓝派生。
- `palette.ts:2-9` 色板含「白色 #F2F2F0」；`TreeEditorCanvas.tsx:160` `void innerColor`（室内色被显式丢弃）；`StudioRightPanel.tsx:339-340` 声明"2D 立面显示室外面颜色；3D 两面分别渲染"——属有意设计。
- 画布无底色：stage 无 fill、`background` 层建了不画（`tree-editor.ts:209-219`），页面浅色背景直接透出。

**问题**：

1. （即时可见）「白色」#F2F2F0 填充在浅色背景上只剩 0.5alpha 的黑色描边（`window-tree-render.ts:573`），框体几乎不可见；深色系则整图糊成色块，扇/框同色（都取 `profile`）只靠 0.5 描边区分。
2. （出图）立面/大样图是**线框图**，线宽+图例表达构件属性；客户色至多出现在材质说明/色卡。本项目已实测记录 windoorcraft 料件用固定灰阶 `#636568`（`docs/WINDOORCRAFT_COMPONENT_DRAW_SPECS.md`），说明对标产品也不把客户色当绘图主色。
3. 双色窗（室内外异色）在 2D 无表达（`innerColor` 被弃用）；若图注注明"室外立面"可接受，但当前图上没有任何面别/朝向标注。

**代码修改任务**（按依赖顺序，依赖 T6 的导出净化接口）：

1. `packages/core/src/window-tree-render.ts`：新增 `export const PAPER_COLORS: Required<typeof DEFAULT_COLORS>`——全部构件填充白色 `#ffffff`（纸面线框图靠既有墨线/描边区分），供出图模式整体替换 `colors`。描边对比度（现有内联 `rgba(0,0,0,0.5)`）暂不动，归 T13 的样式表。
2. `apps/web/src/canvas/tree-editor.ts`：
   - 新增 `private renderMode: 'edit' | 'paper' = 'edit'` 与 `setRenderMode(mode)`（内部 `this.render()`）；
   - `render()`（431-488）：`const colors = this.renderMode === 'paper' ? PAPER_COLORS : this.colors;`，同时传给 `renderAssembly`（460-465）与 `renderWindowTree`（470-475）；
   - `exportImage()`（423-429）扩参为 `exportImage(opts?: { clean?: boolean; mode?: 'edit' | 'paper'; pixelRatio?: number })`：`try/finally` 内临时切 paper（与 T6 的隐藏浮层一起做），导出后恢复原模式。
3. `apps/web/src/components/TreeEditorCanvas.tsx:154-171`（编辑态浅色兜底）：对 `colorHex(outerColor)` 做亮度判断（如 hex→相对亮度 > 0.8），过亮（典型「白色 #F2F2F0」）时 `frame/sash` 改用 `mixHex(profile, '#8a8a8a', 0.35)` 之类加深色，保证浅色画布上框体可辨；`bead/inner` 派生系数同步复核。
4. 面别/朝向标注（可选）：图中加"室外立面"角标，或提供内外切换（3D 双面数据已存在，`Preview3D.tsx:57-58`）——本任务先做 1-3，此项随 T16 图框一并做。

**验收标准**：`setRenderMode('paper')` 后画面全为白底墨线、无客户色；导出 PNG（T6 接线后）无任何彩色填充；客户色切到「白色」时编辑态框体仍清晰；回归颜色切换 / 3D 预览 / `npm run typecheck`。

### 5.5.2 尺寸标注样式（T22，并入 T7）

**当前实现**（`tree-editor.ts`）：

- 只有两层：`renderDimensions()`（492-524）画外框总宽/总高（507-508，量的是 `layout.frame`）+ 选中分格（511-517）；**没有洞口尺寸层**，且画布从不画洞口/墙体（grep 全文件 `openingW` 仅出现于 221/744/748/814/1021，均为几何计算，无绘制）。
- `pushDimCad()`（530-621）：起止符号是垂直于尺寸线的短竖线（581-587，`tick = 8*s`）；尺寸数字 **bold**、居中在**尺寸线中段挖空处**（549；565 注释"尺寸线：中段断开给文本让位"）；`DIM_COLOR='#333333'`、`DIM_FRAME_FONT=24 / DIM_CELL_FONT=15` 经 `1/scale` 反算 → **屏幕恒定**。

**与制图惯例的差异**（GB/T 50001/50104 体系；条文号未逐字核验，实施前请按 §9.3 方式复查）：

| 项 | 惯例/规范 | 当前 | 结论 |
|---|---|---|---|
| 起止符号 | 45° 中粗斜短线（2~3mm）或箭头 | 垂直短竖线 | [不符] |
| 数字位置 | 尺寸线上方中部（水平）/左侧中部（竖直、字头朝左） | 尺寸线中段挖空、数字居中在线内 | [不符] |
| 数字样式 | 长仿宋、字高 2.5/3.5/5 系列、非粗体 | bold 无衬线 | [注意] |
| 尺寸层结构 | 洞口 → 外框 → 分格 → 玻璃逐层外扩；图面间距 7~10mm | 仅外框一层，间距 40/14 世界 mm（与出图比例无关） | [不符] |
| 屏幕恒定 | 出图应为图面 mm 恒定 | 1/scale 反算（编辑手感好，打印比例失真） | [注意] |

**代码修改任务**（步骤 1-3 可独立先做，不依赖 T7；步骤 4 与 T7 合并）：

1. **起止符号改 45° 斜短线**（`pushDimCad` 580-587）：水平尺寸两端改为 `[start - tick/2, y1 + tick/2, start + tick/2, y1 - tick/2]`；竖直尺寸同理绕端点旋转；`tick = 8*s` 不变。
2. **数字移到尺寸线上方**：
   - 删除"中段挖空"：565-578 的 `seg(start, mid - half)` / `seg(mid + half, end)` 合并为整段 `seg(start, end)`（不再计算 `half`/`pad` 用于断口）；
   - 水平尺寸：`t.x = mid`（保留）、`t.y = y1 - pad - t.height()`（取消 `offsetY` 居中）；竖直尺寸：`t.x = x1 - pad - t.width()`、仍 `rotation(-90)`，字头朝左；
   - 去 `fontStyle: 'bold'`（549）。
3. **字号按模式**：编辑态保持现有 `1/scale` 屏幕恒定；出图态改用 `paper.scaleDenominator`（与 T23 共用参数）反算图面字高。`DIM_FRAME_FONT/DIM_CELL_FONT` 的含义从"屏幕像素"改为"编辑态屏幕像素"。
4. **洞口尺寸层**（`renderDimensions()` 492-524）：
   - 从 `layout.frame` 反推洞口矩形（`x - installGap`、`y - installGap`、`w + 2*installGap`、`h + 2*installGap`；T2 落地后 `installGap` 用 `this.installGap`）；
   - 新增 `dimGapOpening` 字段（默认在 `dimGapW/H` 之外一层），`pushDimCad` 复用现有可拖动逻辑；
   - 洞口线本体：先画在 `dimLayer` 底部（`Konva.Rect`，`dash:[30,15]`、`listening:false`），T15 落地后迁到 `background` 层统一管理。
5. **与 T7 数据结构对接**（后置）：当 T7 输出 `dimensionChains` 后，`pushDimCad` 只保留"画"的职责，层号/间距/数值全部由 describe 数据驱动。

**验收标准**：标注外观 = 45° 斜短线 + 数字在线上方；拖动调距（`dimGapW/H`）仍生效；`openingW=1500, gap=20` 时洞口层显示 1500、外框层显示 1460（两数同时可见、不重叠）；`npm run typecheck` 通过。

### 5.5.3 图内文字字号（T23，并入 T13）

- `window-tree-render.ts:152`：分格/单元标签 `fontSize = Math.max(14, Math.round(Math.min(el.w, el.h) / 14))`，单位是**世界 mm**；把手标签同病（`Math.max(18, …)`、色 `#5c3b00`，`960`/`962`），且把手标签与窗户编号都渲染进图纸。
- 结果两头错：1:20 出图时 14 world mm → **0.7mm 图面字高**，远小于最小可读的 2.5mm；而 3000mm 大窗字号算到 214mm → 10.7mm 图面，盖过标题栏。

**代码修改任务**：

1. `WindowTreeRenderOptions`（`window-tree-render.ts:14-32`）新增 `paper?: { scaleDenominator: number; fontHeightMm?: number }`（`fontHeightMm` 默认 3.5）。
2. `drawElement`（104-158）：字号改为 `const fs = paper ? Math.round((paper.fontHeightMm ?? 3.5) * paper.scaleDenominator) : Math.max(14, Math.round(Math.min(el.w, el.h) / 14));`，再加防线 `fs = Math.min(fs, Math.floor(el.w * 0.9), Math.floor(el.h * 0.9))`（小格不溢出）。`paper` 需从 `renderWindowTree` 逐层传入（现签名 `drawElement(g, el, colors, inset, showLabels, bead)` → 增参）。
3. 把手标签（952-966）：`paper` 模式直接不绘制（编辑辅助）；同理数量徽章见 T25 的 `showBadges`。
4. `tree-editor.ts render()`（470-475）：paper 模式传 `paper: { scaleDenominator: 20 }`（比例暂定 1:20；T16 图框落地后从图纸设置读取）。标注字号（T22 步骤 3）复用同一参数。
5. 窗编号字（`tree.name`，140-158 同一处）：随 T16 的编号方案一起改，本任务只保证字号公式统一。

**验收标准**：paper 导出图中文字字高 = 3.5mm × 比例分母（1:20 → 70 world mm），按像素比例换算验证；3000mm 大窗文字不溢出分格、150mm 小格文字自动缩小；编辑模式视觉与改前一致（仍 14+ world mm）；`npm run typecheck`。

### 5.5.4 玻璃图例与配置数据（T24，依赖 T4）

- **渲染**：普通玻璃一律 `colors.glass` 平铺——扇内玻璃（`window-tree-render.ts:764-775`）、固定扇（242-244）、推拉扇（1079）；仅 roleType 分支（`drawRoleType` 321+，如 frostedGlass 斜纹）有图案。单玻/中空/夹层/钢化/Low-E 在图上完全同貌。
- **数据**：`GlassSchema`（`material.ts:143-149`）只有 `thickness`（单值）与 `layers`（层数），**存不下"5+12A+5 中空钢化"这类结构**；配置信息实际编码在 `glassId` 字符串里（默认 'g-5-12a-5'，`material.ts:182`），渲染层取不到结构化数据。
- **惯例**：门窗大样图需"玻璃配置填充图例"并在图例/说明中列明（陕西 T/SXBEEA 5.4.4，§9.3 已核验）。

**代码修改任务**（步骤 1-2 为前置数据，3-5 为绘制与接线；依赖 T4 的字段确认）：

1. `packages/schema/src/material.ts`：`GlassSchema`（143-149）增 `config: z.string().default('')`（如 `'5+12A+5'`）、`tempered: z.boolean().default(false)`、`lowE: z.boolean().default(false)`；`packages/schema/src/sample-library.ts:271-273` 三条玻璃种子补 `config`（现有 `name` 已是"5+12A+5 中空玻璃"，可直接提取）。带 default 保证旧数据兼容。
2. 新增 core 纯函数（建议并入 T4 的 `glazing.ts`）：`parseGlassConfig('5+12A+5') → { panes: [5,5], cavities: [12], laminated: false }`；识别 `PVB`/`夹层`/`钢化`/`LowE` 标记；配单测（放 `packages/core/test/`）。
3. `packages/core/src/window-tree-describe.ts`：`TreeRenderElement`（24-61）增 `glazingConfig?: string`；`describeWindowTree(tree, installGap, glass?: { config?: string })` 增可选第三参，命中时写入各 area 元素（缺省不写 → 现有调用与测试零影响）。调用方：`window-tree-render.ts:78` 从 opts 透传即可，`tree-editor.ts:1414`、`windowTreeBridge.ts:19`、`window-assembly-describe.ts:18` 暂传 `undefined`。
4. `packages/core/src/window-tree-render.ts`：新增 `drawGlazingLegend(g, rect, parsed)`——中空=腔内两条细平行线（示意两层玻璃）+ 中点腔线，夹层=虚线，单玻=一条细线；在 `drawSashAndGlass`（764-775）与固定扇玻璃（242-244）处按 `paper` 模式调用（编辑模式不画，避免噪音）。
5. `apps/web` 接线：`TreeEditorCanvas.tsx` 订阅 `library.glasses`，`ctl.setGlazingConfig({ config })`（来源 `glasses.find(g => g.id === windowTree.glassId)?.config`）；`tree-editor.ts` 存字段并在 `render()` 透传给 `renderWindowTree`。
6. 图例表（"中空 5+12A+5 钢化"数据来源即本任务字段）放 T16 图框。

**验收标准**：`parseGlassConfig` 单测（'5+12A+5'、'5+0.76PVB+5'、'6' 三种）；paper 导出图中中空玻璃双线、单玻单线、夹层虚线；编辑模式画面不变；`npm test`（core）与 `npm run typecheck` 全绿。

### 5.5.5 拼樘绘制（T25）

`window-assembly-render.ts:93-118`：拼樘 = `fill:'#8a8a92'` 实心圆角矩形 + 黑色 1px 描边 + 数量徽章（`drawFittingBadge`）。问题：

1. 实心块盖住两侧单元的框线，图上"拼樘处"与"框"分不清；
2. 拼樘无定位尺寸（真实大样图要标拼樘宽度/中心定位）→ 接 T7；
3. 数量徽章是编辑辅助，出图应隐藏（补进 T6 的净化清单：隐藏 `data-combiner` 徽章）。

**代码修改任务**：

1. **拼樘本体改线框**（`window-assembly-render.ts:94-105`）：编辑模式保留浅灰填充但可选中（现状即可，仅把描边加粗到 1.5px 增强辨识）；paper 模式 `fill:'#ffffff'`、描边黑色实线 + 沿长轴中线加一条分缝线（示意拼樘料双线），与框的墨线风格统一。
2. **徽章开关**：`WindowTreeRenderOptions`（`window-tree-render.ts:14-32`）增 `showBadges?: boolean`（默认 `true` 保持现状；`AssemblyRenderOptions extends WindowTreeRenderOptions`，装配路径自动继承）；`window-tree-render.ts:82-90` 与 `window-assembly-render.ts:112-114` 的 `drawFittingBadge` 调用受控；`tree-editor.render()` 在 paper 模式传 `false`。
3. **定位尺寸**：`renderCombinerLabels`（`tree-editor.ts:626-675`，已有"连接件(60)"标签+箭头）与 `renderAngleLabels`（680+，转角角度）保留；拼樘的**定位尺寸**（中心线到相邻框边距离、拼樘宽）统一由 T7 的 `dimensionChains` 输出，本任务不改数据结构，T7 落地时把拼樘项勾上。
4. **回归点**：`data-combiner` 属性、`setSelectedCombiner` 高亮、命中测试（`hitNode` 对 `data-combiner` 的路由）不得受影响。

**验收标准**：编辑态拼樘仍可点选、高亮正常；paper 导出中拼樘为线框、无橙色角标、无实心色块遮挡两侧框线；`npm run typecheck`；转角/拼樘相关 core 测试（`window-assembly.test.ts`）全绿。

### 5.5.6 图线线宽用途分级（并入 T13）

`window-tree-render.ts` 实测 18 处 `strokeScaleEnabled:false` 的 1~3px 屏幕线（如 573/624/642/693/733），与世界 mm 线宽混用（百叶符号 15、把手 3、玻璃格条 `widthMm`、`drawShadeMarks` 15）；`tree-editor.ts` 标注线 `2.2/scale`。制图规范（GB/T 50104 图线）要求按用途取 b 系列线宽（可见轮廓粗、分缝中、尺寸/图例细），当前无「用途 → 线宽」映射，缩放/出图时语义漂移。**修法**：T13 落地时建 `role → 图面线宽(mm)` 表（建议可见轮廓 0.5、开启线 0.35、分缝与尺寸 0.25，实施前核对 GB/T 50104 图线表），编辑模式全部屏幕恒定。

### 5.5.7 构件编号体系（并入 T16）

- 图上文字来自 `tree.name` 与放置默认值：`'A1'`（`model.ts:242`）、`'F1'/'S1'/'WC'`（`tree-editor.ts:1485/1493/1497`）；渲染在 `window-tree-render.ts:140-158`（bold 黑字，字号问题同 5.5.3）。
- 惯例：编号 = 代号（门 M / 窗 C，GB/T 50104 表 3.1.1，§9.3 已核验）+ 洞口尺寸（如 C1518/M0921）；分格内部不标 A1/F1 这类内部标签（那是编辑器调试信息）。
- **修法**：T16 落地时把 label 生成改为"类型代号+洞口尺寸"规则并允许手改；`showLabels` 扩为 `labelMode: 'none' | 'id' | 'debug'`——编辑显示调试标签，出图只显示窗编号。

### 5.5.8 其余小项（随相关任务顺手处理）

- 45° 拼接缝（`window-tree-render.ts:670, 786`）与压线缝线（716）在出图模式加开关（控制图面密度）；
- 把手标签（`960`/`962`）出图隐藏或并入图例说明；
- 百叶/纱窗等 windoorcraft 符号保留（§8.1 约定），但图纸说明中注明非国标图例（同 T9 结论）；
- 洞口/墙体线缺失（见 5.5.2），随 T15 的 `background` 层一起画（洞口虚线 + 可选墙体厚度）。

---

## 6. 验证手段

### 6.1 必跑命令

```bash
npm run typecheck && npm test
```

> 基线状态（2026-09-13 实测）：`npm run typecheck` 全绿（core/schema/desktop/server/web）。接手后若 typecheck 报错，先判断是否为自己引入。

### 6.2 手工回归清单（每阶段结束跑一遍）

1. 画外框（framing 拖拽）→ 分割（拖出横/竖梃）→ 拖中梃 → 放置玻扇 → 放置纱扇；
2. 撤销 5 次、重做 5 次，逐步核对画面（T1）；
3. 改系列 installGap（或切系列）→ 洞口↔框间隙与标注同步（T2）；
4. 拖外框左边 → 右面板总宽、图上标注、导出 PDF 表头三处一致（T3）；
5. 滚轮缩放（鼠标停在框角，该点不动）、展开右面板视图不跳、中键平移（T5）；
6. 导出三份 PDF：图纸无高亮、无浮层（T6）；
7. 转角窗/拼樘（`renderAssembly`）在多单元下的渲染与撤销（T1 的深拷贝可能影响 `offsetX/offsetY` 烘焙，重点回归 `window-assembly.test.ts`）。
8. 开启线核对（T9 修正后）：外开=实线、内开=虚线、交角在合页侧；上悬窗交角在上；推拉窗无开启线。
9. 出图规范核对（T21/T22/T23 修正后）：导出图为黑白线框、无客户色实心填充；尺寸起止符号为 45° 斜短线、数字在尺寸线上方；图纸文字在按比例打印后可读（≥2.5mm 图面字高）；玻璃按配置显示图例（T24）。

### 6.3 复现脚本存放约定

临时脚本命名 `tmp-*.mjs` 放仓库根目录，**验证完必须删除**（本仓库已约定不留临时文件）。

---

## 7. 未决 / 待人工确认

1. **开启线线型（已核验，需业主最终确认）**：GB/T 50104 表 3.1.1 明确"实线为外开，虚线为内开、交角侧=合页侧"（引自 2001 版，2010 版条文号未逐字核对）。当前实现的实/虚线含义**相反**，且上悬窗交角位置不符（详见 T9）。修法明确，但个别项目/图集可能有自定义约定，建议做成可配置并请绘图负责人过目。
2. **`glassGap` 的真实工艺含义（最高优先确认）**：现行"内空 − 2×glassGap"的公式方向与 JGJ 214-2010 表 5.3.2 的"嵌入深度/边缘余隙"体系不符，玻璃下料尺寸可能整体偏小 30mm 量级（详见 T4）。**在改任何下料相关代码前，先找工艺确认**：本系列的槽口深度、嵌入深度 b、边缘余隙 c 各是多少；`glassGap` 是历史遗留的错误近似还是另有口径。
3. `DEFAULT_MEETING_MM=60`、`SASH_WIDTH_BONUS_MM=10`、`muntinWidthOf` 默认 40 是否为真实工艺值——需工艺/生产同事确认后再写入系列默认（见 T14）。
4. `orderConfig.beadJoint`（压线斜接/直连）对**压线下料长度**的影响是否已进 BOM——修复 T4 时一并核对。
5. `installGap` 的单值语义：20mm 更接近"洞口-附框"的粗装缝；若系列采用附框工法，2D 里应展示哪一段缝需产品定义（见 T2）。

---

## 8. 铁律（禁止事项）

1. **不得搬运 windoorcraft.com 的混淆源码**。只可使用 `docs/WINDOORCRAFT_COMPONENT_DRAW_SPECS.md` 中已记录的**可观察规格**（颜色/线宽/点序/标注条等）。这是本项目的既有约定。
2. 每次改动后必须本地跑通 `npm run typecheck` 与 `npm test`（core 测试跑在 dist 上，`npm test` 会自动先 build）。
3. 纯业务/几何模块（`window-tree.ts`、`outline.ts`、`bom*.ts`、`geometry.ts`、新增 `glazing.ts`）**不得引入 konva/react/zustand**；Konva 只允许出现在 `window-tree-render.ts` 与 `apps/web`。
4. 保持 `describeWindowTree`（纯数据）与 `window-tree-render`（Konva 物化）的分离——新增绘制需求先加 describe 字段，再在渲染层消费。
5. 修改 `window-tree.ts` 的 `splitArea/moveMuntin/setSash/removeSash/layoutTree` 签名时，同步排查所有调用方（`tree-editor.ts`、`window-tree-patterns.ts`、`window-tree-resize.ts`、`window-assembly.ts`、`DesignStudio.tsx`），并补/改对应 core 测试（现有 26 个测试文件）。
6. 不删除既有测试；如需修改既有断言，必须在提交说明里写清原因。
7. 不改动 `picDemo/`、`docs/` 既有文档的结论（新增文档可以）。

---

## 9. 背景参考

### 9.1 第三方对标结论（摘要）

- **Orgadata LogiKal**：`Grid fields`（分格）+ `Dimensions`（固定/弹性尺寸）+ `Rebate Dimensions`（槽口）+ `Glazing`（独立玻璃视图）+ `Machinings` + CAD Suite（DXF/DWG 出图）+ CNC 数据。→ 我们方向对，缺"固定/弹性尺寸""槽口/加工层""出图"。
- **SoftTech V6 / Klaes**：单源设计模型 → 出图 / 拆单 / CNC。→ 印证 T3/T4 的单源改造是对的。
- **酷家乐 / 三维家**：3D 展示 + 实时报价面向业主；2D 面向生产；两层共模型。
- **windoorcraft.com**：已由本项目实测并记录在 `docs/WINDOORCRAFT_COMPONENT_DRAW_SPECS.md`（7 类构件、261 个工具 id、绘制常量表、45° 料件四边形、标注条颜色、扇类配方）。**工具粒度（异形框/格条/标线）比我们细**，其规格可直接用于补全绘制（遵守 §8.1）。
- **本地参考** `E:\WindowDoor-CAD-Toolkit-main`：IndexedDB 本地保存、CuttingOptimizer 与 BOM 分离。→ 与本仓库 `docs/DESIGN_BOM_ITERATION_PLAN.md` §十 的待办（模板库、材料面板常驻、本地自动保存、下料优化器）一致。

### 9.2 本仓库相关文档索引

| 文档 | 内容 |
|---|---|
| `docs/DESIGN_BOM_ITERATION_PLAN.md` | 设计/算料/报价迭代规划 + §十 第三方工具可借鉴点 |
| `docs/DESIGN_BOM_ROADMAP.md` / `docs/DESIGN_BOM_TASK_BREAKDOWN.md` | 阶段路线与任务拆解（模块 M1/M2…），本文件的任务编号 T1-T20 与其不冲突，可交叉引用 |
| `docs/WINDOORCRAFT_COMPONENT_DRAW_SPECS.md` | windoorcraft 2D 绘制规格实测（颜色/线宽/点序/标注/扇类配方） |
| `docs/WINDOORCRAFT_PROFILE_SERIES_SPEC.md` | 该工具系列/型材规格采集 |
| `ARCHITECTURE_NOTES.md`（根目录） | 架构笔记 |

### 9.3 标准依据与出处（2026-09-13 核验，供下一位执行者复查）

| 结论 | 来源 |
|---|---|
| 开启线实线=外开/虚线=内开、交角侧=合页侧 | GB/T 50104-2001 表 3.1.1 原文（[PDF](http://files.h2o-china.com/standard/200801/111391200365210.pdf)）；2010 版目录见 [工标库](https://www.gongbiaoku.com/mobile/book/nzg18501zaz)（2010 正文未逐字核对） |
| 洞口允许偏差 ±10mm、干法/湿法、玻璃安装尺寸 b/c 表 | JGJ 214-2010《铝合金门窗工程技术规范》（[PDF](https://jncc.jinan.gov.cn/attach/0/289bf47b183841279339d4ddf4fa7095.pdf)）5.3.2 / 6.3.1 / 7.2.1 |
| 槽口深度=c+b、支承块厚度=c | JGJ 113-2003《建筑玻璃应用技术规程》7.1.3 / 7.2.2（现行 [JGJ 113-2015](https://www.waizi.org.cn/bz/132051.html)） |
| 大样图/深化图深度（分格尺寸、定位尺寸、执手高度、节点索引、下单文件字段） | 陕西 T/SXBEEA《建筑门窗专项设计文件编制深度指南》征求意见稿 2026，4.4 / 5.4 / 5.6 |
| 门窗表列（类别/设计编号/洞口尺寸/樘数/标准图集/备注）、M/C 代号 | 深圳市《建筑工程施工图设计文件编制深度规定》（[PDF](https://www.gbwindows.net/ow.attachment.asp?sn=MjAyMzA3MjgxNjM2MTMxMDYzMjYwOTE0NDQ2MQ)）表 2.3.6；代号"门用 M、窗用 C"见 GB/T 50104 表 3.1.1 |
| 附框-洞口 15~20mm、框-附框 6mm | 江苏《居住建筑标准化外窗系统应用技术规程》5.2.11（[PDF](https://dbba.sacinfo.org.cn/portal/download/73540bc1b367c8f408a9da5cb149da967bed336db3e3baf64de6a6b91ce1f22f)） |
| 洞口>1500mm 框-附框 6~10mm | 广东《系统门窗安装交付标准》5.5.4（[PDF](https://www.gddwa.com/ueditor/php/upload/file/20240322/1711076067602507.pdf)） |
| 玻璃下料公式（扇宽−光企−勾企+2×槽深−2×间隙） | [13种铝合金门窗下料尺寸计算公式](https://www.sohu.com/a/271536091_720401)（行业资料，非标准条文） |

> 未能核验的项已在上表标注；"1:1/1:2 型材断面比例""内开内倒/纱窗国标图例"均未在检索到的标准文本中找到依据，勿当作规范引用。

---

## 10. 建议执行顺序（交付给下一位执行者）

```
第 1 批（正确性，可直接开干）：T1 → T2 → （T4 的解析器骨架）→ T3
第 2 批（视图与输出）：T5 → T6（含 5.5.5 拼樘徽章的净化）
第 3 批（设计区能力）：T11 → T8 → T7（含 T22 标注样式）→ T9（含国标线型修正，可提前单独做）→ T10
第 4 批（出图与深化）：T21（黑白线框模式）→ T13（含 T23 字高、5.5.6 线宽表）→ T16（含 5.5.7 编号）→ T17 → T24 → T12/T14/T15/T19/T25 → T18/T20
```

**等待项提示**：T4 的公式改造需先拿到工艺确认（§7-2），在等待期间先把 `glazing.ts` 的"单一解析器 + 对拍测试"骨架搭好（保持现有数值不变），确认后只改一处；
T9 的开启线线型修正（`out` 实线 / `in` 虚线）与上悬窗交角位置是**独立小改动**，不必等 T9 整体（开启方向 UI）就能先做；
T24 的玻璃图例依赖 T4 的字段确认（玻璃结构/配置），等待期可先做「图例占位 + 图纸说明表」。

每一批结束跑 §6.2 手工回归清单 + `npm test`；T1/T2/T4 完成后应为每项补 core 单测（这是把"评审结论"固化成"防回归资产"的最佳时机）。
