# 门窗设计软件 (Window & Door Designer)

跨平台门窗设计软件：**Windows 桌面端 + Web + Android**。

## 功能模块

- **首页菜单**：门窗设计 / 订单管理 / 型材系列 / 统计 / 个人中心 / 窗型图库 / 客户管理 / 创库管理 / 订单跟踪 / 阳光房设计（图标导航，已开发模块可直接进入，未开发模块提示开发中）
- **门窗设计工作台（三栏式）**：无文字菜单栏的整页工作台。顶栏（Logo + 分享）、左侧绘图工具栏（底部报价/图纸切换）、**中央画布统一使用 Konva 画布实现设计功能（后续图形设计均基于 Konva 开发）**、右侧**可折叠隐藏到右侧边缘**的属性面板（「属性 / 颜色」双页签：窗型、产品系列、总宽高、编号、数量、单价、包装、玻璃、合页、五金、位置、墙厚；外框色/内色可选咖啡色等并实时联动画布）、**页面底部居中工具栏（撤销 / 重做 / 清除 / 删除 / 保存）**
- 2D 图纸设计（Konva 画布，铺满）：**打开与点击「清除」后画布为空白**（仅网格）；绘制的图形为**门窗外框形式**：矩形工具渲染为固定窗俯视图（深灰外框 + 白色内框 + 四角 45° 拼角线 + F1 扇位标注 + 浅灰玻璃区，`FixedWindow` 组件），梯形/尖拱/拱形为外轮廓框料环 + 内缩玻璃区；尺寸标注使用 **`DimensionLine` 组件**（tick + 主线断开 + 28px 蓝色加粗文字，`dim-label` 可点击改参，文字像素恒定）；**交互与状态管理层**——`BaseTool` + `ToolManager`（SelectTool / RectTool / TrapezoidTool / GothicArchTool 尖拱 / ArchTool 拱形 / LineTool / TextTool），四层图层（网格 / 图形 / 标注最上层 / 预览），`shapes: Konva.Node[]` 增删改触发 onChange；滚轮缩放 + 空格拖拽平移，世界坐标(mm)⇄画布坐标互转；选中后单击拖拽移动、Transformer 控制点缩放、Delete 删除、Ctrl+Z/Y 撤销重做
- 3D 预览：**Three.js** 整屏渲染页，**仅渲染当前画布上的图形**——按外框轮廓挤出成「外框环 + 玻璃」实体（ExtrudeGeometry），颜色跟随 外形颜色/内色实时更新；顶部居中图标栏含 首页 / 2D 设计 / 颜色设置
- 型材 / 玻璃 / 五金 / 辅料材料库
- 自动算料 / 下料单（BOM，含中梃与辅料，可导出 CSV）
- 报价 / 折扣计算，导出报价单 CSV
- 订单管理：提交订单并持久化到服务端，订单记录查看

## 技术栈

- 语言：TypeScript（全栈）
- UI：React + Ant Design
- 2D：Konva.js + 自研尺寸链约束
- 3D：Three.js
- 状态：Zustand
- 桌面：Electron
- 移动：Capacitor（后续）
- 服务端：NestJS + Prisma + PostgreSQL

## 工程结构

```
window-door-designer/
├─ packages/
│  ├─ schema/   # Zod 材料库 schema + 型材系列数据
│  └─ core/     # 领域引擎：几何/窗型模型/算料 BOM/报价（纯 TS）
└─ apps/
   ├─ web/      # Web 端 (Vite + React)
   ├─ desktop/  # Electron 桌面壳 (Windows)
   └─ server/   # NestJS 服务端（订单/材料云同步）
```

## 常用命令

```bash
npm install          # 安装全部依赖
npm run build        # 构建 schema + core + web
npm run dev          # 启动 Web 开发服务器
npm test             # 运行 core 领域引擎测试
npm run dev:desktop  # 启动桌面端
npm run dev:server   # 启动服务端（订单默认 JSON 文件持久化，数据存 data/orders.json）
```

## 快速开始

1. `npm install`
2. `npm run dev` 打开 http://localhost:5173
3. 在左侧选择窗型 → 中间画布可点击扇面并分格/编辑 → 右侧查看 BOM 与报价 → 填写客户提交订单
4. 需要订单服务时先 `npm run dev:server`（默认 http://localhost:3000），Web 通过 `VITE_API_BASE` 指向该地址

## 服务端订单持久化

- 默认使用本地 JSON 文件仓库（`apps/server/data/orders.json`），重启不丢数据，无需外部数据库。
- 仓库实现位于 `apps/server/src/orders/orders.repository.ts`，遵循 `OrderRepository` 接口；如需切换 PostgreSQL + Prisma，实现同一接口替换注入即可，业务层无需改动。