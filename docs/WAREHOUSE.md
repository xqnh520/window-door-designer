# 仓库管理（WMS）· 第一期

门窗 / 材料库存管理：库存总览、入库、出库、盘点、流水追溯、缺料预警、多仓库与库位主数据、BOM 一键领料出库。
入口：首页菜单「仓库管理」卡片（`apps/web/src/components/HomeMenu.tsx`）→ `App.tsx` 的 `tab === 'warehouse'` 整页分支。

## 一、架构总览

```
packages/schema/src/material-catalog.ts   IMaterial / IInventory / IMaterialCost / IInventoryTransaction + zod + 编码生成器
packages/schema/src/warehouse-catalog.ts  IWarehouse + zod + 仓库编码生成器
packages/core/src/bom.ts                  computeBom / computeBomFromDesignModel → BomResult
packages/core/src/bom-pick.ts             BOM → 领料行匹配（纯函数，有单测）
apps/server/src/materials/                NestJS：materials / inventory / warehouse 三个 controller + 两个 service + JSON 仓储
apps/web/src/warehouse/                   React：api / store / types / 页面与弹窗
```

数据落在 `apps/server/data/materials.json`（`JsonFileMaterialsRepository`）。
`apps/server/prisma/schema.prisma` 里 Material / Inventory / MaterialCost / InventoryTransaction / Warehouse 五张表已与之对齐，
**但当前不接数据库**（本地 PostgreSQL 未启动）；日后切 Prisma 只需替换仓储实现，Service / Controller 不动。

## 二、API 契约

### 物料档案 `/materials`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/materials?category=&status=&keyword=` | 列表（排除软删） |
| GET | `/materials/:id` | 详情 |
| POST | `/materials` | 新建；`code` 留空自动生成 `AL-6063-T5-01` 风格 |
| PATCH | `/materials/:id` | 更新 |
| DELETE | `/materials/:id` | 软删除（`isDeleted`） |
| GET/PUT | `/materials/:id/cost` | 采购成本 |
| GET | `/materials/:id/transactions` | 该物料流水（不分页） |

### 库存 `/inventory`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/inventory?warehouseId=&category=&onlyWarning=1` | 库存行（附物料、仓库名、`warning`）；物料已软删的行不返回 |
| GET | `/inventory/summary?warehouseId=` | 按仓库汇总 + 全局缺料条数（页签角标用） |
| GET | `/inventory/transactions?materialId=&transactionType=&warehouseId=&keyword=&from=&to=&page=&pageSize=` | 流水分页；`from`/`to` 按 ISO 字符串比较，按日筛选需补全为 `T00:00:00` / `T23:59:59.999` |
| PATCH | `/inventory` | 维护 `safetyStock` / `maxStock` / `lockedQty`，不产生流水 |
| POST | `/inventory/inbound` | 入库，`quantity > 0` |
| POST | `/inventory/outbound` | 出库，校验 `availableQty`，流水记负数 |
| POST | `/inventory/adjust` | 盘点：`currentQty` **设为** `countedQty`，流水记差额（无差异也留痕） |
| POST | `/inventory/batch-outbound` | 批量领料，恒 2xx 返回 `BatchResult` |

### 仓库主数据 `/warehouses`

GET 列表 / GET `:id` / POST 新建（`code` 留空自动生成 `WH01`）/ PATCH 更新 / DELETE 软删除。
库位是仓库下的 `locations: string[]`（服务端统一去空白、转大写、去重），不是独立实体 —— 库存复合键
`(materialId, warehouseId, locationCode)` 因此保持不变。

### 关键语义

- **可用量**：`availableQty = currentQty - lockedQty`；`lockedQty` 目前只能手工维护，尚未与生产订单联动。
- **缺料预警**：`safetyStock > 0 && availableQty < safetyStock`。
- **出入库前置校验**：仓库必须存在且启用，库位必须属于该仓库（`WarehouseService.assertWarehouseLocation`）。
- **批量领料两阶段**：阶段一只读校验（同库位多行按**合计**需求量判断），阶段二才写入，且只在末尾 `persist()` 一次。
  默认 all-or-nothing；任一行不满足就整单不写，端点仍返回 200 + `BatchResult{ok:false, results[].error}`，
  由前端渲染失败明细（「哪几行不足」是业务数据，不是 HTTP 错误）。`allowPartial=true` 时逐行提交、失败行跳过。
  `relatedDocNo` 已有流水则拒绝，作为重复提交的幂等兜底。
- **删除保护**：仓库有结存库存、或删后一个仓库都不剩 → 拒绝；删除库位前校验该库位无结存。

## 三、前端结构（apps/web/src/warehouse/）

| 文件 | 职责 |
|---|---|
| `types.ts` | 行视图与 DTO（实体本身复用 `@wdd/schema`） |
| `api.ts` | `warehouseApi`，仿 `crm/api.ts` 的 `request<T>` + `qs()` |
| `store.ts` | `useWarehouseStore`（zustand，纯内存）。载入类 action 吞异常写 `error`，变更类 action 抛出由调用方提示 |
| `WarehousePage.tsx` | 容器：仓库切换 + 四页签 + 缺料角标 |
| `InventoryOverview.tsx` | 汇总卡片、缺料筛选、库存表（行内发起入库/出库/盘点、行内改安全库存） |
| `TransactionList.tsx` | 流水筛选 + 服务端分页 |
| `MaterialCatalogTab.tsx` | 物料档案，复用 `components/MaterialForm.tsx` |
| `WarehouseSettings.tsx` | 仓库与库位维护（库位用 `Select mode="tags"`） |
| `StockOpModal.tsx` | 入库/出库/盘点共用一个弹窗，`Segmented` 切换 |
| `BatchPickModal.tsx` | BOM 领料出库 |
| `docNo.ts` | 单据号 `PO/WO/IC-yyyyMMdd-序号`，序号存 localStorage |

页签：库存总览（带缺料角标）/ 出入库流水 / 物料档案 / 仓库设置。
预警不单独开页签 —— 它是库存的子集，独立页签等于两份表格代码。

## 四、BOM → 领料的数据对齐（核心难点）

设计器算料出的 `BomItem.materialId` 来自样例库（`p-frame-60` / `g-5mm`），`BomItem.code` 是样例库编码
（型材 `LK60-01`、五金 `HW-HG01`、辅料 `AC-SE01`，**玻璃的 code 等于玻璃名称**，见 `packages/core/src/bom.ts`）；
而档案物料是 uuid + `AL-6063-T5-01` 风格编码。两套 id 天然对不上，所以 `bom-pick.ts` 按
**编码精确 → 名称精确 → 名称互含 → 同分类且规格互含** 逐级降级匹配，并在 `PickLine` 里严格区分
`bomMaterialId`（仅展示）与 `materialId`（才可提交）。

未匹配行可手工指定，或点「建档」一键建物料：建档时沿用 BOM 编码（含中文的，如玻璃名，则留空让服务端生成 `GL-…`），
**下次同一 BOM 就能自动匹配**；若服务端报「编码已存在」，前端直接把既有档案回填到该行。
型材的 BOM 规格尾巴带每根料长度（`…框料60 760mm`），建档时会去掉，避免同一型材裂成多条档案。

领料数量 = BOM 单樘用量 × 樘数（弹窗顶部可改，默认 1）。
入口只有一处：`components/BomTable.tsx` 的「领料出库」按钮 —— 该组件同时被 `App.tsx` 与设计器 Studio 渲染，一处改动两处生效。

## 五、运行与验证

```bash
npm run dev:server        # NestJS，:3000，JSON 持久化
npm run dev               # 先 build schema+core 再起 vite :5173
npm run typecheck         # 全部 workspaces
npm test                  # packages/core（node:test），含 bom-pick 匹配算法单测
node apps/server/scripts/smoke-warehouse.mjs   # 后端 30 项冒烟（需服务端已启动，可重复执行）
```

改 `packages/schema` 后必须先 build 再 typecheck web，否则 web 读的是旧 `dist` 类型。

手工回归清单：

1. 首页 → 仓库管理 → 库存总览（首次进入应看到种子仓 WH01 与三个库位）
2. 仓库设置 → 新建仓库 + 录入库位 → 总览的仓库下拉切换，汇总卡片随之变化
3. 物料档案 → 新增物料（编码留空自动生成）
4. 入库 100 → 出库 30 → 盘点填 65 → 流水页签应有 3 条且 `变动前/后` 连续（0→100→70→65，盘点记 −5）
5. 把安全库存改成 80 → 该行标红「缺料」、页签角标 +1、「只看缺料」只剩它
6. 2D 设计 → 材料 → 领料出库 → 樘数 2 → 提交 → 流水里同一单据号多条、数量 = BOM×2

## 六、已知取舍

1. **JSON 仓储只适合单实例**：`persist()` 是全量同步写文件，多进程会互相覆盖。批量操作已合并为一次落盘。
2. **两套物料数据源并存**：首页「型材系列 → 材料库」页仍是浏览器 localStorage 的样例档案（`MaterialLibrary.tsx`，未改动），
   仓库页的物料档案来自服务端。物料档案页签顶部有 Alert 明示两者独立。
3. **`lockedQty` 无业务写入口**：可用量等于结存量，出库校验偏乐观；需要时通过 `PATCH /inventory` 手工维护。
4. **玻璃匹配率与单位口径**：玻璃按「块」领料，档案若按「平方米」建，领料行会给出单位不一致提示，需人工换算。
5. **单位枚举放宽**：为承接 BOM，`MaterialUnit` 增加了 `'块' | '把'`（`packages/schema` 与服务端 types 同步），
   按单位汇总的报表口径需注意。
