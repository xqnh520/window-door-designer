/**
 * 仓库管理主页面：顶部仓库切换 + 四个页签（库存总览 / 出入库流水 / 物料档案 / 仓库设置）。
 *
 * 所有 store 订阅都在本组件内部完成，App.tsx 顶层不需要感知仓库状态，
 * 避免 tab 分支切换时的钩子顺序问题（见 App.tsx 顶部注释）。
 */
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Select, Space, Tabs, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ALL_WAREHOUSES, useWarehouseStore } from './store';
import { InventoryOverview } from './InventoryOverview';
import { TransactionList } from './TransactionList';
import { MaterialCatalogTab } from './MaterialCatalogTab';
import { WarehouseSettings } from './WarehouseSettings';
import { StockOpModal } from './StockOpModal';
import type { InventoryRow, StockOpKind } from './types';

const KIND_LABEL: Record<StockOpKind, string> = { inbound: '入库', outbound: '出库', adjust: '盘点' };

export function WarehousePage() {
  const warehouses = useWarehouseStore((s) => s.warehouses);
  const activeWarehouseId = useWarehouseStore((s) => s.activeWarehouseId);
  const setActiveWarehouse = useWarehouseStore((s) => s.setActiveWarehouse);
  const summary = useWarehouseStore((s) => s.summary);
  const error = useWarehouseStore((s) => s.error);
  const bootstrap = useWarehouseStore((s) => s.bootstrap);
  const loadInventory = useWarehouseStore((s) => s.loadInventory);
  const loadSummary = useWarehouseStore((s) => s.loadSummary);

  const [opOpen, setOpOpen] = useState(false);
  const [opKind, setOpKind] = useState<StockOpKind>('inbound');
  const [opRow, setOpRow] = useState<InventoryRow | null>(null);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const openOp = (kind: StockOpKind, row: InventoryRow | null) => {
    setOpKind(kind);
    setOpRow(row);
    setOpOpen(true);
  };

  const warningCount = summary?.warningCount ?? 0;

  return (
    <Card
      size="small"
      title={
        <Space size={12}>
          <Typography.Text strong style={{ fontSize: 16 }}>仓库管理</Typography.Text>
          <Select
            size="small"
            style={{ width: 190 }}
            value={activeWarehouseId}
            onChange={setActiveWarehouse}
            options={[
              { value: ALL_WAREHOUSES, label: '全部仓库' },
              ...warehouses.map((w) => ({
                value: w.id,
                label: `${w.code} ${w.name}${w.isDefault ? '（默认）' : ''}`,
              })),
            ]}
          />
          {warningCount > 0 && <Badge count={warningCount} showZero={false} color="#cf1322" />}
        </Space>
      }
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            void loadInventory();
            void loadSummary();
            message.success('已刷新');
          }}
        >
          刷新
        </Button>
      }
    >
      {error && (
        <Alert
          type="error"
          showIcon
          closable
          style={{ marginBottom: 12 }}
          message="读取仓库数据失败"
          description={`${error}（请确认服务端已启动：npm run dev:server，默认 http://localhost:3000）`}
        />
      )}

      <Tabs
        size="small"
        items={[
          {
            key: 'inventory',
            label: (
              <Badge count={warningCount} size="small" offset={[12, -2]}>
                <span style={{ paddingRight: 4 }}>库存总览</span>
              </Badge>
            ),
            children: <InventoryOverview onOpenOp={openOp} />,
          },
          { key: 'transactions', label: '出入库流水', children: <TransactionList /> },
          { key: 'materials', label: '物料档案', children: <MaterialCatalogTab /> },
          { key: 'settings', label: '仓库设置', children: <WarehouseSettings /> },
        ]}
      />

      <StockOpModal
        open={opOpen}
        kind={opKind}
        row={opRow}
        onKindChange={setOpKind}
        onCancel={() => { setOpOpen(false); setOpRow(null); }}
        onDone={() => {
          message.success(`${KIND_LABEL[opKind]}已提交`);
          setOpOpen(false);
          setOpRow(null);
        }}
      />
    </Card>
  );
}
