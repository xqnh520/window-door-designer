/**
 * 出入库 / 盘点弹窗 —— 三种业务共用一个表单（80% 字段重合），用 Segmented 切换。
 *
 * 差异：
 * - 入库：数量 > 0，单据号 PO-…
 * - 出库：显示「当前可用」并校验不超量，单据号 WO-…
 * - 盘点：填「实盘数量」，实时显示账面与差额，单据号 IC-…
 */
import { useEffect, useMemo } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Segmented, Select, Space, Typography } from 'antd';
import { ALL_WAREHOUSES, useWarehouseStore } from './store';
import { nextDocNo, type DocPrefix } from './docNo';
import type { InventoryRow, StockOpKind } from './types';

const KIND_LABEL: Record<StockOpKind, string> = { inbound: '入库', outbound: '出库', adjust: '盘点' };
const KIND_PREFIX: Record<StockOpKind, DocPrefix> = { inbound: 'PO', outbound: 'WO', adjust: 'IC' };

interface FormValues {
  materialId: string;
  warehouseId: string;
  locationCode: string;
  quantity: number;
  relatedDocNo: string;
  operatorId: string;
  remark?: string;
}

export function StockOpModal({
  open,
  kind,
  row,
  onKindChange,
  onCancel,
  onDone,
}: {
  open: boolean;
  kind: StockOpKind;
  /** 从库存行发起时预填物料 / 仓库 / 库位；从工具条发起时为 null */
  row?: InventoryRow | null;
  onKindChange: (kind: StockOpKind) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const warehouses = useWarehouseStore((s) => s.warehouses);
  const materials = useWarehouseStore((s) => s.materials);
  const inventory = useWarehouseStore((s) => s.inventory);
  const activeWarehouseId = useWarehouseStore((s) => s.activeWarehouseId);
  const submitInbound = useWarehouseStore((s) => s.submitInbound);
  const submitOutbound = useWarehouseStore((s) => s.submitOutbound);
  const submitAdjust = useWarehouseStore((s) => s.submitAdjust);

  const defaultWarehouseId = useMemo(() => {
    if (row) return row.warehouseId;
    if (activeWarehouseId !== ALL_WAREHOUSES) return activeWarehouseId;
    return (warehouses.find((w) => w.isDefault) ?? warehouses[0])?.id ?? '';
  }, [row, activeWarehouseId, warehouses]);

  // 打开或切换业务类型时重置表单（单据号按前缀重新取号）
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      materialId: row?.materialId ?? '',
      warehouseId: defaultWarehouseId,
      locationCode: row?.locationCode ?? '',
      quantity: kind === 'adjust' ? (row?.currentQty ?? 0) : undefined as unknown as number,
      relatedDocNo: nextDocNo(KIND_PREFIX[kind]),
      operatorId: 'webshell',
      remark: '',
    });
  }, [open, kind, row, defaultWarehouseId, form]);

  const materialId = Form.useWatch('materialId', form);
  const warehouseId = Form.useWatch('warehouseId', form);
  const locationCode = Form.useWatch('locationCode', form);
  const quantity = Form.useWatch('quantity', form);

  const material = materials.find((m) => m.id === materialId);
  const current = inventory.find(
    (r) =>
      r.materialId === materialId &&
      r.warehouseId === warehouseId &&
      r.locationCode === String(locationCode ?? '').toUpperCase(),
  );
  const bookQty = current?.currentQty ?? 0;
  const availableQty = current?.availableQty ?? 0;
  const lockedQty = current?.lockedQty ?? 0;
  const delta = Number.isFinite(quantity) ? (quantity ?? 0) - bookQty : 0;

  const locationOptions = (warehouses.find((w) => w.id === warehouseId)?.locations ?? []).map((loc) => ({
    value: loc,
    label: loc,
  }));

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验未通过，保持弹窗打开
    }
    const base = {
      materialId: values.materialId,
      warehouseId: values.warehouseId,
      locationCode: values.locationCode,
      relatedDocNo: values.relatedDocNo.trim(),
      operatorId: values.operatorId.trim() || 'webshell',
      remark: values.remark?.trim() || undefined,
    };
    try {
      if (kind === 'inbound') await submitInbound({ ...base, quantity: values.quantity });
      else if (kind === 'outbound') await submitOutbound({ ...base, quantity: values.quantity });
      else await submitAdjust({ ...base, countedQty: values.quantity });
      onDone();
    } catch (err) {
      form.setFields([{ name: 'quantity', errors: [(err as Error).message] }]);
    }
  };

  return (
    <Modal
      title={
        <Space size={12}>
          <Segmented
            size="small"
            value={kind}
            onChange={(v) => onKindChange(v as StockOpKind)}
            options={(Object.keys(KIND_LABEL) as StockOpKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {KIND_LABEL[kind]}单
          </Typography.Text>
        </Space>
      }
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="提交"
      cancelText="取消"
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" size="small" style={{ marginTop: 12 }}>
        <Form.Item label="物料" name="materialId" rules={[{ required: true, message: '请选择物料' }]}>
          <Select
            showSearch
            disabled={!!row}
            placeholder="按编码 / 名称 / 规格搜索"
            optionFilterProp="label"
            options={materials
              .filter((m) => m.status === 'active')
              .map((m) => ({ value: m.id, label: `${m.code}｜${m.name}${m.specModel ? `｜${m.specModel}` : ''}` }))}
          />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="仓库" name="warehouseId" rules={[{ required: true, message: '请选择仓库' }]}>
            <Select
              disabled={!!row}
              options={warehouses
                .filter((w) => w.status === 'active')
                .map((w) => ({ value: w.id, label: `${w.code} ${w.name}${w.isDefault ? '（默认）' : ''}` }))}
            />
          </Form.Item>
          <Form.Item label="库位" name="locationCode" rules={[{ required: true, message: '请选择库位' }]}>
            <Select disabled={!!row} options={locationOptions} placeholder={locationOptions.length ? undefined : '该仓库暂无库位'} />
          </Form.Item>
        </div>

        {materialId && !current && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="该物料在此库位尚无库存记录"
            description={kind === 'inbound' ? '提交后会自动建立库存行。' : '出库 / 盘点需要已有库存行，请先入库。'}
          />
        )}

        <Form.Item
          label={kind === 'adjust' ? '实盘数量' : kind === 'inbound' ? '入库数量' : '出库数量'}
          name="quantity"
          rules={[
            { required: true, message: '请填写数量' },
            {
              validator: (_, value: number) => {
                if (value == null) return Promise.resolve();
                if (kind === 'adjust') {
                  if (value < 0) return Promise.reject(new Error('实盘数量不能为负数'));
                  if (value < lockedQty) return Promise.reject(new Error(`实盘数量不能小于锁定数量 ${lockedQty}`));
                  return Promise.resolve();
                }
                if (value <= 0) return Promise.reject(new Error('数量必须大于 0'));
                if (kind === 'outbound' && value > availableQty) {
                  return Promise.reject(new Error(`可用库存不足：当前 ${availableQty}，需要 ${value}`));
                }
                return Promise.resolve();
              },
            },
          ]}
          extra={
            kind === 'adjust'
              ? `账面 ${bookQty}${material ? ` ${material.unit}` : ''} → 差额 ${delta > 0 ? '+' : ''}${delta || 0}（无差异也会留痕）`
              : kind === 'outbound'
                ? `当前可用 ${availableQty}${material ? ` ${material.unit}` : ''}（结存 ${bookQty} / 锁定 ${lockedQty}）`
                : `当前结存 ${bookQty}${material ? ` ${material.unit}` : ''}`
          }
        >
          <InputNumber min={kind === 'adjust' ? 0 : 1} style={{ width: '100%' }} addonAfter={material?.unit} />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="单据号" name="relatedDocNo" rules={[{ required: true, message: '请填写单据号' }]}>
            <Input placeholder={`${KIND_PREFIX[kind]}-yyyyMMdd-0001`} />
          </Form.Item>
          <Form.Item label="操作人" name="operatorId">
            <Input />
          </Form.Item>
        </div>

        <Form.Item label="备注" name="remark">
          <Input placeholder={kind === 'adjust' ? '如：月度盘点 / 破损核销' : '可选'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
