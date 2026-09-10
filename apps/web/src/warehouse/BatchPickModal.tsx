/**
 * BOM 一键领料出库。
 *
 * 设计器算料得到的 BomItem.materialId 来自样例库（p-frame-60 / g-5mm），与仓库物料档案的
 * uuid 是两套 id，因此这里用 @wdd/core 的 buildPickLines 做「编码 → 名称 → 规格」降级匹配，
 * 匹配不上的行可手工指定或一键建档（建档时沿用 BOM 编码，下次即可自动匹配）。
 * 提交走 POST /inventory/batch-outbound：默认整单成功或整单不写，失败明细直接渲染成表格。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { MaterialCategoryLabel, type MaterialCategory } from '@wdd/schema';
import {
  applyManualMaterial,
  buildPickLines,
  pickQuantity,
  validatePickLines,
  type BomItem,
  type PickLine,
  type PickMatchBy,
} from '@wdd/core';
import { warehouseApi } from './api';
import { nextDocNo } from './docNo';
import { useWarehouseStore } from './store';
import type { BatchResult } from './types';

const MATCH_LABEL: Record<PickMatchBy, string> = {
  code: '编码',
  name: '名称',
  spec: '规格',
  manual: '手工',
};

const CATEGORY_COLOR: Record<string, string> = {
  profile: 'blue',
  glass: 'cyan',
  hardware: 'orange',
  accessory: 'green',
  finished: 'purple',
};

const STATUS_TAG: Record<PickLine['status'], { color: string; text: string }> = {
  matched: { color: 'green', text: '可领料' },
  'no-stock': { color: 'orange', text: '需先入库' },
  unmatched: { color: 'red', text: '未匹配' },
};

export function BatchPickModal({
  open,
  bomItems,
  designName,
  onCancel,
  onDone,
}: {
  open: boolean;
  bomItems: BomItem[];
  designName: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const warehouses = useWarehouseStore((s) => s.warehouses);
  const materials = useWarehouseStore((s) => s.materials);
  const inventory = useWarehouseStore((s) => s.inventory);
  const loadWarehouses = useWarehouseStore((s) => s.loadWarehouses);
  const loadMaterials = useWarehouseStore((s) => s.loadMaterials);
  const loadInventory = useWarehouseStore((s) => s.loadInventory);
  const submitBatch = useWarehouseStore((s) => s.submitBatch);

  const [warehouseId, setWarehouseId] = useState('');
  const [sets, setSets] = useState(1);
  const [docNo, setDocNo] = useState('');
  const [remark, setRemark] = useState('');
  /** 手工覆盖：BOM 行 key → 档案物料 id（null = 显式清空匹配） */
  const [manual, setManual] = useState<Record<string, string | null>>({});
  const [blocked, setBlocked] = useState<string[]>([]);
  const [failure, setFailure] = useState<BatchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 打开时重置并载入主数据（设计器页面不会预先 bootstrap 仓库 store）
  useEffect(() => {
    if (!open) return;
    setDocNo(nextDocNo('WO'));
    setRemark(`领料：${designName}`);
    setSets(1);
    setManual({});
    setBlocked([]);
    setFailure(null);
    void loadWarehouses();
    void loadMaterials();
    void loadInventory();
  }, [open, designName, loadWarehouses, loadMaterials, loadInventory]);

  // 仓库列表到位后选默认仓
  useEffect(() => {
    if (!open || warehouseId || !warehouses.length) return;
    const actives = warehouses.filter((w) => w.status === 'active');
    const preferred = actives.find((w) => w.isDefault) ?? actives[0];
    if (preferred) setWarehouseId(preferred.id);
  }, [open, warehouseId, warehouses]);

  const lines = useMemo(() => {
    const ctx = { materials, inventory, preferredWarehouseId: warehouseId || undefined };
    return buildPickLines(bomItems, ctx).map((line) => {
      const override = manual[line.key];
      if (override === undefined) return line;
      return applyManualMaterial(line, materials.find((m) => m.id === override) ?? null, ctx);
    });
  }, [bomItems, materials, inventory, warehouseId, manual]);

  const problems = useMemo(() => validatePickLines(lines, sets), [lines, sets]);
  const totalQty = lines.reduce((sum, l) => sum + (l.materialId ? pickQuantity(l, sets) : 0), 0);

  /** 一键建档：沿用 BOM 编码（玻璃的 code 是名称，含中文则留空由服务端生成 GL-…） */
  const quickCreate = async (line: PickLine) => {
    const raw = line.bomCode.trim();
    const code = raw && !/[\u4e00-\u9fa5]/.test(raw) ? raw : '';
    const existing = code ? materials.find((m) => m.code.toUpperCase() === code.toUpperCase()) : undefined;
    if (existing) {
      setManual((prev) => ({ ...prev, [line.key]: existing.id }));
      message.info(`编码 ${code} 已建档，已关联「${existing.name}」`);
      return;
    }
    try {
      const created = await warehouseApi.createMaterial({
        code: code || undefined,
        name: line.name,
        category: line.category,
        // 玻璃的 BOM 规格是「宽×高」，按尺寸建档会一樘一条，留空更合理；
        // 型材的规格尾巴带每根料的长度（…框料60 760mm），去掉后才是稳定的型材规格
        specModel: line.category === 'glass' ? '' : line.spec.replace(/\s*\d+(?:\.\d+)?mm\s*$/i, '').trim(),
        unit: line.unit,
        status: 'active',
      });
      await loadMaterials();
      setManual((prev) => ({ ...prev, [line.key]: created.id }));
      message.success(`已建档 ${created.code}｜${created.name}`);
    } catch (err) {
      const dup = /物料编码 (\S+) 已存在/.exec((err as Error).message);
      const hit = dup ? materials.find((m) => m.code === dup[1]) : undefined;
      if (hit) {
        setManual((prev) => ({ ...prev, [line.key]: hit.id }));
        message.info(`编码 ${hit.code} 已存在，已关联「${hit.name}」`);
        return;
      }
      message.error((err as Error).message);
    }
  };

  const handleSubmit = async () => {
    if (problems.length) {
      setBlocked(problems);
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await submitBatch({
        relatedDocNo: docNo.trim(),
        operatorId: 'webshell',
        remark: remark.trim() || undefined,
        lines: lines.map((l) => ({
          materialId: l.materialId as string,
          warehouseId: l.warehouseId as string,
          locationCode: l.locationCode as string,
          quantity: pickQuantity(l, sets),
        })),
      });
      if (result.ok) {
        message.success(`领料成功：${result.succeeded} 行已出库，单据号 ${result.relatedDocNo}`);
        onDone();
      } else {
        setFailure(result);
        void loadInventory();
      }
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: '分类',
      dataIndex: 'category',
      width: 68,
      render: (v: MaterialCategory) => <Tag color={CATEGORY_COLOR[v]}>{MaterialCategoryLabel[v]}</Tag>,
    },
    {
      title: '名称 / 规格',
      dataIndex: 'name',
      width: 210,
      render: (_: string, l: PickLine) => (
        <div>
          <Typography.Text strong style={{ fontSize: 12 }}>{l.name}</Typography.Text>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>{l.spec || l.bomCode}</div>
          {l.warning && (
            <Typography.Text type="warning" style={{ fontSize: 11 }}>{l.warning}</Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '单樘用量',
      dataIndex: 'quantityPerSet',
      width: 92,
      align: 'right' as const,
      render: (v: number, l: PickLine) => `${v} ${l.unit}`,
    },
    {
      title: '领料数量',
      width: 92,
      align: 'right' as const,
      render: (_: unknown, l: PickLine) => (
        <Typography.Text strong>{pickQuantity(l, sets)} {l.unit}</Typography.Text>
      ),
    },
    {
      title: '物料档案',
      width: 250,
      render: (_: unknown, l: PickLine) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Select
            size="small"
            showSearch
            allowClear
            style={{ width: 240 }}
            placeholder="选择档案物料"
            value={l.materialId ?? undefined}
            optionFilterProp="label"
            onChange={(v) => setManual((prev) => ({ ...prev, [l.key]: v ?? null }))}
            options={materials
              .filter((m) => m.status === 'active')
              .map((m) => ({ value: m.id, label: `${m.code}｜${m.name}${m.specModel ? `｜${m.specModel}` : ''}` }))}
          />
          {l.matchBy && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              按{MATCH_LABEL[l.matchBy]}匹配{l.materialCode ? ` → ${l.materialCode}` : ''}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '出库库位',
      width: 160,
      render: (_: unknown, l: PickLine) => {
        if (!l.warehouseId || !l.locationCode) return <Typography.Text type="secondary">—</Typography.Text>;
        const wh = warehouses.find((w) => w.id === l.warehouseId);
        const need = pickQuantity(l, sets);
        return (
          <div style={{ fontSize: 12 }}>
            <div>{wh ? `${wh.code} ${wh.name}` : l.warehouseId} · {l.locationCode}</div>
            <Tooltip title="可用量小于领料量时整单会被拒绝">
              <Typography.Text type={l.availableQty < need ? 'danger' : 'secondary'}>
                可用 {l.availableQty} {l.unit}
              </Typography.Text>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 92,
      render: (v: PickLine['status']) => <Tag color={STATUS_TAG[v].color}>{STATUS_TAG[v].text}</Tag>,
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, l: PickLine) =>
        l.materialId ? null : (
          <Button size="small" type="link" onClick={() => void quickCreate(l)}>建档</Button>
        ),
    },
  ];

  return (
    <Modal
      title={`领料出库 — ${designName}`}
      open={open}
      onCancel={onCancel}
      width={1080}
      destroyOnClose
      footer={
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {lines.length} 行 / 合计 {Math.round(totalQty * 100) / 100}
            {problems.length > 0 && <Typography.Text type="danger"> · {problems.length} 行待处理</Typography.Text>}
          </Typography.Text>
          <Button size="small" onClick={onCancel}>取消</Button>
          <Button size="small" type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            提交领料
          </Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ fontSize: 12 }}>樘数</span>
        <InputNumber size="small" min={1} value={sets} onChange={(v) => setSets(Math.max(1, Math.round(v ?? 1)))} style={{ width: 80 }} />
        <span style={{ fontSize: 12 }}>出库仓库</span>
        <Select
          size="small"
          style={{ width: 190 }}
          value={warehouseId || undefined}
          placeholder="选择仓库"
          onChange={setWarehouseId}
          options={warehouses
            .filter((w) => w.status === 'active')
            .map((w) => ({ value: w.id, label: `${w.code} ${w.name}${w.isDefault ? '（默认）' : ''}` }))}
        />
        <span style={{ fontSize: 12 }}>单据号</span>
        <Input size="small" style={{ width: 180 }} value={docNo} onChange={(e) => setDocNo(e.target.value)} />
        <span style={{ fontSize: 12 }}>备注</span>
        <Input size="small" style={{ width: 200 }} value={remark} onChange={(e) => setRemark(e.target.value)} />
      </Space>

      {blocked.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${blocked.length} 行无法领料`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {blocked.slice(0, 6).map((b) => <li key={b} style={{ fontSize: 12 }}>{b}</li>)}
              {blocked.length > 6 && <li style={{ fontSize: 12 }}>…另有 {blocked.length - 6} 行</li>}
            </ul>
          }
        />
      )}

      {failure && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`单据 ${failure.relatedDocNo} 未出库：${failure.failed} / ${failure.total} 行不满足条件`}
          description={
            <Table
              size="small"
              rowKey="index"
              pagination={false}
              dataSource={failure.results.filter((r) => !r.ok)}
              columns={[
                { title: '#', dataIndex: 'index', width: 44, render: (v: number) => v + 1 },
                { title: '编码', dataIndex: 'code', width: 140 },
                { title: '名称', dataIndex: 'name', width: 180 },
                { title: '原因', dataIndex: 'error' },
              ]}
            />
          }
        />
      )}

      <Table
        size="small"
        rowKey="key"
        dataSource={lines}
        columns={columns}
        pagination={false}
        scroll={{ x: 1120, y: 380 }}
        locale={{ emptyText: '当前设计没有算料结果' }}
      />
    </Modal>
  );
}
