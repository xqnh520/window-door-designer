/**
 * 客户列表页：搜索 / 状态筛选 / 分页 / 新建 / 编辑 / 删除 / 进入详情
 */
import { useEffect, useState } from 'react';
import { Button, Card, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCrmStore } from './store';
import {
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABEL,
  type Customer,
  type CustomerStatus,
} from './types';
import { CustomerFormModal, type CustomerFormValues } from './CustomerForm';

const ALL_STATUS = Object.keys(CUSTOMER_STATUS_LABEL) as CustomerStatus[];

export function CustomerListPage({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const customers = useCrmStore((s) => s.customers);
  const total = useCrmStore((s) => s.customerTotal);
  const page = useCrmStore((s) => s.page);
  const pageSize = useCrmStore((s) => s.pageSize);
  const keyword = useCrmStore((s) => s.keyword);
  const statusFilter = useCrmStore((s) => s.statusFilter);
  const loading = useCrmStore((s) => s.loadingList);
  const fetchCustomers = useCrmStore((s) => s.fetchCustomers);
  const createCustomer = useCrmStore((s) => s.createCustomer);
  const updateCustomer = useCrmStore((s) => s.updateCustomer);
  const removeCustomer = useCrmStore((s) => s.removeCustomer);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  // 进入页面自动加载客户列表
  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  const submit = async (values: CustomerFormValues) => {
    try {
      if (editing) {
        await updateCustomer(editing.id, values);
        message.success('客户已更新');
      } else {
        await createCustomer(values);
        message.success('客户已建档');
      }
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', width: 100, render: (v: string, m: Customer) => <a onClick={() => onOpenDetail(m.id)}>{v}</a> },
    { title: '电话', dataIndex: 'phone', width: 130 },
    { title: '小区', dataIndex: 'community', render: (v: string | null) => v ?? '—' },
    { title: '类型', dataIndex: 'houseType', width: 90, render: (v: string | null) => v ?? '—' },
    { title: '预算(万)', dataIndex: 'budget', width: 88, align: 'right' as const, render: (v: number | null) => (v == null ? '—' : v) },
    { title: '来源', dataIndex: 'source', width: 110, render: (v: string | null) => v ?? '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 122,
      render: (v: CustomerStatus) => <Tag color={CUSTOMER_STATUS_COLOR[v]}>{CUSTOMER_STATUS_LABEL[v]}</Tag>,
    },
    {
      title: '操作',
      width: 190,
      render: (_: unknown, m: Customer) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => onOpenDetail(m.id)}>
            详情
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => {
              setEditing(m);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该客户？"
            description="将连同其跟进/方案/订单一并删除"
            onConfirm={async () => {
              try {
                await removeCustomer(m.id);
                message.success('已删除');
              } catch (err) {
                message.error((err as Error).message);
              }
            }}
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="客户管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="姓名 / 电话 / 小区"
            style={{ width: 220 }}
            defaultValue={keyword}
            onSearch={(v) => fetchCustomers({ page: 1, keyword: v })}
          />
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ width: 150 }}
            value={statusFilter}
            onChange={(v?: CustomerStatus) => fetchCustomers({ page: 1, status: v })}
            options={ALL_STATUS.map((s) => ({ value: s, label: CUSTOMER_STATUS_LABEL[s] }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchCustomers({ page: 1 })}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setModalOpen(true); }}>
            新建客户
          </Button>
        </Space>
      }
    >
      <Table<Customer>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={customers}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          onChange: (p) => fetchCustomers({ page: p }),
        }}
      />
      <CustomerFormModal open={modalOpen} initial={editing} onCancel={() => { setModalOpen(false); setEditing(null); }} onSubmit={submit} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        状态流转：A类（高意向）→ B类（在对比）→ C类（长期跟进）→ 已量尺 → 已签约 / 已流失；保存方案、跟进记录均在客户详情页操作。
      </Typography.Text>
    </Card>
  );
}
