# windoorcraft「型材系列」功能与公式体系规格

采集自 https://windoorcraft.com/home →「型材系列」（试用账号 2026-09-10 到期），页面 `/product-manage/index`、公式编辑器 `/product-manage/product-script/{product_id}/{type}?from_type=0`，样例系列 **110平开系列（id=155862）**。立场：只提炼功能/数据规格，不搬代码。

## 1. 系列列表页（product-manage/index）

- 系列以「目录卡片」列表展示（图 + 名称 + 「更多」菜单 + 教程），顶部有搜索（系列名）、材料管理、新增目录、完成。
- 样例 6 个系列：110平开系列 / 108平开系列 / 侧压平移气密窗 / 888三轨推拉 / 110三轨推拉 / 平开门。
- 每张卡片「更多」菜单 = **查看公式 / 克隆**；「查看公式」进入公式编辑器。
- 系列由目录（catelog_id=1699 等）归类；`order_format?productID=` 返回该产品的下单选项表（1054 条：type3/4=『组合、每型组合499×2、value 形如 ["1","3"]，price 1.00』、type7/8=颜色、type10=位置"2楼"、type99=特殊项…）。

## 2. 公式编辑器布局（product-script/{pid}/{type}）

```
┌ 面包屑: 型材系列 / 110平开系列   [返回上一级]  [测试公式 ⇄ 隐藏测试公式]
├ 左: 窗型分类  平开 | 推拉 | 复古门 | 肯德基门 | 中式门窗 | 自由画 | 订单
├ 中: 画布（Konva，工具条: 常用/框/梃/扇/格条/标线/其他 + 撤销/删除/清除/导入）
│    下方「计算结果」表区
├ 右: 变量页签  属性 | 自定义变量 | 系统可用变量
└ 公式分类页签: 外框公式 | 内扇公式 | 对开扇公式 | 推拉扇公式 | 折叠扇公式
                | 产品报价 | 成本核算 | 计件工资 | 设计规则 | 打孔设置
```

- **窗型分类 tab** 决定公式作用于哪种窗（平开/推拉等）；URL 里的 `{type}` 即窗型序号。
- **公式分类 tab** 下是若干可折叠 panel（外框公式下：扇尺寸 / 型材 / 玻璃 / 配件 / 产品报价 / 成本核算 / 设计规则；打孔设置下：基础图元 / 排水孔 / 刻线孔 / 执手孔 / 合页·插销孔 / 组装孔 / 螺丝孔 / 安装孔 / 端铣）。
- **型材 panel 再按角色分子面板：边框 / 附框 / 固玻压线 / 连接件 / 转角**。

## 3. 公式表（以「外框公式 → 型材 → 边框」为例）

表头：`编号 | 名称 | 位置 | 长度 | 类型 | 颜色 | 边位 | 方位 | 有效条件`

| 编号 | 名称 | 位置 | 长度 | 类型 | 颜色 | 边位 | 有效条件 |
|---|---|---|---|---|---|---|---|
| 110断桥窗 | 边框 | 边框-中梃 | `cc-1294` | 边框 | 灰色 | 上 下 | 开向="外开" |
| 110断桥窗 | 边框 | 边框-中梃 | `cc-1851` | 边框 |  | 左 右 |  |

- **位置** = 「宿主-端点」枚举（边框-中梃 …），决定这根料搭接在哪两个部件之间。
- **长度** = 公式引用 `cc-N`（N 为系统公式库的记录号）或内联表达式。
- **边位** = 该料用于 上/下（横料）或 左/右（竖料），同一条公式可覆盖多边。
- **有效条件** = 生效开关，如 `开向="外开"`（引号内是可枚举变量值）。
- 下拉字典（script_config，前端 TO）覆盖：bar.type 41 种、pos_type（frame 28 / mullion 32 / spec 33 / track 7…）、side_position 4 种（上/下/左/右）、angle 3 种（45-45 等）。

## 4. 公式的两种形态（关键）

1. **内联表达式（数量公式）**：直接写「变量 + 四则运算」。示例（配件）：
   - `count: "(框宽*2+框高*2)/500"` —— 螺丝 3.0X19mm 用量
   - 报价 `count: "外框面积"`
2. **公式引用（长度公式）**：`length: "cc-1294"` 指向公式库记录；同一产品下每条料独立引用，»上/下« 与 »左/右« 各配一条，说明长度按边位分组配置。

## 5. 系列配置数据模型（GET /api/default_product_info/{product_id}）

```jsonc
data: {
  id: 155862, name: "110平开系列", catelog_id: 1699, company_id: 1,
  material_automatic: 0, material_automatic_cost: 1,
  show_setting: { /* 料宽字典，见下 */ },
  draw_setting: { /* 画图行为开关 */ },
  product_detail: {...},
  profile_relations: null,
  product_bar: [...17 项型材], product_glass: [...3], product_addon: [...10],
  product_cost: [0], product_rule: [0], product_offer_price: [...5], product_wage: [0]
}
```

### 5.1 show_setting —— 料宽字典（与 draw 画布 `view.params` 同源同值）

```jsonc
{ "frame": 40, "sash": 60, "bead": 22, "glassGap": 6, "upSash": 60, "downSash": 60,
  "screen": 60, "subFrame": 24, "antiTheft": 24, "kfcWaist": 200, "doorBeam": 100,
  "connector": 60, "interlock": 60, "shadeSash": 60, "innerFrame": 45, "sashHolder": 100,
  "sashMullion": 60, "antiTheftGap": 120, "cornerJoiner": 100, "frameMullion": 40,
  "millingFrame": 5, "shadeMullion": 35, "frameMullionLg": 0, "antiTheftHandleW": 240,
  "antiTheftMullion": 45, "antiTheftHoleHeight": 240, "reinforcedFrameMullion": 90 }
```
（帧料 40 / 扇料 60 / 压线 22 / 玻璃缝 6 —— 与画布测量出的 40mm 框、22mm 压线一致）

### 5.2 draw_setting —— 画图行为

```jsonc
{ "nonGap": 0, "connector": 60, "cornerJoiner": 100, "drawPolyType": "bridge",
  "sashBeadShown": 1, "fixedBeadShown": 1, "sashOutwardOpen": 1, "fixedDimToGround": 0,
  "sashEdgeJointWay": 0, "withTurningFrame": 1, "drainHoleAvoidMul": 1,
  "frameEdgeJointWay": 0, "reverseInnerOuter": 0, "sashDoubleWayOpen": 0,
  "syncOpenDirection": 1, "fixedSashToFixedGlass": 0,
  "decorationLockPosition": "none", "slideFrameEdgeJointWay": 2, "topViewHidden": 0 }
```

### 5.3 product_bar（17 项，型材出料配置）—— 样例行

```jsonc
{ "code": "110断桥窗", "name": "边框",
  "length": "cc-1294", "count": "1",
  "type": "frame", "pos_type": "4", "angle_one": "45-45", "angle_two": "",
  "color": "灰色", "condition": "开向=\"外开\"",
  "side_position": "up,down", "direction": "1",
  "bar_height": 90, "bar_width": 90, "meter_weight": 0,
  "is_optimize": 1, "script_type": "frame", "script_purpose": "bar", "auxibar": 0 }
```
17 项覆盖角色：边框 / 附框 / 固玻压线 / 连接件 / 转角（面板 5 个子目录）+ 各自位置/边位组合。

### 5.4 product_glass（3 项）

```jsonc
{ "specs": "5+20A+5", "name": "固玻", "length": "cc-62", "count": "",
  "type": "fixedNet", "pos_type": "4", "condition" }
```
（另两项应为中空/纱网类：type fixedNet / …）

### 5.5 product_addon（10 项，配件出料）—— count 用内联公式

```jsonc
{ "code": "SCR19", "name": "螺丝3.0X19mm",
  "count": "(框宽*2+框高*2)/500", "type": "frameAddon" }
```

### 5.6 product_offer_price（5 项报价规则）

```jsonc
{ "name": "断桥", "price": "148", "calc_type": "frame", "scope": "all",
  "count": "外框面积", "as_order_area": 1, "discount": 10, "condition" }
```
（count 同样是表达式：外框面积 / 洞口面积…，支持的变量来自变量字典）

## 6. 变量（右侧「属性 / 自定义变量 / 系统可用变量」）

「属性」面板字段（窗属性，即系统可用变量的来源）：
`总宽 总高 面积 窗号 樘数 单价 外色 包套 玻璃 合页 五金 锁具 位置 墙厚 纱网 边封 外框 内色 安装 下轨`

- 「系统可用变量」：内建变量字典（框宽/框高/面积/开向/樘数…，供公式内联引用）。
- 「自定义变量」：系列自定义量，公式里可引用。

## 7. 打孔设置（基础图元）—— 排水孔样例（4 行）

表头：`位置 | 打孔编码 | 打孔型材 | 数量 | 长度 | 边距 | 搭接量 | 方向 | 有效条件 | 操作`

| 位置 | 打孔编码 | 打孔型材 | 数量 | 长度 | 搭接量 | 方向 |
|---|---|---|---|---|---|---|
| 固玻下框 | 110框排水 | 110外框 | 1 | 0-500 | 5 | 顺时针 |
| 扇下框 | 110框排水 | 110外框 | 1 | 0-500 | 5 | 顺时针 |
| 固玻下梃 | 110梃排水 | 110中梃 | 1 | 0-500 | 5 | 正向 |
| 扇下梃 | 110梃排水 | 110中梃 | 1 | 0-500 | 5 | 正向 |

- 打孔图元 = 基于「型材上打孔」的规则表：位置(在哪根料) → 打孔编码(图元) → 数量/长度区间(0-500)/搭接量/方向(顺时针|正向)/条件。
- 「基础图元」子面板底部的「打孔编码 | 图元详情」计算结果表：当前产品 0 行（图元详情未配置关联，只有先配置了图元才回填）。

## 8. 底部「计算结果」表区（公式引擎输出区，画窗后回填）

| 表 | 列 |
|---|---|
| 总览 | 类型 \| 计算结果 |
| 型材 | 编号/名称 \| 计算结果 \| 类型 \| 切角 \| 颜色 |
| 玻璃 | 规格/名称 \| 计算结果 \| 类型 |
| 配件 | 编号/名称 \| 计算结果 \| 规格 \| 类型 \| 颜色 |
| 报价 | 成本项目 \| 单价 \| 数量 \| 单位 \| 备注 \| 计算结果 |
| 成本核算 | 环节名称 \| 单价 \| 数量 \| 计算结果 |

当前样例因未在画布画窗，各行均为空；「测试公式」隐藏/显示只切换视图，不影响公式表格内容（URL query `from_type=0` 不变）。

## 9. 与我方实现的对齐点

1. 我方 `@wdd/schema` 的 SeriesSpec `profileWidths`/`view.params` 料宽参数 ⇔ windoorcraft `show_setting`（同名同义，frame=40/sash=60/bead=22/glassGap=6）。
2. 我方 `profileFormulas`（按 框/扇/中梃/压线 角色的 length/count）⇔ windoorcraft 按 **边位(up/down/left/right) + 位置(边框-中梃) + 有效条件** 组织的出料行 —— 他们用 `cc-N` 长度公式引用 + count 内联表达式，条件用 `变量="枚举值"`。
3. 我方 BOM 配件用量（perM2 等）⇔ addon `count: "(框宽*2+框高*2)/500"` 内联公式。
4. 我方报价项（QuotePanel）⇔ offer_price `count` 表达式 + `scope` + `discount`。
5. 打孔/排水孔 → 我方尚未实现，可作为后续迭代（型材孔位规则表）。