/**
 * 仓库设置：仓库列表 + 新建/编辑弹窗。
 * 库位用 Select mode="tags" 自由录入，服务端统一去空白 / 转大写 / 去重；
 * 删除库位前服务端会校验该库位是否仍有结存。
 */
import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Tooltip, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { MaterialStatusLabel, type MaterialStatus } from '@wdd/schema';
import { useWarehouseStore } from './store';
import type { Warehouse } from './types';

interface FormValues {
  code?: string;
  name: string;
  address?: string;
  manager?: string;
  phone?: string;
  locations: string[];
  isDefault: boolean;
  status: MaterialStatus;
  remark?: string;
}

export function WarehouseSettings() {
  const warehouses = useWarehouseStore((s) => s.warehouses);
  const loading = useWarehouseStore((s) => s.loadingWarehouses);
  const loadWarehouses = useWarehouseStore((s) => s.loadWarehouses);
  const saveWarehouse = useWarehouseStore((s) => s.saveWarehouse);
  const removeWarehouse = useWarehouseStore((s) => s.removeWarehouse);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  useEffect(() => {
    if (!modalOpen) return;
    form.resetFields();
    form.setFieldsValue({
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      address: editing?.address ?? '',
      manager: editing?.manager ?? '',
      phone: editing?.phone ?? '',
      locations: editing?.locations ?? [],
      isDefault: editing?.isDefault ?? warehouses.length === 0,
      status: editing?.status ?? 'active',
      remark: editing?.remark ?? '',
    });
  }, [modalOpen, editing, warehouses.length, form]);

  const handleOk = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      await saveWarehouse(values, editing?.id);
      message.success(editing ? '仓库已更新' : '仓库已新增');
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const setDefault = async (w: Warehouse) => {
    try {
      await saveWarehouse({ isDefault: true }, w.id);
      message.success(`已将 ${w.name} 设为默认仓`);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns = [
    { title: '编码', dataIndex: 'code', width: 90 },
    { title: '名称', dataIndex: 'name', width: 150 },
    {
      title: '库位',
      dataIndex: 'locations',
      render: (locs: string[]) =>
        locs.length ? (
          <Space size={[4, 4]} wrap>
            {locs.map((l) => <Tag key={l}>{l}</Tag>)}
          </Space>
        ) : (
          <Tooltip title="没有库位就无法出入库，请先编辑补上">
            <Tag color="orange">未设置</Tag>
          </Tooltip>
        ),
    },
    {
      title: '默认仓',
      dataIndex: 'isDefault',
      width: 96,
      render: (v: boolean, w: Warehouse) =>
        v ? <Tag color="blue">默认</Tag> : <Button size="small" type="link" onClick={() => void setDefault(w)}>设为默认</Button>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 76,
      render: (v: MaterialStatus) => <Tag color={v === 'active' ? 'green' : 'default'}>{MaterialStatusLabel[v]}</Tag>,
    },
    { title: '负责人', dataIndex: 'manager', width: 90, render: (v?: string) => v || '—' },
    { title: '电话', dataIndex: 'phone', width: 120, render: (v?: string) => v || '—' },
    { title: '地址', dataIndex: 'address', render: (v?: string) => v || '—' },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, w: Warehouse) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => { setEditing(w); setModalOpen(true); }}>编辑</Button>
          <Popconfirm
            title="删除仓库？"
            description="有结存库存或仅剩一个仓库时会被拒绝"
            onConfirm={async () => {
              try {
                await removeWarehouse(w.id);
                message.success('已删除');
              } catch (err) {
                message.error((err as Error).message);
              }
            }}
          >
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditing(null); setModalOpen(true); }}
        >
          新建仓库
        </Button>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>
          共 {warehouses.length} 个仓库；出入库必须指定仓库与库位
        </span>
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={warehouses}
        columns={columns}
        pagination={false}
        scroll={{ x: 1100 }}
        locale={{ emptyText: '暂无仓库，点「新建仓库」创建（首个仓库会自动成为默认仓）' }}
      />

      <Modal
        title={editing ? `编辑仓库 ${editing.code}` : '新建仓库'}
        open={modalOpen}
        onOk={handleOk}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={620}
      >
        <Form form={form} layout="vertical" size="small" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', columnGap: 12 }}>
            <Form.Item label="仓库编码" name="code" extra={editing ? undefined : '留空自动生成 WH01 / WH02 …'}>
              <Input placeholder="WH01" disabled={!!editing} />
            </Form.Item>
            <Form.Item label="仓库名称" name="name" rules={[{ required: true, message: '请输入仓库名称' }]}>
              <Input placeholder="如：主仓库 / 型材仓 / 成品仓" />
            </Form.Item>
          </div>

          <Form.Item
            label="库位编码"
            name="locations"
            extra="回车或逗号分隔录入，如 A-01-01；删除仍有结存的库位会被拒绝"
          >
            <Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="A-01-01" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 12 }}>
            <Form.Item label="负责人" name="manager">
              <Input />
            </Form.Item>
            <Form.Item label="联系电话" name="phone">
              <Input />
            </Form.Item>
            <Form.Item label="状态" name="status">
              <Radio.Group
                options={(['active', 'inactive'] as MaterialStatus[]).map((s) => ({
                  value: s,
                  label: MaterialStatusLabel[s],
                }))}
              />
            </Form.Item>
          </div>

          <Form.Item label="地址" name="address">
            <Input />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', columnGap: 12 }}>
            <Form.Item label="默认仓" name="isDefault" valuePropName="checked" extra="全库仅一个">
              <Switch size="small" />
            </Form.Item>
            <Form.Item label="备注" name="remark">
              <Input />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
