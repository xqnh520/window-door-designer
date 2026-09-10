# 设计、算料与报价研发任务拆解

本文档基于 `docs/DESIGN_BOM_ITERATION_PLAN.md`，将后续迭代拆成可执行研发任务。任务按模块分线：核心模型、前端设计区、算料引擎、系列配置、报价引擎、下料单、校验规则、测试验收。

## 一、阶段目标总览

```text
阶段 1：统一设计数据源
阶段 2：构件化 2D 工具
阶段 3：从画布生成基础 BOM
阶段 4：系列配置化
阶段 5：窗型模板化
阶段 6：工艺规则校验
阶段 7：报价引擎独立化
阶段 8：生产下料单
阶段 9：复杂窗型扩展
```

## 二、核心模型任务

### 任务 M1：定义 DesignModel

目标：建立独立于 Konva 的门窗业务模型，作为 BOM、报价、下料单的统一输入。

建议位置：

- `packages/schema/src/design-model.ts`
- `packages/schema/src/index.ts`

主要内容：

- 新增 `DesignModel`。
- 新增 `DesignComponent`。
- 新增 `ComponentKind`。
- 新增 `OpeningType`。
- 新增 `MaterialRole`。
- 新增 `DesignModelMeta`，保存订单号、客户、位置、数量、颜色、备注等信息。

建议类型：

```ts
export interface DesignModel {
  id: string;
  name: string;
  openingW: number;
  openingH: number;
  seriesId: string;
  glassId: string;
  hardwareSetId?: string;
  components: DesignComponent[];
  meta?: DesignModelMeta;
}
```

验收标准：

- 类型可被 `apps/web` 和 `packages/core` 同时引用。
- 不依赖 Konva、React、Zustand。
- 能表达外框、中梃、固定玻璃、平开扇、推拉扇、上悬扇、文字和尺寸标注。

### 任务 M2：SketchShape 到 DesignModel 的转换

目标：保留现有画布能力，同时让画布数据可以转换成业务模型。

建议位置：

- `apps/web/src/canvas/designModelAdapter.ts`

主要内容：

- 新增 `buildDesignModelFromShapes(shapes, state)`。
- 将 `rect`、`trapezoid`、`arch`、`gothic` 转换为业务构件。
- 将 `sashes` 转换为开启扇构件。
- 忽略或标记 `line`、`text` 为标注类构件。

验收标准：

- 当前画布保存的方案可以生成 `DesignModel`。
- 平开扇的开启方向、铰链侧、所属宿主可以保留。
- 转换失败时返回明确错误，而不是静默生成错误 BOM。

### 任务 M3：Store 中接入 DesignModel

目标：让前端状态中可以同时维护画布图形和业务设计模型。

建议位置：

- `apps/web/src/store.ts`

主要内容：

- 增加 `designModel` 或 `getDesignModel()`。
- 在 `setShapesFromCanvas` 后同步生成业务模型或标记待计算。
- 保存本地和 CRM 方案时保存业务字段。

验收标准：

- 保存/加载方案后，画布图形和业务模型都能恢复。
- BOM 面板可以读取最新业务模型。

## 三、前端设计区任务

### 任务 F1：工具栏业务化改造

目标：把通用绘图工具逐步改成门窗构件工具。

建议位置：

- `apps/web/src/canvas/tools/catalog.ts`
- `apps/web/src/components/studio/StudioLeftTools.tsx`

主要内容：

- 将“矩形”改为“固定玻璃”或拆为“外框”“固定玻璃”。
- 新增“竖中梃”“横中梃”。
- 平开扇工具增加左开、右开、内开、外开配置。
- 修复快捷键冲突，文字和梯形不能同时使用 `T`。
- 增加工具分组：结构、构件、标注。

验收标准：

- 设计师可以按门窗业务对象绘制。
- 每个工具生成的对象都带 `kind` 或可转换成 `kind`。
- 工具栏图标、Tooltip、快捷键一致。

### 任务 F2：连续绘制模式

目标：提高连续绘制中梃、固定玻璃、标注时的效率。

建议位置：

- `apps/web/src/canvas/tools/DragDrawTool.ts`
- `apps/web/src/components/studio/StudioLeftTools.tsx`

主要内容：

- 增加“锁定当前工具”状态。
- 按住 `Shift` 绘制时不自动切回选择工具。
- 工具栏显示当前工具是否锁定。

验收标准：

- 单次绘制默认仍可自动切回选择。
- 连续绘制时可以保持当前工具。
- 不影响撤销、选择、删除。

### 任务 F3：右侧构件属性面板

目标：选中构件时显示业务属性和材料影响。

建议位置：

- `apps/web/src/components/studio/StudioRightPanel.tsx`
- 新增 `apps/web/src/components/studio/ComponentPropertyPanel.tsx`

主要内容：

- 显示选中构件的类型、尺寸、位置、系列、玻璃、五金、开启方式。
- 支持直接输入宽高、位置。
- 显示当前构件产生的型材、玻璃、五金用量。
- 对不可编辑或需要重算的字段给出状态说明。

验收标准：

- 选中平开扇能看到扇料、压线、玻璃、五金影响。
- 修改尺寸后材料影响实时更新。
- 错误配置能被清楚提示。

### 任务 F4：实时 BOM/报价预览入口

目标：让设计师画图时随时看到材料和价格变化。

建议位置：

- `apps/web/src/components/BomTable.tsx`
- `apps/web/src/components/QuotePanel.tsx`
- `apps/web/src/components/studio/DesignStudio.tsx`

主要内容：

- BOM 优先读取 `DesignModel`。
- 画布为空时回退到旧 `WindowDesign`。
- 增加“材料清单 / 下料单 / 报价”切换。
- 显示错误和警告状态。

验收标准：

- 画布修改后 BOM 和报价实时刷新。
- 计算失败时不显示过期清单。

## 四、算料引擎任务

### 任务 B1：新增 computeBomFromDesignModel

目标：从业务设计模型直接生成材料 BOM。

建议位置：

- `packages/core/src/bom-design-model.ts`
- `packages/core/src/index.ts`

主要内容：

- 输入 `DesignModel`、`ProductSeries`、`MaterialLibrary`。
- 输出 `BomResult`。
- 支持外框、中梃、固定玻璃、平开扇、压线、基础五金。
- 保留旧 `computeBom`，用于兼容旧 `WindowDesign`。

验收标准：

- 一固定一平开可生成完整 BOM。
- 修改宽高、系列、玻璃后 BOM 变化正确。
- 有单元测试覆盖基础窗型。

### 任务 B2：构件级 BOM 明细

目标：每条 BOM 能追溯到画布构件。

建议位置：

- `packages/core/src/bom-design-model.ts`

主要内容：

- `BomItem` 增加 `sourceComponentId` 或新增扩展类型。
- 每个构件输出自身材料贡献。
- 前端可按选中构件过滤 BOM。

验收标准：

- 选中某个平开扇时能看到它贡献的扇料、压线、五金、玻璃。
- 删除构件后对应 BOM 消失。

### 任务 B3：窗型计算器策略化

目标：避免系列和窗型逻辑堆在一个函数里。

建议位置：

- `packages/core/src/bom/calculators/`

主要内容：

- 定义 `BomCalculator` 接口。
- 新增 `CasementBomCalculator`。
- 新增 `SlidingBomCalculator`。
- 新增 `TopHungBomCalculator`。
- 新增计算器注册和选择逻辑。

验收标准：

- 不同窗型由不同计算器处理。
- 新增窗型不需要修改大量旧逻辑。

## 五、系列配置任务

### 任务 S1：扩展材料库 Schema

目标：支持系列级型材角色、公式、损耗和限制。

建议位置：

- `packages/schema/src/material.ts`
- `packages/schema/src/material-catalog.ts`

主要内容：

- 增加 `ProductSeries`。
- 增加 `ProfileRule`。
- 增加 `HardwareRule`。
- 增加 `QuoteRule`。
- 增加 `ConstraintRule`。

验收标准：

- 可配置 75 平开、110 平开、120 推拉。
- 系列配置可以被 BOM、报价、校验引擎读取。

### 任务 S2：建立样本系列配置

目标：用真实或接近真实的样本验证架构。

建议位置：

- `packages/schema/src/sample-library.ts`

主要内容：

- 配置 75 平开系列。
- 配置 110 平开系列。
- 配置 120 推拉系列。
- 为每个系列配置型材角色、价格、损耗、五金规则。

验收标准：

- 同一窗型切换系列后 BOM 变化明显且合理。
- 缺失配置时有明确错误。

### 任务 S3：公式计算安全层

目标：支持配置化公式，同时避免直接执行任意代码。

建议位置：

- `packages/core/src/formula.ts`

主要内容：

- 支持简单表达式，如 `outerW`、`sashH - 2 * gap`、`sashCount * 2`。
- 只允许白名单变量和数学运算。
- 公式错误返回可读错误。

验收标准：

- 系列规则可以使用公式计算长度和数量。
- 非法公式不会导致运行时崩溃。

## 六、窗型模板任务

### 任务 T1：定义 WindowTemplate

目标：支持快速生成常见窗型。

建议位置：

- `packages/schema/src/window-template.ts`

主要内容：

- 定义 `WindowTemplate`。
- 定义 `allowedSeriesIds`。
- 定义默认构件布局。

验收标准：

- 模板不依赖前端画布。
- 模板可以生成 `DesignModel`。

### 任务 T2：模板选择和生成

目标：用户选择窗型和系列后自动生成初始结构。

建议位置：

- `apps/web/src/components/studio/StudioRightPanel.tsx`
- `apps/web/src/store.ts`

主要内容：

- 增加窗型模板选择。
- 根据洞口尺寸、系列和模板生成构件。
- 将构件同步到画布。

验收标准：

- 选择“一固定一平开”可生成外框、中梃、固定玻璃、平开扇。
- 选择“两轨两扇推拉”可生成推拉结构。

## 七、校验规则任务

### 任务 V1：新增 validateDesign

目标：在报价和下料前发现设计问题。

建议位置：

- `packages/core/src/validate-design.ts`

主要内容：

- 校验外框闭合。
- 校验中梃连接。
- 校验格子封闭。
- 校验构件归属。
- 校验系列兼容。
- 校验尺寸限制。
- 校验材料配置完整性。

验收标准：

- 返回错误、警告、提示三个级别。
- 错误项包含 `componentId`，前端可定位高亮。

### 任务 V2：前端错误展示

目标：让设计师能快速定位并修正问题。

建议位置：

- `apps/web/src/components/studio/DesignValidationPanel.tsx`
- `apps/web/src/canvas/CanvasController.ts`

主要内容：

- 右侧显示错误列表。
- 画布高亮错误构件。
- 点击错误定位到构件。
- 严重错误阻止导出生产下料单。

验收标准：

- 错误位置和原因清楚。
- 设计师修改后错误自动消失。

## 八、报价引擎任务

### 任务 Q1：新增 QuoteEngine

目标：让报价规则独立于 BOM 生成逻辑。

建议位置：

- `packages/core/src/quote-engine.ts`

主要内容：

- 输入 `DesignModel`、`BomResult`、`QuoteRules`。
- 输出报价明细和总价。
- 支持面积价、材料成本价、开启扇加价、颜色加价、异形加价、玻璃加价、五金加价、安装运输包装、折扣。

验收标准：

- 同一 BOM 可以使用不同报价策略。
- 报价明细能解释金额来源。

### 任务 Q2：报价面板改造

目标：展示更清晰的报价构成。

建议位置：

- `apps/web/src/components/QuotePanel.tsx`

主要内容：

- 显示基础面积价。
- 显示材料成本。
- 显示附加费用。
- 显示优惠和总价。
- 显示报价规则来源。

验收标准：

- 用户能看懂每一项价格为什么产生。
- 导出 PDF 和界面显示一致。

## 九、下料单任务

### 任务 C1：新增 CuttingEngine

目标：从设计模型生成生产下料单。

建议位置：

- `packages/core/src/cutting.ts`

主要内容：

- 输出逐根型材长度。
- 包含型材编码、名称、颜色、长度、数量、切角、位置、构件来源。
- 支持损耗率。

验收标准：

- 一固定一平开可导出外框、中梃、扇料、压线下料。
- 每根料能追溯到画布构件。

### 任务 C2：排料优化

目标：按原材料长度优化切割方案。

建议位置：

- `packages/core/src/cutting-optimizer.ts`

主要内容：

- 支持 6 米料或自定义原料长度。
- 输出每支原料切哪些长度。
- 输出余料。
- 按型材编码和颜色分组优化。

验收标准：

- 能生成可读的排料结果。
- 相同型材、相同颜色才会合并排料。

### 任务 C3：下料单导出

目标：生成生产使用的文档。

建议位置：

- `apps/web/src/util/exportPdf.ts`
- 新增 `apps/web/src/components/CuttingListTable.tsx`

主要内容：

- 下料单表格。
- CSV 导出。
- PDF 导出。
- 区分客户报价图和生产加工图。

验收标准：

- 下料单包含完整字段。
- 生产图纸和报价图纸不会混用。

## 十、测试任务

### 任务 X1：核心引擎单元测试

建议位置：

- `packages/core/test/design-model-bom.test.ts`
- `packages/core/test/series-rules.test.ts`
- `packages/core/test/quote-engine.test.ts`
- `packages/core/test/cutting.test.ts`

覆盖场景：

- 固定窗。
- 一固定一平开。
- 两固定一平开。
- 两轨两扇推拉。
- 上悬窗。
- 观景窗。
- 系列切换。
- 材料缺失。
- 尺寸超限。

验收标准：

- 核心算料和报价有稳定快照测试。
- 修改公式或系列配置时能及时发现结果变化。

### 任务 X2：前端交互测试

建议位置：

- `apps/web` 测试目录，后续可接入 Playwright。

覆盖场景：

- 绘制外框。
- 添加中梃。
- 添加平开扇。
- 修改尺寸。
- 切换系列。
- 查看 BOM。
- 导出报价单。

验收标准：

- 常见设计流程无白屏、无过期 BOM、无错误清单静默导出。

## 十一、推荐里程碑

### Milestone 1：画布能生成可算料模型

包含任务：

- M1
- M2
- M3
- F1 部分完成

结果：现有画布对象可以转换成 `DesignModel`。

### Milestone 2：基础窗型自动 BOM

包含任务：

- B1
- B2
- F3
- F4
- X1 基础用例

结果：固定窗、一固定一平开可以从画布实时生成材料清单。

### Milestone 3：多系列配置化

包含任务：

- S1
- S2
- S3
- B3

结果：75 平开、110 平开、120 推拉可以使用不同规则算料。

### Milestone 4：模板和校验

包含任务：

- T1
- T2
- V1
- V2

结果：可以选择窗型模板生成结构，并在设计时发现问题。

### Milestone 5：报价和下料单

包含任务：

- Q1
- Q2
- C1
- C2
- C3

结果：同一设计可以输出 BOM、报价单和生产下料单。

## 十二、近期建议开工顺序

建议最先启动以下 6 个任务：

1. M1：定义 `DesignModel`。
2. M2：实现 `SketchShape` 到 `DesignModel` 的转换。
3. B1：新增 `computeBomFromDesignModel()`，先支持固定窗和平开窗。
4. S2：准备 75 平开和 120 推拉两个样本系列配置。
5. F1：把工具栏中的“矩形”业务化，先改成“固定玻璃/外框”。
6. F4：让 BOM 面板优先读取画布生成的设计模型。

这 6 个任务完成后，系统就能进入“画完基础窗型即可自动算料”的状态，后续再扩系列、窗型、报价和下料。
