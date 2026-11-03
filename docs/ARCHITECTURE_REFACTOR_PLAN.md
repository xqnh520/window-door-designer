# 架构级重构方案：门窗设计工具（渐进式，三阶段）

> 产出日期：2026-09-13。约束：不推翻项目、不加新技术栈（React + Konva + Node）、全部落地到文件/函数级、每阶段结束系统可运行。
> 判定基线（错误设计，本文档给出替代方案）：
> ① tree ↔ shapes 双向转换 ② UI 原位修改业务数据 ③ renderer 内做业务投影 ④ 派生数据落状态 ⑤ 撤销栈按引用入栈。

## 实施进度（2026-09-13）

- Phase 1 已完成：撤销栈深拷贝、Controller 私有工作副本、Konva 渲染层移出 core。
- Phase 2 的模型主链已完成：store 不再保存 `windowTree` 或 `shapes`；BOM、报价、下料和右侧面板只从 `WindowAssembly → DesignModel` 计算，空画布不再回退旧 `WindowDesign`。
- Bridge 删除已完成：`windowTreeBridge.ts`、`designModelAdapter.ts` 已删除；旧 ShapeModel 只在 `legacyShapesImport.ts` 加载一次，CRM/3D 只通过 `shapes3d.ts` 单向输出。
- Renderer 业务投影已前移：`fittingCount`、`handlePlacements`、扇宽/扇叶数/填充类型、对开单叶矩形、百叶布局、上玻下板布局与格条几何均由 `describeWindowTree` 计算；异形外框的 Web 视觉几何由无 Konva 依赖的 `outline-frame-visual.ts` 描述，painter 只物化显式结果，且 Konva 不再进入 `packages/core`。
- 根级 `typecheck` 已先构建 schema/core 声明再检查各 workspace，避免 Web 偶然读到过期 `@wdd/core/dist` 而产生假通过或假失败。
- 本轮继续收敛：草稿/方案持久化已升级 v5（非空方案只保存 `WindowAssembly`）；报价统一走 `quoteFromDesignModel(model, bom, ...)`；公式预览改用 `formulaContextFromDesignModel`，按所属外框计算组合窗上下文；移除仍会写旧 `WindowDesign.panels` 的 `PanelEditor`。
- 全局上下文写入已补齐画布历史：`setSeries`、`setWindowType`、`setOpeningSize`、`setGlass` 在装配模式下均先写入深拷贝快照；切换窗型会同步所有叶区 `sash.windowType`，不再出现 UI 显示与 BOM/渲染类型分叉。
- 已移除 store 中旧 `selectedPanelId` 及 `updatePanel/splitPanel/removePanel/resetPanels` API；面板级编辑统一由树编辑器和 `dispatchCanvas` 承担。
- 已移除旧 `WindowDesign` 的独立 `past/future` 撤销栈与 `undo/redo` API；撤销/重做统一使用 `canvPast/canvFuture` 的 `WindowAssembly` 快照，避免两套历史状态互相覆盖。
- `TreeEditorController.applyDimEdit()` 直接发 `resize-dim` intent，不再先修改控制器内的业务树副本；旧 `onChange → replace-focused-tree → setFocusedTree` 整树回写 bridge 已删除。
- 把手拖拽在结构化回调模式下改为本地 Konva 预览，`dragend` 只发送 `patch-sash(handle)`；不再通过 `replace-focused-tree` 回写整棵树。
- 默认扇规格已从 `tree-editor.ts` 移入 [`packages/core/src/sash-defaults.ts`](../packages/core/src/sash-defaults.ts) 的 `specForSash()`，新增开启方式时不再修改控制器业务分支。
- 安装间隙已统一为 [`packages/core/src/defaults.ts`](../packages/core/src/defaults.ts) 的 `DEFAULT_INSTALL_GAP_MM`；Web 布局、3D/DesignModel 投影与 core `equalDivide()` 不再各自持有 `20`。
- 窗口平移已改为拖动期间仅移动 Konva 渲染组和叠加组，`mouseup` 只提交一次 `translate` intent；包括转角旋转单元在内，拖动预览不再修改控制器的 `WindowTree.offsetX/Y`。
- 尺寸线、拼樘标签和转角角度的 Konva 物化已从 `tree-editor.ts` 拆到 [`apps/web/src/canvas/render/dimensions.ts`](../apps/web/src/canvas/render/dimensions.ts)；模块只读模型快照，尺寸修改仍通过 `onDimEdit → resize-dim` intent，标注拖拽仅回传 renderer 自身间距。
- 选中框、单根框料、压线环与拼樘高亮的 Konva 物化已从 `tree-editor.ts` 拆到 [`apps/web/src/canvas/render/highlight.ts`](../apps/web/src/canvas/render/highlight.ts)；控制器只保留选择状态与挂载/重绘调度。
- 仍在收敛：store 顶层 `openingW/openingH/seriesId` 与 `design: WindowDesign` 仅作为空画布/历史兼容元数据，尚未从运行时状态删除；renderer 的大型 painter switch 尚未拆分。

---

## 1️⃣ 目标架构

### 目录结构（目标态）

```
packages/
  schema/                     # 唯一契约（zod）：WindowTree / WindowAssembly / SashSpec / SeriesSpec / Glass
                              #  + WindowDesign（仅作持久化格式，不是运行时模型）
  core/                       # 纯逻辑，零 UI 依赖（禁 import konva，禁 import react）
    src/
      window-tree.ts          # 树结构与原地 mutator（只被 dispatch 的私有副本调用）
      window-tree-layout.ts   # layoutTree / layoutAssembly（纯）
      window-tree-describe.ts # describeWindowTree → TreeRenderElement（纯，扩展后含 handle/fittingCount）
      window-tree-builder.ts  # toDesignModel / treeFromDesignModel
      bom.ts / bom-design-model.ts
      outline.ts / geometry
      sash-defaults.ts        # 新增：specFor + INSTALL_GAP 唯一导出（从 UI 迁入）
apps/
  web/src/
    canvas/
      render/                 # Konva 物化层（Phase 1 从 core 迁入，Phase 3 纯函数化）
        scene.ts              # describeScene(tree, opts) → SceneElement[]（纯，无 Konva）
        materialize.ts        # renderScene(scene, ctx) → Konva.Group（唯一 new Konva 处）
        painters/             # 每个构件一个文件，注册表驱动
          frame.ts muntin.ts glass.ts sash.ts screen.ts bead.ts handle.ts fitting.ts
        dimensions.ts         # pushDimCad / combiner 标签 / 角度标注（Phase 3 从 tree-editor 拆出）
        highlight.ts          # 选中高亮 / 拼樘高亮（Phase 3 拆出）
      controller/
        tree-editor.ts        # 事件 → intent。不持有树引用、不改数据
      legacyShape.ts          # 旧 ShapeModel 边界类型（禁止进入 store）
      legacyShapesImport.ts   # 旧草稿/CRM 的一次性导入
      shapes3d.ts             # treeToShapes / assemblyToShapes 单向只读投影
      model.ts                # 删除（死代码 + 旧 ShapeModel）
      windowTreeBridge.ts     # 已删除
      designModelAdapter.ts   # 已删除
    store.ts                  # 唯一权威容器 + dispatchCanvas + 深拷贝撤销栈 + load/save 边界转换
    components/               # React：只订阅 store，只发 intent
apps/desktop/                 # 不变
apps/server/                  # 改为直接 import @wdd/schema 类型（替换手工复制 materials.types.ts）
```

### 层职责

| 层 | 职责 | 禁止 |
|---|---|---|
| core | 树操作、布局、描述、算料（全部纯函数/可单测） | import konva；持有状态 |
| renderer（web/canvas/render/） | scene → Konva 物化，零业务推导 | 读 tree；调 sashHandlePlacement 等业务函数 |
| ui（components + controller） | 订阅 store、发 intent | 改树字段；自算几何；写业务规则 |

### 唯一数据源

- **运行时权威 = `assembly: WindowAssembly`**（store 唯一模型字段；单窗 = 1 单元 0 拼樘）。
- `windowTree`（聚焦镜像）、`shapes`（3D 投影）、`DesignModel`（算料投影）、`design: WindowDesign`（持久化副本）全部降级为派生或边界产物，不落 store 状态。
- 尺寸唯一来源：`tree.openingW / tree.openingH`；顶层 openingW/H、unit 副本、design 副本全部删除。

---

## 2️⃣ 数据流设计

### 重构前数据流（错误标注）

```
TreeEditorController ──①──► windowTree 镜像 ──► 与 assembly 共享子引用
  （tree-editor.ts:246 改 handle；744 改 openingW；1133-1134 改 offsetX/Y；
    1175 resizeTreeEdge；1384/1397 moveMuntin；1237 setSash；1447 removeSplit —— 全部原位改）

store 同时持有：openingW/H 顶层 ② + design.openingW ② + unit 内 ② + tree 内 ②（四份尺寸）
  + shapes 投影副本 ③ + windowTree 派生镜像落状态 ④

shapes ──⑤ shapesToTree（windowTreeBridge.ts:106-117）──► tree   ← DesignStudio.tsx:189 挂载时反向桥
shapes ──⑥ buildDesignModelFromShapes ──► BOM            ← BomTable/CuttingList/QuotePanel/StudioRightPanel 四表
tree ────⑦ treeToShapes/assemblyToShapes ──► shapes ──► Preview3D  ← 单向但落回状态（DesignStudio.tsx:480,483）
canvPast ──⑧ 按引用入栈（store.ts:751）→ undo 后编辑即篡改历史（T1 bug）
```

错误点：① UI 改数据 ② 尺寸多副本 ③ shapes 成第二事实源 ④ 派生落状态 ⑤⑥ 反向有损桥 ⑦ 投影回写 ⑧ 引用快照。

### 当前已落地数据流

```
用户手势 → CanvasAction → store.dispatchCanvas
                         │ 克隆聚焦树
                         ▼
                    core mutator
                         │ 替换快照
                         ▼
              store.assembly（唯一结构状态）
                  ├── focusedTreeFromAssembly → Konva renderer
                  ├── toDesignModelAssembly   → BOM / 报价 / 下料 / 校验
                  └── assemblyToShapes        → 3D / CRM 保存载荷

旧草稿 / CRM ShapeModel JSON → normalizeLegacyShapes → DesignModel → WindowAssembly
                               （仅加载边界一次；不存在反向运行时同步）
```

### 目标数据流（严格单向）

```
用户输入 → intent（tree-editor）
   │ dispatchCanvas(action)                     ← store 唯一写入口
   ▼
core mutator 作用于私有 deepCloneTree           ← UI 永远拿不到树引用
   │ 新树
   ▼
store：assembly 替换 + 深拷贝快照入 canvPast
   │ 派生（useMemo / selector，不落状态）
   ├── selectFocusedTree ──► describeScene（core 纯描述）──► renderScene（Konva 物化）──► 画布
   ├── toDesignModel ──────► computeBomFromDesignModel ──────► BOM 四表
   └── treeToShapes3d（一次性投影）──────────────────────────► three.js Preview3D
```

方向约束：**UI → core（intent 单向）、core → renderer（scene 单向）、renderer → UI（像素单向）。任何反向箭头都视为回归。**

---

## 3️⃣ 重构步骤

### Phase 1（最低风险止血：撤销栈 + 镜像脱钩 + 渲染出 core + 封死反向桥）

不改数据模型、不删 shapes、系统每个提交后可运行。

**P1-1 撤销栈修复（T1 根因）**
- 文件：`apps/web/src/store.ts`
  - `commitCanvasSnapshot`（747-754）：751 行改为 `const newPast = [...canvPast, deepCloneAssembly(assembly)]`。
  - `undoCanvas`（472-483）：476 行 `canvFuture: [assembly, ...canvFuture]` 改为 `[deepCloneAssembly(assembly), ...]`；恢复路径 `deriveFocused` 前不再 clone（快照已是独立副本）。
  - `redoCanvas`（484-495）：488 行 `canvPast: [...canvPast, assembly]` 同样改深拷贝。
  - 新增 `deepCloneAssembly` / `deepCloneTree`（JSON 递归，保留 id/offset，与现有 `cloneTree`（730-736，重置 id）区分）。
- 验收：undo → 继续编辑 → 再 undo 恢复的是编辑前状态；redo 同理。

**P1-2 手势级暂存克隆（阻断 UI 污染通道，最小改动量）**

> 审查修订（2026-09-13）：原方案（deriveFocused 深克隆镜像 + deepFreeze assembly）废弃。
> 原因：① 会话级克隆镜像在手势外被其他动作（setOpeningSize/combineUnit/setFocusedUnit）改过后，下一次 `onChange(克隆)` 会把旧克隆整体替换回 assembly → 静默丢数据（无报错、难复现，比 T1 更隐蔽）；② deepFreeze 与 core 原地 mutator 风格冲突（window-tree-resize.ts:79-88、window-assembly-builder.ts:79-82 均原地写树字段），layout 烘焙 mutate 边界未审计，冻结会误伤正常流程。

- 文件：`apps/web/src/canvas/tree-editor.ts`（约 15 行）+ `apps/web/src/components/TreeEditorCanvas.tsx`（接线约 3 行）
  - `TreeEditorOptions` 新增 `getTree: () => WindowTree | null`（返回 store 当前聚焦树）。
  - `onMouseDown`（1002）处理手势起点处：`this.tree = structuredClone(this.opts.getTree())`（暂存克隆）；手势内照旧原位改 + render；`mouseup` 时 `onChange(this.tree)` 上抛（现有 setFocusedTree 语义不变）。
  - store 层**不改**（deriveFocused 保持现状）。共享引用窗口从「整个会话」缩到「单次手势（mousedown→mouseup）」；拖拽期间 UI 模态化，丢失窗口实际归零。
  - 可选 dev 断言（非运行时冻结）：`commitCanvasSnapshot`（747-754）内比较 `JSON.stringify` 前后 hash，检测"未经过 commit 的穿透修改"并 console.error。
- 验收：拖中梃/把手/边缘/平移全流程正常；打开 A 动作（如改洞口）→ 立即拖中梃 → A 的修改仍在（针对静默丢失的回归用例）。
- 备注：意图化（P3-3）仍是最终态；本步只把「止血」与「意图化」解耦，避免 Phase 1 一次性改动过大。

**P1-3 渲染层迁出 core**
- `git mv packages/core/src/window-tree-render.ts apps/web/src/canvas/render/window-tree-render.ts`
- `git mv packages/core/src/window-assembly-render.ts apps/web/src/canvas/render/window-assembly-render.ts`
- 修导入：两文件内 `./window-tree.js` 等相对导入改 `@wdd/core`；`apps/web/src/canvas/tree-editor.ts:16,24` 改从 `../render/...` 导入。
- `packages/core/src/index.ts`：删除第 15、24 行两条渲染模块导出；`packages/core/package.json` dependencies 移除 konva。
- 验收：`npm run build -w @wdd/core` 通过；`node -e "import('@wdd/core')"` 不再报 `Cannot find module 'canvas'`（修复交接文档 §0.4 陷阱）。

**P1-4 封死反向桥**
- 文件：`apps/web/src/canvas/windowTreeBridge.ts` —— 删除 `shapesToTree`（106-117）与 import（第 5 行）。
- 文件：`apps/web/src/components/studio/DesignStudio.tsx:186-192` —— 挂载迁移 effect 改为调用 store 新方法 `importLegacyShapes(shapes)`：
  - 实现放 `apps/web/src/store.ts`：内部用 `buildDesignModelFromShapes → treeFromDesignModel`（逻辑与现 shapesToTree 相同），成功后 `setWindowTree` 并 `set({ shapes: [] })`，同时把旧 shapes 备份到 `localStorage['wdd-studio-backup']`。
  - 语义：反向转换从"通用 API"降级为"加载边界一次性迁移函数"。
- 验收：旧草稿（含 shapes 无 assembly）打开仍能进树模式；新数据不再有任何代码路径 shapes→tree。

### Phase 2（统一模型：shapes 降级为局部投影、BOM 改接 DesignModel、尺寸收敛）

**P2-1 移除 store.shapes 状态**
- 状态：**已完成**。`SketchShape` 已迁到 `canvas/legacyShape.ts` 并改名 `LegacyShape`；运行时 store、草稿 v4 与方案 v4 均不再保存 shapes。
- `apps/web/src/store.ts`：删除 `shapes` 字段、`addShape/updateShape/removeShape`（685-690，已核实无外部调用）、`persistDraft` 中的 shapes（759-769 行）。
- `setShapesFromCanvas`（691）保留至 CRM 迁移完成：`apps/web/src/crm/konva.ts:47,52` 改为 `treeToShapes(st.windowTree, series)` 投影后导出（CRM 格式不变，数据来源从状态变投影），`apps/web/src/components/studio/DesignStudio.tsx:234` 同步改投影；三处清零后删除 `setShapesFromCanvas`。
- `apps/web/src/components/Preview3D.tsx:46-47`：改为
  `const shapes = useMemo(() => assembly && assembly.units.length > 1 ? assemblyToShapes(assembly, series) : windowTree ? treeToShapes(windowTree, series) : [], [assembly, windowTree, series])`。
- `apps/web/src/components/studio/DesignStudio.tsx:480,483`：删除 `setShapesFromCanvas` 同步。
- 验收：3D 预览随编辑实时刷新（memo 依赖正确）；CRM 导出与改前逐字节一致；grep `state.shapes` 仅剩 Preview3D 局部。

**P2-2 BOM 四表改接 DesignModel（切断 shapes 第二事实源）**
- 状态：**已完成**。四表与导出链路已删除 `computeBom(design)` 回退；assembly 为空时明确展示空态或阻止导出。
- 文件（各改 1 行）：`BomTable.tsx:33`、`CuttingListTable.tsx:17`、`QuotePanel.tsx:37`、`StudioRightPanel.tsx:76`、`DesignStudio.tsx:539,1330`：
  `model = modelOverride ?? toDesignModel(tree 或 assembly)`。
- `apps/web/src/canvas/designModelAdapter.ts`：`buildDesignModelFromShapes` 调用点清零后删除该函数（`buildShapesFromDesignModel` 暂留，供 applyTemplate）。
- 验收：BOM 四表数字与 Phase 2 前逐行对拍一致（同方案、同配置）。

**P2-3 尺寸收敛（阶段 1/2）**
- 状态：**进行中**。CRM 保存尺寸、PDF/BOM/报价、公式预览与 3D 已改读 assembly 投影；顶层兼容字段仍待删除。
- `apps/web/src/store.ts`：删除顶层 `openingW/openingH` 字段；新增 selector `selectOpening(state): { w, h }`（有 assembly 取聚焦树 `tree.openingW/H`，否则回退 design）。
- 替换全部读取点（grep `openingW` in apps/web/src/components，逐个改 selector）。
- `setOpeningSize`（350-362）简化：只 `mapUnits` 更新 assembly + design 重建。
- `persistDraft`（759-769）：移除 openingW/H/windowTree（windowTree 由 assembly 可重建）。
- **明示残余**：`design.openingW` 在 P3 删 design 字段前仍是第二尺寸源（仅作无 assembly 的 legacy 回退），selector 回退只覆盖旧方案载入路径；「单一来源」在 P3 删除 design 运行时字段后才成立，勿提前宣称。
- 验收：改洞口尺寸后 PDF 导出、BOM、画布标注三处一致（修复"PDF 用旧 openingW"的实测漂移）；无 assembly 旧方案回退路径仍可用。

**P2-5 报价与公式上下文收敛（2026-09-13）**
- `packages/core/src/quote-engine.ts` 新增 `quoteFromDesignModel`：`openingAreaM2` 取 `DesignModel`，`billedAreaM2` 严格取同次 `BomResult`，不再从旧 `WindowDesign.panels` 重算。
- `packages/core/src/formula-context.ts` 新增 `formulaContextFromDesignModel`；组合窗按面板 `parentId` 解析所属外框，避免用装配体总宽生成错误出料长度。
- `apps/web/src/components/FormulaConfigModal.tsx` 改为 assembly → DesignModel → 公式上下文；`apps/web/src/components/PanelEditor.tsx` 删除，防止旧 panels 编辑入口重新形成第二写入通道。
- 回归测试：`packages/core/test/quote-engine.test.ts`、`packages/core/test/formula-config.test.ts` 覆盖 BOM 面积口径与不同宽度组合窗公式。

**P2-4 迁移 Shape → Tree（加载边界一次性转换）**
- 状态：**已完成（实现位置调整）**。转换保留在 `apps/web/src/canvas/legacyShapesImport.ts`，因为 ShapeModel 是 Web/CRM 历史协议，不应反向污染通用 core。
- 旧 `WindowDesign` / ShapeModel 到树的转换保留在 `apps/web/src/canvas/legacyShapesImport.ts`，仅作为 Web 加载边界适配；当前 core 不暴露反向 bridge API。
- `apps/web/src/canvas/model.ts`：删除全部死代码（calcInnerBox/buildModel/applyLabelEdit 等无调用者函数）；确认 `SashData/sampleOutline` 真实使用面（store.ts:26、Preview3D.tsx:8），剩余类型迁入 `shapes3d.ts` 后删除本文件。
- `apps/web/src/store.ts:404`（applyTemplate）：不再写 shapes/design，改为 `buildAssemblyFromDesign(createDesignFromTemplate(...))` 直接进树模式（模板 UI 若仍走旧面板流，此步放 Phase 2 最后，标注依赖）。
- 验收：旧方案 JSON 导入 → 树模式可编辑；模板应用后画布为树模式。

### Phase 3（彻底移除 bridge + renderer 稳定 + 编辑器意图化）

**P3-1 删除 bridge 残余**
- 状态：**已完成**。
- `windowTreeBridge.ts` → 重命名 `shapes3d.ts`，只保留 `treeToShapes/assemblyToShapes/assemblySize`，文件头注释改为「单向只读 3D 投影，禁止反向」。
- `designModelAdapter.ts` 整体删除（applyTemplate 已在 P2-4 改造）。
- 至此 shapes 只存在于 Preview3D 的 useMemo 局部变量，不进任何状态/持久化。

**P3-2 renderer 纯函数化（业务投影前置到描述层）**
- 状态：**业务几何前移已完成一轮，painter 注册表与统一 scene API 尚待后续小步拆分**。
- `packages/core/src/window-tree-describe.ts`：`TreeRenderElement` 扩展 `fittingCount`、`handlePlacements`、`panePoints`、`sashGlassPoints`、`contentAnchor` 等只读描述字段；`describeWindowTree` 内部完成配件计数、把手布局与异形安全落点投影。
- 已额外前移 `sashWidthOf / sashLeavesOf / sashInfillOf / sashLeafRects / louverSlats / panelLeafLayout / glassBarGeometry`，以及异形扇玻璃内轮廓、格条/百叶裁剪轮廓、标签区域锚点和异形把手回退落点；`window-tree-render.ts` 不再导入或运行这些业务几何函数。
- `apps/web/src/canvas/render/outline-frame-visual.ts` 接管异形外框的内腔、压线中心/内缘和四边命中带计算。它属于 Web renderer 的纯 scene 描述，因为 `beadWidthMm` 与命中带是视觉/交互策略；`drawOutlineFrame()` 只把这些数据物化为 Konva 节点。
- 新增 `apps/web/src/canvas/render/painters/bead.ts`、`painters/fold.ts`、`painters/security.ts`、`painters/decor.ts` 与 `painters/sash-composite.ts`：压线、折叠、安防、装饰条/中梃及复合扇 role 的 painter 已从 `window-tree-render.ts` 提取；模块只接收只读元素描述、颜色和 Konva Group，不依赖 store、React 或 core 业务操作。`packages/renderer` 仍不创建，当前拆分仅服务单一 Web consumer。
- 基础构件与开启方式已改由 `LEGACY_PAINTERS: Record<Exclude<TreeRenderElementType, 'combiner'>, Painter>` 显式注册；主渲染流程不再包含 `switch (el.type)`，新增 core 类型若遗漏 painter 会在 TypeScript 阶段失败。`roleType` 也已通过 `ROLE_PAINTERS` 注册表隔离调用边界，当前已知角色全部迁出兼容 dispatcher。
- `apps/web/src/canvas/render/window-tree-render.ts`：
  - `subSash / sashInSash / pushIn / foldSash / foldScreen / sashBead / screenBead / panelBead` 已直接绑定独立 painter；role 兼容 dispatcher 已删除，避免两份角色清单重复维护。
  - `renderWindowTree` 删除业务侧配件计数、把手落点和异形内缩计算，改读 element 描述字段。
  - `drawRoleType` 通过 `ROLE_PAINTERS` 注册表分发；透明命中区由 dispatcher 统一补齐，视觉 painter 不写交互状态；按角色逐步迁入 `painters/`，不为了目录形式一次性搬动所有 helper。
  - 新增 `strokePx(ctx, mm)` 工具，收敛散落的 18 处 `strokeScaleEnabled:false` 与 `1/scale` 手算（含标注层 pushDimCad 542-546）。
- 新增 `apps/web/src/canvas/render/scene.ts`：`describeScene(tree, opts) → SceneElement[]`（合并 describeWindowTree + 尺寸标注数据 + 高亮数据，纯函数）。
- 验收：像素对拍（Phase 2 末与 P3-2 末同一棵树 exportImage 截图 diff 为空）；`import('@wdd/core')` 保持可用。

**P3-3 TreeEditor 意图化与拆分（tree-editor.ts 1500 行 → 3 文件）**
- 状态：**意图化与第一轮拆分已完成**。尺寸标注已迁入 `render/dimensions.ts`，选择高亮已迁入 `render/highlight.ts`；控制器文件保持原路径以避免无价值的全仓导入改名。尺寸编辑、把手、窗口平移、边缘和中梃拖拽均已完成 intent 化；边缘/中梃只在一次性候选副本上运行 core 约束并绘制幽灵几何。分割、放置、删除也不再先修改控制器树，旧整树回写 action/API 已删除。
- 删除 `this.tree` 字段与全部原位修改点：246、744、1133-1134、1175、1384-1397、1237、1447-1459。
- 拖拽期间只更新本地幽灵节点（中梃预览已有此模式，推广到手把/平移/边缘）；`dragend` 发一次 intent（见 §4 示例 C）。
- `specFor`（1482-1499）迁入 `packages/core/src/sash-defaults.ts`；`INSTALL_GAP` 迁入 `packages/core/src/defaults.ts`，core 统一导出，UI 不再持有安装间隙字面量。
- 拆文件：`controller/tree-editor.ts`（事件→intent）、`render/dimensions.ts`（pushDimCad 530-621 / renderCombinerLabels 626-675 / renderAngleLabels 680-736）、`render/highlight.ts`（renderHighlight 865-982 / renderCombinerHighlight 844-863）。
- `apps/web/src/store.ts`：新增 `dispatchCanvas(action)`（§4 示例 B），`setFocusedTree` 改为其内部实现；命中语义不再依赖 Konva `name()` 字符串，改由 scene 元素显式元数据（edge/bead-host）在物化层照抄。
- 验收：扩展性验收——新增一个开启方式（如 folding）的实际改动口径为 **4-5 处新增分支**（schema 联合类型 + describe typeOfSash + BOM 分料 + painters/folding.ts 注册 + 可能的 sashWidthOf），但**不改核心框架**（renderWindowTree 主循环、tree-editor 事件层、store dispatch 均不动）；以「diff 行数统计」验收而非「处数」。性能：四条拖拽热路径（中梃/边缘/把手/平移）不再全量 destroy/重建（增量更新 + batchDraw 合并）；其余交互路径保持全量重建（全量 diff 引擎不在本阶段范围）。

**P3-4（可选，判定条件触发才做）**
- 出现第二个渲染消费者（desktop 缩略图 / 服务端出图 / PDF 矢量）时，把 `web/canvas/render/` 提升为 `packages/renderer`（stage 经接口注入，不 import react）。只有一个消费者时不拆——避免过度设计。

---

## 4️⃣ 关键代码改造示例

### A. render(tree) 纯函数

```ts
// apps/web/src/canvas/render/scene.ts —— 纯，无 Konva
export interface SceneElement {
  id: string;
  kind: 'frame' | 'muntin' | 'area';
  x: number; y: number; w: number; h: number;
  points?: number[];                       // 异形轮廓（局部扁平坐标）
  role?: string;                           // painter 注册键
  label?: string;
  handle?: { x: number; y: number; w: number; h: number; arm: number; label: string };
  bead?: { widthMm: number; joint: 'miter' | 'butt' };
  fittingCount: number;                    // ← 描述层已算好，渲染层零推导
  edge?: 'top' | 'bottom' | 'left' | 'right';  // 显式命中元数据（替代 name() 字符串契约）
}

export function describeScene(tree: WindowTree, opts: RenderOpts): SceneElement[] {
  const els = describeWindowTree(tree, opts.installGap);   // core 纯描述（已含 handle/fittingCount）
  return els.map((el) => ({ ...el, ...opts.highlightOf?.(el) }));  // 高亮/标注合并也在此完成
}

// apps/web/src/canvas/render/materialize.ts —— 唯一 new Konva 的地方
export function renderScene(scene: SceneElement[], ctx: RenderCtx): Konva.Group {
  const root = new Konva.Group({ listening: true });
  for (const el of scene) {
    const g = new Konva.Group({ id: el.id, name: el.kind });
    g.position({ x: el.x, y: el.y });
    (painters[el.role ?? el.kind] ?? painters.fallback)(g, el, ctx);
    root.add(g);
  }
  return root;
}
```

### B. dispatch(action) —— store 唯一写入口

```ts
// apps/web/src/store.ts
export type CanvasAction =
  | { type: 'moveMuntin'; muntinId: string; ratio: number }
  | { type: 'resizeEdge'; id: string; edge: TreeEdge; pos: number }
  | { type: 'split'; hostId: string; dir: SplitDir; ratio: number; thicknessMm: number }
  | { type: 'setSash'; areaId: string; spec: WindowSashSpec }
  | { type: 'moveHandle'; areaId: string; offsetMm: number; fromBottomMm: number }
  | { type: 'translate'; offsetX: number; offsetY: number }
  | { type: 'removeSelected'; id: string };

dispatchCanvas: (action: CanvasAction) => {
  const { assembly, focusedUnitId, canvPast } = get();
  if (!assembly || !focusedUnitId) return;
  const unit = assembly.units.find((u) => u.id === focusedUnitId);
  if (!unit) return;
  const tree = deepCloneTree(unit.tree);      // 私有副本，UI 永远拿不到引用
  switch (action.type) {
    case 'moveMuntin':   moveMuntin(tree, action.muntinId, action.ratio); break;
    case 'resizeEdge':   resizeTreeEdge(tree, action.id, action.edge, action.pos, { installGap: INSTALL_GAP }); break;
    case 'split':        splitArea(tree, action.hostId, action.dir, action.ratio, action.thicknessMm, muntinSagittaOf(tree), /* rect */ ...); break;
    case 'setSash':      setSash(tree, action.areaId, action.spec); break;
    case 'moveHandle': { const a = findArea(tree, action.areaId);
                         if (a?.sash) a.sash.handle = { ...(a.sash.handle ?? {}), offsetMm: action.offsetMm, fromBottomMm: action.fromBottomMm }; break; }
    case 'translate':    tree.offsetX = action.offsetX; tree.offsetY = action.offsetY; break;
    case 'removeSelected': { /* removeSplit / removeSash 按选中语义 */ } break;
  }
  set({
    canvPast: [...canvPast, deepCloneAssembly(assembly)],   // 深拷贝快照（T1 修复）
    canvFuture: [],
    ...deriveFocused(coreSetUnitTree(assembly, focusedUnitId, tree), focusedUnitId),
  });
}
```

### C. TreeEditor 改造（意图化）

```ts
// ── 改前（tree-editor.ts:1130-1136，平移窗口：直接改树）──
this.tree.offsetX = Math.round((this.dragWindow.offsetX + dx) * 10) / 10;
this.tree.offsetY = Math.round((this.dragWindow.offsetY + dy) * 10) / 10;
this.render();

// ── 改后：dragmove 只更新幽灵节点，dragend 发一次 intent ──
// controller 不再有 this.tree；预览阶段：
this.ghostGroup?.position({ x: this.dragWindow.offsetX + dx, y: this.dragWindow.offsetY + dy });
this.layers.shape.batchDraw();
// dragend：
this.opts.onIntent({
  type: 'translate',
  offsetX: Math.round((this.dragWindow.offsetX + dx) * 10) / 10,
  offsetY: Math.round((this.dragWindow.offsetY + dy) * 10) / 10,
});

// ── 改前（tree-editor.ts:246，把手拖拽：改业务数据）──
area.sash.handle = next;  ...  this.opts.onChange(this.tree);

// ── 改后：同样只发意图（dragmove 期间仅移动 Konva 节点本体，见 248-253 已有模式）──
this.opts.onIntent({ type: 'moveHandle', areaId, offsetMm: next.offsetMm, fromBottomMm: next.fromBottomMm });

// React 侧接线（TreeEditorCanvas.tsx）：
const controller = new TreeEditorController(container, tree, {
  onIntent: (a) => useStore.getState().dispatchCanvas(a),
  onSelect: ..., onPlaceRequest: ..., onFrameCreate: ...,
});
```

---

## 5️⃣ 风险提示

| # | 风险 | 最容易出问题的点 | 防法 |
|---|---|---|---|
| 1 | **暂存克隆窗口残留** | P1-2 手势级克隆：mousedown 与 mouseup 之间其他路径（键盘 Delete、外部事件）改动树，提交时整体替换仍会覆盖——窗口已从会话级缩到手势级，残余风险需在 P3-3 意图化后归零 | P1-2 验收用例「改洞口→立即拖中梃→洞口修改仍在」；P3-3 前禁止在拖拽手势内触发其他写路径 |
| 2 | **快照引用残留** | 三处入栈（751/476/488）漏改任何一处，undo 即串历史 | Phase 1 收尾时 grep `canvPast` / `canvFuture` 全部赋值点逐一核对；快照只进不出（恢复前不再 clone，快照本身独立） |
| 3 | **反向桥删除顺序** | 先删函数再找调用方 → 编译错误轰炸 | 严格按：清零调用方（DesignStudio.tsx:189 唯一写入口）→ grep 确认 → 删函数 → typecheck 兜底 |
| 4 | **BOM 数字漂移** | P2-2 改接 DesignModel 时 toDesignModel 与 buildDesignModelFromShapes 的入参语义（installGap/series）不一致 | 切换前对同一方案跑两份输出 diff，逐行一致才提交 |
| 5 | **3D 预览失同步** | shapes 从 store 状态切为 useMemo 投影后漏依赖（series 变化不重投影） | 验证用例：编辑中梃、切换系列、切换聚焦单元三种操作后 3D 立即刷新 |
| 6 | **渲染几何回归** | P3-2 painter 拆分是纯代码搬运，最容易引入坐标偏移 | 逐 painter 提交；每个 painter 迁移后立刻 exportImage 像素对拍，不攒批验收 |
| 7 | **拖拽性能掉帧** | dispatchCanvas 全量深拷贝在 60fps 高频 intent 下卡顿 | 改造示例 C 已内置：dragmove 只更新幽灵节点，dragend 才 dispatch；仍卡则 P3 末做 core mutator 按路径不可变化（只 clone 变更链） |
| 8 | **历史数据兼容** | persistDraft 字段收缩后旧 localStorage 草稿解析失败 | hydrateDraft/reviveAssembly 保留回退逻辑（store.ts:772-778 已有）；旧 shapes 数据经 importLegacyShapes 迁移并备份 `wdd-studio-backup` |

### 执行顺序与依赖

```
Phase 1（约 1-2 天）── 可立即开始，独立验收
  P1-1 撤销栈 → P1-2 镜像脱钩 → P1-3 渲染出 core → P1-4 封死反向桥
Phase 2（约 2-3 天）── 依赖 Phase 1 的单一权威
  P2-1 shapes 出状态 → P2-2 BOM 改接 → P2-3 尺寸收敛 → P2-4 Shape→Tree 迁移
Phase 3（约 3-5 天）── 依赖 Phase 2 的 shapes 移除
  P3-1 删 bridge → P3-2 renderer 纯函数化 → P3-3 编辑器意图化
```

每阶段结束门禁：`npm run typecheck` + `npm test -w @wdd/core`（build + node --test）+ 手工用例（撤销/重做、拖中梃、把手、转角窗、3D、BOM 对拍）。

### CAD 专项保障

- **几何数据**：所有尺寸/分割/拼接只在 assembly 树中；`layoutTree / describeScene` 纯函数可单测（复用 core 现有 node --test 基建）；渲染层禁止自算几何（违者按错误设计打回）。
- **渲染正确性**：世界 mm 坐标从 describe 到 materialize 不做任何缩放，缩放只发生在 Stage 层；像素对拍（exportImage）作为每次 painter 迁移的回归门禁。对拍工具落地方式：vite dev + 浏览器 MCP（环境已具备 browser-use / chrome-devtools）自动导出改造前后截图对比；不引入 node-canvas（'canvas' 原生模块 Windows 编译有风险，且正是 core barrel 此前崩溃的依赖）。
- **可扩展性**：五金 / 开启方式 / 材料各有一个扩展点——painter 注册表（视觉）+ TreeRenderElement 字段（投影）+ schema（数据）。新类型 = 新文件 + 注册，不改任何 switch。
