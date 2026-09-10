# windoorcraft 构件绘制规格采集

目标：逐构件拿到 windoorcraft.com（画门窗）在 2D 画布上的**绘制方式**，作为我方 `packages/core` 渲染层的模仿依据。
立场：只采集**可观察的几何/视觉规格**（图形分层、点序、颜色、线宽、符号画法），**不搬运其混淆源码**（约定见项目记忆 `windoorcraft-no-code-copy`）。

入口：`https://windoorcraft.com/login`（用户自有账号）→ 首页「设计门窗」→ `/draw?drawType=2`（**自由画**模式）。

---

## 1. 构件清单（7 类，菜单项 111 个）

工具条分 7 个 tab（`.v-tabs .v-tab`），面板为 `.v-window-item[0..6]`，每项 = `.v-card` 内 `.iconfont` + `.keep-all` 标签。

| 面板 | 索引 | 项数 | 条目 |
|---|---|---|---|
| 常用 | 0 | 8 | 外框 / 横竖梃 / 玻扇 / 纱扇 / 防盗框 / 推拉扇 / 折叠扇 / 转角窗 |
| 框 | 1 | 40 | 外框 / 拱形 / 门 / 缺边肯德基 / 缺边肯德基2 / 肯德基门 / 肯德基门2 / 肯德基门4 / 圆 / 立体圆弧窗 / 平行四边形 / 半圆 / 四分之一圆 / 哥特式 / 洋葱 / 八边形 / springlineflanker / 等腰三角形 / 六边形 / 六边形2 / 六边形3 / 菱形 / angledpentagon / 三角顶 / 梯形 / 四分之一拱 / hollowside / 凹 / 凸 / 四叶草 / extendedpartialarch / 三角形 / 单耳窗 / framepointedear / 双耳窗 / 异形外框 / 异形外框 / 波浪 / 清真寺 / 异形 |
| 梃 | 2 | 19 | 横竖梃 / 横竖梃(等分) / 等分分体圆弧 / 二阶分体圆弧 / 圆弧中梃 / 连体圆弧 / spin_mullion / compoundsquare×2 / compounddiamond / compoundcircle / compoundhexagon / halfhexagon / 四角 / 八角 / 长八边形 / 双八边形 / 波浪 / 扇中梃 |
| 扇 | 3 | 21 | 玻扇 / 纱扇 / 防盗框 / 双内开扇 / 内倒平移扇 / 对开扇 / 对开纱扇 / 肯德基门 / 对开肯德基门 / 百叶窗 / 对开百叶窗 / 玻璃护栏 / 四扇对开 / 扇中扇 / 时尚门 / 微通风扇 / 降扇纱框 / 推拉 / 折叠玻扇 / 折叠纱扇 / 护栏晾衣架 |
| 格条 | 4 | 31 | 格条 / 中式格条2 / 中式格条3 / chinese5 / 中式格条4 / 矩形格条 / 经典格条 / 均分格条 / diamond / wheel×2 / innerArc / innerArc2 / wheel1 / wheel3 / innerArc / topBar×3 / 对开格条 / xFlip / arc3 / xFlip / arc2 / xFlip / arc / arc2 / crabapple / inner / angle / arc |
| 标线 | 5 | 9 | 水平标线 / 垂直标线 / 任意标线 / 圆弧标线 / 角度标线 / 标注 / 参考标线男 / 参考标线女 / 清除 |
| 其他 | 6 | 13 | 墙体 / 转角窗 / 连接件 / 转角墙 / 全景转角 / 玻璃 / 纱网 / 板材 / 百叶 / 空填充物 / 打孔 / fillerFan / 内框 |

## 2. 工具 id 全表（`view.toolManager.tools` 键名，共 261）

比菜单更细的权威词表（含方向变体）。前缀计数：`frame_*` 96、`decoration_bar_*` 34、`mullion_*` 32，其余为扇/填充/连接件/编辑手柄。

- 扇类 id：`sash`(玻扇) `screen`(纱扇) `topHungSash` `guardSash` `airSash` `sashHolder` `screenSashHolder` `commercialSash` `sashScreenIntegrated` `innerSashAndScreen` `innerSash` `innerScreen` `downWithSlideSash` `kfcSash` `doubleKfcSash` `doubleSash` `doubleScreen` `doubleCommercialSash` `shadePushSash` `doubleShadePushSash` `foldSash` `foldScreen` `foldShade` `foldDouble` `pushGroup` `slide` `shadeSlide` `stylishDoor`~`stylishDoor6` `halfGuardWithGlass` `guardWithGlass` `doubleGuardWithGlass` `theftWithFrame`~`theftWithFrame3` `antiTheft` `door` `commercialSash`
- 梃类 id：`mullion_cross_line`(+`_equal_two`/`_equal_three`/`_equal_four`) `mullion_horizontal` `mullion_vertical` `mullion_diagnoal` `mullion_counterdiagnoal` `mullion_half_wheel` `mullion_crossties` `mullion_semi_arc`(+`_pro`/`_pro2`) `mullion_semi_segment_pro` `mullion_spin` `mullion_frametify_like` `mullion_door_hole_split` `mullion_inner_eq_split` `mullion_inner_121_split` `mullion_inner_121_slide_split` `mullion_compound_square|diamond|circle|hexagon|x_square|rectangle_single|rectangle_double|long_octagon|double_octagon` `mullion_wave` `mullion_inner_arc` `mullion_half_hexagon`
- 格条 id：`decoration_bar_half_wheel|wheel|innerArc|innerArc2|semi_arc_wheel1|semi_arc_wheel3|semi_arc_innerArc|semi_arc_*_topBar|quarter_arc(_xFlip)|quarter_arc2(_xFlip)|quarter_arc3(_xFlip)|double_arc|double_arc2|extendable_arc|crabapple|crabapple_inner|right_angle|chinese|chinese2..5|rect|custom|prairie|prairie_frame|colonial|diamond`
- 填充/其他：`fillerGlass|Panel|Empty|Shade|Screen|Fan` `glassHole` `profileStruct` `wall` `connerJoiner` `wallCornerJoiner` `panoramicCornerJoiner` `connector` `note` `multilineNote` `fireSign` `extraDim{Horizontal,Vertical,Arbitrary,Radius,Angle}` `extraManImage` `extraWomenImage` `hideDim`
- `edit*` 约 35 个是**交互层**（尺寸线 `editDim`/`editDimension`/`editExtraDim`、拖拽手柄 `editDragRobot`/`editWallEdgeRobot`/`editTopViewDragRobot`/`editMullionRobot`/`editCornerRobot`、合页 `editHinge`、把手 `editHandle`/`editCommercialHandle`/`editCrossHandle`、五金 `editHardwareOnFrame`/`editHardwareOnMullion`、分割器 `editSplitter`/`editInnerSplitter`、斜文字 `editSkewText`、三维弧文字 `editThreedArcText`）——不是构件本体，但对「选中态/手柄样式」规格有用。
- 已实测确认的 中文→id 对：外框/矩形=`frame_scalable`(默认) 半圆=`frame_half_circle` 菱形=`frame_diamond` 哥特式=`frame_gothic` 洋葱=`frame_onion` 波浪=`frame_wave` 横竖梃=`mullion_cross_line`

## 3. 采集方法（已验证）

页面里 `Konva` 是全局对象，`stage.find('Shape')[0].attrs.view` 即应用上下文（含 `toolManager`/`shapeManager`/`dimManager`/`params`）。**注意：不要打印 `view`/`token` 等字段，里面含登录令牌。**

画布尺寸正常（594×794，DPR 1.5，初始 `stage.scaleX()=0.23026`）。**本文所有坐标统一为世界 mm**；采集时钩到的是形状局部坐标，需按第 7 条归一化（矩阵乘点 → 除以录制时 scale → 减 stage 位置）才得到 mm。

关键交互语义（踩坑结论）：
1. **激活工具**：`card.click()` 与纯 `MouseEvent` 序列**都无效**；必须给 `.iconfont` 子元素派发 `pointerdown/mousedown/pointerup/mouseup/click` 五连，才会在 `view.toolManager.curTool` 看到目标 id。
2. **放置构件**：自由画模式下**只能在墙体洞口内拖拽**；洞口外拖拽会生成 `editTopViewDragRobot`（俯视图手柄）而不是构件。
3. **归属判定**：构件形状节点的 `attrs.tool` 多为空或 `edit*`，**不能**用它归属；要靠「录制区域过滤 + 放置前后节点差集」。
4. **录制**：钩 `Konva.Context.prototype` 的绘制方法（该类代理了 2D 上下文全部方法）+ `Konva.Shape.prototype.drawScene`（节点分段）。单次全量 `stage.draw()` + 解析约 40ms。
5. **求值上限**：browser `evaluate_script` 单次 15s 超时；每批 ≤4 项，或把结果暂存 `window.__specs` 分次取回。
6. 组件放置成功后工具会自动回到 `pan`；`Ctrl+Z` 撤销**不可靠**（场景不清零）。**「清除」不是清空场景** —— 标线面板 idx8「清除」实测激活的是 `hideDim`（只隐藏尺寸线），`Delete`/`Backspace` 对已放置的框也无效（节点数不变）。复位请用工具栏 **「新增」**（见 §7「复位手段」：点后场景清空但工具条会消失，再点一下画布空白处即恢复）。
7. **钩到的路径参数是「形状局部坐标」，不是 mm**：Konva 在 `drawScene` 里 `setTransform` 用的是含 stage 缩放的绝对矩阵，所以要先把录到的矩阵乘到点上、再除以**录制时**的 `stage.scaleX()` 并减去 stage 位置，才得到本文统一使用的世界 mm。漏掉这步会得到舞台像素（诊断特征：1300mm 的框记成 442、40mm 料厚记成 14，比值恰为 scale）。
8. **每次创建构件后视图会自动缩放到内容**（实测 scale 0.23026 → 0.3385、position 同变），所以拖拽放置要用**一次性算好的固定 client 映射**；若每步都按当前变换重算目标点，会与自动缩放形成反馈环，把 1300mm 的框拉成 2552mm 宽的畸形（半圆被拉成 r=8499 的扁弧）。要在一个场景里摆多个构件，先自行 `stage.scale()/position()` 设视口，并**在每次拖拽前重设**（切 tab 也会把视口重置）。
9. 按索引激活时面板要取 `.v-window-item--active`（见 §7.1 的同类踩坑）；退一步可用 `getComputedStyle(p).display !== 'none'`，**但 `offsetParent` 恒为 null 不可用**（会误选到上一个面板，把 idx 录成别类构件）。页面有两组 `.v-tabs`：第 0 组是 7 个工具箱 tab，第 1 组是「全选 / 压线颜色」，取 tab 时别混。
10. 试用账号点首页「工厂管理」下的模块（仓库管理 / 车间管理）**无任何反应**，路由不跳转、也无提示弹窗，拿不到它们的界面规格。

## 4. 已确认的绘制常量（多次采样一致）

| 用途 | 值 |
|---|---|
| 外框料填充 | `#636568`，描边 `#000000`，`lineWidth ≈ 3`（世界单位下为线宽，实际随缩放补偿） |
| 扇料填充 | `#7B7F81`，描边 `#000000` |
| 玻璃 | `rgba(211, 221, 218, 0.6)`（即 `#D3DDDA` @60%） |
| 选中/高亮 | `#0000ff`，`lineWidth 3` |
| 编辑手柄 | 填充 `rgba(255, 0, 0, 0.6)`，描边 `#000000`，40×40 / 120×40 / 40×120 mm 三种（角/横/竖） |
| 墙体 | 填充 `#5f4210`，描边 `#3b4896`（多边形 78 点，含洞口镂空） |
| 尺寸标注条 | 竖标 `#c0ff0e`（左）/ `#450def`（右）/ `#9607a6`（下），内部白字为尺寸值（如 `1130`、`622`）；宽 50~60mm、长=被测边长 |
| 料件画法 | 每根料是**独立 45° 斜接头四边形**（例：右竖料 `[1597,20]→[1619,42]→[1619,682]→[1597,704]`，宽 22mm）；斜边料同为斜接四边形 |
| 弧形顶部 | 用 `ctx.arc()`（采样到 arcs 2~3 段）而非贝塞尔；`quadraticCurveTo/bezierCurveTo` 计数为 0 |
| 料宽实测 | 外框料 40mm、扇料 22mm（该系列 110平开，洞口 622×1130mm 样例） |

## 5. 扇类配方（样例：1300×1300 单格，110平开系列，外框料 40mm、扇料 22mm）

坐标是录制到的**世界 mm**（该样例洞口 699..1998，外框内缘 739..1958，扇内缘 821..1876）。

### 5.1 所有扇共用的分层（自下而上）

1. **外框 4 料** `#636568` 填充 + `#000000` 描边 `lw3`，每根是 45° 斜接四边形（5 点闭合），厚 40mm。例左竖料 `P[739,739 739,1958 799,1898 799,799]`。
2. **扇料 4 料** `#7b7f81` 填充 + `#000000 lw3`，厚 22mm，同样 45° 斜接。例上横料 `P[1898,821 1898,799 799,799 799,821]`。
3. **玻璃/填充面**：矩形 `821,821..1876,1876`，`#000000 lw3` 描边；填充按构件类型不同（见 5.3）。

### 5.2 五金与开启符号（叠在扇上）

| 元素 | 画法 |
|---|---|
| 把手 | 填充 `#d4d1d9`、描边 `#000000 lw3`，44×65mm 位于右竖料中段（bb `1906,1316,1950,1381`）；路径 = 5 点斜切矩形 + **4 段 r=6 圆角弧**（按 3.1→1.6→0→−1.6→−3.1 弧段闭合） |
| 传动杆/锁臂 | 同 `#d4d1d9`，27×135mm 竖条（bb `1915,1343,1942,1478`），底部两段 r=5 圆角 + 顶部一段 **r=14 半圆**（0..3.1） |
| **开启方向符号** | **不填充**、`#000000`、**`lw9`** 折线：`右上 → 左中 → 右下`，即顶点指向**合页侧**的倒 V（样例 `1898,1898 → 799,1349 → 1898,799` = 合页在左） |
| 内开 / 外开 | 同一几何只改线型：**实线** 与 **`dash [30,15]` 虚线** 分别表示两种开向（实测 `玻扇` 实线；`纱扇/防盗框/双内开扇` 虚线） |
| 滑移符号（平移类） | `lw15` 三线组成**等腰梯形**（底边 789..1908 @y2595，两腰上外撇至 y2395）+ 两端各一个 `#0000ff lw3` 40×40 端挡方块 |
| 方向箭头 | `fill none`、`#000000 lw9`：杆 `P[1532,1289 1165,1289]` + 头 `P[1477,1234 1532,1289 1477,1344]`（> 形） |
| 选中态 | `#0000ff lw3` 的 40×40 角手柄 + `lw25` 端刻度线；编辑手柄填充 `rgba(255,0,0,0.6)` |

### 5.3 各扇类型差异（已确认 18 项）

| 构件 | 工具 id | 相对通用分层的差异（坐标为 1300 方格样例） |
|---|---|---|
| 玻扇 | `sash` | 玻璃面平涂 `rgba(211,221,218,0.6)`；开启符号**实线** |
| 纱扇 | `screen` | 面填充改用**线性渐变**（`createLinearGradient`）；开启符号**虚线 dash30/15** |
| 防盗框 | `antiTheft` | 框内叠加护栏杆：`#636568 lw3` 横杆厚 45mm、间距 120mm（y=824/944/1064/1184/1469/1589/1709/1829，跨 763..1934）+ 1 根 45mm 竖杆（x 1666..1711，y 1229..1469） |
| 双内开扇 | `innerSashAndScreen` | **两层扇叠加**：玻扇层 `#7b7f81` + 纱扇层 **`#19ee26`（亮绿）**，各自 4 根 45° 斜接料，绿层再叠 45mm 横档 |
| 内倒平移扇 | `downWithSlideSash` | 绿纱层 + **滑移梯形**（`lw15` 三线）+ 两个 `#0000ff lw3` 40×40 端挡 + `lw9` 方向箭头 + `#bd6736 lw3` 标记字形 |
| 对开扇 | `doubleSash` | 中缝双竖料：左扇右边 `1289..1349`（每扇各一根 60mm 对开料），玻璃拆成 `821..1267` 与 `1321..1876`；把手各自贴在外侧竖料 |
| 推拉 | `slide` | 每扇一根 `lw15` 水平滑移线（两扇错开 y：2250 / 2330）+ **每扇一个 r50 半圆**（`A[1633,2540,r50@-3.1..3.1]`）+ 蓝色 40×40 端块（另有 20×20 小方块） |
| 对开纱扇 | `doubleScreen` | 两扇各一条 **`lw10` 锯齿线**（连续三角波，步长约 22/78mm，如 `P[792,2299 813,2323 870,2292 892,2316 …]`）＝**纱网画法**；每侧各一个 r50 半圆 |
| 百叶窗 | `shadePushSash` | 一根 `lw15` 主斜线 + 分扇副斜线 + 每扇 r50 半圆；`#0000ff lw3` 46×46 斜切把手方块 |
| 对开百叶窗 | `doubleShadePushSash` | 同上但左右两组（斜线 `792,2298→1293,2386` 与 `1404,2298→1905,2386`，各配 r50 半圆 @994/1603） |
| 折叠玻扇 | `foldSash` | 洞口按 **305mm 等分成 N 片竖料**（x=739/1044/1349/1654…），每片底部一个 `r50 半圆` + 蓝色斜切手柄块，相邻片间用 `lw15` 短斜线连接 |
| 折叠纱扇 | `foldScreen` | 同 `foldSash`，但所有料件与面均为 **`#19ee26` 绿**（含 754..1943 的整面） |
| 玻璃护栏 | `guardSash` | **只有三边料（左/右/底，无顶料）**，料宽仅 15mm（`739..754`）；玻璃 `754,958..1943,1943`；外侧再叠 `#45bf3a lw3` 轮廓 + 多个 **r90 全圆**（`0..6.3`）表示立柱/装饰球 |
| 肯德基门 | `kfcSash` | 门体下部一块 **200mm 高横板** `#636568 799,1249..1898,1449`，上玻下板；扇料在 y1227/1249 处断开；中线 `1319..1379` 有一根 60mm 竖芯 |
| 对开肯德基门 | `doubleKfcSash` | 左右两叶各带 200mm 横板（`799..1289` / `1289..1898`），中缝 1289；门扇中部一块 **`#d4d1d9` 150×200mm 推板**（`1116,1249..1266,1449`） |
| 微通风扇 | `airSash` | 中央 60mm 竖芯（`1319..1379`）+ 两条竖向装饰带（`1828..1888`、`2063..2123`）+ `lw15` 斜线与蓝色端块；整框 `#636568` 满填底 |
| 降扇纱框 | `screenSashHolder` | 顶部一条 **300mm 高渐变带**（`grad` 填充 `739,739..1958,1039`）+ 四边 0 面积描边线（`#636568`）+ `#dfa79f lw15` 强调线 |
| 四扇对开 | `foldDouble` | 工具 id 已确认；几何未采到（需要更宽的格才能容下 4 叶） |

> 符号词汇表（跨构件复用）：**r50 半圆 = 平开/推拉/折叠的开启轨迹**；**`lw10` 锯齿线 = 纱网**；**`lw15` 斜线/梯形 = 推拉与内倒轨迹**；**`lw9` 倒 V = 合页侧指向**；**r90 全圆 = 护栏立柱节点**；`#19ee26` = 纱扇层专用色；`#45bf3a`/`#dfa79f`/`#bd6736` = 附加构件的强调色。

### 5.4 采集状态

- 已录并解读：**扇类 18/21**；**外框类 6**（矩形/半圆/菱形/哥特式/洋葱/波浪 —— 料件斜接点序与 `arc` 弧顶用法已拿到，但当时未清空场景，轮廓点序需重采一轮才能直接照抄）。
- 扇类待补 3 项：**时尚门 / 扇中扇 / 护栏晾衣架**。**已排除**「卡片缺 `.iconfont`」这一假设 —— 改对卡片本体与 `.keep-all` 标签各派发一轮五连后，`curTool` 仍停在上一个工具（`sash`），说明这三张卡在自由画模式下点击不切工具（推测需其他模式或面板需先滚动渲染）。候选 id（**未验证**）：时尚门≈`stylishDoor`、扇中扇≈`innerSash`、护栏晾衣架≈`guardWithGlass`。`四扇对开` = `foldDouble`（id 已确认，几何需换更宽的格重采）。
- 之后再采：格条 31 → 异形外框 40 → 梃 19。

### 5.5 格条类（decoration_bar_*）采集结论与阻塞点

**已确认**：
- 索引→id（格条面板 31 项，按索引激活可靠，标签大量重名不能按文字激活）：`0 格条=decoration_bar_chinese`、`1 中式格条2=decoration_bar_chinese2`、`5 矩形格条=decoration_bar_rect`。
- 放置手势：**选中格条工具后单击玻璃即施加**（拖拽无效，只会在已有分割器上产生 `editInnerSplitter` 选中）。
- `decoration_bar_chinese` 几何：在玻璃四角各生成一组 **20mm 厚 `#636568` 角件**（样例角件 bb 依次 `911,971,991,991` / `971,911,991,991` / `1706,971,1786,991` / `1706,911,1726,991` 等 8 块，对称分布在玻璃 821..1876 的四角），即中式格条的角部花格由 8 个斜接小块拼成。

**阻塞（重要）**：
1. **一个分格只能有一种格条图案** —— 图案铺满整块玻璃，第二次点击落在已有格条上（进入 `editInnerSplitter` 选中态），因此**不能在同一块玻璃上连续叠加采集**（实测 3 次采集结果 +0 新节点）。
2. **`Delete` 键不能移除已施加的格条**（节点数 552→553 未减），需要找他们上下文面板里的删除入口才能复位。
3. 选中构件后**上下文面板会整体顶替工具箱**（`.keep-all` 归零），而站点又会周期性弹 `.v-overlay.loading` 暂停渲染 → 批量采集中"每项前重切 tab + 空白点击/Escape 自愈"只能救一部分，**连采 3 项后必卡**。

**下一步做法（建议按此重开一轮）**：先用梃把洞口切成 N 格（每格一块玻璃），**每格只施加一种格条**，按格子中心分点采集；或每采一项就 `navigate` 重载 + 重画基准框。前者一次能采 4~9 项，成本低得多。

### 5.6 runner 追加踩坑（重要）

1. **点中构件会弹出「压线颜色」上下文面板并顶掉整个工具箱**（`.keep-all` 全部从 DOM 消失）→ 每项录完要 `Escape` + 点画布空白处取消选中。
2. 他们操作后会发服务器请求，期间出现 `.v-overlay.loading` 且**工具箱整体不渲染**，此时激活必然失败；等遮罩结束再跑。
3. `__switchTab` 必须在**每一项之前**都调一次（Vuetify 只挂载当前面板），否则目标标签根本不在 DOM 里。
4. 归因用「放置前后 **签名（f|s|lw|dash|bb|点数|弧数）多重集差分**」，项内再去重 —— 比区域过滤可靠，因为场景里总有历史残留。
5. `evaluate_script` 有 15s 上限：**每批 ≤3 项**；结果同步写 `localStorage`（如 `qoder-harvest-specs`），页面卡死或重载后可恢复。

## 6. 梃类（mullion_*）配方（部分已得）

样例：1300×1300 洞口（外框内缘 739..1958，玻璃 761..1936）。

| 项 | 工具 id | 实测画法 |
|---|---|---|
| 横/竖梃 | `mullion_cross_line` | 竖梃本体 = **`#636568 lw3` 的 40mm 宽全高竖带**（实测 `1358,739,1398,1958`、`1856,739,1896,1958`）。**加梃会把原分格拆成两个独立格**：两侧各自重新生成 4 根 22mm `#7b7f81` 扇料 + 各自一块玻璃（如 `rgba(211,221,218,0.6) 1420,761..1834,1936`），不是简单叠一条线 |

**手势力证**：
- 放梃用**单击**（点哪根就在哪生成），**拖拽无效** —— 对角拖拽只会在尺寸线上加刻度（实测新增 `1177`/`1520` 两处 tick）并画出一条 `#284fdb` 蓝条。
- 工具用后**经常自动退回 `pan`**（不像玻扇那样保持），所以每根梃之前都要重新激活。
- 已经存在分格的区域上再点，会被当作**选中**（`curTool` 立刻变 `pan` 且无新节点）—— 这就是横梃补不上去的原因。

**未完成**：3×3 九格只做出**3 列**（两根竖梃 @1358、@1856），横梃两次点击均被吞。下一步改用等分工具一次成型：候选 id `mullion_cross_line_equal_two` / `_equal_three` / `_equal_four`（面板标签 idx1「横竖梃」= `mullion_cross_line`，等分系列尚未对应到具体索引，需按索引逐个激活并读 `curTool` 建映射）。

**梃类其余 18 项待采**：等分分体圆弧 / 二阶分体圆弧 / 圆弧中梃 / 连体圆弧 / `spin_mullion` / `compoundsquare`×2 / `compounddiamond` / `compoundcircle` / `compoundhexagon` / `halfhexagon` / 四角 / 八角 / 长八边形 / 双八边形 / 波浪 / 扇中梃。

### 6.1 梃面板 idx → 工具 id（19 项全量实测）

| idx | 菜单标签 | 工具 id |
|---|---|---|
| 0 | 横/竖梃 | `mullion_cross_line` |
| 1 | 横竖梃 | `mullion_cross_line`（与 0 同一工具） |
| 2 | 等分分体圆弧 | `mullion_half_wheel` |
| 3 | 二阶分体圆弧 | `mullion_semi_arc` |
| 4 | 圆弧中梃 | `mullion_inner_arc` |
| 5 | 连体圆弧 | `mullion_inner_arc`（与 4 同一工具） |
| 6 | spin_mullion | `mullion_spin` |
| 7 | compoundsquare | `mullion_compound_square` |
| 8 | compoundsquare | `mullion_compound_x_square` |
| 9 | compounddiamond | `mullion_compound_diamond` |
| 10 | compoundcircle | `mullion_compound_circle` |
| 11 | compoundhexagon | `mullion_compound_hexagon` |
| 12 | halfhexagon | `mullion_half_hexagon` |
| 13 | 四角 | `mullion_compound_rectangle_single` |
| 14 | 八角 | `mullion_compound_rectangle_double` |
| 15 | 长八边形 | `mullion_compound_long_octagon` |
| 16 | 双八边形 | `mullion_compound_double_octagon` |
| 17 | 波浪 | `mullion_wave` |
| 18 | 扇中梃 | 仍读到 `mullion_wave`（**激活未切换，待确认**；注册表候选：`mullion_frametify_like` / `mullion_inner_eq_split` / `mullion_door_hole_split`） |

- 注册表里的 `mullion_cross_line_equal_two/_equal_three/_equal_four`、`mullion_horizontal`、`mullion_vertical`、`mullion_diagnoal`、`mullion_counterdiagnoal`、`mullion_semi_arc_pro(2)`、`mullion_semi_segment_pro`、`mullion_crossties`、`mullion_inner_eq_split`、`mullion_inner_121_split`、`mullion_inner_121_slide_split`、`mullion_door_hole_split` **都不在梃面板** → 应该在「常用」面板、右键/上下文菜单，或需修饰键触发（3×3 九格要靠它们或新建洞口重画）。
- **`清除` 按钮点不动**（节点数 69→69，也无确认弹窗），且他们**自动保存草稿**：`navigate` 重载恢复的是上次那张 3 列场景。因此格条的「一格一图案」只能靠**新建分格**实现，不能靠清除复位。

### 6.2 为什么 3×3 切不出来（根因 + 下一步路径）

实测：`mullion_cross_line` 在**已经加过梃的分格内**再点，`curTool` 立刻变 `pan` 且零新增节点（试点 `(1048,860)` 与 `(1048,1830)`，靠顶/靠底都一样）。

根因：**加一根梃会把原分格拆成两个"独立扇"**（各自带 4 根 22mm `#7b7f81` 扇料 + 各自玻璃，见 §6）。梃工具只作用于**未扇化的洞口**，而竖梃加完以后整块洞口就已经全部扇化了 → 横梃无处可加。这也解释了最初那两根竖梃为什么能成功（那时洞口还是整块玻璃）。

**下一轮获取干净分格的两条路径（格条批量采集的前置条件）**：
1. 工具栏 **「新增」**（新增一樘窗 = 新的未扇化洞口）→ 每樘新窗可以放 1 种格条，重复「新增 → 放格条 → 录制」即可批量采集，无需清除；
2. **「编辑洞口」** 重设洞口尺寸（可能会重建分格，需实测）。

在拿到干净洞口之前，格条只能用现有 3 列（3 块玻璃）各放 1 种，共 3 种/场景。

## 附录 A：页内采集器（粘贴到 evaluate_script 即可复用）

钩子 + 激活 + 录制 + 区域过滤 + 压缩取回，一次性安装：

```js
// 1) 绘制指令录制（节点分段 + 样式采样）
const cap = { on: false, ev: [], limit: 4000 }; window.__cap = cap;
['beginPath','moveTo','lineTo','closePath','stroke','fill','arc','arcTo','bezierCurveTo','quadraticCurveTo',
 'rect','roundRect','fillRect','strokeRect','fillText','strokeText','setLineDash','translate','rotate','scale',
 'transform','setTransform','save','restore','clip','ellipse','drawImage','clearRect']
 .forEach(fn => { const C = Konva.Context.prototype, o = C[fn]; if (typeof o !== 'function') return;
   C[fn] = function (...a) { if (cap.on && cap.ev.length < cap.limit) cap.ev.push({ op: fn, a,
     st: /^(fill|stroke|fillText|strokeText|setLineDash)$/.test(fn) ? { f: this.fillStyle, s: this.strokeStyle, lw: this.lineWidth, d: this.getLineDash?.() } : null });
     return o.apply(this, a); }; });
window.__capSet = v => { cap.on = v; cap.ev = []; };
const origDS = Konva.Shape.prototype.drawScene;
Konva.Shape.prototype.drawScene = function (...a) { if (cap.on) cap.ev.push({ node: { tool: String(this.attrs.tool||''), artType: this.attrs.artType, fcolor: this.attrs.data?.fcolor } }); return origDS.apply(this, a); };
// 2) 激活工具（必须五连到 .iconfont）
window.__activate = async (panelIdx, label) => {
  const win = document.querySelectorAll('.v-window-item')[panelIdx];
  const lab = [...win.querySelectorAll('.keep-all')].find(e => (e.innerText||'').replace(/\s+/g,'') === label);
  const card = lab && (lab.closest('.v-card') || lab.parentElement);
  const icon = card.querySelector('[class*=iconfont]') || card;
  for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
    icon.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, pointerId: 1 }));
  await new Promise(r => setTimeout(r, 260));
  return String(Konva.stages[0].find('Shape')[0].attrs.view.toolManager.curTool);
};
// 3) 洞口内拖拽放置（mm 直接乘 stage.scaleX 得 clientX）
// 4) 录制一次重绘并按区域过滤 → 存 window.__specs[label]，分批取回
```

### 6.3 梃类几何实测（7/19 已采，compound_* 家族疑似需拖拽，页面阻塞未验完）

统计口径：`n` = 相对"基准外框"新增图形数；`th` = 料厚分布（mm）；`r` = `ctx.arc` 半径（mm，成对即环带内外径）。洞口 1300×1300。

| idx | 标签 | 工具 id | n | th | r |
|---|---|---|---|---|---|
| 0/1 | 横/竖梃 | `mullion_cross_line` | 6 | 40×1（**竖带 40mm**）+ 22×4（两侧扇料）| — |
| 2 | 等分分体圆弧 | `mullion_half_wheel` | 22 | **50×2**、40×4、22×7 | — |
| 3 | 二阶分体圆弧 | `mullion_semi_arc` | 39 | **50×9**、40×5、22×7、67/82/95/110 各1 | **285/325、263/347** |
| 4 | 圆弧中梃 | `mullion_inner_arc` | 23 | **50×5**、40×7、22×6、38×1、13×1 | **480/520、542/458** |
| 5 | 连体圆弧 | 激活串到 `cross_line` | 15 | 50×4、40×5、22×4 | — （**数据无效，需重采**） |

**归纳**
1. **直梃（cross_line）料厚 40mm，弧梃（half_wheel / semi_arc / inner_arc）料厚 50mm** —— 弧形梃比直梃厚 10mm，这与弯料需要更大断面一致。
2. **弧梃一律用成对半径的 `ctx.arc` 画环带**：`semi_arc` = r285/325（40mm 环带）+ r263/347；`inner_arc` = r480/520 + r542/458。半径量级 ≈ 洞口宽的 0.2~0.4 倍，圆心在洞口内。
3. **加一根梃 = 拆成两个独立扇**：新增里总有 4~7 根 22mm `#7b7f81` 扇料（每侧 4 根），以及各自一块玻璃；`n` 越大说明该梃把格子拆得越碎（semi_arc 的 39 = 多段弧 + 多格）。
4. 弧梃还伴随 67/82/95/110mm 的"短厚件" —— 应是弧与直料交接处的**补料/转角块**。

**采集限制（下一轮注意）**
- 每项循环（新增→点画布→画基准框→激活→单击→差分）约 4~5s，**一批 3 项经常超 15s 求值上限**；超时后页面还会**阻塞约 30s**，期间连纯同步读取都超时 → 实际稳定节奏是**一批 2 项 + 失败后等 30s 再读回**。
- `__actIdx` 必须取 `.v-window-item--active` 面板，否则会选中标签更多的格条面板（本轮已修，但 idx5 仍串到了 `cross_line`，说明切 tab 后 active 面板可能滞后一次）。

**本轮新增实测**（同一循环：新增 → 点画布 → 基准框 → 激活 → 单击玻璃 → 差分）：

| idx | 标签 | 工具 id | n | th | 说明 |
|---|---|---|---|---|---|
| 6 | spin_mullion | `mullion_spin` | 63 | 22×28、40×14、**50×7** | 一次生成 **7 段 50mm 弧/斜梃 + 14 根 40mm 框料 + 28 根 22mm 扇料**（≈7 个分格的复合梃） |
| 8 | compoundsquare | `mullion_compound_x_square` | 63 | 22×28、40×14、50×7 | 与 `spin` 统计完全一致（同为 7 格复合，区别应在角度/排布，需看点序） |
| 15 | 长八边形 | `mullion_compound_long_octagon` | 72 | 22×32、40×14、50×7 | 比 spin 多 4 根扇料（8 格） |

**compound_* 家族单击无效**：idx10 `compound_circle`、idx13 四角 `compound_rectangle_single`、idx16 双八边形 `compound_double_octagon` 激活成功但**单击玻璃零新增**；改用**拖拽**（800,800→1900,1900）验证时页面阻塞超时，**手势未定论**（推测这一族要拖出范围，或要先有一根梃再在其上叠加）。

**本轮新增（走变体 id 路径，可靠）**
- `mullion_inner_eq_split`（扇中梃-等分内分）：`box 1218×607`，2 个料件 —— 一根 50mm 横梃把洞口上下等分。
- `mullion_semi_arc_pro`（连体圆弧进阶）：`box 1218×1218`，9 个料件。
⇒ 梃几何累计 **9/19**（`cross_line`、`half_wheel`、`semi_arc`、`inner_arc`、`spin`、`compound_x_square`、`compound_long_octagon`、`inner_eq_split`、`semi_arc_pro`）。

**⚠ 本轮污染的数据（必须忽略或删除）**：批量 runner 里我又用回了"标签最多的面板"，而**「框」面板有 40 项、多于梃的 19 项**，于是 `梃#7/9/10/11/12/13/14/16/17` 与 `格条#28` 这些键里记的其实是 **`frame_kfc4` / `frame_three_dimensional_arc` / `frame_parallelogram` / `frame_half_circle` / `frame_gothic` / `frame_onion` / `frame_isosceles_triangle` / `frame_convex`** 等框类工具，**不是梃**。读 `localStorage['qoder-harvest-specs']` 时按 `tool` 前缀校验（梃必须是 `mullion_`、格条必须是 `decoration_bar_`）即可剔除。
- 教训同 §8.2：**任何"按索引激活"都必须先取 `.v-window-item--active` 面板**，且**采完必须断言 `curTool` 前缀符合该分类**，否则整批静默错位。

**剩余待采 8 项梃几何**：`compound_square`、`compound_diamond`、`compound_circle`、`compound_hexagon`、`half_hexagon`、`compound_rectangle_single`(四角)、`compound_rectangle_double`(八角)、`mullion_wave`(波浪)。其中 `compound_circle`/四角/双八边形**单击零新增**，需先确定它们的手势（疑似拖拽）。

**页面稳定性与队列教训**：连跑多轮后页面会长时间阻塞（纯同步 `evaluate` 也 15s 超时）；**两个后台队列不能并发** —— 本轮第二队列在 150s 内一项都没完成（每项都要 `新增` 复位 + 重画基准框，互相抢占场景且定时器被饿死）。正确做法：**串行、单队列、一次 1 项**，并在每次轮询后只补跑未完成项。

## 7. 格条类（decoration_bar_*）配方

**复位手段（重要）**：工具栏 **「新增」= 新建图纸**，点后场景清空（只剩 1 个 stub），但**工具条会整体消失**；再**点一下画布空白处**工具条就回来了。于是「新增 → 点画布 → 画基准外框 → 放一种格条 → 录制」成为可重复循环（每轮约 4~7s，一次 `evaluate_script` 只够跑 1~2 轮）。

**已采 8 项**（坐标为各自场景的世界 mm，玻璃区约 1300×1300）：

| 面板 idx | 标签 | 工具 id | 画法 |
|---|---|---|---|
| 0 | 格条 | `decoration_bar_chinese` | 玻璃四角各一组 **20mm 厚 `#636568` 斜接角件**（共 8 块，如 `911,971,991,991` / `971,911,991,991`），中式角花 |
| 1 | 中式格条2 | `decoration_bar_chinese2` | 同族变体（id 已确认，几何待重采） |
| 5 | 矩形格条 | `decoration_bar_rect` | **内嵌一圈 20mm 矩形环**（4 根斜接条，外缘 `725,2114..1740,3129`，每根 20mm 厚），不含中格 |
| 6 | 经典格条 | `decoration_bar_prairie` | **40mm 斜接外环 + 20mm 内部条**（如竖条 `475..495 × 1826..3002`） |
| 7 | 均分格条 | `decoration_bar_colonial` | **20mm 网格**：2 条横（y `2208..2228`、`2600..2620`，跨 x `365..1541`）+ 1 条竖（x `747..767`，分段穿过横条），横竖相交处断开 |
| 8 | diamond | `decoration_bar_diamond` | 40mm 外环 + **6 根 28mm 斜条**（对角方向，如 `P[967,1826 365,2428 365,2400 938,1826]`），部分斜条**画出玻璃边界之外** |
| 9 | wheel | `decoration_bar_half_wheel` | **3 根 20mm 射线过玻璃中心并向两侧无限延长**（实测 bb 达 `-6125,-4075 .. 8030,3009`），完全依赖裁剪 |
| 11 | innerArc | `decoration_bar_innerArc` | **同心圆弧 + 竖条**：`ctx.arc` 半径 `r588` 与 `r578`（=10mm 环带）、内圈 `r255/r265`，圆心同一处（`1232,2622`）；竖条 `967..977`（**10mm**） |

**要点**
1. **料厚随图案变**：中式/矩形/colonial/prairie 的条是 **20mm**，prairie 外环与 diamond 外环是 **40mm**，diamond 斜条 **28mm**，innerArc 的弧带与竖条只有 **10mm**。
2. **超界靠裁剪**：`half_wheel` 直接把射线画到玻璃外几千 mm，`diamond` 也有斜条越界 → 我们要么用 Konva `clipFunc` 裁到玻璃区，要么自行求交裁好端点（后者对我们现有渲染管线更省事）。
3. 弧形图案（innerArc/wheel/arc 族）用 **`ctx.arc()`**，与外框弧顶一致；未见到贝塞尔。
4. 选中态会多出一个整块高亮节点，颜色随图案变（见 `#8dc110`、`#7a28cf`、`#7da833`），采集时应忽略。

### 7.1 全量实测表（idx → 工具 id → 几何统计，27/31 已采）

`n` = 相对基准框新增的图形数；`th` = 料厚分布（mm，只统计 <120mm 的条状件）；`r` = `ctx.arc` 半径（mm，成对出现即环带的内外半径）。

| idx | 标签 | 工具 id | n | th | r |
|---|---|---|---|---|---|
| 0 | 格条 | `chinese` | 8（首轮采） | 20×8 | — |
| 1 | 中式格条2 | `chinese2` | 0 | — | — |
| 2 | 中式格条3 | `chinese3` | 28 | 20×24 + 40×4 | — |
| 3 | chinese5 | `chinese5` | 44 | 20×40 + 40×4 | — |
| 4 | 中式格条4 | `chinese4` | 14 | 20×10 + 40×4 | — |
| 5 | 矩形格条 | `rect` | 9 | 20×4 + 40×4 | — |
| 6 | 经典格条 | `prairie` | 13 | 20×8 + 40×4 | — |
| 7 | 均分格条 | `colonial` | 9 | 20×8（**无外环**） | — |
| 8 | diamond | `diamond` | 11 | 40×4 + 6 根 28mm 斜条 | — |
| 9 | wheel | `half_wheel` | 4 | 20（3 根过心射线，超界靠裁剪） | — |
| 10 | wheel | `wheel` | 8 | 10×1 + 40×4 | 588/578 |
| 11 | innerArc | `innerArc` | 12 | 10×3 + 40×4 | 588/578、255/265 |
| 12 | innerArc2 | `innerArc2` | 11 | 10×3 + 40×4 | 588/578、255/265 |
| 13 | wheel1 | `semi_arc_wheel1` | 12 | 10×7 + 40×4 | 746/736 |
| 14 | wheel3 | `semi_arc_wheel3` | 14 | 10×7 + 40×4 | 746/736 |
| 15 | innerArc | `semi_arc_innerArc` | 18 | 10×10 + 40×4 + 77/88 各1 | 746/736、579/589 |
| 16 | topBar | `semi_arc_wheel1_topBar` | 13 | 10×7 + 40×4 | 746/736 |
| 17 | topBar | `semi_arc_wheel3_topBar` | 15 | 10×7 + 40×4 | 746/736 |
| 18 | topBar | `semi_arc_innerArc_topBar` | 19 | 10×10 + 40×4 + 77/88 各1 | 746/736、579/589 |
| 19 | 对开格条 | `quarter_arc` | 12 | 10×4 + 40×4 | 1965/1975、968/978 |
| 20 | xFlip | `quarter_arc_xFlip` | 12 | 10×4 + 40×4 | 5551/5561、2733/2743 |
| 21 | arc3 | `quarter_arc3` | 12 | 10×4 + 40×4 | 5551/5561、2733/2743 |
| 22 | xFlip | `quarter_arc3_xFlip` | 7 | 10×2 + 40×4 | 1967/1977 |
| 23 | arc2 | `quarter_arc2` | 5 | 40×4 | 1166/1176 |
| 24 | xFlip | `quarter_arc2_xFlip` | 5 | 40×4 | 1166/1176 |
| 25 | arc | `double_arc` | 11 | 10×5 + 40×4 | 598/588 |
| 26 | arc2 | `double_arc2` | 1（**不全**） | — | — （唯一新增件带 `dash`，点序 `1777,2773→1777,2922→1926,2922→1926,2773`） |
| 27 | crabapple | `decoration_bar_crabapple` | 7 | 20×6 + 20mm 方环四边 | **已采到**（缓存键 `格条v2#27`，即 top 放宽到 6 件那轮）：绕玻璃心**旋转 28.9°** 的方形环带，外接半径 `0.433×短边`、带宽 20mm、角部圆角 `r0.081×宽`；外加 **6 根 20mm 连接短条** —— 竖直 2 根在水平中线 x≈0.5 从玻璃上/下边到环带包围盒上/下边；水平 4 根在「最左角 y≈0.29」与「最右角 y≈0.71」两行，从左右两边到环带包围盒左右边 |
| 28 | inner | `crabapple_inner` | 7 | 同上 | 环带更大且转角不同（外接半径 `0.481`、旋转 `37.3°`），但**6 根短条与 idx27 逐条一致** ⇒ 是叠加在海棠底图上的内圈，不是独立图案 |
| 29 | angle | `right_angle` | 9 | 20×4 + 40×4 | — |
| 30 | arc | `extendable_arc` | 18 | 10×13 + 40×4 | 3349/2242 |

**归纳出的三条规律**
1. **除 `colonial` 外，所有格条都先画一圈 40mm 斜接外环**（4 根，`#636568 lw3`），再叠内部花格。
2. **内部花格料厚只有两档：直条 20mm（中式/矩形/经典族）、弧带 10mm（wheel/arc 族，用成对半径的 `ctx.arc` 画环带）**；`diamond` 的斜条是 28mm。
3. **弧半径与图案语义直接相关**：`wheel/innerArc` 用 588/578（约玻璃半宽）+ 255/265 内圈；`semi_arc_*` 用 746/736；`quarter_arc*` 用 968~5561 的**大半径浅弧**（半径远大于玻璃尺寸 → 视觉上只是微弯的弧段）；`extendable_arc` 用 3349/2242。

**仍未采到（2026-09-08 复核后修正）**：idx1 `chinese2`（缓存里 `格条v2#1` 有 51 件但只留了 top 6，不足以复原整图）、idx26 `double_arc2`（`格条v2#26` bodies=0）。`crabapple`/`crabapple_inner` 已通过缓存 `格条v2#27/#28` 读回并落码（见上表）。

**⚠ 采集链路已失效**：2026-09-08 再进 `/draw`，左侧面板 DOM 已改版 —— `.v-window-item` 还在但其中 **`.keep-all` 与 `.v-list-item` 均取不到任何项**，附录 A 的「按面板项激活 + 五连事件 + `curTool` 校验」整条链路失效；且应用全局从 `window.view` 变成 `window.webcc`（`webcc.toolManager.curTool` 仍可用）。试用只剩约 1 天，未采项**基本无法再补**，只能按现有数据实现或按行业惯例补。

**扇类 tool id（缓存里只存了 id、没存几何，以后按 id 对齐即可）**：`四扇对开=foldDouble`、`微通风扇=airSash`、`百叶窗=shadePushSash`、`对开百叶窗=doubleShadePushSash`、`玻璃护栏=guardSash`、`降扇纱框=screenSashHolder`、`折叠玻扇=foldSash`、`时尚门/扇中扇=sash`。

### 7.2 我方实现映射（16 种，已落码并实机验证）

几何在 `packages/core/src/window-tree.ts: glassBarGeometry()`（纯函数、单测覆盖），物化在 `packages/core/src/window-tree-render.ts: drawGlassBars()`，UI 在 `DesignStudio` 叶子浮层的「玻璃格条」下拉（`pattern` + 直条类的 `cols/rows` + `topBar` 开关）。

| 我方 pattern | 对应工具 id | 依据 |
|---|---|---|
| `colonial` | `colonial` | 20mm 网格、**无外环**，条数由 cols×rows 决定 |
| `chinese` | `chinese` | 网格 + 四角 20mm 斜角花 |
| `rect` | `rect` | 40 外环 + 内嵌 20mm 环 |
| `prairie` | `prairie` | 40 外环 + 8×20（中央方环 + 四边中点连接条） |
| `rightAngle` | `right_angle` | 40 外环 + 4×20 角部直条 |
| `diamond` | `diamond` | 40 外环 + 2 根 28mm 对角条 |
| `wheel` | `wheel` | 40 外环 + **1 根** 10mm 环带（实测 10×1、r588/578） |
| `spoke` | `half_wheel` | 40 外环 + 3 根 20mm 过心条，**端点解析裁到玻璃**（对方越界靠裁剪） |
| `halfWheel` | — | **我方扩展**（下半圆环带 + 一根辐条），非实测原样 |
| `innerArc` | `innerArc` | 2 段同心上半弧带 + 3 根 10mm 竖条 |
| `semiArc` | `semi_arc_wheel1` | 1 段上半弧带（r≈0.39 短边）+ 7 根 10mm 条 |
| `quarterArc` | `quarter_arc` | 双浅弧（r 比 1.51/0.74）+ 4 根 10mm 竖条 |
| `shallowArc` | `quarter_arc3`/`_xFlip` | 双浅弧（r 比 4.27/2.1）+ 4 根 10mm 竖条 |
| `doubleArc` | `double_arc` | 底角对称双弧（r 比 0.45）+ 5 根 10mm 竖条 |
| `extendableArc` | `extendable_arc` | 双浅弧（r 比 2.58/1.72）+ 13 根 10mm 竖条 |
| `crabapple` | `crabapple` | **已按实测实现**：绕心旋转 28.9° 的方形环带（外接半径 0.433×短边、20mm 带）+ 6 根 20mm 连接短条（上下走水平中线、左右在两条角 y 上）；角部 r0.081 由带边交叠近似，不再单独画弧 |
| 任一 + `topBar` | `*_topBar` | 玻璃上部叠加 1 根 20mm 横档 |

**两处按实测做的修正**：① `wheel` 原实现多画了一圈内环，实测 `th=10×1` 只有一根环带；② 面板 idx9 的标签写的是 `wheel` 但工具 id 是 `half_wheel`，其几何是 3 根过心射线而不是半圆，故另立 `spoke` 图案承接，`halfWheel` 保留为我方半圆+辐条扩展。

**渲染层要点**：带 `startDeg/sweepDeg` 的弧带必须用 `Konva.Path`（SVG `A` 命令）画，`Konva.Arc` 未闭合时会多描两条半径；`Konva.Ellipse` 只能画整圆（早期把半圆/浅弧全画成了整圆）。对方把条画到玻璃外几千 mm 依赖裁剪，我方在几何层裁（`chordThroughCenter`）+ 弧段套一层 `clipWidth/clipHeight` 组兜底。

**已做**：格条按逐根中心线长度进下料表与报价（`glassGridAddon` 派生配件 → `bead` 型材行，同长度合并计数、45° 拼角，单窗与拼樘/转角装配两条路径都出料）。
**未做**：`chinese2/3/4/5` 多环变体与 `double_arc2`（缓存数据不足且**采集链路已随对方改版失效**，见 §7.1 末）；`crabapple_inner` 需先支持"同一分格叠加多层格条"。

## 8. 异形外框轮廓点序（8/40 已采，归一化到外框包围盒）

采集方式：`新增` 复位 → 激活「框」面板第 idx 项 → 在 (700,700)→(2000,2000) 拖出 1300×1300 洞口 → 差分新增图形 → 只保留料件色（`#636568`/玻璃/grad/none）→ 坐标按并集包围盒归一化到 0..1（**W=H=1600mm 时 0.025 ≡ 40mm 料厚**）。

| idx | 标签 | 工具 id | 轮廓配方 |
|---|---|---|---|
| 8 | 圆 | `frame_circle` | **同心环带**：外弧 `r0.5`（0→2π）+ 内弧 `r0.475`（2π→0），圆心 `(0.5,0.5)`；另有 `r0.461` 的玻璃内缘弧 |
| 11 | 半圆 | `frame_half_circle` | **半圆环带**（外 `r0.5` 0→π、内 `r0.475` π→0，圆心 `(0.5,0.5)`）+ **底部直料** 5 点四边形 `(0,0.5)(1,0.5)(0.974,0.475)(0.026,0.475)`（即 40mm 平底槛） |
| 13 | 哥特式 | `frame_gothic` | **两段等半径弧对拼成尖顶**：圆心 `(0.293,0.5)` 与 `(0.707,0.5)`，半径 `0.293`（内弧 `0.288` = 40mm 带），交汇于顶点 `(0.5,0.147)`；弧角区间 `-2.4..3.1` / `0..-0.8` |
| 14 | 洋葱 | `frame_onion` | 两段弧心 `(0.707,0.5)`/`(0.293,0.5)`、`r0.282`，顶点 `(0.5,0.174)`，**腰部收进点** `(0.426,0.773)` 与 `(0.574,0.773)` → 先收腰再外扩的 S 形 |
| 15 | 八边形 | `frame_octagon` | **9 点闭合多边形**：`(0.343,0.12)(0.657,0.12)(0.879,0.343)(0.879,0.657)(0.657,0.879)(0.343,0.879)(0.12,0.657)(0.12,0.343)` 回到起点；角部另用 `r0.092` 弧过渡 |
| 17 | 等腰三角形 | `frame_isosceles_triangle` | 顶点 `(0.5,0.1)`、底角 `(0.1,0.9)`/`(0.9,0.9)`；**每个角用 `r0.1` 的 `ctx.arc` 圆角过渡**（顶角弧 `1.1..2`，底角弧 `-1.1..0`） |
| 18 | 六边形 | `frame_hexagon` | 角点含 `(0.25,0.151)(0.286,0.081)(0.643,0.081)(0.714,0.081)` 等；角部 `r0.071` 圆弧过渡 |
| 21 | 菱形 | `frame_diamond` | 顶点 `(0.5,0.08)`、`(0.861,0.5)` 等；角部 `r0.081` 圆弧过渡 |

**归纳（对我们 `outline.ts` 直接可用）**
1. **料厚恒为包围盒的 0.025（1600mm 洞口 → 40mm）**，弧形框用"外弧 + 反向内弧"两条 `ctx.arc` 构成环带，不是逐段四边形。
2. **所有多边形异形框的角部都不是尖角，而是 `r≈0.07~0.1`（≈110~160mm）的 `ctx.arc` 圆角过渡** —— 这是我们目前 `sampleOutline` 直接连尖角的最大差异点。
3. **尖顶类（哥特/洋葱）= 两段等半径圆弧对拼**，圆心落在起拱点（`0.293W` / `0.707W`），顶点由两弧相交自然形成；洋葱额外有腰部收进点，属 S 形双弧。
4. 半圆/四分之一圆类保留一根**平的底槛**（40mm 直料四边形），弧只负责上半部。

**失效/待重采**：idx1 拱形（激活后被置回 `pan`，疑似需二级选择弧高）、idx12 四分之一圆（同上）、idx23 三角顶（激活串到 `diamond`，数据与 21 重复无效）。

**剩余待采 ~29 项**：门 / 缺边肯德基×2 / 肯德基门×3 / 立体圆弧窗 / 平行四边形 / 四分之一圆 / 拱形 / springlineflanker / 六边形2 / 六边形3 / angledpentagon / 三角顶 / 梯形 / 四分之一拱 / hollowside / 凹 / 凸 / 四叶草 / extendedpartialarch / 三角形 / 单耳窗 / framepointedear / 双耳窗 / 异形外框×2 / 波浪 / 清真寺 / 异形。

### 8.1 第二批新增（4 项）

| idx | 标签 | 工具 id | 轮廓配方（归一化） |
|---|---|---|---|
| 25 | 四分之一拱 | `frame_quarter_arch` | **两层同心四分之一弧**：主弧圆心 `(0.5,0.5)`、外 `r0.5`(0→−1.6) / 内 `r0.488`；另有一组小弧 `r0.25`(−1.6→0) / 内 `r0.263` → 大弧做外轮廓、小弧做起拱线（springline） |
| 3 | 缺边肯德基 | `frame_half_kfc` | **三边框（缺一边）**：左竖料 `(0,1)(0,0)(0.016,0.025)(0.016,1)`、上横料 `(0,0)(1,0)(0.984,0.025)(0.016,0.025)`，料厚 0.016×2500 ≈ **40mm** |
| 7 | 肯德基门4 | `frame_kfc4` | 矩形框 + **偏心竖柱**：竖料落在 `x=0.224..0.24`（≈40mm 厚，位置在 0.232W 处而非中缝），底横料 `(0.24,1)(0,1)(0.016,0.975)(0.224,0.975)` |
| 9 | 立体圆弧窗 | `frame_three_dimensional_arc` | 由多段 **0.006 归一化厚度（≈40mm）的直料四边形**拼出折面弧（`0.216,0..0.231` 等），即"立体弧"= 多段短直料逼近 + 投影偏移，包围盒 6250×6935（含投影） |

另：`frame_half_kfc2`、`frame_parallelogram` 的 **id 已确认但未采到几何**（激活成功、bodies=0）。

### 8.3 「框」面板 idx → 工具 id 全量映射（40/40 已扫描）

**已确认 25 项**（点击即切工具）：

| idx | 标签 | 工具 id | idx | 标签 | 工具 id |
|---|---|---|---|---|---|
| 0 | 外框 | `frame_scalable` | 17 | 等腰三角形 | `frame_isosceles_triangle` |
| 3 | 缺边肯德基 | `frame_half_kfc` | 18 | 六边形 | `frame_hexagon` |
| 4 | 缺边肯德基2 | `frame_half_kfc2` | 19 | 六边形2 | `frame_hexagon2` |
| 6 | 肯德基门2 | `frame_kfc2` | 21 | 菱形 | `frame_diamond` |
| 7 | 肯德基门4 | `frame_kfc4` | 23 | 三角顶 | `frame_peak_pentagon` |
| 8 | 圆 | `frame_circle` | 25 | 四分之一拱 | `frame_quarter_arch` |
| 9 | 立体圆弧窗 | `frame_three_dimensional_arc` | 28 | 凸 | `frame_convex` |
| 10 | 平行四边形 | `frame_parallelogram` | 29 | 四叶草 | `frame_quatrefoil` |
| 11 | 半圆 | `frame_half_circle` | 30 | extendedpartialarch | `frame_extended_partial_arch` |
| 13 | 哥特式 | `frame_gothic` | 36 | 异形外框（第2个） | `frame_ear3` |
| 14 | 洋葱 | `frame_onion` | 37 | 波浪 | `frame_wave` |
| 15 | 八边形 | `frame_octagon` | 38 | 清真寺 | `frame_mosque` |
| — | — | — | 39 | 异形 | `frame_polygon` |

**15 项点击后 `curTool` 不变**：idx 1 拱形、2 门、5 肯德基门、12 四分之一圆、16 springlineflanker、20 六边形3、22 angledpentagon、24 梯形、26 hollowside、27 凹、31 三角形、32 单耳窗、33 framepointedear、34 双耳窗、35 异形外框（第1个）。

**规律（重要推断）**：这 15 项**恰好都是注册表里带方向/变体后缀的形状** —— 例如 `frame_trapezoid` 有 `_right/_down/_left`，`frame_ear` 有 `_left/_up/_down`，`frame_quarter_circle` 有 `_left/_mirror_*`，`frame_springline_flanker` 有 5 个变体，`frame_hollow_side` 有 4 个，`frame_angled_pentagon` 有 4 个，`frame_triangle` 有 `_left`。所以它们**点击后应是弹出"变体选择"浮层**（选方向/镜像），而不是直接切工具；我的五连点击可能已经打开了浮层，但没有再点浮层里的选项。

**下一轮验证做法**：点这类 item 后立刻枚举浮层容器（`.v-menu__content`、`.v-popover`、`.v-dialog`、`.v-bottom-sheet`）里的可点项，逐个点击并读 `curTool`，即可一次拿到某个形状的**全部方向变体 id + 各自轮廓**（这正好覆盖注册表里那 ~70 个 `frame_*` 变体）。

**采集时的稳定性规律**：每成功激活一次，**紧接着的下一次点击常常无效**（需要重试或先点画布空白处取消选中）；`__map` 必须边跑边写 `localStorage`，否则 15s 超时会丢掉整批。

### 8.4 变体菜单机制（已破解）+ 55 个变体 id

§8.3 里那 15 个"点了没反应"的项，**其实是打开了一个方向/变体菜单**：每个变体族都有一个常驻 DOM 的 `.v-menu__content`（平时 `display:none`），里面是 `.v-list-item`，图标类名即方向（`icon06_shang/you/xia/zuo` = 上/右/下/左）。

**关键技巧**：**直接对菜单项派发 pointer+mouse 五连事件就能切换工具，即使菜单是 `display:none`**（合成事件不受可见性影响）。因此无需真的把菜单弹出来，可以程序化遍历所有变体。

已扫出 **55 个变体 id**（按菜单分组，`M#` 是 `.v-menu__content` 的 DOM 序号，一个菜单可能承载两个族）：

| 菜单 | 族（对应面板项） | 变体 id（省略 `frame_`/`mullion_` 前缀） |
|---|---|---|
| M0 | 连体圆弧（梃） | `mullion_semi_arc_pro`、`mullion_semi_arc_pro2`、`mullion_semi_segment_pro` |
| M1 | 扇中梃（梃） | `mullion_inner_eq_split`、`mullion_inner_121_split` |
| M2 | 拱形 | `springline`、`springline2` |
| M3 | 四分之一圆 | `quarter_circle`、`left_quarter_circle` |
| M4 | 梯形 | `trapezoid`、`trapezoid_right`、`trapezoid_down`、`trapezoid_left`、`isosceles_trapezoid` |
| M5 | 单轨/单耳 | `single_track`、`single_track_left`、`single_track_up`、`single_track_down`、`single_track_left_right` |
| M6 | 肯德基门 | `kfc`、`kfc3` |
| M7 | springlineflanker | `springline_flanker`、`springline_flanker_left` |
| M8 | 六边形3 | `hexagon3`、`rounded_rectangle` |
| M9 | angledpentagon | `angled_pentagon`、`_right`、`_down`、`_left` |
| M10 | hollowside / 双耳窗 | `hollow_side`、`_down`、`_left`、`_up`；`double_ears`、`_left`、`_right` |
| M11 | 凹 / 双耳 / 耳2 | `hollow`、`hollow2`、`hollow_down`、`hollow_left`、`hollow_right`；`double_ears_down`、`double_ears2`；`ear2`、`ear2_vertical` |
| M12 | 三角形 | `triangle`、`triangle_left` |
| M13 | 单耳窗 | `ear`、`ear_left`、`ear_up`、`ear_down` |
| M14 | framepointedear | `pointed_ear`、`_left`、`_up`、`_down` |

**M15/M16 已补扫（17 个菜单全部扫完）**：

| 菜单 | 族 | 图标 → 工具 id |
|---|---|---|
| M15 | 双耳窗（5 项） | `shuanger_shang → frame_double_ears`、`shuanger_zuo → _left`、`shuanger_you → _right`、`shuanger_xia → _down`、`shuangerdaifuchu → frame_double_ears2` |
| M16 | 外框3/外框竖（2 项） | `waikuang3 → frame_ear2`、`waikuangshu → frame_ear2_vertical` |

图标类名本身携带语义（`shang/you/xia/zuo` = 上/右/下/左，`shuanger` = 双耳，`danguiwaikuang` = 单轨外框），可直接当作方向标记写进我们的规格表。

**变体总数 55 个 id（去重后）**，覆盖 M0–M16 全部菜单。注册表里**仍未对应到任何菜单/面板入口**的 id（可能是内部派生或已废弃）：`frame_rectangle`、`frame_mirror_quarter_circle`、`frame_mirror_left_quarter_circle`、`frame_mirror_springline_flanker(_left)`、`frame_springline_flanker_down(_left)`、`frame_chamfered_rectangle`、`frame_peak_pentagon2`、`frame_convex_left/_down/_right`、`frame_convex2(_down/_right/_left)`、`frame_ear4`、`frame_inner_arc`。

### 8.5 变体轮廓实测（已读回 6 个）

采集函数 `__varCycle2(toolId)`：`新增` 复位 → 按 `localStorage['qoder-variant-idx']` 里的 (菜单序号, 项序号) **直接点菜单项**激活变体 → 校验 `curTool === toolId` → 拖拽 (700,700)→(2000,2000) → 差分 → 只保留料件色 → 归一化到并集包围盒。

| 变体 id | 包围盒(mm) | 实测轮廓 |
|---|---|---|
| `frame_trapezoid` | 2000×2918 | 8 个料件；角部圆角弧 `r0.069`，圆心 `(0.1,0.37)` 区间 `-0.5..1.6`、`(0.9,0.069)` `1.6..2.6` |
| `frame_trapezoid_right` | **2080×1840** | 7 个料件；圆角 `r0.096`，圆心 `(0.481,0.108)` `1..-3.1`、`(0.904,0.891)` `-3.1..-2.1` |
| `frame_trapezoid_down` | **1840×2080** | 7 个料件；圆角 `r0.096`，圆心 `(0.891,0.481)` `2.6..-1.6`、`(0.109,0.904)` `-1.6..-0.5` |
| `frame_quarter_circle` | 3200×3200 | 3 个料件：**两段直料在中心成直角** —— 竖料沿 `x=0.5`（`y 0→0.5`）、横料沿 `y=0.5`（`x 0.5→1`），料厚 `0.013`（≈40mm）；第三件为四分之一弧 |
| `frame_triangle` | 2000×2000 | 玻璃 = **直角三角形** `(0.131,0.175)(0.131,0.869)(0.825,0.869)`；直角处 `r0.1` 圆角弧（圆心 `(0.1,0.1)`） |
| `frame_ear` | 2100×2100 | 8 个料件：**主框玻璃 `x 0.03..0.637 × y 0.029..0.97`** + 一根全高竖料 `x 0.648..0.667` → 主体矩形 + 右侧"耳"部凸出 |

**方向变体 = 旋转/镜像（有据）**：`trapezoid_right` 与 `trapezoid_down` 的包围盒互为转置（2080×1840 ↔ 1840×2080），圆角半径同为 `r0.096`，圆心坐标互为 `(x,y)→(y,x)` 转置，弧角区间整体平移约 π/2。⇒ **我们实现时只需"基础形状 + 一个方向参数（旋转/镜像）"**，不必为每个方向单独建模，这正好对上他们 `_right/_down/_left/_up/_mirror_*` 的命名方式。

**第二批已读回 8 个**（重载后直接从 `localStorage['qoder-harvest-specs']` 取回，无需重装探针）：

| 变体 id | 包围盒(mm) | 实测轮廓 |
|---|---|---|
| `frame_pointed_ear` | 2100×2100 | 7 件；主结构与 `ear` 相同（主框玻璃 `0.03..0.637 × 0.029..0.97` + 全高竖料 `0.648..0.667`），**尖耳特征在其余 5 件里**（见下方注意事项） |
| `frame_hollow_side` | 2400×1600 | 6 件；左竖料 `(0,0)(0,1)(0.017,0.975)(0.017,0.025)`（0.017×2400 ≈ **41mm**）+ 底横料 `(0,1)(1,1)(0.983,0.975)(0.017,0.975)` → 缺一侧的凹边框 |
| `frame_single_track` | 2100×2100 | **只有 3 件**：左竖料 `(0.019,0.019)(0,0)(0,1)(0.019,0.981)` + 底横料 `(0.019,0.981)(0,1)(1,1)(1,0.981)` → **单轨 = 两根料构成的开放框** |
| `frame_angled_pentagon` | 1400×2120 | 8 件；玻璃 = **6 点斜角五边形** `(0.187,0.971)(0.956,0.971)(0.956,0.123)(0.59,0.123)(0.187,0.389)` —— 左上角被一条斜边切掉 |
| `frame_springline` | 2900×2900 | 5 件；玻璃 = 4 点 + **1 段弧 `圆心(0.5,0.5) r0.479`** → 下矩形 + 上拱（起拱线拱形）；竖料 `0.155..0.169`（≈40mm） |
| `frame_hollow` | 2400×1600 | 8 件；前两件与 `hollow_side` 完全一致（左竖料 + 底横料），凹形族共用料件 |
| `frame_double_ears` | 2100×2100 | 11 件；顶横料通宽 `(0.981,0.019)(1,0)(0,0)(0.019,0.019)` + 角部玻璃块 `0.03..0.323 × 0.029..0.304` → 双耳 = 主体 + 两个角部凸出 |
| `frame_left_quarter_circle` | 3200×3200 | 4 件；竖料沿 `x=0.5`（`y 0→0.5`，厚 `0.012`）+ 玻璃 3 点 `(0.481,0.02)(0.481,0.481)(0.02,0.481)` + **弧 `圆心(0.5,0.5) r0.481`** |

**镜像关系已验证**：`left_quarter_circle` 与 `quarter_circle` 的直料同在 `x=0.5 / y=0.5`、弧半径几乎相同（`r0.481` vs `r0.5` 外缘），差别只在**玻璃落在哪个象限**（左上 vs 右下）⇒ 再次印证 §8.5 的结论：**方向变体 = 基础形状 + 旋转/镜像**，我们不需要为每个方向单独建模。

**未采/注意事项**
- 本条写成时 `frame_hexagon3` 那一批被超时截断；**后续已补采成功**（连同 `rounded_rectangle`、`kfc`、`kfc3`），目前真正未采的只剩 §8.6 列出的 6 个基础形状。
### 8.6 变体采集累计（top 放宽到 6 件）

把 `top` 从 2 件放宽到 6 件后，圆角族终于看全了：

- **`frame_rounded_rectangle`**（3000×1920，8 件）：**四个角各一段圆弧**，圆心分别在 `(0.2,0.688)`、`(0.8,0.688)`、`(0.8,0.313)`、`(0.2,0.313)`，**外 `r0.2` / 内 `r0.187`**（料厚 = 0.013×3000 ≈ 40mm）+ 四段直料（如左直料 `0,0.313 → 0,0.688`）。即**圆角矩形 = 4 段 90° 环带扇形 + 4 根直料**。
- **`frame_hexagon3`**（2400×1920，6 件）：**只在上方两个角有圆弧**（圆心 `(0.75,0.313)` 与 `(0.25,0.313)`，外 `r0.25` / 内 `r0.233`），其余为直料（左/底/右三根 + 顶直料 `0.25,0 → 0.75,0`）。所以"六边形3"其实是**矩形 + 顶部两角大圆角**。

**已采变体 18 个**（`localStorage['qoder-harvest-specs']` 的 `变体#frame_*`）：`trapezoid`(+`_right`/`_down`)、`quarter_circle`(+`left_`)、`triangle`、`ear`、`pointed_ear`、`hollow_side`、`single_track`、`angled_pentagon`、`springline`、`hollow`、`double_ears`、`hexagon3`、`rounded_rectangle`、`kfc`、`kfc3`。

其中 **`kfc` 与 `kfc3` 已采集但明细尚未读回**（读回时页面又卡死），下次直接：
```js
JSON.parse(localStorage.getItem('qoder-harvest-specs'))['变体#frame_kfc']  // 以及 _kfc3
```

### 8.7 基础形状集已齐（累计 24 个变体已采）

**最后 6 个基础形状**（一次只跑 1 个 id 才不超时；每项实测 5~6s）：

| 变体 id | 包围盒(mm) | 料件构成（归一化） |
|---|---|---|
| `frame_ear2` | 2500×1600（10 件） | **倒 L 形**：主矩形 `0..1 × 0..0.688`（顶横料 + 左竖料 + 右侧竖料）+ 右下凸出块（底横料 `0..0.64`、竖料 `x 0.64..0.656`） |
| `frame_ear2_vertical` | 1600×2500（10 件） | 与 `ear2` **互为转置**（竖料 `x 0.663..0.688`、横料 `y 0.344..0.36`）→ 再次验证方向变体 = 转置/旋转 |
| `frame_springline_flanker` | 2134×2134（5 件） | 竖料 `x=0.5`（`y 0→0.75`）+ 横料 `y=0.75`（`x 0.5→1`）+ 右竖料 `x=1`（`y 0.5→0.75`）+ **大弧 外`r0.5`/内`r0.481`（圆心 0.5,0.5）**；玻璃 4 点 + 弧 `r0.471` → **四分之一圆 + 0.75 处一条水平台阶腿** |
| `frame_isosceles_trapezoid` | 3200×1800（9 件） | 4 根斜接料围成**等腰梯形**（顶边 `x 0.25..0.75 @y=0.111`、底边 `x 0.063..0.938 @y=0.889`）；玻璃 `(0.092,0.855)(0.908,0.855)(0.737,0.146)(0.263,0.146)`；角部圆角弧 `r0.063` |
| `frame_hollow2` | 2400×1600（11 件） | 完整左/右/底三边 + **顶部断成两段**（`0→0.367` 与 `0.633→1`）并各接一根下探竖料（`x 0.35..0.367`、`x 0.633..0.65`，到 `y=0.4`）→ **顶部中央凹口** |
| `frame_double_ears2` | 2100×2800（13 件） | 顶横料通宽 + 左竖料到 `y=0.5` + 横料 `y=0.486..0.5`（`0→0.333`）+ 竖料 `x=0.333..0.352`（`y 0.25→1`）+ 底横料 `0.352→0.648` + 对称竖料 `x=0.648..0.667` → **中间主体 + 左右两耳** |

**另外两个门族**（`top` 放宽到 6 件后读回）：
- `frame_kfc`（2100×2100，9 件）：顶/左全边 + 底横料只到 `x=0.352` + 两根通高竖柱 `x 0.333..0.352` 与 `x 0.648..0.667` → **主框 + 双竖柱三分**。
- `frame_kfc3`（3500×2100，14 件）：顶/左全边 + 底横料分段（`0→0.2`…）+ 多根竖柱 `x≈0.205`、`0.395`… **等分竖柱联排，间距 ≈0.195（≈682mm）**。

**结论：基础形状集已齐** —— 共 **24 个变体**有实测料件构成（`trapezoid`(+`_right`/`_down`)、`quarter_circle`(+`left_`)、`triangle`、`ear`、`pointed_ear`、`ear2`、`ear2_vertical`、`hollow_side`、`hollow`、`hollow2`、`single_track`、`angled_pentagon`、`springline`、`springline_flanker`、`isosceles_trapezoid`、`double_ears`、`double_ears2`、`hexagon3`、`rounded_rectangle`、`kfc`、`kfc3`）。其余 `_left/_right/_up/_down/_mirror_*` 方向变体按 §8.5 的**转置/旋转/镜像**规律推导即可（`trapezoid_right ↔ _down` 与 `ear2 ↔ ear2_vertical` 两组转置已实测验证）。

数据全在浏览器 `localStorage['qoder-harvest-specs']`（键 `变体#frame_<id>`），重载不丢。

**（已修正的早期误判）** 曾以为「框」面板存在索引与工具错位（idx5 标签"肯德基门"却读到 `three_dimensional_arc`、idx6 读到 `parallelogram`）。真实原因是：**这些项点击后不切工具，`curTool` 沿用了上一个成功激活的 id**，于是看起来像错位。根因见 §8.4 —— 它们是**变体族入口**，点开后还要再点菜单里的方向项才会真正切工具。所以采集时**必须校验 `curTool` 是否变化**，不能只读它的值。

**正确流程（下一轮照做）**：
1. 先只跑"激活不放置"的扫描：`for idx in 0..39: switchTab('框'); actIdx(idx); 记录 (idx, label, curTool)`，得到**真实 idx→id 映射**（梃类就是这么做的，19/19 全对）。
2. 再按映射逐项采集；每次采集后校验 `curTool` 与期望 id 一致，不一致就跳过并记为失效。
3. 每批 ≤3 项；页面会周期性卡死（连同步 `evaluate` 都 15s 超时），卡死后 `navigate` 重载 + 重跑附录 A 安装脚本（`__specs` 已从 `localStorage['qoder-harvest-specs']` 自动恢复）。

### 8.8 我方实现映射（异形外框 25 种，已落码并实机验证）

单一来源：`packages/core/src/outline.ts` 的 `FRAME_SHAPE_IDS`（`packages/schema` 的 `DesignComponent.shape` 枚举由单测防漂移），UI 在画布顶部工具条「外框形状」分组下拉（直边类 / 凹形 / 拱形类 / 多边形·圆）。

几何走两条路：`rect/trapezoid/arch/gothic` 保持原有「直接在真实 box 上生成」（P1/P2 的既测行为不变）；其余形状走 **单位轮廓 → 镜像 → 朝向旋转 → 角部圆角 → 仿射映射到 box**，因此：

- **方向变体不必逐个实现**：`trapezoidRight/Down/Left` = 同一份单位梯形转 90°/180°/270°，`quarterCircleLeft`/`rightTriangleLeft` = 镜像。实测「`trapezoid_right ↔ _down` 互为转置、`ear2 ↔ ear2_vertical` 互为转置」的规律据此一次性覆盖了注册表里那批 `_left/_right/_up/_down/_mirror_*`。
- **角部圆角按实测配**：`cornerRatio` = 实测 `ctx.arc` 半径 ÷ 包围盒（八边形 0.092、六边形 0.071、菱形 0.081、等腰三角形 0.1、直角三角形直角处 0.1、圆角矩形 **0.2**、六边形3 顶部两角 0.25），每个顶点用「控制点=原顶点」的二次贝塞尔过渡、短边自动收敛切距；`cornerOnly` 支持「只圆某几个角」（实测的直角三角形只圆直角处、`hexagon3` 只圆顶部两角）。这正是实测归纳的第 2 条「他们的异形框没有尖角」。
- **凹形也能干净分割**：`clipByAxis` 已从 Sutherland–Hodgman 换成**「交点配对 + 边界链」**——SH 只对凸多边形正确，凹形会静默产出跨越缺口的「桥接」自交多边形。新实现只保留落在切割带内的边界链并用弦闭合，链数不符合单一连通（凹形切成多块、或与切割线重合退化）就返回 `null`，上层按「此处不能分割」拒绝。单测对全部 25 种形状断言：外轮廓、内缩轮廓、分割三块**都是无自交的简单多边形**，且三块面积之和 == 原轮廓面积。

| 我方 shape | 对应工具 id | 状态 |
|---|---|---|
| `rect` / `arch` / `gothic` | `frame_scalable` / `springline` / `frame_gothic` | 既有（P1） |
| `roundedRect` | `frame_rounded_rectangle` | 新实现（实测四角圆心 `(0.2,0.313)` 等 → r=0.2×宽） |
| `trapezoid`(+`Right`/`Down`/`Left`) | `frame_trapezoid*`、`frame_isosceles_trapezoid`（窄边比≈0.5） | 新实现方向变体 |
| `parallelogram` | `frame_parallelogram` | 新实现（对方 bodies=0 未采到几何，按斜切矩形） |
| `peakPentagon` | `frame_peak_pentagon`（三角顶） | 新实现 |
| `angledPentagon` | `frame_angled_pentagon` | 新实现（实测玻璃 5 点归一化，左上被一条斜边切掉；该形状实测无圆角） |
| `halfCircle` | `frame_half_circle` | 新实现（半椭圆填满 box，底边即平底槛） |
| `quarterCircle` / `quarterCircleLeft` | `frame_quarter_circle` / `left_quarter_circle` | 新实现 |
| `triangle` | `frame_isosceles_triangle` | 新实现（点序取实测 (0.5,0.1)(0.1,0.9)(0.9,0.9) 归一化）。**注意 `frame_triangle` 是另一个工具**：实测玻璃为直角三角形，见下一行 |
| `rightTriangle` / `rightTriangleLeft` | `frame_triangle` / `frame_triangle_left` | 新实现（实测 (0.131,0.175)(0.131,0.869)(0.825,0.869) 归一化；**只圆直角处** r0.1） |
| `diamond` / `hexagon` / `octagon` / `circle` | `frame_diamond` / `hexagon` / `octagon` / `circle` | 新实现（八边形点序直接用实测值） |
| `hexagonTop` | `frame_hexagon3` | 新实现（实测「六边形3」其实是矩形 + 顶部两角 r0.25 大圆角，底部两角仍尖角） |
| `lShape` / `notchTop` / `earsTop` | `frame_ear2` / `frame_hollow2` / `frame_double_ears2` | **凹形**新实现：倒L（主矩形 0..1×0..0.688 + 右下块，面积比 0.888）、顶部中央凹口（凹口 x 0.367..0.633 深 0.4，比 0.894）、上部通宽 + 下部窄柱的 T 形（比 0.657）。`ear2 ↔ ear2_vertical` 的转置规律说明它们同样可用 `orient` 出方向变体 |

**实测印证（不必改代码）**：`frame_quarter_circle` 的实测是「两根直料在**中心**成直角（竖料 `x=0.5`、横料 `y=0.5`）+ 一段四分之一弧」——按其自身并集包围盒归一化后，正是我方实现的「直角在左下、竖直左边 + 水平底边 + 弧从左上到底右」；`left_quarter_circle`（玻璃落在左上象限）就是它的镜像 ✓。

**未收录（受阻原因要记着，别再当"漏做"）**：
- `ear` / `pointed_ear`：实测只给到「主框玻璃 `0.03..0.637` + 一根全高竖料 `0.648..0.667`」，**耳部凸出的 y 范围没有读到**，无法定出闭合轮廓（`ear2`/`double_ears2` 已实现，见上表）。
- `hollow` / `hollow_side` / `single_track` / `kfc` / `kfc2` / `kfc3` / `kfc4` / `half_kfc`：**已可用「矩形框 + 缺边」表达（P16）** —— `tree.frameOpenSides`（上/下/左/右可缺）被缺的边不画框料，且公式行 / 异形四边 / 回退三条出料路径都按边扣减根数；于是 2~3 根料的开放框（`hollow_side`、`single_track`、`half_kfc`）直接可选，`kfc2/3/4` 这类「框 + 等分竖柱」再叠我方等分即可。**仍未做的是这些工具 id 的一键预设入口**（目前需两步操作）。
- `springline_flanker`：四分之一圆 + `y=0.75` 处一条水平台阶腿，需先确认台阶腿属于同一轮廓还是独立补料。
- `wave` / `quatrefoil` / `mosque` / `onion` / `three_dimensional_arc`：缺实测点序，或含贝塞尔/折面投影（立体弧是多段短直料逼近 + 投影偏移）。

**已推翻的旧近似**：`insetPolygon` 曾是**质心按比例缩放**（多边形角部内缩量偏大），**P13 已换成真等距内缩**：凸形逐边做内侧半平面裁剪、凹形 miter+bevel、结果不自交/面积同号/点在原轮廓内才采纳，否则退回质心缩放兜底。前后影响对照见 §8.9。剩余已知近似：凹形凹角用 bevel（直线倒角）承接，不是圆弧过渡。

### 8.9 P13 真等距内缩：实现与前后影响对照（2026-09-08，用户已批准）

`insetPolygon`（`packages/core/src/outline.ts`）从**向质心按比例缩放**换成**真等距内缩**：

- **凸多边形**（含弧/圆角采样）：逐边做「内侧偏移 inset 后的半平面」裁剪，即所有偏移半空间的交 —— 精确、天然不自交。（先前试过的「miter 交点」写法在圆角采样链上会翻车：短边的交点被相邻两边越过导致自交，故凸形统一走裁剪。）
- **凹多边形**（`lShape`/`notchTop`/`earsTop`）：每边沿内法向平移，凸角取偏移线交点（miter，超过 4×inset 改倒角），凹角给出两侧偏移端点（bevel）——旧算法在凹角处会过度内缩。
- **兜底**：结果必须仍是「同号、正面积、无自交、所有点在原轮廓内」，否则退回质心缩放（inset 大于最小特征宽度等退化情形），渲染/算料永远拿不到坏轮廓。
- 单测判据：① 矩形内缩 60 精确到四边各 60 且面积 = (w−2d)(h−2d)；② 全部 25 种形状「内缩后任一点到原边界的距离 ≥ d − 0.02」（料厚处处不欠）+ 点仍在原轮廓内；③ 凹形周长不增大、缺口窄于 2d 时走兜底仍是有效多边形；④ 钉住旧算法偏大（矩形 1500×1100/料 60 时旧内腔比新的大 6.6%）。

**影响**：外框 1460×1060、料厚 60mm 时内腔面积变化（旧 → 新，单位 cm²×10 即 10⁻¹ m²… 下表数值为 **cm²×100**，即 134.9 表示 1.349 m²）：

| shape | 旧内腔 | 新内腔 | Δ | 旧周长 | 新周长 |
|---|---|---|---|---|---|
| `rect` | 134.9 | 126.0 | -6.6% | 4705 | 4560 |
| `roundedRect` | 126.8 | 123.0 | -3.0% | 4300 | 4263 |
| `trapezoid` | 105.8 | 98.1 | -7.3% | 4199 | 4037 |
| `trapezoidRight` | 107.0 | 97.4 | -9.0% | 4320 | 4162 |
| `trapezoidDown` | 105.8 | 98.1 | -7.3% | 4199 | 4037 |
| `trapezoidLeft` | 107.0 | 97.4 | -9.0% | 4320 | 4162 |
| `parallelogram` | 98.2 | 91.0 | -7.4% | 4098 | 3925 |
| `lShape` | 117.1 | 108.8 | -7.1% | 4732 | 4525 |
| `notchTop` | 122.2 | 104.8 | -14.3% | 5363 | 5338 |
| `earsTop` | 84.7 | 73.3 | -13.5% | 4718 | 4490 |
| `arch` | 109.1 | 104.7 | -4.1% | 4053 | 3968 |
| `gothic` | 83.4 | 78.0 | -6.6% | 3785 | 3649 |
| `peakPentagon` | 101.7 | 95.1 | -6.5% | 4031 | 3922 |
| `angledPentagon` | 121.5 | 114.7 | -5.6% | 4443 | 4315 |
| `halfCircle` | 100.9 | 96.3 | -4.6% | 3949 | 3853 |
| `quarterCircle` / `quarterCircleLeft` | 103.5 | 95.7 | -7.6% | 4206 | 4050 |
| `triangle` | 63.5 | 55.0 | -13.4% | 3472 | 3370 |
| `rightTriangle` / `rightTriangleLeft` | 63.5 | 53.5 | -15.7% | 3970 | 3574 |
| `diamond` | 60.8 | 57.1 | -6.2% | 3098 | 3049 |
| `hexagon` | 89.3 | 87.7 | -1.8% | 3485 | 3467 |
| `hexagonTop` | 129.7 | 123.3 | -4.9% | 4467 | 4363 |
| `octagon` | 104.2 | 103.2 | -1.0% | 3738 | 3723 |
| `circle` | 96.9 | 95.8 | -1.0% | 3593 | 3575 |

读法与注意：
1. **矩形也在表内**是因为 `insetPolygon` 被异形路径与 `window-tree-render` 的 roleType 环带共用；常规矩形窗走的是解析框料（不经此函数），**存量矩形窗的数字不受影响**。
2. 内腔一律变小 1%~16%，方向符合预期：旧算法按"顶点到质心的距离"缩放，等于把角部按对角线让位，**内腔系统性偏大**（玻璃偏大、料偏长），越尖/越瘦长的形状误差越大（直角三角形 −15.7%、顶凹口 −14.3%），而圆/八边形这类"顶点到质心距离均匀"的形状几乎不变（−1%）。
3. 四边料长（顶/底/左/右）的分配还会因 `outlineFourSides` 的"主导方向归属"启发式而**换边**（例如凹形/T 形内缩后某些斜边从"顶"改归"底"），所以个别 shape 的分项数值跳变比周长变化大；**总料长看周长列**。

### 8.10 P17 弧梃（曲线中梃）：`splitByChain` + 已接线到树 / 渲染 / 出料 / UI

弧梃要真正把格子切成两块，就必须能用**非线性边界**分割多边形。新增内核（`packages/core/src/outline.ts`）：

- `arcChain(center, r, fromDeg, toDeg, segments=32)` —— 把圆弧采样成分割链（与全站"弧=折线逼近"的口径一致）。
- `splitByChain(poly, chain)` —— 用一条开折线把简单多边形切成两块：只接受"穿入一次、穿出一次"（交点数恰为 2）；两块都必须是简单多边形且**面积之和等于原多边形**，否则返回 `null`。与 `clipByAxis` 同一套"宁可不切也不产出坏轮廓"的纪律。
- 等宽弧梃带 = **两次切割**：先用外弧切出（内侧 / 外叶），再用内弧把内侧切成（内叶 / 带）。单测验证带的最小/最大半径差恰为料厚（50mm 档），三块面积拼回原矩形。
- 顺带能力：任意起伏的曲线分隔（只在两侧各穿一次的链）同样可用。

**已接线（同轮完成）**：`WindowMuntin.curve = { sagittaMm }`（正=朝左/上凸）；`layoutContours` 对带 curve 的中梃改用 `clipByArcBand`，**失败自动回退 `clipByAxis`**；`describeWindowTree` 与 `toDesignComponents` 的门控从"异形框"放宽为"异形框 **或** 树内有弧梃"（`treeHasCurvedMuntin`），于是矩形框也能出现非矩形子区；`DesignComponent.arcLenMm` = 弧带中心线长（= 轮廓周长/2 − 料厚），BOM 出行名 `弧中梃(竖/横)`。整窗默认参数 `tree.muntinSagittaMm`（工具条"弧高(mm)"），分割与等分都跟随它；`splitArea` 未显式传弧高时取该默认，与料厚同一约定。

约束与退化（都有单测钉住）：
- **弧高必须 < 半弦**，且弧带需真能切成"内叶/带/外叶"三块（面积守恒 + 简单多边形），否则整体回退直线分割并且**不算弧长、不叫弧中梃**（实测 240mm 宽内腔配 180mm 弧高就属这种荒谬输入，早先版本会错配出 21mm 的"弧长"）。
- 标签与角标已改按**区域质心 `regionAnchor`** 定位（凹形/月牙质心落在区域外时退到"边中点朝质心微移"的内侧点）；3D 也已按弧还原（`describe.sagittaMm → SketchShape.curve → Preview3D` 沿弧链逐段摆小料）。仍是直线比例的是子区 **box**（把手定位、逐边拖拽、吸附都按它算），只有轮廓与出料按弧。
- **2026-09-09 无头 Edge 截图已确认 3D 弧带成型**（同场景弧高 0 与 200 两组对照：逐列"框色像素"剖面 0 组单调线性、200 组先降后升）。截图当时暴露的一处 3D 不一致**同日已修**：叶玻璃/扇料原先按直线 bbox 挤出，弧带下垂后与直玻璃边之间露出月牙形空隙。现已把子区轮廓打通：`describeWindowTree` 的局部扁平 `points` → `treeToShapes` 还原成绝对坐标 `SketchShape.contour` → `Preview3D.outlineOf()` 优先取 contour（需内缩时走 `insetPolygon`，退化就折半重试直至退回原轮廓，绝不回退成 bbox），玻璃板面与 `makeRing` 的环带都按它挤出。验收：弧高 200 月牙空隙消失、弧高 0 的直梃剖面逐列数值与改前完全一致（无回归）、`arch` 与凹形 `notchTop` 的叶玻璃都改 hug 内缘且三角化无破面。
- **3D 扇料环已补上（同日）**：树模式下**开启扇/纱扇**（`casementSash/slidingSash/topHungSash/screen`）沿子区轮廓挤出一圈扇料（前=外面色、后=内色，与外框同一套两层约定；离边界 2mm 留企口缝避免与框料、中梃共面闪烁），玻璃按 `sashWidthOf(tree)` 内缩；**固定格仍"格子即板面"**（玻璃与框料/中梃内缘齐平），旧画布模式完全不走这条路。截图验收：直梃叶可见 45° 拼角的矩形扇料、弧梃叶的上下横档**沿弧弯曲**且与弧带之间留出均匀企口缝。

### 8.11 `insetPolygon` 凹形 join 修复（3D 扇料环的前提，已验收数字零变动）

给弧梃叶按扇料宽内缩时暴露出内核缺陷：**弧链与直边之间的锐角**处，旧 join 规则按"转向符号 `den*s` 判凹凸 → 凹角倒角"把它误判成凹角，倒角取的是两条偏移边的原始端点，而这两个端点落在相邻边的半平面**之外**（实测 1080×1380 内腔、弧高 200、料厚 40：4 个点跑到轮廓外，最深 19mm）；于是整条候选被判无效，静默退回"向质心缩放"，而 `scaleInset` 的中心用的是**顶点平均**——弧叶 21 个顶点里 18 个挤在弧上，平均中心直接落到区域外，兜底结果同样越界。后果：2D 的 `drawPolySash` 玻璃会溢出叶形，3D 里 three.js 拿到"洞比外轮廓还大"的多边形就把整格填成实心板。

修法（`packages/core/src/outline.ts`）：
- 保留旧 join 作为**第一候选**（`lShape/notchTop/earsTop` 等已验收形状的数字因此逐字节不变）；只有它无效时才用**候选点 join** 重建一次：每个角先取两侧偏移线交点，交点不在原轮廓内就改用仍在轮廓内的那些偏移端点，两端点都不在内说明该角已被这条边吃掉，直接跳过。
- `scaleInset` 的中心从顶点平均换成 `regionAnchor`（面积质心 + 保证落在区域内），兜底结果不再越界。
- 两条判据都进了单测：`等距内缩：已验收的凹形内腔数字不变`（钉住 1500×1100 内缩 60 时 lShape 1168872/4685、notchTop 1127640/5530、earsTop 790875/4650）与 `等距内缩：弧梃切出的凹形叶内缩后仍在原轮廓内`（上下两叶 × 内缩 2/45/60 验正面积、不越界、面积变小）。25 形状 × 内缩 40/60/80/120 的新旧对照：**只有弧叶变了**，其余全部一致；core 225/225 通过。
- 注意：改了 core 之后，正在跑的 vite 仍用预打包的旧 `@wdd/core`，要 `npm run dev -- --force` 重启才生效。

### 8.12 P21 斜梃（对角中梃）：`clipByDiagonalBand` 与全链接线

对应对方注册表里 `mullion_diagnoal` / `mullion_counterdiagnoal`（不在梃面板里，靠 `spin`/`compound_*` 复合梃成批出现），是梃类欠账的共同前置。

**参数约定**（`WindowMuntin.direction = 'diagonal' | 'antiDiagonal'`）：
- 把宿主区归一化后取偏移坐标 `f`：↘ 族 `f = v − u`，↗ 族 `f = v + u − 1`，`f ∈ [−1, 1]`，**`f = 0` 就是那条角到角的对角线** ⇒ `ratio = 0.5` = 对角线本身，`ratio = (1 − f)/2`。
- `thicknessMm` 按**垂直于料**计（换算到 f 单位要乘该方向梯度模长 `hypot(1/w, 1/h)`）；斜梃**不支持弧高**（`splitArea` 内部把 `sagittaMm` 归零）。
- 内核 `clipByDiagonalBand(poly, slope, ratio, thickness)` = **两次 `splitByChain`**（先切出大 f 侧，再把剩下那块切成带），沿用弧带那套"宁可不切也不产出坏轮廓"的纪律：穿越次数≠2、自交、三块面积不守恒、带长非正 ⇒ 一律 `null`。`a` 恒为小 f 侧（↘ 时含右上角），与 `clipByAxis`「a=左/上侧」同序。

**矩形树模型怎么容纳非矩形子区**：`WindowTreeArea` 的 `xr/yr/wr/hr` 表达不了三角形，所以斜梃分割**只存占位 `[0,0,1,1]`**，真实包围盒由 `layoutTree` 现场按带裁剪取 `bBoxOf`；`layoutContours` 给出子区/带的真多边形，轮廓门控从"异形框或有弧梃"扩到 `treeNeedsContours`（弧梃**或**斜梃）。

**已经打通的链路**：2D 中梃与两片叶都走闭合 `Konva.Line`（实测斜带 6 点、两叶各 3 点）；格条按玻璃轮廓 `clipFunc` 裁剪（否则直条会跨过被切掉的角）；把手落在矩形位外时退回 `regionAnchor`；BOM 出行名 `斜中梃(↘)`/`斜中梃(↗)`、长度取**中心线长**（`polygonLen/2 − 料厚`，与弧带同一公式；按 bbox 单边会少算 √2），下料单两端 **45°**；3D 经 `treeToShapes` 输出斜 `p1/p2` + `widthMm`（斜带 bbox 看不出厚度）后按 `atan2` 摆料；校验侧 `OVERLAP` 改成**两块都有轮廓时按多边形判**（相邻两三角 bbox 完全重叠却互不覆盖），轴对齐格检族（`UNSEGMENTED/CELL_UNCOVERED/GRID_VIOLATION`）与 `MULLION_DISCONNECTED` 遇斜梃整族跳过。
UI 入口：工具条「分割:自动 / 斜梃↘ / 斜梃↗」下拉（`TreeEditorController.setSplitSlope`，预览直接画真带多边形）+ 等分对话框的方向下拉；提交不再从预览矩形宽高反推方向（旧写法是 `width()>height()` 的启发式）。

**仍降级/未做（诚实清单）**：斜向没有吸附线与吸附（只有轴对齐）；斜梃等分**只做二分**（多平行斜带要等分的是面积不是 ratio，且子区已非矩形）；拖三角形格的"边"会归到宿主区去调宿主（斜料没有落在其上的轴对齐边）；`SASH_SIZE` 仍按 bbox 量，斜切三角扇会保守地报超限；`DesignModel → 树` 反推（`shapesToTree`/CRM 旧方案）不认斜梃，会把它当中梃以外的构件跳过。
单测：`clipByDiagonalBand：斜带三块拼合…`（两朝向 × 角到角/偏心 × 面积守恒、带面积≈对角线×料厚、a/b 定向、极端比例与超厚拒绝、凹形宿主要么切不出要么守恒）+ `斜梃贯通`（树→轮廓→包围盒→DesignModel→BOM 行名与长度→45° 切角→校验不误报）+ `斜梃约束`（等分拒绝 n>2、小宿主拒绝、拖拽按 f 偏移移动、占位分数与真实包围盒）。core 228/228。

### 8.13 P22 复合梃一键分格：`applyMuntinPattern`（compound_* / spin 一族）

对方梃面板里"一次点出整套分格"的那一族（实测统计见 §6.3：`mullion_spin` 一次生成 7 段弧/斜梃 + 14 根框料 + 28 根扇料），我方做成**预设层**而不是新模型：`packages/core/src/window-tree-patterns.ts` 的 `applyMuntinPattern(tree, areaId, pattern, { installGap, thicknessMm })` 内部只是一串既有 `splitArea`/`equalDivide`，所以非矩形子区、扇料/玻璃/压线出料、下料切角、3D 与校验**全部自动继承**。

| 预设 | 成格 / 料数 | 顶替的对方工具 | 构成 |
|---|---|---|---|
| `square2x2` 田字 | 4 格 / 3 根 | `mullion_compound_square` | 竖 2 等分 + 每列横 2 等分 |
| `grid3x3` 九宫 | 9 格 / 8 根 | `mullion_compound_rectangle_single`（四角） | 竖 3 等分 + 每列横 3 等分 |
| `crossX` X 双对角 | 4 三角 / 3 根 | `mullion_diagnoal` + `mullion_counterdiagnoal` | 角到角斜带一刀，再对两块各切一刀 |
| `diamond` 菱形 | 5 格 / 4 根 | `mullion_compound_diamond` | 四角各切一刀（`ratio 0.76`） |
| `octagon` 八角 | 5 格 / 4 根 | `mullion_compound_long_octagon` / `double_octagon` | 同上但更浅（`0.86`） |
| `spin` 风车 | 8 格 / 6 根 | `mullion_spin` / `compound_x_square` | 田字 + 每象限一条斜带（同族 → 手性一致） |

**全成才生效**（这是这一层最重要的纪律）：① 每一步把目标的**真实尺寸**交给 `splitArea` 做前置校验；② 全部跑完后再对**选中格子树**做一次事后校验——被拒绝的切割不会留下带轮廓（子区会沿用父轮廓），所以"每根新中梃都有带轮廓 + 每片新叶子面积不退化（≥最大格的 1%）"才是真切出来了；任一条不满足就返回 `false`，**原树逐字节不变**（预设全程在深拷贝上试切，成功才回写 `root`）。单测钉住了"小格子套菱形 → false 且原树不变"。

**两个反直觉的实测结论**：① 菱形**不能**取 `ratio 0.75`（恰好过两邻边中点）——那样第三、四根斜料会在已有顶点上相交，穿越次数≠2 被裁剪器正确拒绝，所以取"刚好比中点浅一点"的 0.76（视觉上仍是菱形/大八角）；② 预设**一律出直料**：跑之前把草稿的 `muntinSagittaMm` 清零，整窗的弧高设置不会把田字/九宫变成弧梃（原树的设置原样保留）。

UI：工具条「复合梃」下拉（选中分格才可用，选中外框时禁用），菜单项即上表标签；**可嵌套套用**（先九宫、再对其中一格套菱形 → 9−1+5=13 格，实机已验）。每格自动继承原扇并顺延标号（A1…A9 唯一）。

**仍未覆盖**：`compound_circle` / `compound_hexagon` / `half_hexagon` / `mullion_wave` / `semi_arc` / `inner_arc` 那一族——要么需要任意角度料（我方斜料目前只有两族：平行于包围盒两条对角线），要么需要多段弧复合梃；且对方这些工具的**点序从未采到**（§6.3：单击零新增、手势未定论），所以本表是"按语义等价重实现"，不是照抄其排布。单测：`window-tree-patterns.test.ts` 5 条（六预设成格数与面积守恒、扇继承与标号唯一、只作用选中格、失败整单回滚、斜料出斜中梃行且不受弧高影响）。core 233/233。

### 8.14 P23 对开扇（`doubleSash`）：一个构件两片扇，中缝不是中梃

实测（§5.3）对开扇的关键是**中缝两根 60mm 对开料**（左扇右边 `1289..1349`，右扇左边同段）+ 玻璃拆两块 + 两把手各贴自由边。若按"加一根竖梃再放两扇"实现，中缝会出成 40mm **中梃料**，与实测不符，所以做成**单构件多叶**：

- **模型**：`WindowSashSpec.leaves = 2`（缺省/1=单扇，旧数据无损）+ 整窗 `meetingWidthMm`（缺省 `DEFAULT_MEETING_MM = 60`；实测扇料 22 时对开料 60）。单叶几何 `sashLeafRects`：`leafW = (w + 中缝) / 2`，两叶**在中缝重叠一根对开料**，合页各自朝左右外侧。
- **2D**：两片扇环（自由边那条料按中缝宽画，其余三边仍是扇料宽）+ 两个 `lw9` 开启三角（各自镜像）+ 两个把手（共用同一份 handle 配置 → 对称）。实机节点普查 `handles=2 / openingMarks=2`。
- **出料**：`扇料(横)×4`、`扇料(竖)×2`、**`对开料(中缝)×2`**（同角色型材、单列一行）、玻璃 `×2` 且按单叶算（`leafW − 扇料 − 中缝 − 2×gap`）、压线逐叶；五金按扇叶数成套（合页/执手/传动器/锁点 ×2）；`autoFittingsOfTree` 自动挂 `doubleSashAddon`（对开扇中挺锁），手工已加则不重复。公式出料行与内置回退两条路径共用同一"竖料折半 + 补对开料行"的校正。
- **校验**：`SASH_SIZE` / `GLASS_SIZE` 改按**单叶宽**判——这正是做对开扇要解决的超限（1500 洞口单扇必超 900，对开两片 ~780 就合规）。
- **3D**：`treeToShapes` 对 `leaves=2` 且无轮廓的格子出**两片扇构件**，于是 3D 是两圈扇料 + 两块玻璃 + 中缝两根重叠料（截图确认无中梃）。
- **UI**：左侧构件菜单「对开扇」（= 平开扇 + `leaves:2`）；叶子浮层「对开（两扇）」开关 + 「中缝料(mm)」输入（整窗参数，与扇料宽/中梃厚同一约定）。

**限制**：只对 `casement` / `screen` 开放（对开肯德基门、对开百叶、四扇对开 `foldDouble` 未做）；拖任一个把手会移动同一份 handle 配置（对称移动）；`DesignModel → 树` 反推仍按单扇处理。单测 `double-sash.test.ts` 4 条（几何与重叠、出料行与五金翻倍、单扇零回归、按单叶判上限 + 自动配件）。core 237/237。

### 8.15 P24 内倒平移扇（`tiltSlide` ← `downWithSlideSash`）

新增窗型 `tiltSlide`（内开内倒 + 平移），**映射到 `casementSash` 角色**，于是扇料/玻璃/压线/开启扇校验全部复用，不必新增构件类型。

- **2D 符号**（取自 §5.2 / §5.3）：扇环 + 玻璃之上叠 `lw15` 三线**等腰滑移梯形**（底边在下、两腰向上外撇）、底边两端各一个 `#0000ff lw3` 40×40 **端挡**、一支 `lw9` **方向箭头**（杆 + `>` 头，头长随格子尺寸收敛）、一个 `#bd6736 lw3` **内倒标记字形**；把手仍走"开启扇自动带把手"的统一约定。所有符号 `listening:false`，命中仍落在扇料与玻璃上。实机节点普查：`lw15×3 / lw9×2 / #bd6736×1 / #0000ff 端挡×2 / 把手×1`。
- **出料**：平开一套（合页/执手/传动器/锁点）之上再加 `推拉滑轮×2` + `内开内倒五金×1`；模型通路（`bom-design-model`）与 legacy 通路（`bom.ts`）两条都补。材料角色 `WINDOW_TYPE_ROLES.tiltSlide = frame/sash/**track**/mullion/bead`（会平移故走滑轨）。
- **加一个窗型要动的地方**（备忘，防漏）：schema `WindowTypeSchema` + `WindowTypeLabel` + 五金 `windowTypes`；core `kindFromSashType`、`TreeRenderElementType` + `typeOfSash`、渲染层 case、`validate-design.allowedWindowTypes`、`formula-context.WINDOW_TYPE_ROLES`、`design.ts.createPanels`（漏它会让返回类型带上 `undefined`，编译期就报）、legacy `bom.ts` 五金分支；web `windowTreeBridge.kindOf/roleOf`、`tree-editor.specFor`、`DesignStudio.applyPlace` + `PLACE_TYPE_LABEL`、`StudioLeftTools.BASIC_ITEMS`，以及 HomeMenu / PanelEditor / WindowGallery / StudioRightPanel 四处窗型数组。
- **顺带查实**：模型通路的 `casementUp` 一直按**平开全套**出五金（"只挂内开内倒五金"的分支只存在于 legacy `bom.ts`）——本次没改它，并用单测钉住现状，免得以后被误判成回归。
- **限制**：`DesignModel → 树` 反推仍把它压成 `casement`（旧方案导入不报错，但内倒平移语义会丢）；3D 与平开扇同形（扇环 + 玻璃），滑轨未在 3D 建模。

单测 `tilt-slide.test.ts` 3 条（角色/描述/校验、两条通路五金与扇料 + `casementUp` 零回归、算料角色与 legacy 窗型模板）。core 240/240。

### 8.16 P25 百叶窗 / 对开百叶窗（`shadePushSash` / `doubleShadePushSash`）：扇面填充轴

对方「其他」面板把 玻璃/纱网/板材/**百叶**/空填充物 列成独立的**填充物**，所以百叶不做成新窗型，而是给扇加一条填充轴：`WindowSashSpec.infill = 'glass' | 'louver'`（缺省 glass，旧数据无损）。于是：

- **百叶窗** = `casement + infill:'louver'`；**对开百叶窗** = 再加 `leaves:2`，直接复用 §8.14 的两叶几何（两片扇、中缝两根对开料、两个把手），零新增代码。
- **帘片**：`louverSlats(h, inset, pitch)` 在扇口高度内按间距均摊（至少两片；扇口小于框宽则不出片）。**对方未采到片厚与间距**，故间距做成整窗可配参数 `tree.louverPitchMm`（缺省 `DEFAULT_LOUVER_PITCH_MM = 100`），片厚按间距 30% 收敛（4~16mm）。非矩形子区里的帘片用 `clipFunc` 裁到玻璃轮廓。
- **实测符号**（§5.3）：每扇一根 `lw15` 主斜线 + 一个 `r50` 半圆；把手画成 `#0000ff lw3` 的 **46×46 斜切方块**（仍是可拖拽的 `sashHandle` 节点，标注照旧）。
- **出料**：百叶扇**不出玻璃、不出压线**，改出一行 `百叶帘片`（按扇计价，与纱网同一套占位单价约定 `LOUVER_PRICE=120`，后续可迁进材料库）；扇料/对开料/开启五金完全照旧。校验对百叶扇跳过 `GLASS_SIZE`。
- **实机核对**（对开百叶，1500×1500）：节点 `帘片 26 片 / 玻璃矩形 0 / lw15 斜线 2 / r50 半圆 2 / 蓝把手方块 2`；材料表 `扇料(横)×4、扇料(竖)×2、对开料(中缝)×2、百叶帘片×2、平开合页×4、执手×2、传动器×6、锁点×12、把手 A1×2`，无玻璃行与压线行。
- **不精确处（记录，别当已解决）**：按㎡计的辅料（胶条/毛条/玻璃垫块）仍以整扇面积为基数，百叶扇没有单独口径 —— 垫块严格说不该计，但拆开会改动所有窗型的辅料基准。

单测 `shutter-sash.test.ts` 4 条（帘片布局、百叶出料替换、对开百叶组合、缺省玻璃扇零回归 + 间距传递与校验跳过）。core 244/244。

### 8.17 P26 肯德基门 / 对开肯德基门（`kfcSash` / `doubleKfcSash`）：上玻下板

继续走 §8.16 的**扇面填充轴**：`infill = 'panel'`（对方填充物里的「板材」），不新增窗型。实测（§5.3）门体下部一块 **200mm 高横板 `#636568`**，扇料在板顶 `y1227/1249` 处断开（差 22 = 扇料宽 ⇒ 一根中横档）。

- **几何** `panelLeafLayout(w, h, inset, panelH)` → 上部玻璃 / 板顶一根扇料宽的中横档 / 下部横板；下板高做成整窗参数 `tree.panelHeightMm`（缺省 `DEFAULT_PANEL_HEIGHT_MM = 200`）。叶高不够同时放下板与玻璃时返回 null，调用方按普通扇画，不产出负尺寸。
- **对开肯德基门** = `infill:'panel'` + `leaves:2`，直接复用 §8.14 的两叶几何；再按实测在**中缝与板顶同高处**画一块 `#d4d1d9` **150×200 推板**。
- **出料**：玻璃高度扣掉 `下板高 + 一根扇料`（压线与玻璃面积随之走真实上半扇口）；每叶补一行 `中横档(下板顶)`（扇料角色）；每扇补一行按扇计价的 `板材(下板)`（与纱网/帘片同一套占位单价约定 `PANEL_PRICE=260`）。校验的 `GLASS_SIZE` 同样按上半高度判。
- **UI**：叶子浮层的「百叶（帘片）」开关换成**扇面三选下拉**（玻璃 / 百叶帘片 / 上玻下板）+ 条件显示「百叶间距(mm)」/「下板高(mm)」；左侧菜单新增「肯德基门 / 对开肯德基门」。所有平开系菜单项改由**一张 `PLACE_SPECS` 表**声明（只差扇面填充与叶数），不再堆三元判断。
- **实机核对**（对开肯德基门 1400×2400）：节点 `下板 560×200 ×2 / 玻璃 560×1905 ×2（y=45 起）/ 推板 150×200 ×1 / 把手 ×2`；材料表 `扇料(横)×4、扇料(竖)×2、对开料(中缝)×2、中横档(下板顶)×2、板材(下板)×2、玻璃 475×1671 ×2、压线 475×1671、平开合页×4、执手×2、把手 A1×2`。
- **未单独建模**：实测单扇 `kfcSash` 里那根 `1319..1379` 的 60mm **竖芯**——它就是双扇的中缝对开料，单扇场景由 `leaves:2` 覆盖，不再造第三种构件。

单测 `kfc-door.test.ts` 4 条（上玻下板几何与缺省 200、玻璃压缩与中横档/下板出料、对开肯德基门组合、填充与下板高传到渲染层与构件 + 缺省零回归）。core 248/248。
