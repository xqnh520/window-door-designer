/**
 * 客户建档 / 编辑弹窗（Ant Design 表单）
 */
import { useEffect } from 'react';
import { Form, Input, InputNumber, Modal, Select } from 'antd';
import { CUSTOMER_STATUS_LABEL, HOUSE_TYPES, LEAD_SOURCES, type Customer, type CustomerStatus } from './types';

export interface CustomerFormValues {
  name: string;
  phone: string;
  community?: string;
  houseType?: string;
  budget?: number;
  source?: string;
  status: CustomerStatus;
}

export function CustomerFormModal({
  open,
  initial,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initial?: Customer | null;
  onCancel: () => void;
  onSubmit: (values: CustomerFormValues) => void;
}) {
  const [form] = Form.useForm<CustomerFormValues>();

  useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue({
        name: initial.name,
        phone: initial.phone,
        community: initial.community ?? undefined,
        houseType: initial.houseType ?? undefined,
        budget: initial.budget ?? undefined,
        source: initial.source ?? undefined,
        status: initial.status,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ status: 'C_COLD' });
    }
  }, [open, initial, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit(values);
  };

  return (
    <Modal
      title={initial ? '编辑客户' : '新建客户'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      destroyOnClose
      width={560}
    >
      <Form form={form} layout="vertical" size="small" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="客户姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如：张三" />
          </Form.Item>
          <Form.Item label="联系电话" name="phone" rules={[{ required: true, message: '请输入电话' }]}>
            <Input placeholder="如：13800138000" />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="小区" name="community">
            <Input placeholder="如：阳光花园 3 栋" />
          </Form.Item>
          <Form.Item label="房屋类型" name="houseType">
            <Select allowClear placeholder="新房/旧改/别墅" options={HOUSE_TYPES.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="预算（万元）" name="budget">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="如：10" />
          </Form.Item>
          <Form.Item label="客户来源" name="source">
            <Select allowClear placeholder="自然进店/转介绍/抖音…" options={LEAD_SOURCES.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
        </div>
        <Form.Item label="客户状态" name="status" rules={[{ required: true }]}>
          <Select
            options={(Object.keys(CUSTOMER_STATUS_LABEL) as CustomerStatus[]).map((s) => ({
              value: s,
              label: CUSTOMER_STATUS_LABEL[s],
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
