/**
 * 客户详情页：客户信息 + 状态流转 + 跟进时间轴 + 关联方案（Konva）+ 订单
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCrmStore } from './store';
import {
  CUSTOMER_STATUS_COLOR,
  CUSTOMER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  type CustomerStatus,
  type DesignScheme,
  type Order,
  type OrderStatus,
} from './types';
import { CustomerFormModal, type CustomerFormValues } from './CustomerForm';

export function CustomerDetailPage({
  customerId,
  onBack,
  onNewScheme,
  onEditScheme,
}: {
  customerId: string;
  onBack: () => void;
  onNewScheme: () => void;
  onEditScheme: (scheme: DesignScheme) => void;
}) {
  const current = useCrmStore((s) => s.currentCustomer);
  const followUps = useCrmStore((s) => s.followUps);
  const schemes = useCrmStore((s) => s.schemes);
  const orders = useCrmStore((s) => s.orders);
  const loadingDetail = useCrmStore((s) => s.loadingDetail);
  const error = useCrmStore((s) => s.error);
  const loadCustomerDetail = useCrmStore((s) => s.loadCustomerDetail);
  const updateCustomer = useCrmStore((s) => s.updateCustomer);
  const removeCustomer = useCrmStore((s) => s.removeCustomer);
  const addFollowUp = useCrmStore((s) => s.addFollowUp);
  const removeFollowUp = useCrmStore((s) => s.removeFollowUp);
  const removeScheme = useCrmStore((s) => s.removeScheme);
  const createOrder = useCrmStore((s) => s.createOrder);
  const updateOrder = useCrmStore((s) => s.updateOrder);

  useEffect(() => {
    void loadCustomerDetail(customerId);
  }, [customerId, loadCustomerDetail]);

  // 编辑客户
  const [editOpen, setEditOpen] = useState(false);
  const submitEdit = async (values: CustomerFormValues) => {
    try {
      await updateCustomer(customerId, values);
      message.success('客户信息已更新');
      setEditOpen(false);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  // 跟进
  const [followForm] = Form.useForm();
  const submitFollow = async () => {
    const values = await followForm.validateFields();
    try {
      await addFollowUp(customerId, {
        content: values.content,
        nextFollowDate: values.nextFollowDate ? (values.nextFollowDate as dayjs.Dayjs).toISOString() : undefined,
      });
      followForm.resetFields();
      message.success('跟进已记录');
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  // 新建订单
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm] = Form.useForm();
  const submitOrder = async () => {
    const values = await orderForm.validateFields();
    try {
      await createOrder({
        customerId,
        schemeId: values.schemeId || undefined,
        totalAmount: values.totalAmount ?? 0,
        deposit: values.deposit ?? 0,
        balance: values.balance ?? 0,
        remark: values.remark,
      });
      setOrderOpen(false);
      orderForm.resetFields();
      message.success('订单已创建');
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const schemeColumns = [
    { title: '方案名称', dataIndex: 'name' },
    { title: '尺寸(mm)', dataIndex: 'totalWidth', width: 110, render: (_: number, s: DesignScheme) => `${s.totalWidth}×${s.totalHeight}` },
    { title: '系列', dataIndex: 'seriesName', width: 100 },
    { title: '颜色', dataIndex: 'colorConfig', width: 110, render: (c: DesignScheme['colorConfig']) => c?.outerColor ?? '—' },
    { title: '版本', dataIndex: 'schemaVersion', width: 64 },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, s: DesignScheme) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => onEditScheme(s)}>
            进入设计
          </Button>
          <Popconfirm
            title="删除该方案？"
            onConfirm={async () => {
              await removeScheme(customerId, s.id);
              message.success('方案已删除');
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

  const orderColumns = [
    { title: '订单号(截)', dataIndex: 'id', width: 90, render: (v: string) => v.slice(0, 8) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: OrderStatus) => <Tag color={ORDER_STATUS_COLOR[v]}>{ORDER_STATUS_LABEL[v]}</Tag>,
    },
    { title: '总价(元)', dataIndex: 'totalAmount', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    { title: '定金(元)', dataIndex: 'deposit', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    { title: '尾款(元)', dataIndex: 'balance', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(2) },
    { title: '备注', dataIndex: 'remark', render: (v: string | null) => v ?? '—' },
    {
      title: '状态流转',
      width: 170,
      render: (_: unknown, o: Order) => (
        <Select
          size="small"
          style={{ width: 150 }}
          value={o.status}
          onChange={(v: OrderStatus) => {
            void updateOrder(o.id, { status: v }).then(() => message.success('订单状态已更新'));
          }}
          options={(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] }))}
        />
      ),
    },
  ];

  const timelineItems = useMemo(
    () =>
      followUps.map((f) => ({
        key: f.id,
        color: f.nextFollowDate ? 'blue' : 'gray',
        children: (
          <div>
            <div style={{ fontWeight: 600 }}>{f.content}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dayjs(f.createdAt).format('YYYY-MM-DD HH:mm')}
              {f.nextFollowDate ? ` · 下次跟进 ${dayjs(f.nextFollowDate).format('YYYY-MM-DD')}` : ''}
            </Typography.Text>
            <Button size="small" type="text" danger icon={<CloseOutlined />} style={{ marginLeft: 8 }}
              onClick={() => void removeFollowUp(f.id)} />
          </div>
        ),
      })),
    [followUps, removeFollowUp],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回列表
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          客户详情
        </Typography.Title>
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
      </Space>

      <Card loading={loadingDetail} title="客户信息" extra={
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
            编辑
          </Button>
          <Select
            size="small"
            style={{ width: 140 }}
            value={current?.status}
            onChange={(v: CustomerStatus) => {
              void updateCustomer(customerId, { status: v }).then(() => message.success('状态已流转'));
            }}
            options={(Object.keys(CUSTOMER_STATUS_LABEL) as CustomerStatus[]).map((s) => ({ value: s, label: CUSTOMER_STATUS_LABEL[s] }))}
          />
          <Popconfirm
            title="删除该客户？"
            description="将连同跟进/方案/订单一并删除"
            onConfirm={async () => {
              try {
                await removeCustomer(customerId);
                onBack();
                message.success('客户已删除');
              } catch (err) {
                message.error((err as Error).message);
              }
            }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      }>
        <Descriptions column={3} size="small" bordered>
          <Descriptions.Item label="姓名">{current?.name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="电话">{current?.phone ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            {current ? <Tag color={CUSTOMER_STATUS_COLOR[current.status]}>{CUSTOMER_STATUS_LABEL[current.status]}</Tag> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="小区">{current?.community || '—'}</Descriptions.Item>
          <Descriptions.Item label="房屋类型">{current?.houseType || '—'}</Descriptions.Item>
          <Descriptions.Item label="预算">{current?.budget != null ? `${current.budget} 万元` : '—'}</Descriptions.Item>
          <Descriptions.Item label="来源">{current?.source || '—'}</Descriptions.Item>
          <Descriptions.Item label="建档时间">{current ? dayjs(current.createdAt).format('YYYY-MM-DD HH:mm') : '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="跟进记录" size="small" extra={<Typography.Text type="secondary">时间轴</Typography.Text>}>
        <Form form={followForm} layout="inline" size="small" style={{ marginBottom: 12 }}>
          <Form.Item name="content" rules={[{ required: true, message: '请输入跟进内容' }]} style={{ flex: 1 }}>
            <Input placeholder="本次跟进内容…" />
          </Form.Item>
          <Form.Item name="nextFollowDate">
            <DatePicker placeholder="下次跟进日期" />
          </Form.Item>
          <Button type="primary" size="small" onClick={() => void submitFollow()}>
            添加跟进
          </Button>
        </Form>
        {followUps.length ? (
          <Timeline items={timelineItems} style={{ marginTop: 8 }} />
        ) : (
          <Typography.Text type="secondary">暂无跟进记录</Typography.Text>
        )}
      </Card>

      <Card
        title="关联设计方案（Konva）"
        size="small"
        extra={
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onNewScheme}>
            新建方案
          </Button>
        }
      >
        <Table<DesignScheme> rowKey="id" size="small" dataSource={schemes} columns={schemeColumns} pagination={false} locale={{ emptyText: '暂无方案，点击「新建方案」进入设计器并将画布数据保存到云端' }} />
      </Card>

      <Card
        title="订单"
        size="small"
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={() => setOrderOpen(true)}>
            新建订单
          </Button>
        }
      >
        <Table<Order> rowKey="id" size="small" dataSource={orders} columns={orderColumns} pagination={false} locale={{ emptyText: '暂无订单' }} />
      </Card>

      <CustomerFormModal open={editOpen} initial={current} onCancel={() => setEditOpen(false)} onSubmit={submitEdit} />

      <Modal title="新建订单" open={orderOpen} onCancel={() => setOrderOpen(false)} onOk={() => void submitOrder()} okText="创建" cancelText="取消" destroyOnClose width={480}>
        <Form form={orderForm} layout="vertical" size="small" style={{ marginTop: 12 }}>
          <Form.Item label="关联方案（可选）" name="schemeId">
            <Select allowClear placeholder="选择方案" options={schemes.map((s) => ({ value: s.id, label: `${s.name}（${s.totalWidth}×${s.totalHeight}）` }))} />
          </Form.Item>
          <Form.Item label="总金额（元）" name="totalAmount" rules={[{ required: true, message: '请输入总金额' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
            <Form.Item label="定金（元）" name="deposit">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="尾款（元）" name="balance">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
