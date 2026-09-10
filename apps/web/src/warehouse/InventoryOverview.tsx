/**
 * 库存总览：按仓库汇总卡片 + 缺料预警筛选 + 库存明细表（行内可发起入库/出库/盘点、改安全库存）
 */
import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Col, InputNumber, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ImportOutlined, ExportOutlined, ScheduleOutlined } from '@ant-design/icons';
import { MATERIAL_CATEGORIES, MaterialCategoryLabel, type MaterialCategory } from '@wdd/schema';
import { useWarehouseStore } from './store';
import type { InventoryRow, StockOpKind } from './types';

/** 安全库存行内编辑：失焦或回车即提交，失败回滚显示值 */
function SafetyStockCell({ row }: { row: InventoryRow }) {
  const updateMeta = useWarehouseStore((s) => s.updateMeta);
  const [value, setValue] = useState(row.safetyStock);

  useEffect(() => setValue(row.safetyStock), [row.safetyStock]);

  const commit = async () => {
    if (value === row.safetyStock) return;
    try {
      await updateMeta({
        materialId: row.materialId,
        warehouseId: row.warehouseId,
        locationCode: row.locationCode,
        safetyStock: value,
      });
      message.success(`安全库存已更新为 ${value}`);
    } catch (err) {
      message.error((err as Error).message);
      setValue(row.safetyStock);
    }
  };

  return (
    <InputNumber
      size="small"
      min={0}
      value={value}
      onChange={(v) => setValue(Math.max(0, Math.round(v ?? 0)))}
      onBlur={commit}
      onPressEnter={commit}
      style={{ width: 80 }}
    />
  );
}

export function InventoryOverview({ onOpenOp }: { onOpenOp: (kind: StockOpKind, row: InventoryRow | null) => void }) {
  const inventory = useWarehouseStore((s) => s.inventory);
  const summary = useWarehouseStore((s) => s.summary);
  const loading = useWarehouseStore((s) => s.loadingInventory);
  const categoryFilter = useWarehouseStore((s) => s.categoryFilter);
  const onlyWarning = useWarehouseStore((s) => s.onlyWarning);
  const setInventoryFilter = useWarehouseStore((s) => s.setInventoryFilter);

  const columns = [
    { title: '编码', dataIndex: ['material', 'code'], width: 140 },
    { title: '名称', dataIndex: ['material', 'name'], width: 170 },
    {
      title: '分类',
      dataIndex: ['material', 'category'],
      width: 72,
      render: (v: MaterialCategory) => MaterialCategoryLabel[v],
    },
    { title: '规格型号', dataIndex: ['material', 'specModel'], width: 120 },
    { title: '仓库', dataIndex: 'warehouseName', width: 130 },
    { title: '库位', dataIndex: 'locationCode', width: 90 },
    {
      title: '结存',
      dataIndex: 'currentQty',
      width: 88,
      align: 'right' as const,
      render: (v: number, row: InventoryRow) => `${v} ${row.material.unit}`,
    },
    {
      title: '锁定',
      dataIndex: 'lockedQty',
      width: 72,
      align: 'right' as const,
      render: (v: number) => (
        <Tooltip title="已分配给生产单但未出库；当前需手工维护，暂未与订单联动">
          <Typography.Text type={v > 0 ? 'warning' : 'secondary'}>{v}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '可用',
      dataIndex: 'availableQty',
      width: 80,
      align: 'right' as const,
      render: (v: number, row: InventoryRow) =>
        row.warning ? <Typography.Text strong style={{ color: '#cf1322' }}>{v}</Typography.Text> : v,
    },
    {
      title: '安全库存',
      dataIndex: 'safetyStock',
      width: 96,
      align: 'right' as const,
      render: (_: number, row: InventoryRow) => <SafetyStockCell row={row} />,
    },
    {
      title: '状态',
      dataIndex: 'warning',
      width: 76,
      render: (warning: boolean, row: InventoryRow) =>
        warning ? (
          <Tooltip title={`可用 ${row.availableQty} 低于安全库存 ${row.safetyStock}`}>
            <Tag color="red">缺料</Tag>
          </Tooltip>
        ) : (
          <Tag color="green">正常</Tag>
        ),
    },
    {
      title: '最后入库',
      dataIndex: 'lastInboundTime',
      width: 150,
      render: (v?: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
    },
    {
      title: '操作',
      width: 168,
      fixed: 'right' as const,
      render: (_: unknown, row: InventoryRow) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => onOpenOp('inbound', row)}>入库</Button>
          <Button size="small" type="link" onClick={() => onOpenOp('outbound', row)}>出库</Button>
          <Button size="small" type="link" onClick={() => onOpenOp('adjust', row)}>盘点</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={8} md={5}>
          <Card size="small">
            <Statistic
              title="缺料预警"
              value={summary?.warningCount ?? 0}
              valueStyle={{ color: (summary?.warningCount ?? 0) > 0 ? '#cf1322' : '#3f8600' }}
              suffix="项"
            />
          </Card>
        </Col>
        {(summary?.warehouses ?? []).map((w) => (
          <Col xs={12} sm={8} md={5} key={w.warehouseId}>
            <Card size="small">
              <Statistic title={`${w.warehouseName} · 结存`} value={w.totalQty} suffix={`/ ${w.skuCount} 种`} />
              {w.warningCount > 0 && (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>缺料 {w.warningCount} 项</Typography.Text>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          placeholder="全部分类"
          style={{ width: 130 }}
          size="small"
          value={categoryFilter}
          onChange={(v) => setInventoryFilter({ category: v })}
          options={MATERIAL_CATEGORIES.map((c) => ({ value: c, label: MaterialCategoryLabel[c] }))}
        />
        <Checkbox
          checked={onlyWarning}
          onChange={(e) => setInventoryFilter({ onlyWarning: e.target.checked })}
        >
          只看缺料
        </Checkbox>
        <Button size="small" type="primary" icon={<ImportOutlined />} onClick={() => onOpenOp('inbound', null)}>入库</Button>
        <Button size="small" icon={<ExportOutlined />} onClick={() => onOpenOp('outbound', null)}>出库</Button>
        <Button size="small" icon={<ScheduleOutlined />} onClick={() => onOpenOp('adjust', null)}>盘点</Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {inventory.length} 条库存记录
        </Typography.Text>
      </Space>

      <Table
        size="small"
        rowKey={(r) => `${r.materialId}|${r.warehouseId}|${r.locationCode}`}
        loading={loading}
        dataSource={inventory}
        columns={columns}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 20, showSizeChanger: false, size: 'small' }}
        locale={{ emptyText: '暂无库存记录，点上方「入库」建立第一条库存' }}
      />
    </div>
  );
}
