import { useEffect, useMemo, useState } from 'react';
import { Divider, Form, Input, InputNumber, Select, Tabs, Tooltip, Typography, message } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import { WindowTypeLabel, sampleWindowTemplates, type WindowType, type DesignModel } from '@wdd/schema';
import { selectCurrentGlassId, selectCurrentOpeningH, selectCurrentOpeningW, selectCurrentSeriesId, useStore } from '../../store';
import { projectDesignModel } from '../../canvas/modelProjection';
import { useCrmStore } from '../../crm/store';
import { ColorSwatches } from './ColorSwatches';
import { colorHex } from './palette';
import {
  DEFAULT_INSTALL_GAP_MM,
  computeBomFromDesignModel,
  findArea,
  findMuntin,
  isTemplateCompatible,
  layoutAssembly,
  layoutTree,
  validateDesignModel,
  type ValidationIssue,
  type WindowTree,
} from '@wdd/core';

const PACKAGING_OPTIONS = ['木架', '纸箱包装', '泡沫+木架', '裸装(定制)'];
const HINGE_OPTIONS = ['不锈钢合页', '锌合金合页', '隐形合页', '国产合页'];
const HARDWARE_OPTIONS = ['进口五金', '国产五金', '国产中高端'];
const POSITION_OPTIONS = ['客厅', '卧室', '厨房', '卫生间', '阳台', '书房', '其他'];
const TEMPLATE_TYPE_LABEL: Record<string, string> = {
  fixed: '固定窗',
  casement: '平开窗',
  sliding: '推拉窗',
  topHung: '上悬窗',
  view: '观景窗',
  custom: '组合/自定义',
};
const SERIES_FAMILY_LABEL: Record<string, string> = {
  fixed: '固定',
  casement: '平开',
  sliding: '推拉',
  mixed: '混合',
};

export function StudioRightPanel({
  onCollapse,
  onFocusShape,
  focusShapeId,
  externalModel,
  tree,
  onResizeDim,
}: {
  onCollapse: () => void;
  onFocusShape?: (id: string) => void;
  focusShapeId?: string | null;
  /** 容器树编辑模式：由树实时生成的 DesignModel（优先于画布形状推断） */
  externalModel?: DesignModel | null;
  /** 聚焦单元的权威容器树：尺寸块唯一几何来源 */
  tree?: WindowTree | null;
  /** 键入尺寸：交给画布 applyDimEdit（与点击标注同一 resize-dim 通路） */
  onResizeDim?: (markId: string, value: number) => void;
}) {
  const library = useStore((s) => s.library);
  const designType = useStore((s) => s.designType);
  const seriesId = useStore(selectCurrentSeriesId);
  const glassId = useStore(selectCurrentGlassId);
  const openingW = useStore(selectCurrentOpeningW);
  const openingH = useStore(selectCurrentOpeningH);
  const activeTemplateId = useStore((s) => s.activeTemplateId);
  const assembly = useStore((s) => s.assembly);
  const windowCount = useStore((s) => s.windowCount);
  const orderConfig = useStore((s) => s.orderConfig);

  const setWindowType = useStore((s) => s.setWindowType);
  const setSeries = useStore((s) => s.setSeries);
  const applyTemplate = useStore((s) => s.applyTemplate);
  const setGlass = useStore((s) => s.setGlass);
  const setWindowCount = useStore((s) => s.setWindowCount);
  const setOrderConfig = useStore((s) => s.setOrderConfig);

  // 客户（保存方案归属）：来自 CRM
  const crmCustomers = useCrmStore((s) => s.customers);
  const schemeCustomerId = useCrmStore((s) => s.selectedCustomerId);
  const setSchemeCustomer = useCrmStore((s) => s.setSchemeCustomer);
  useEffect(() => {
    if (!useCrmStore.getState().customers.length) {
      void useCrmStore.getState().fetchCustomers({ page: 1, pageSize: 100 });
    }
  }, []);

  // 容器树编辑模式优先使用树模型；否则由画布形状推断
  const designModel = externalModel ?? projectDesignModel(useStore.getState());
  const activeSeries = library.series.find((s) => s.id === seriesId) ?? library.series[0];
  const activeTemplate = sampleWindowTemplates.find((t) => t.id === activeTemplateId) ?? null;
  const validationIssues = validateDesignModel(designModel, activeSeries, activeTemplate, library);
  const errorIssues = validationIssues.filter((i) => i.level === 'error');
  const warningIssues = validationIssues.filter((i) => i.level === 'warning');
  const infoIssues = validationIssues.filter((i) => i.level === 'info');
  /** 校验定位：把业务构件 id 映射为画布图形 id（sourceShapeId），无法映射时不可点击 */
  const shapeIdOfIssue = (issue: ValidationIssue): string | undefined => {
    if (!issue.componentId) return undefined;
    return designModel?.components.find((c) => c.id === issue.componentId)?.sourceShapeId;
  };
  const componentStats = designModel?.components.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
  // 材料统计：实时 BOM 汇总（型材/玻璃/五金/辅料 + 金额 + 计价面积），画布为空时为 null
  const materialStats = designModel ? computeBomFromDesignModel(designModel, activeSeries, library) : null;
  const materialCounts = materialStats
    ? {
        profile: materialStats.items.filter((i) => i.category === 'profile').length,
        glass: materialStats.items.filter((i) => i.category === 'glass').length,
        hardware: materialStats.items.filter((i) => i.category === 'hardware').length,
        accessory: materialStats.items.filter((i) => i.category === 'accessory').length,
      }
    : null;
  /** 模板库分组：按窗型类型分组，标注与当前系列的兼容性（不兼容禁用） */
  const tplGroups = (['fixed', 'casement', 'sliding', 'topHung', 'view', 'custom'] as const)
    .map((type) => ({
      label: TEMPLATE_TYPE_LABEL[type] ?? type,
      options: sampleWindowTemplates
        .filter((t) => t.type === type)
        .map((t) => {
          const ok = isTemplateCompatible(t, activeSeries);
          return { value: t.id, label: ok ? t.name : `${t.name}（不兼容）`, disabled: !ok };
        }),
    }))
    .filter((g) => g.options.length > 0);

  // 尺寸块单源自权威容器树：与画布标注 applyDimEdit/dimValue 共用 markId 与换算口径
  const sizeTarget = useMemo<{ markBase: string; prefix: string; label: string; hint: string } | null>(() => {
    if (!tree) return null;
    if (!focusShapeId || focusShapeId === 'frame') {
      return { markBase: 'frame', prefix: '洞口', label: '本单元洞口尺寸 (mm)', hint: '洞口 = 净安装尺寸，不含安装缝。改这里会整樘等比缩放。' };
    }
    const area = findArea(tree, focusShapeId);
    if (area) return { markBase: area.id, prefix: '分格', label: '选中分格尺寸 (mm)', hint: '优先把余量推给相邻分格，整窗轮廓不变；该方向没有相邻分格时按整窗洞口调整。' };
    const found = findMuntin(tree, focusShapeId);
    if (found) return { markBase: found.area.id, prefix: '宿主分格', label: '中梃宿主分格尺寸 (mm)', hint: '选中的是中梃：这里改宿主分格，中梃位置请拖拽或点标注。' };
    return { markBase: 'frame', prefix: '洞口', label: '本单元洞口尺寸 (mm)', hint: '洞口 = 净安装尺寸，不含安装缝。' };
  }, [tree, focusShapeId]);

  /** 目标当前实测宽高（mm）：外框走 layout.frame，分格走 layout.boxes */
  const sizeValue = useMemo<{ w: number; h: number } | null>(() => {
    if (!tree || !sizeTarget) return null;
    const layout = layoutTree(tree, { installGap: DEFAULT_INSTALL_GAP_MM });
    if (sizeTarget.markBase === 'frame') return { w: Math.round(layout.frame.w), h: Math.round(layout.frame.h) };
    const box = layout.boxes.get(sizeTarget.markBase);
    return box ? { w: Math.round(box.w), h: Math.round(box.h) } : null;
  }, [tree, sizeTarget]);

  // 键入草稿：只在回车/失焦时提交，避免每敲一个字符就重算出料与报价
  const [sizeDraft, setSizeDraft] = useState<{ w: number | null; h: number | null } | null>(null);
  const shownW = sizeDraft?.w ?? sizeValue?.w ?? null;
  const shownH = sizeDraft?.h ?? sizeValue?.h ?? null;

  const commitSize = (axis: 'w' | 'h') => {
    if (!sizeTarget || !onResizeDim) return;
    const v = axis === 'w' ? sizeDraft?.w : sizeDraft?.h;
    setSizeDraft(null);
    if (v == null || !Number.isFinite(v)) return;
    const cur = axis === 'w' ? sizeValue?.w : sizeValue?.h;
    if (cur != null && Math.round(v) === cur) return;
    onResizeDim(`${sizeTarget.markBase}-${axis}`, v);
  };

  // 多单元（外框拼接）时给出整樘组合外接尺寸，只读
  const assemblyBounds = assembly ? layoutAssembly(assembly, { installGap: DEFAULT_INSTALL_GAP_MM }).bbox : null;
  const unitCount = assembly?.units.length ?? 0;

  const formItem = { style: { marginBottom: 10 } };

  /** 校验条目按钮：错误/警告/提示分组渲染，可定位到画布构件时支持点击聚焦 */
  const renderIssueButtons = (issues: ValidationIssue[]) =>
    issues.map((issue: ValidationIssue, idx: number) => {
      const shapeId = shapeIdOfIssue(issue);
      const clickable = !!shapeId;
      return (
        <button
          key={`${issue.code}-${idx}`}
          type="button"
          onClick={() => clickable && onFocusShape?.(shapeId)}
          style={{
            width: '100%',
            textAlign: 'left',
            border: clickable && shapeId === focusShapeId ? '1px solid #1677ff' : '1px solid transparent',
            background: clickable ? '#fff' : 'transparent',
            borderRadius: 6,
            padding: '6px 8px',
            cursor: clickable ? 'pointer' : 'default',
            fontSize: 12,
            color: issue.level === 'error' ? '#cf1322' : issue.level === 'warning' ? '#d46b08' : '#1677ff',
          }}
        >
          {issue.level.toUpperCase()} · {issue.message}
          {clickable ? <span style={{ marginLeft: 6, color: '#8c8c8c' }}>[{shapeId}]</span> : null}
        </button>
      );
    });

  const orderTab = (
    <Form layout="vertical" size="small">
      {/* 客户（保存方案归属） */}
      <Form.Item
        label="客户（保存方案归属）"
        {...formItem}
        extra={!schemeCustomerId ? '未选择客户：保存方案将被拦截' : undefined}
      >
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="选择客户（可留空，保存时提醒）"
          value={schemeCustomerId ?? undefined}
          onChange={(v?: string) => setSchemeCustomer(v ?? null)}
          options={crmCustomers.map((c) => ({ value: c.id, label: `${c.name}（${c.phone}）` }))}
        />
      </Form.Item>

      {/* 窗型与产品系列 */}
      <Form.Item label="窗型模板" {...formItem}>
        <Select
          allowClear
          value={activeTemplateId ?? undefined}
          onChange={(v?: string) => {
            if (!v) {
              applyTemplate(null);
              return;
            }
            const tpl = sampleWindowTemplates.find((t) => t.id === v);
            const s = library.series.find((x) => x.id === seriesId) ?? library.series[0];
            if (tpl && !isTemplateCompatible(tpl, s)) {
              message.warning(`模板「${tpl.name}」与系列「${s.name}」不兼容，已阻止应用`);
              return;
            }
            applyTemplate(v);
          }}
          placeholder="选择常用模板"
          options={tplGroups}
        />
      </Form.Item>
      <Form.Item label="窗型" {...formItem}>
        <Select
          value={designType}
          onChange={(v: WindowType) => setWindowType(v)}
          options={(['fixed', 'casement', 'sliding', 'topHinged', 'casementUp', 'tiltSlide'] as WindowType[]).map((t) => ({
            value: t,
            label: WindowTypeLabel[t],
          }))}
        />
      </Form.Item>
      <Form.Item label="产品系列" {...formItem}>
        <Select
          value={seriesId}
          onChange={setSeries}
          options={library.series.map((s) => ({
            value: s.id,
            label: `${s.name} · ${SERIES_FAMILY_LABEL[(s as { windowFamily?: string }).windowFamily ?? 'mixed'] ?? '混合'}`,
          }))}
        />
      </Form.Item>

      <Divider style={{ margin: '10px 0' }} plain>
        {sizeTarget ? sizeTarget.label : '全局总尺寸 (实测)'}
      </Divider>

      <Form.Item label={sizeTarget ? `${sizeTarget.prefix}宽 (mm)` : '总宽 (mm)'} {...formItem}>
        {sizeTarget && onResizeDim ? (
          <InputNumber
            min={60}
            step={10}
            precision={0}
            value={shownW}
            disabled={!sizeValue}
            onChange={(v) => setSizeDraft((d) => ({ w: v ?? null, h: d?.h ?? null }))}
            onPressEnter={() => commitSize('w')}
            onBlur={() => commitSize('w')}
            style={{ width: '100%' }}
          />
        ) : (
          <InputNumber disabled value={Math.round(assemblyBounds?.w ?? openingW)} style={{ width: '100%' }} />
        )}
      </Form.Item>
      <Form.Item label={sizeTarget ? `${sizeTarget.prefix}高 (mm)` : '总高 (mm)'} {...formItem}>
        {sizeTarget && onResizeDim ? (
          <InputNumber
            min={60}
            step={10}
            precision={0}
            value={shownH}
            disabled={!sizeValue}
            onChange={(v) => setSizeDraft((d) => ({ w: d?.w ?? null, h: v ?? null }))}
            onPressEnter={() => commitSize('h')}
            onBlur={() => commitSize('h')}
            style={{ width: '100%' }}
          />
        ) : (
          <InputNumber disabled value={Math.round(assemblyBounds?.h ?? openingH)} style={{ width: '100%' }} />
        )}
      </Form.Item>
      
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {sizeTarget
          ? sizeTarget.hint
          : '画布还没有外框：先点左侧「外框」拖出一个矩形，之后这里可直接键入尺寸。'}
      </Typography.Text>
      {unitCount > 1 && assemblyBounds ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          整樘组合外接 {Math.round(assemblyBounds.w)}×{Math.round(assemblyBounds.h)} mm（{unitCount} 单元，只读）
        </Typography.Text>
      ) : null}

      {componentStats && (
        <div style={{ border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 10px', margin: '8px 0 10px', background: '#fafafa' }}>
          <Typography.Text strong style={{ fontSize: 12 }}>材料统计（实时）</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            外框 {componentStats.outerFrame ?? 0} · 固定玻璃 {componentStats.fixedGlass ?? 0} · 开启扇{' '}
            {(componentStats.casementSash ?? 0) + (componentStats.slidingSash ?? 0) + (componentStats.topHungSash ?? 0)} · 中梃 {componentStats.mullion ?? 0}
          </Typography.Text>
          {materialCounts ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
              型材 {materialCounts.profile} 项 · 玻璃 {materialCounts.glass} 块 · 五金 {materialCounts.hardware} 项 · 辅料 {materialCounts.accessory} 项
            </Typography.Text>
          ) : null}
          {materialStats ? (
            <Typography.Text style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
              材料合计 <Typography.Text strong style={{ fontSize: 12, color: '#cf1322' }}>¥{materialStats.totalAmount.toFixed(2)}</Typography.Text> · 计价面积 {materialStats.billedAreaM2}㎡
            </Typography.Text>
          ) : null}
        </div>
      )}

      <div style={{ border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 10px', margin: '0 0 10px', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text strong style={{ fontSize: 12 }}>设计校验</Typography.Text>
          {validationIssues.length > 0 && (
            <Typography.Text
              style={{ fontSize: 12 }}
              type={errorIssues.length ? 'danger' : warningIssues.length ? 'warning' : 'secondary'}
            >
              错误 {errorIssues.length} · 警告 {warningIssues.length} · 提示 {infoIssues.length}
            </Typography.Text>
          )}
        </div>
        {validationIssues.length ? (
          <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
            {renderIssueButtons(errorIssues)}
            {renderIssueButtons(warningIssues)}
            {renderIssueButtons(infoIssues)}
          </div>
        ) : (
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            当前结构可继续生成材料清单
          </Typography.Text>
        )}
      </div>

      <Divider style={{ margin: '10px 0' }} plain>订单</Divider>
      <Form.Item label="编号" {...formItem}>
        <Input value={orderConfig.orderNo} onChange={(e) => setOrderConfig({ orderNo: e.target.value })} placeholder="如 WD-0001" />
      </Form.Item>
      <Form.Item label="数量 (樘)" {...formItem}>
        <InputNumber min={1} max={999} value={windowCount} style={{ width: '100%' }} onChange={(v) => v && setWindowCount(v)} />
      </Form.Item>
      <Form.Item label="单价 (元/㎡)" {...formItem}>
        <InputNumber min={0} step={10} value={orderConfig.unitPrice} style={{ width: '100%' }} onChange={(v) => setOrderConfig({ unitPrice: v ?? 0 })} />
      </Form.Item>
      <Form.Item label="包装" {...formItem}>
        <Select value={orderConfig.packaging} onChange={(v) => setOrderConfig({ packaging: v })} options={PACKAGING_OPTIONS.map((p) => ({ value: p, label: p }))} />
      </Form.Item>
      <Form.Item label="玻璃" {...formItem}>
        <Select value={glassId} onChange={setGlass} options={library.glass.map((g) => ({ value: g.id, label: g.name }))} />
      </Form.Item>
      <Form.Item label="合页" {...formItem}>
        <Select value={orderConfig.hinge} onChange={(v) => setOrderConfig({ hinge: v })} options={HINGE_OPTIONS.map((h) => ({ value: h, label: h }))} />
      </Form.Item>
      <Form.Item label="五金" {...formItem}>
        <Select value={orderConfig.hardware} onChange={(v) => setOrderConfig({ hardware: v })} options={HARDWARE_OPTIONS.map((h) => ({ value: h, label: h }))} />
      </Form.Item>
      <Form.Item label="位置" {...formItem}>
        <Select value={orderConfig.position} onChange={(v) => setOrderConfig({ position: v })} options={POSITION_OPTIONS.map((p) => ({ value: p, label: p }))} />
      </Form.Item>
      <Form.Item label="墙厚 (mm)" {...formItem}>
        <InputNumber min={80} max={600} step={10} value={orderConfig.wallThickness} style={{ width: '100%' }} onChange={(v) => setOrderConfig({ wallThickness: v ?? 200 })} />
      </Form.Item>
      <Form.Item label="压线拼接" {...formItem}>
        <Select
          value={orderConfig.beadJoint}
          onChange={(v) => setOrderConfig({ beadJoint: v })}
          options={[
            { value: 'miter', label: '斜连接（四角 45°）' },
            { value: 'butt', label: '直连接（直边搭接）' },
          ]}
        />
      </Form.Item>
    </Form>
  );

  const colorTab = (
    <div>
      <Typography.Text strong style={{ fontSize: 13 }}>室外面颜色（外侧）</Typography.Text>
      <div style={{ margin: '8px 0 16px' }}>
        <ColorSwatches value={orderConfig.outerColor} onChange={(v) => setOrderConfig({ outerColor: v })} />
      </div>
      <Typography.Text strong style={{ fontSize: 13 }}>室内面颜色（内侧）</Typography.Text>
      <div style={{ margin: '8px 0 0' }}>
        <ColorSwatches value={orderConfig.innerColor} onChange={(v) => setOrderConfig({ innerColor: v })} />
      </div>
      <Divider style={{ margin: '16px 0' }} />
      <div
        style={{
          borderRadius: 8,
          padding: '10px 12px',
          background: '#f0f7ff',
          border: '1px solid #bae0ff',
          fontSize: 12,
          color: '#0958d9',
        }}
      >
        当前方案：室外面 <span style={{ fontWeight: 600 }}>{orderConfig.outerColor}</span>（{colorHex(orderConfig.outerColor)}）· 室内面{' '}
        <span style={{ fontWeight: 600 }}>{orderConfig.innerColor}</span>（{colorHex(orderConfig.innerColor)}）。2D 立面显示室外面颜色；3D 两面分别渲染。
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: 320,
        background: '#fff',
        borderLeft: '1px solid #e8e8e8',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 12px 6px 16px',
        }}
      >
        <Typography.Text strong style={{ fontSize: 14 }}>
          属性面板
        </Typography.Text>
        <Tooltip title="隐藏到右侧">
          <button
            className="wdd-3d-tab"
            onClick={onCollapse}
            style={{ width: 28, height: 28, borderRadius: '10px 0 0 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <RightOutlined />
          </button>
        </Tooltip>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px' }}>
        <Tabs
          size="small"
          items={[
            { key: 'order', label: '属性', children: orderTab },
            { key: 'color', label: '颜色', children: colorTab },
          ]}
        />
      </div>
    </div>
  );
}
