/**
 * 出入库流水：类型 / 仓库 / 日期范围 / 单据号筛选 + 服务端分页
 */
import { useEffect } from 'react';
import { DatePicker, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { TransactionTypeLabel, type TransactionType } from '@wdd/schema';
import { ALL_WAREHOUSES, useWarehouseStore } from './store';
import type { TransactionRow } from './types';

const TYPE_COLOR: Record<TransactionType, string> = {
  inbound: 'green',
  outbound: 'volcano',
  adjust: 'blue',
  transfer: 'purple',
};

const time = (v?: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—');

export function TransactionList() {
  const warehouses = useWarehouseStore((s) => s.warehouses);
  const transactions = useWarehouseStore((s) => s.transactions);
  const txQuery = useWarehouseStore((s) => s.txQuery);
  const loading = useWarehouseStore((s) => s.loadingTx);
  const loadTransactions = useWarehouseStore((s) => s.loadTransactions);

  useEffect(() => {
    void loadTransactions({ page: 1 });
  }, [loadTransactions]);

  const columns = [
    { title: '操作时间', dataIndex: 'operateTime', width: 160, render: time },
    {
      title: '类型',
      dataIndex: 'transactionType',
      width: 88,
      render: (v: TransactionType) => <Tag color={TYPE_COLOR[v]}>{TransactionTypeLabel[v]}</Tag>,
    },
    { title: '物料编码', dataIndex: ['material', 'code'], width: 140, render: (v: string | undefined) => v ?? '（物料已删除）' },
    { title: '物料名称', dataIndex: ['material', 'name'], width: 170 },
    { title: '仓库', dataIndex: 'warehouseName', width: 130, render: (v?: string) => v ?? '—' },
    { title: '库位', dataIndex: 'locationCode', width: 90, render: (v?: string) => v ?? '—' },
    {
      title: '变动',
      dataIndex: 'quantity',
      width: 88,
      align: 'right' as const,
      render: (v: number, row: TransactionRow) => (
        <Typography.Text strong style={{ color: v > 0 ? '#3f8600' : v < 0 ? '#cf1322' : undefined }}>
          {v > 0 ? `+${v}` : v}
          {row.material ? ` ${row.material.unit}` : ''}
        </Typography.Text>
      ),
    },
    { title: '变动前', dataIndex: 'beforeQty', width: 80, align: 'right' as const },
    { title: '变动后', dataIndex: 'afterQty', width: 80, align: 'right' as const },
    { title: '单据号', dataIndex: 'relatedDocNo', width: 160, render: (v: string) => v || '—' },
    { title: '操作人', dataIndex: 'operatorId', width: 90 },
    { title: '备注', dataIndex: 'remark', render: (v?: string) => v || '—' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          size="small"
          placeholder="全部类型"
          style={{ width: 120 }}
          value={txQuery.transactionType}
          onChange={(v) => void loadTransactions({ page: 1, transactionType: v })}
          options={(Object.keys(TransactionTypeLabel) as TransactionType[]).map((t) => ({
            value: t,
            label: TransactionTypeLabel[t],
          }))}
        />
        <Select
          size="small"
          style={{ width: 170 }}
          value={txQuery.warehouseId ?? ALL_WAREHOUSES}
          onChange={(v) => void loadTransactions({ page: 1, warehouseId: v === ALL_WAREHOUSES ? undefined : v })}
          options={[
            { value: ALL_WAREHOUSES, label: '全部仓库' },
            ...warehouses.map((w) => ({ value: w.id, label: `${w.code} ${w.name}` })),
          ]}
        />
        <DatePicker.RangePicker
          size="small"
          allowClear
          onChange={(_dates, dateStrings) => {
            const [from, to] = dateStrings;
            void loadTransactions({
              page: 1,
              // 服务端按 ISO 字符串比较，日期需补全为当天的起止时刻
              from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
              to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
            });
          }}
        />
        <Input.Search
          size="small"
          allowClear
          placeholder="单据号 / 备注"
          style={{ width: 200 }}
          defaultValue={txQuery.keyword}
          onSearch={(v) => void loadTransactions({ page: 1, keyword: v.trim() || undefined })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {transactions?.total ?? 0} 条流水
        </Typography.Text>
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={transactions?.list ?? []}
        columns={columns}
        scroll={{ x: 1400 }}
        pagination={{
          current: txQuery.page ?? 1,
          pageSize: txQuery.pageSize ?? 20,
          total: transactions?.total ?? 0,
          size: 'small',
          showSizeChanger: true,
          onChange: (page, pageSize) => void loadTransactions({ page, pageSize }),
        }}
        locale={{ emptyText: '暂无出入库流水' }}
      />
    </div>
  );
}
