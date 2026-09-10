# 门窗客户管理系统（CRM）· 第一期 MVP

> 本系统与既有 React 2D/3D 门窗设计器无缝衔接：设计方案（Konva 画布数据）以 JSON
> 存入数据库，加载时 100% 回显到画布继续编辑。
>
> 覆盖：客户管理 / 跟进记录（时间轴）/ 设计方案（Konva）/ 订单状态流转。

---

## 一、架构总览

```text
┌─ 前端 (apps/web/src/crm/) ──────────────────────────────┐
│  CustomerListPage      客户列表（搜索/筛选/分页/建档）      │
│  CustomerDetailPage    客户详情（信息/跟进时间轴/方案/订单）│
│  store.ts              useCrmStore（Zustand 切片 + actions）│
│  api.ts                crmApi（类型化 fetch，/crm/*）      │
│  konva.ts              designData ⇄ 设计器 Store 桥接       │
│  types.ts              类型（与 Prisma 一一对应）            │
└──────────┬───────────────────────────────────────────────┘
           │ REST /crm/*（fetch）
┌──────────▼───────────────────────────────────────────────┐
│ 后端 (apps/server/src/crm/) 【NestJS】                     │
│  customers/followups/schemes/orders.controller.ts         │
│  crm.service.ts           业务逻辑 + 校验                  │
│  prisma.crm.repository.ts PostgreSQL + Prisma 持久化        │
└───────────────────────────────────────────────────────────┘
           │ 与设计器交点（apps/web）
           ├─ 保存方案：DesignStudio「保存方案」→ useStore(shapes/orderConfig) → crmApi
           └─ 加载回显：prepareCrmScheme() → useStore 预装 → ShapeCanvas initialModels
```

## 二、数据库 Schema（已写入 apps/server/prisma/schema.prisma）

CRM 四表 + 枚举（与材料库模型共存）：

| 表 | 关键字段 | 关系 |
|---|---|---|
| `Customer` | name / phone(唯一) / community / houseType / budget(万元) / source / status | 1:N FollowUp / DesignScheme / Order |
| `FollowUp` | content / nextFollowDate / createdAt(时间轴) | N:1 Customer（Cascade） |
| `DesignScheme` | totalWidth / totalHeight / seriesName / **colorConfig(Json)** / **designData(Json)** / schemaVersion | N:1 Customer（Cascade）；1:N Order |
| `Order` | status / totalAmount / deposit / balance / remark / schemeId? | N:1 Customer（Cascade）；N:1 DesignScheme（SetNull） |

枚举：`CustomerStatus`(A_HOT/B_WARM/C_COLD/MEASURED/SIGNED/LOST)、
`OrderStatus`(PENDING_PRODUCTION/IN_PRODUCTION/SHIPPED/PENDING_INSTALL/COMPLETED/AFTER_SALES)。

## 三、API 契约（前端 crmApi ↔ 后端 /crm/*）

| 方法 | 路由 | 说明 |
|---|---|---|
| GET / POST | `/crm/customers` | 列表（page/pageSize/status/keyword） / 建档（phone 冲突 409） |
| GET / PATCH / DELETE | `/crm/customers/:id` | 详情 / 更新·状态流转 / 删除（级联） |
| GET / POST | `/crm/customers/:id/follow-ups` | 跟进时间轴 / 添加跟进（nextFollowDate 可空） |
| GET | `/crm/customers/:id/schemes` | 方案列表（摘要，不含 designData） |
| POST | `/crm/schemes` | 新建方案（designData + colorConfig 落库） |
| GET / PUT / DELETE | `/crm/schemes/:id` | 完整回显 / 保存新版本（覆盖 + updatedAt）/ 删除（订单 SetNull） |
| GET / POST | `/crm/orders` | 订单列表 / 创建订单（校验方案属于该客户，金额快照落库） |
| GET / PATCH / DELETE | `/crm/orders/:id` | 详情 / 状态流转·收款 / 删除（误建清理） |

## 四、前端 Store（useCrmStore 切片）

```text
customers / customerTotal / page / keyword / statusFilter / loadingList
selectedCustomerId / currentCustomer / followUps / schemes / currentScheme / orders / loadingDetail
actions: fetchCustomers · create/update/removeCustomer · loadCustomerDetail
         add/removeFollowUp · refreshSchemes · setCurrentScheme · setSchemeSaved
         removeScheme · fetchOrders · createOrder · updateOrder(status/deposit/balance)
```

## 五、Konva 方案数据流（核心）

### 保存（设计器 → 数据库）
```text
画布编辑 → useStore.shapes 实时同步（既有链路）
  → 底部「保存」按钮（CRM 模式 / 普通模式同一设计器，仅底部一个保存工具）
  → 未选择客户时弹出守卫弹窗：选择已有客户 / 新建客户 / 取消退出
      （确认后自动绑定 customerId 再保存）
  → collectDesignerPayload()
      = { shapes(ShapeModel[]), colorConfig(outer/inner), totalWidth/H, seriesName }
  → POST/PUT /crm/schemes → designData Json 整存 PostgreSQL
  → 保存成功自动回到该客户详情页
```

### 加载回显（数据库 → 画布 100% 还原）
```text
客户详情 → 方案列表 → 「进入设计」
  → prepareCrmScheme(scheme)【必须在画布挂载前】：
      setShapesFromCanvas(designData)   // 图形
      setOpeningSize(totalWidth/H)      // 尺寸 → 绘图区域/洞口联动
      setSeries(seriesName→id)          // 系列 → 框料宽度级联
      setOrderConfig(colorConfig)       // 颜色 → 画布实时刷新
  → DesignStudio(key=方案id) 挂载 → ShapeCanvas 以 useStore.shapes 初始化
  → 继续编辑 → 再「保存方案」→ PUT 覆盖 + updatedAt 刷新
```

## 六、运行

```bash
# 1. 启动后端（NestJS，CRM/订单/材料均为本地 JSON 持久化）
npm run dev:server          # http://localhost:3000（数据文件 data/crm.json）

# 2. 启动前端
npm run dev                 # ✅ http://localhost:5173 → 首页「客户管理」

# 3.（接入 Prisma 时）
cd apps/server
npm i -D prisma @prisma/client
npx prisma migrate dev --name crm_init      # 按 schema.prisma 建表
# 然后实现 JsonFileCrmRepository 的 Prisma 版本（同一接口替换注入即可）
```

## 七、本期设计决策

1. **后端选型 NestJS**：与仓库既有工作区一致（底层即 Express），DTO/Service/Repository 分层与 Prisma 天然契合。
2. **已接入 PostgreSQL + Prisma**：`apps/server/.env` 配置 `DATABASE_URL`（wdd_crm）；`npx prisma db push` 建表；仓库层 `PrismaCrmRepository`（读取时全量快照入内存、写入时事务内全量对账），`JsonFileCrmRepository` 保留为离线备选。
3. **designData Json 整存**：Konva `ShapeModel[]` 全部可序列化，无需拆表；大字段只在详情接口返回，列表摘要剔除。
4. **金额 Float**：MVP 够用；对精度敏感时可改 `Decimal @db.Decimal(12,2)`（schema 注释已标）。
5. **路由仍用 App 内 tab 状态**：未引入 React Router；第二期如需 URL 直达/面包屑，可平滑迁移（页面组件已与路由解耦）。

## 八、后续路线（第二期候选）

- [ ] React Router 化 + 深链接（/crm/customers/:id）
- [ ] 登录鉴权（operatorId 落地到 createdBy/updatedBy）
- [ ] 客户软删除 + 回收站
- [ ] 方案版本历史（快照表 / Json[]）
- [ ] 订单号自动生成 + 收款流水
- [ ] 跟进到期提醒（nextFollowDate 看板）
- [ ] 报价接口（复用 @wdd/core computeBom/quote 于服务端）

## 九、已知问题与迁移说明（2025-08-27 修复）

1. **客户详情页空白（白屏）**：根因是 App.tsx 在分支内条件调用 zustand 钩子（违反 Hooks 规则）→ 已提升到组件顶层；另方案列表为摘要（无 designData），「进入设计」前改为先拉取完整方案，并防御 designData 缺失。
2. **设计器统一**：CRM 方案模式与首页设计器为同一 DesignStudio，顶栏不再额外显示「保存方案」按钮；保存统一走底部「保存」按钮。
3. **数据库切换**：旧 JSON 数据（data/crm.json）不会自动迁移，如需导入请手工插入或写一次性脚本；当前运行中的 3000 端口服务为旧构建，**重启（npm run dev:server）后即连接 PostgreSQL**。
