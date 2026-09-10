import { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Input, InputNumber, Modal, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import type { FormulaContext } from '@wdd/core';
import {
  FORMULA_VARIABLES,
  PROFILE_ROLE_LABEL,
  computeGeometry,
  evaluateFormula,
  formulaContextFromGeometry,
  formulaContextFromPanel,
  validateCutRows,
  type FormulaVariableDoc,
} from '@wdd/core';
import type { CutSide, CutScope, CutUnit, SeriesCutRow } from '@wdd/schema';
import { useStore, type SeriesFormulaConfig } from '../store';

const SIDE_OPTIONS: { value: CutSide; label: string }[] = [
  { value: 'up', label: '上' },
  { value: 'down', label: '下' },
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
];

const ROLE_OPTIONS = [...Object.entries(PROFILE_ROLE_LABEL), ['viewEnhance', '加强角码(观景)']].map(([v, label]) => ({
  value: v,
  label: `${v} · ${label}`,
}));

/** showSetting 料宽字典预设键（与 windoorcraft show_setting 对齐） */
const SHOW_SETTING_KEYS = [
  'frame', 'sash', 'bead', 'mullion', 'track', 'sill', 'upSash', 'downSash', 'screen',
  'subFrame', 'antiTheft', 'kfcWaist', 'doorBeam', 'connector', 'interlock', 'shadeSash',
  'innerFrame', 'sashHolder', 'sashMullion', 'antiTheftGap', 'cornerJoiner', 'frameMullion',
  'millingFrame', 'shadeMullion', 'reinforcedFrameMullion', 'glassGap',
];

/** 单条表达式输入 + 实时试算 */
function FormulaField({
  value,
  context,
  placeholder,
  onFocus,
  onChange,
}: {
  value: string;
  context: FormulaContext;
  placeholder: string;
  onFocus: () => void;
  onChange: (v: string) => void;
}) {
  const trimmed = value.trim();
  const preview = trimmed ? evaluateFormula(trimmed, context) : null;
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <Input
        size="small"
        value={value}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        status={preview && !preview.ok ? 'error' : undefined}
      />
      <div style={{ minHeight: 18, marginTop: 2 }}>
        {!trimmed ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>未配置 → 内置算法回退</Typography.Text>
        ) : preview?.ok ? (
          <Typography.Text type="success" style={{ fontSize: 12 }}>= {preview.value}</Typography.Text>
        ) : (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>{preview?.error}</Typography.Text>
        )}
      </div>
    </div>
  );
}

function blankRow(seq: number): SeriesCutRow {
  return { id: `c-${Date.now()}-${seq}`, label: '', role: 'frame', side: [], length: '', count: '1', scope: 'window', unit: '支' };
}

function cloneConfig(cfg: SeriesFormulaConfig): SeriesFormulaConfig {
  return {
    cuts: cfg.cuts.map((r) => ({ ...r, side: [...(r.side ?? [])] })),
    formulaBank: { ...cfg.formulaBank },
    showSetting: { ...cfg.showSetting },
  };
}

/** 系列出料行公式配置（v2 出料行表 + 公式库 + 料宽字典），对标 windoorcraft product_bar */
export function FormulaConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const library = useStore((s) => s.library);
  const design = useStore((s) => s.design);
  const currentSeriesId = useStore((s) => s.seriesId);
  const updateSeriesFormulaConfig = useStore((s) => s.updateSeriesFormulaConfig);

  const [seriesId, setSeriesId] = useState<string>(currentSeriesId);
  const [draft, setDraft] = useState<SeriesFormulaConfig>({ cuts: [], formulaBank: {}, showSetting: {} });
  const [activeField, setActiveField] = useState<{ rowId: string; kind: 'length' | 'count' } | null>(null);

  const series = library.series.find((s) => s.id === seriesId) ?? library.series[0];

  // 打开弹窗：定位系列并装载（含示例默认）可编辑副本
  useEffect(() => {
    if (!open) return;
    setSeriesId(currentSeriesId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const current = library.series.find((s) => s.id === seriesId) ?? library.series[0];
    setDraft(cloneConfig({ cuts: current.cuts ?? [], formulaBank: current.formulaBank ?? {}, showSetting: current.showSetting ?? {} }));
    setActiveField(null);
  }, [open, seriesId, library]);

  const previewContext = useMemo(() => {
    const geometry = computeGeometry(design, series);
    const base = formulaContextFromGeometry(geometry, series, design);
    const panel = geometry.sizes.panels[0];
    return panel ? formulaContextFromPanel(geometry, series, design, panel) : base;
  }, [design, series]);

  /** 变量分组：系统变量 + 系列料宽字典 */
  const groupedVariables = useMemo(() => {
    const map: Record<string, FormulaVariableDoc[]> = {};
    for (const v of FORMULA_VARIABLES) {
      (map[v.scope] ??= []).push(v);
    }
    const settingVars: FormulaVariableDoc[] = Object.keys(draft.showSetting).map((k) => ({
      name: k,
      label: k,
      scope: '系列',
      description: '系列料宽设定 (mm)',
    }));
    if (settingVars.length) map['料宽字典'] = (map['料宽字典'] ?? []).concat(settingVars);
    return map;
  }, [draft.showSetting]);

  const patchRow = (rowId: string, patch: Partial<SeriesCutRow>) => {
    setDraft((d) => ({ ...d, cuts: d.cuts.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) }));
  };
  const addRow = () => setDraft((d) => ({ ...d, cuts: [...d.cuts, blankRow(d.cuts.length)] }));
  const removeRow = (rowId: string) => setDraft((d) => ({ ...d, cuts: d.cuts.filter((r) => r.id !== rowId) }));
  const duplicateRow = (row: SeriesCutRow) =>
    setDraft((d) => ({ ...d, cuts: [...d.cuts, { ...row, id: `c-${Date.now()}-${d.cuts.length}`, side: [...(row.side ?? [])] }] }));

  const insertVariable = (name: string) => {
    const target = activeField ?? { rowId: draft.cuts[0]?.id ?? '', kind: 'length' as const };
    if (!target.rowId) return;
    setDraft((d) => ({
      ...d,
      cuts: d.cuts.map((r) =>
        r.id === target.rowId ? { ...r, [target.kind]: r[target.kind] ? `${r[target.kind]} + ${name}` : name } : r,
      ),
    }));
  };

  const patchBank = (key: string, expr: string) => {
    const k = key.trim();
    setDraft((d) => {
      const bank = { ...d.formulaBank };
      if (!k) {
        message.warning('公式库键不能为空');
        return d;
      }
      bank[k] = expr;
      return { ...d, formulaBank: bank };
    });
  };
  const addBankRow = () => {
    let i = 1;
    while (draft.formulaBank[String(i)]) i += 1;
    setDraft((d) => ({ ...d, formulaBank: { ...d.formulaBank, [String(i)]: '' } }));
  };
  const removeBankKey = (key: string) => {
    setDraft((d) => {
      const bank = { ...d.formulaBank };
      delete bank[key];
      return { ...d, formulaBank: bank };
    });
  };

  const patchSetting = (key: string, v: number | null) => {
    setDraft((d) => {
      const showSetting = { ...d.showSetting };
      if (v == null || v < 0) delete showSetting[key];
      else showSetting[key] = v;
      return { ...d, showSetting };
    });
  };

  const handleSave = () => {
    const errors = validateCutRows(draft.cuts, draft.formulaBank, previewContext);
    const entries = Object.entries(errors);
    if (entries.length) {
      message.error(
        `公式校验未通过：${entries
          .map(([key, err]) => {
            const row = draft.cuts.find((r) => r.id === key.split('.')[0]);
            const [, kind] = key.split('.');
            return `${row?.label || key}(${kind === 'length' ? '长度' : '数量'}): ${err}`;
          })
          .join('；')}`,
      );
      return;
    }
    // 过滤空 label 行、整理单位/作用域缺省
    const cuts = draft.cuts
      .filter((r) => r.label?.trim())
      .map((r) => ({
        id: r.id,
        label: r.label.trim(),
        role: r.role,
        side: r.side ?? [],
        length: r.length ?? '',
        count: r.count ?? '1',
        scope: (r.scope ?? 'window') as CutScope,
        unit: (r.unit ?? '支') as CutUnit,
        ...(r.angle ? { angle: r.angle } : {}),
        ...(r.condition ? { condition: r.condition } : {}),
      }));
    updateSeriesFormulaConfig(series.id, {
      cuts,
      formulaBank: Object.fromEntries(Object.entries(draft.formulaBank).filter(([, v]) => v?.trim())),
      showSetting: draft.showSetting,
    });
    message.success(`公式已保存：${series.name}，BOM / 报价 / 下料单已实时更新`);
    onClose();
  };

  const bankKeys = Object.keys(draft.formulaBank);

  return (
    <Modal
      open={open}
      title={`自定义计算公式 · ${series.name}`}
      width={1120}
      okText="保存公式"
      cancelText="取消"
      onOk={handleSave}
      onCancel={onClose}
      destroyOnClose
    >
      <Space style={{ width: '100%', marginBottom: 12 }} wrap>
        <span>
          <Typography.Text type="secondary">产品系列</Typography.Text>
          <Select
            size="small"
            style={{ width: 220, marginLeft: 8 }}
            value={seriesId}
            onChange={setSeriesId}
            options={library.series.map((s) => ({ value: s.id, label: s.name }))}
          />
        </span>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addRow}>
          新增出料行
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {draft.cuts.length} 行 · 出料 = 边位数 × 数量（每边）
        </Typography.Text>
      </Space>

      <Divider style={{ margin: '4px 0 10px' }} plain>出料行表（对标 windoorcraft product_bar）</Divider>

      <div style={{ maxHeight: 360, overflow: 'auto', marginBottom: 4 }}>
        {draft.cuts.map((row, idx) => (
          <div
            key={row.id}
            style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', marginBottom: 8, background: '#fafafa' }}
          >
            <Space size={8} wrap align="start">
              <span style={{ width: 16, color: '#999', fontSize: 12, lineHeight: '30px' }}>{idx + 1}</span>
              <Input
                size="small"
                style={{ width: 92 }}
                placeholder="名称"
                value={row.label ?? ''}
                onChange={(e) => patchRow(row.id, { label: e.target.value })}
              />
              <Select
                size="small"
                style={{ width: 150 }}
                value={row.role}
                onChange={(v) => patchRow(row.id, { role: v })}
                options={ROLE_OPTIONS}
              />
              <Select
                size="small"
                mode="multiple"
                allowClear
                style={{ width: 150 }}
                placeholder="边位(可空=非边位)"
                value={row.side ?? []}
                onChange={(v) => patchRow(row.id, { side: v })}
                options={SIDE_OPTIONS}
              />
              <Select
                size="small"
                style={{ width: 86 }}
                value={row.scope ?? 'window'}
                onChange={(v) => patchRow(row.id, { scope: v })}
                options={[
                  { value: 'window', label: '整窗' },
                  { value: 'panel', label: '每扇区' },
                ]}
              />
              {/^cc-\d+$/i.test((row.length ?? '').trim()) ? (
                <Select
                  size="small"
                  style={{ width: 150 }}
                  value={(row.length ?? '').trim()}
                  onChange={(v) => patchRow(row.id, { length: v })}
                  onFocus={() => setActiveField({ rowId: row.id, kind: 'length' })}
                  options={[
                    ...bankKeys.map((k) => ({ value: `cc-${k}`, label: `cc-${k}（公式库）` })),
                    { value: '', label: '取消引用' },
                  ]}
                />
              ) : (
                <FormulaField
                  value={row.length ?? ''}
                  context={previewContext}
                  placeholder="长度 cc-N 或 frameOuterW-6"
                  onFocus={() => setActiveField({ rowId: row.id, kind: 'length' })}
                  onChange={(v) => patchRow(row.id, { length: v })}
                />
              )}
              <div style={{ width: '100%' }} />
              <FormulaField
                value={row.count ?? ''}
                context={previewContext}
                placeholder="数量/边（0=不产，如 sashCount）"
                onFocus={() => setActiveField({ rowId: row.id, kind: 'count' })}
                onChange={(v) => patchRow(row.id, { count: v })}
              />
              <Select
                size="small"
                style={{ width: 64 }}
                value={row.unit ?? '支'}
                onChange={(v) => patchRow(row.id, { unit: v })}
                options={[
                  { value: '支', label: '支' },
                  { value: '米', label: '米' },
                ]}
              />
              <Input
                size="small"
                style={{ width: 78 }}
                placeholder="切角45-45"
                value={row.angle ?? ''}
                onChange={(e) => patchRow(row.id, { angle: e.target.value })}
              />
              <Input
                size="small"
                style={{ width: 170 }}
                placeholder={'条件，如 开向="外开"'}
                value={row.condition ?? ''}
                onChange={(e) => patchRow(row.id, { condition: e.target.value })}
              />
              <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => duplicateRow(row)} title="复制行" />
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeRow(row.id)} title="删除行" />
            </Space>
          </div>
        ))}
        {!draft.cuts.length && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            暂无出料行——留空则该系列全部按内置算法出料。
          </Typography.Text>
        )}
      </div>

      <Divider style={{ margin: '8px 0 10px' }} plain>公式库（出料行 length 可写 cc-N 引用这里）</Divider>
      <Space size={[6, 6]} wrap style={{ marginBottom: 6 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={addBankRow}>新增公式</Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>出料行「长度」填 cc-编号 即引用；键为空条目保存时剔除</Typography.Text>
      </Space>
      {bankKeys.map((key) => (
        <Space key={key} size={6} style={{ marginBottom: 6, width: '100%' }}>
          <Input
            size="small"
            style={{ width: 84 }}
            value={key}
            disabled
          />
          <span style={{ color: '#999' }}>=</span>
          <Input
            size="small"
            style={{ flex: 1 }}
            placeholder="表达式，如 frameOuterW - 6"
            value={draft.formulaBank[key]}
            onChange={(e) => patchBank(key, e.target.value)}
          />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeBankKey(key)} />
        </Space>
      ))}

      <Divider style={{ margin: '8px 0 10px' }} plain>料宽字典（showSetting，公式可引用）</Divider>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        {SHOW_SETTING_KEYS.map((key) => (
          <div key={key}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{key}</Typography.Text>
            <InputNumber
              size="small"
              min={0}
              style={{ width: '100%' }}
              value={draft.showSetting[key]}
              placeholder="—"
              onChange={(v) => patchSetting(key, v)}
            />
          </div>
        ))}
      </div>

      <Divider style={{ margin: '12px 0 10px' }} plain>可用变量（点击插入到当前光标行）</Divider>
      <div style={{ maxHeight: 150, overflow: 'auto' }}>
        {Object.entries(groupedVariables).map(([scope, vars]) => (
          <div key={scope} style={{ marginBottom: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>{scope}</Typography.Text>
            <Space size={[4, 4]} wrap>
              {vars.map((v) => (
                <Tooltip key={v.name} title={`${v.label}：${v.description}`}>
                  <Tag
                    color="blue"
                    style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                    onClick={() => insertVariable(v.name)}
                  >
                    {v.name}
                  </Tag>
                </Tooltip>
              ))}
            </Space>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          borderRadius: 6,
          padding: '8px 10px',
          background: '#f0f7ff',
          border: '1px solid #bae0ff',
          fontSize: 12,
          color: '#0958d9',
        }}
      >
        公式支持数字、变量与 <Typography.Text code style={{ fontSize: 12 }}>+ - * / ( )</Typography.Text>（安全解析，
        不使用 eval）；length 可写 <Typography.Text code style={{ fontSize: 12 }}>cc-N</Typography.Text> 引用「公式库」。
        出料行数量 = 边位数 × 每边数量；未配置或公式非法自动回退内置算料。
      </div>
    </Modal>
  );
}