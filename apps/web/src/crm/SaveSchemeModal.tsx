/**
 * 保存方案 —— 归属客户守卫弹窗
 * 未选择客户时点击保存触发：选择已有客户 / 新建客户信息 / 取消退出
 */
import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Segmented, Select, message } from 'antd';
import { useCrmStore } from './store';

export function SaveSchemeModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  /** 返回已确认的客户 id（选择或新建成功） */
  onConfirm: (customerId: string) => void;
}) {
  const customers = useCrmStore((s) => s.customers);
  const fetchCustomers = useCrmStore((s) => s.fetchCustomers);
  const createCustomer = useCrmStore((s) => s.createCustomer);
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    setMode('pick');
    setSelectedId(undefined);
    form.resetFields();
    if (!useCrmStore.getState().customers.length) {
      void fetchCustomers({ page: 1, pageSize: 100 });
    }
  }, [open, fetchCustomers, form]);

  const confirm = async () => {
    if (mode === 'pick') {
      if (!selectedId) {
        message.warning('请先选择客户');
        return;
      }
      onConfirm(selectedId);
      return;
    }
    const values = await form.validateFields();
    setCreating(true);
    try {
      const created = await createCustomer({ name: values.name, phone: values.phone, community: values.community });
      message.success(`客户 ${created.name} 已建档`);
      onConfirm(created.id);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="保存方案 — 请选择归属客户"
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消 / 退出
        </Button>,
        <Button key="ok" type="primary" loading={creating} onClick={() => void confirm()}>
          保存到该客户
        </Button>,
      ]}
      destroyOnClose
      width={520}
    >
      <p style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>
        保存方案必须归属到客户，否则方案无法关联。请选择已有客户、新建客户信息，或点击「取消 / 退出」返回。
      </p>
      <Segmented
        block
        style={{ marginBottom: 12 }}
        options={[
          { label: '选择已有客户', value: 'pick' },
          { label: '新建客户', value: 'create' },
        ]}
        value={mode}
        onChange={(v) => setMode(v as 'pick' | 'create')}
      />
      {mode === 'pick' ? (
        <Select
          autoFocus
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          placeholder="选择客户（支持搜索）"
          value={selectedId}
          onChange={setSelectedId}
          options={customers.map((c) => ({ value: c.id, label: `${c.name}（${c.phone}）` }))}
        />
      ) : (
        <Form form={form} layout="vertical" size="small">
          <Form.Item label="客户姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如：张三" />
          </Form.Item>
          <Form.Item label="联系电话" name="phone" rules={[{ required: true, message: '请输入电话' }]}>
            <Input placeholder="如：13800138000" />
          </Form.Item>
          <Form.Item label="小区（可选）" name="community">
            <Input />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
