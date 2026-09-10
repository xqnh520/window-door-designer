import { useRef, useState } from 'react';
import { Checkbox, InputNumber, Tooltip } from 'antd';
import {
  AlignCenterOutlined,
  AppstoreOutlined,
  BlockOutlined,
  BorderOuterOutlined,
  BorderlessTableOutlined,
  ColumnWidthOutlined,
  GroupOutlined,
  HighlightOutlined,
  MinusOutlined,
  SafetyCertificateOutlined,
  SelectOutlined,
  SwapOutlined,
  TableOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  FRAME_SHAPE_GROUPS,
  FRAME_SHAPE_LABEL,
  GLASS_BAR_GROUPS,
  GLASS_BAR_LABEL,
  MUNTIN_PATTERN_IDS,
  MUNTIN_PATTERN_LABEL,
  TRAPEZOID_SHAPES,
  listComponentTypes,
  listFittingTypes,
  type FittingHost,
  type FittingType,
  type FrameShape,
  type GlassBarPattern,
  type MuntinPattern,
} from '@wdd/core';
import type { TreeCanvasTool } from '../TreeEditorCanvas';
import type { StudioBottomTab } from './types';
import { StudioToolFlyout, type FlyoutGroup } from './StudioToolFlyout';

/**
 * 树设计（统一画布）左侧工具栏：**全部构件的唯一分类入口**。
 * - 基础工具（选择 / 外框 / 分割）：画布操作，固定在顶部
 * - 构件分类：11 类，每类一个图标，点开右侧飞出面板（分组 + 双列网格）
 * - 材料 / 报价 / 图纸 / 下料：固定在底部
 *
 * 分类顺序即施工顺序「画框 → 分格 → 放扇 → 玻璃 → 附件」。
 * 四类构件的生效语义不同，别混为一谈：外框形状＝切工具 + 记参数；复合梃 / 玻璃格条＝作用于当前选中；
 * 配件＝对当前宿主开弹窗；其余 7 类＝进入放置模式后点分格放置。
 */

/** 基本构件（旧版 5 类窗型，无注册表替代） */
const BASIC_ITEMS: { id: string; label: string }[] = [
  { id: 'fixed', label: '固定玻璃' },
  { id: 'casement', label: '平开扇' },
  { id: 'double', label: '对开扇' },
  { id: 'tiltSlide', label: '内倒平移扇' },
  { id: 'shade', label: '百叶窗' },
  { id: 'shadeDouble', label: '对开百叶窗' },
  { id: 'kfc', label: '肯德基门' },
  { id: 'kfcDouble', label: '对开肯德基门' },
  { id: 'sliding', label: '推拉扇' },
  { id: 'topHinged', label: '上悬扇' },
  { id: 'screen', label: '纱窗' },
];

const regItems = (group: Parameters<typeof listComponentTypes>[0]): { id: string; label: string }[] =>
  listComponentTypes(group).map((d) => ({ id: d.id, label: d.label }));

/** 一个构件分类：面板内容 + 高亮/置灰规则 + 点选回调 */
interface RailCategory {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** 一句话说明这一类点下去会发生什么 */
  hint: string;
  groups: FlyoutGroup[];
  /** 面板尾部附属控件 */
  extra?: React.ReactNode;
  /** 面板内高亮项 */
  currentId?: string | null;
  /** 图标钮高亮（含右下角蓝点） */
  active?: boolean;
  /** 整类不可用（无合法作用对象）：置灰且不给开面板 */
  disabledReason?: string;
  onPick: (id: string) => void;
}

/** 基础工具（画布操作，非构件放置） */
const BASE_TOOLS: { key: TreeCanvasTool; label: string; hint: string; icon: React.ReactNode }[] = [
  { key: 'select', label: '选择', hint: '选中节点 / 拖中梃调位 / Delete 删除', icon: <SelectOutlined /> },
  { key: 'framing', label: '外框', hint: '拖拽绘制外框：松开后选择拼接方向（上/下/左/右）或重画整窗', icon: <BorderlessTableOutlined /> },
  { key: 'split', label: '分割', hint: '点容器 → 拖动生成中梃分格', icon: <MinusOutlined /> },
];

const BOTTOM_TABS: { key: StudioBottomTab; label: string }[] = [
  { key: 'material', label: '材料' },
  { key: 'quote', label: '报价' },
  { key: 'drawing', label: '图纸' },
  { key: 'cutting', label: '下料' },
];

const FITTING_HOST_LABEL: Record<FittingHost, string> = {
  tree: '整窗 / 外框',
  area: '选中分格',
  combiner: '选中拼樘',
};

const PLACE_HINT = '点选构件 → 在画布点击分格放置';
const NEED_AREA_HINT = '请先在画布选中一个分格';

export function StudioLeftTools({
  tool,
  placeSpec,
  onToolChange,
  onPlaceComponent,
  frameShape,
  topRatio,
  onPickFrameShape,
  onTopRatioChange,
  selectedBarPattern,
  barTopBar,
  barCols,
  barRows,
  onPickBarPattern,
  onBarTopBarChange,
  onBarColsRowsChange,
  canApplyPattern,
  onApplyPattern,
  fittingHost,
  onOpenFitting,
  bottomTab,
  onToggleBottom,
}: {
  tool: TreeCanvasTool;
  /** 当前选中的构件类型（legacy SashType 或 registry id）；tool==='place' 时生效 */
  placeSpec: string | null;
  /** 切换基础工具（选择 / 外框 / 分割） */
  onToolChange: (t: TreeCanvasTool) => void;
  /** 选择某分类下的构件 → 进入放置模式 */
  onPlaceComponent: (id: string) => void;
  /** 外框形状（绘制 / 重画整窗时生效） */
  frameShape: FrameShape;
  /** 梯形族窄边比（0.1..0.95） */
  topRatio: number;
  /** 选形状：同时切到「外框」工具，选完即可拖画 */
  onPickFrameShape: (s: FrameShape) => void;
  onTopRatioChange: (r: number) => void;
  /** 选中叶子分格当前的格条图案；null = 没有可用的选中分格 */
  selectedBarPattern: GlassBarPattern | 'none' | null;
  barTopBar?: boolean;
  barCols?: number;
  barRows?: number;
  onPickBarPattern: (p: GlassBarPattern | 'none') => void;
  onBarTopBarChange: (v: boolean) => void;
  onBarColsRowsChange: (cols: number, rows: number) => void;
  /** 复合梃能否套用（有选中分格且不是外框） */
  canApplyPattern: boolean;
  onApplyPattern: (p: MuntinPattern) => void;
  /** 配件宿主：combiner 优先于 focusShape；null = 选中的是中梃之类非法宿主 */
  fittingHost: FittingHost | null;
  onOpenFitting: (type: FittingType) => void;
  bottomTab: StudioBottomTab;
  onToggleBottom: (t: StudioBottomTab) => void;
}) {
  /** 当前展开的分类飞出面板（一次只开一个） */
  const [openCat, setOpenCat] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const placeCat = (
    key: string,
    label: string,
    icon: React.ReactNode,
    items: { id: string; label: string }[],
  ): RailCategory => {
    const active = tool === 'place' && !!placeSpec && items.some((it) => it.id === placeSpec);
    return {
      key,
      label,
      icon,
      hint: PLACE_HINT,
      groups: [{ items }],
      currentId: active ? placeSpec : null,
      active,
      onPick: (id) => {
        onPlaceComponent(id);
        setOpenCat(null);
      },
    };
  };

  const showRatio = TRAPEZOID_SHAPES.includes(frameShape);
  const barPattern = selectedBarPattern ?? 'none';
  const showBarColsRows = barPattern === 'colonial' || barPattern === 'chinese';

  const allCategories: RailCategory[] = [
    {
      key: 'frameShape',
      label: '外框形状',
      icon: <BorderOuterOutlined />,
      hint: '选形状 → 自动切到「外框」工具，在画布拖拽绘制；已有窗时拖出的是拼接新框',
      groups: FRAME_SHAPE_GROUPS.map((g) => ({
        label: g.label,
        items: g.value.map((s) => ({ id: s, label: FRAME_SHAPE_LABEL[s] })),
      })),
      currentId: frameShape,
      active: tool === 'framing',
      onPick: (id) => {
        onPickFrameShape(id as FrameShape);
        setOpenCat(null);
      },
      extra: showRatio ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
          窄边比
          <InputNumber
            size="small"
            min={0.1}
            max={0.95}
            step={0.05}
            value={topRatio}
            onChange={(v) => onTopRatioChange(typeof v === 'number' ? v : 0.6)}
            style={{ width: 76 }}
          />
        </label>
      ) : (
        <div style={{ fontSize: 11, color: '#bbb' }}>梯形族可在此调窄边比（窄边宽 ÷ 长边宽）</div>
      ),
    },
    {
      key: 'muntin',
      label: '复合梃',
      icon: <TableOutlined />,
      hint: canApplyPattern
        ? '一键把选中分格切成整套对称分格；尺寸不足则整单不改'
        : `${NEED_AREA_HINT}（复合梃作用于选中的分格）`,
      groups: [{ items: MUNTIN_PATTERN_IDS.map((p) => ({ id: p, label: MUNTIN_PATTERN_LABEL[p] })) }],
      disabledReason: canApplyPattern ? undefined : NEED_AREA_HINT,
      onPick: (id) => {
        onApplyPattern(id as MuntinPattern);
        setOpenCat(null);
      },
    },
    placeCat('basic', '基本构件', <AppstoreOutlined />, BASIC_ITEMS),
    placeCat('combo', '组合扇', <GroupOutlined />, regItems('combo')),
    placeCat('fold', '折叠扇', <SwapOutlined />, regItems('fold')),
    placeCat('sliding', '推拉构件', <ColumnWidthOutlined />, regItems('sliding')),
    {
      key: 'bars',
      label: '玻璃格条',
      icon: <AlignCenterOutlined />,
      hint: selectedBarPattern === null
        ? `${NEED_AREA_HINT}（格条施加在分格的玻璃上）`
        : '施加到选中分格的玻璃；一块玻璃只保留一种图案',
      groups: [
        { items: [{ id: 'none', label: '无格条' }] },
        ...GLASS_BAR_GROUPS.map((g) => ({
          label: g.label,
          items: g.value.map((p) => ({ id: p, label: GLASS_BAR_LABEL[p] })),
        })),
      ],
      currentId: selectedBarPattern === null ? null : barPattern,
      disabledReason: selectedBarPattern === null ? NEED_AREA_HINT : undefined,
      onPick: (id) => {
        onPickBarPattern(id as GlassBarPattern | 'none');
        // 不收起：接着调横档 / 列行是常见连招
      },
      extra:
        selectedBarPattern !== null && barPattern !== 'none' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Tooltip title="对应对方 *_topBar 变体：在玻璃上部叠加一根 20mm 横档">
              <Checkbox checked={barTopBar === true} onChange={(e) => onBarTopBarChange(e.target.checked)}>
                <span style={{ fontSize: 12 }}>顶部横档</span>
              </Checkbox>
            </Tooltip>
            {showBarColsRows && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
                列 / 行
                <InputNumber size="small" min={1} max={8} value={barCols ?? 2} onChange={(v) => onBarColsRowsChange(v ?? 1, barRows ?? 2)} style={{ width: 54 }} />
                <InputNumber size="small" min={1} max={8} value={barRows ?? 2} onChange={(v) => onBarColsRowsChange(barCols ?? 2, v ?? 1)} style={{ width: 54 }} />
              </label>
            )}
          </div>
        ) : undefined,
    },
    placeCat('glazing', '玻璃', <BlockOutlined />, regItems('glazing')),
    placeCat('safety', '安全构件', <SafetyCertificateOutlined />, regItems('safety')),
    placeCat('decor', '装饰构件', <HighlightOutlined />, regItems('decor')),
    {
      key: 'fitting',
      label: '配件',
      icon: <ToolOutlined />,
      hint: fittingHost
        ? `加到「${FITTING_HOST_LABEL[fittingHost]}」上；数量与已有配件在弹窗内管理`
        : '请先在画布选中外框、分格或拼樘（中梃不能单独挂配件）',
      groups: fittingHost
        ? [{ label: FITTING_HOST_LABEL[fittingHost], items: listFittingTypes(fittingHost).map((d) => ({ id: d.id, label: d.label })) }]
        : [],
      disabledReason: fittingHost ? undefined : '请先选中外框 / 分格 / 拼樘',
      onPick: (id) => {
        onOpenFitting(id as FittingType);
        setOpenCat(null);
      },
    },
  ];

  /** 空分类不上栏（点开是空面板）；但配件类无合法宿主时要保留置灰钮，好让 Tooltip 说明原因 */
  const CATEGORIES = allCategories.filter(
    (c) => c.disabledReason !== undefined || c.groups.some((g) => g.items.length > 0),
  );

  const opened = CATEGORIES.find((c) => c.key === openCat) ?? null;

  const btnBase: React.CSSProperties = {
    width: 40,
    height: 40,
    border: 'none',
    borderRadius: 8,
    fontSize: 18,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div
      ref={railRef}
      style={{
        position: 'relative',
        width: 64,
        flex: 'none',
        background: '#fff',
        borderRight: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 0',
      }}
    >
      {/* 基础工具：固定不滚 */}
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {BASE_TOOLS.map((def) => {
          const active = tool === def.key;
          return (
            <Tooltip key={def.key} title={`${def.label} · ${def.hint}`} placement="right">
              <button
                onClick={() => onToolChange(def.key)}
                style={{
                  ...btnBase,
                  background: active ? '#e6f4ff' : 'transparent',
                  color: active ? '#1677ff' : '#555',
                }}
              >
                {def.icon}
              </button>
            </Tooltip>
          );
        })}
        <div style={{ width: 32, height: 1, background: '#eee', margin: '2px 0' }} />
      </div>

      {/* 构件分类：数量多，中部独立滚动（基础工具与底部标签始终可见） */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          paddingTop: 2,
        }}
      >
        {CATEGORIES.map((cat) => {
          const disabled = !!cat.disabledReason;
          const btn = (
            <button
              disabled={disabled}
              onClick={() => !disabled && setOpenCat(openCat === cat.key ? null : cat.key)}
              style={{
                ...btnBase,
                position: 'relative',
                flex: 'none',
                background: cat.active ? '#e6f4ff' : openCat === cat.key ? '#f5f6f7' : 'transparent',
                color: disabled ? '#ccc' : cat.active ? '#1677ff' : '#555',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {cat.icon}
              {cat.active && (
                <span
                  style={{
                    position: 'absolute',
                    right: 4,
                    bottom: 4,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#1677ff',
                  }}
                />
              )}
            </button>
          );
          return (
            <Tooltip
              key={cat.key}
              placement="right"
              title={disabled ? `${cat.label} · ${cat.disabledReason}` : `${cat.label} · 点击展开`}
            >
              <span style={{ display: 'inline-flex' }}>{btn}</span>
            </Tooltip>
          );
        })}
      </div>

      {/* 底部：材料 / 报价 / 图纸 / 下料 垂直切换标签（固定不滚） */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 4,
          padding: '8px 8px 0',
        }}
      >
        <div style={{ width: '100%', height: 1, background: '#eee', marginBottom: 4 }} />
        {BOTTOM_TABS.map((t) => {
          const active = bottomTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onToggleBottom(t.key)}
              style={{
                border: 'none',
                borderRadius: 8,
                padding: '10px 0',
                cursor: 'pointer',
                writingMode: 'vertical-rl',
                letterSpacing: 4,
                fontSize: 13,
                background: active ? '#1677ff' : '#f5f6f7',
                color: active ? '#fff' : '#555',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <StudioToolFlyout
        open={!!opened}
        title={opened?.label ?? ''}
        hint={opened?.hint}
        groups={opened?.groups ?? []}
        extra={opened?.extra}
        currentId={opened?.currentId ?? null}
        onPick={(id) => opened?.onPick(id)}
        onClose={() => setOpenCat(null)}
        ignoreRef={railRef}
      />
    </div>
  );
}
