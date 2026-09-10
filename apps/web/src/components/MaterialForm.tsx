/**
 * 物料表单（Ant Design Modal 表单）— 依据 @wdd/schema 的 IMaterial 接口生成。
 *
 * 特性：
 * - 覆盖 IMaterial 全字段（含 ★ 补充的 重量 weightKg / 体积 volumeM3）
 * - 分类 / 单位 / 状态 用下拉与单选，避免裸字符串录入错误
 * - 物料编码：留空时自动生成（分类前缀-规格-序号，generateMaterialCode 实时预览）
 * - 编辑模式回填 initial 值；提交时由父组件补齐 id / 审计字段
 */
import { useEffect, useMemo } from 'react';
import { Form, Input, InputNumber, Modal, Radio, Select } from 'antd';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  MaterialCategoryLabel,
  MaterialStatusLabel,
  nextMaterialCode,
  type IMaterial,
  type MaterialCategory,
  type MaterialStatus,
  type MaterialUnit,
} from '@wdd/schema';

/** 表单提交值（不含 id / 审计字段，由父组件组装 IMaterial） */
export interface MaterialFormValues {
  code: string;
  name: string;
  category: MaterialCategory;
  specModel: string;
  color: string;
  unit: MaterialUnit;
  brand: string;
  status: MaterialStatus;
  weightKg?: number;
  volumeM3?: number;
  description?: string;
  barcode?: string;
}

export function MaterialFormModal({
  open,
  initial,
  existingCodes = [],
  onCancel,
  onSubmit,
}: {
  open: boolean;
  /** 编辑模式：传入已有物料回填；新增模式传 null */
  initial?: IMaterial | null;
  /** 已存在的物料编码（用于自动续号与查重提示） */
  existingCodes?: string[];
  onCancel: () => void;
  onSubmit: (values: MaterialFormValues) => void;
}) {
  const [form] = Form.useForm<MaterialFormValues>();

  // 打开时回填（编辑）/ 重置（新增）
  useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue({
        code: initial.code,
        name: initial.name,
        category: initial.category,
        specModel: initial.specModel,
        color: initial.color,
        unit: initial.unit,
        brand: initial.brand,
        status: initial.status,
        weightKg: initial.weightKg,
        volumeM3: initial.volumeM3,
        description: initial.description,
        barcode: initial.barcode,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ category: 'profile', unit: '米', status: 'active' });
    }
  }, [open, initial, form]);

  // 实时预览自动编码（分类 + 规格型号 联动）
  const category = Form.useWatch('category', form) as MaterialCategory | undefined;
  const specModel = Form.useWatch('specModel', form) as string | undefined;
  const code = Form.useWatch('code', form) as string | undefined;
  const suggestedCode = useMemo(() => {
    if (!open) return '';
    if (code?.trim()) return '';
    if (!category) return '';
    return nextMaterialCode(category, specModel ?? '', existingCodes.filter((c) => !initial || c !== initial.code));
  }, [open, code, category, specModel, existingCodes, initial]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit({
      ...values,
      // 编码留空 → 自动生成
      code: values.code?.trim() || suggestedCode,
    });
  };

  return (
    <Modal
      title={initial ? '编辑物料' : '新增物料'}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      destroyOnClose
      width={640}
    >
      <Form form={form} layout="vertical" size="small" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="物料分类" name="category" rules={[{ required: true, message: '请选择分类' }]}>
            <Select options={MATERIAL_CATEGORIES.map((c) => ({ value: c, label: MaterialCategoryLabel[c] }))} />
          </Form.Item>
          <Form.Item label="物料编码" name="code" extra={suggestedCode ? `留空自动生成：${suggestedCode}` : undefined}>
            <Input placeholder="留空自动生成" />
          </Form.Item>
        </div>

        <Form.Item label="物料名称" name="name" rules={[{ required: true, message: '请输入物料名称' }]}>
          <Input placeholder="如：6063-T5 银白氧化铝型材" />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="规格型号" name="specModel">
            <Input placeholder="如：60*40*1.5（参与编码生成）" />
          </Form.Item>
          <Form.Item label="颜色 / 表面处理" name="color">
            <Input placeholder="如：氟碳喷涂、木纹转印" />
          </Form.Item>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 12 }}>
          <Form.Item label="基本单位" name="unit" rules={[{ required: true, message: '请选择单位' }]}>
            <Select options={MATERIAL_UNITS.map((u) => ({ value: u, label: u }))} />
          </Form.Item>
          <Form.Item label="品牌 / 供应商" name="brand">
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="单件重量 (kg)" name="weightKg" extra="门窗材料按重量计价的必填">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="kg / 单位" />
          </Form.Item>
          <Form.Item label="单件体积 (m³)" name="volumeM3" extra="运输 / 仓储体积测算">
            <InputNumber min={0} step={0.001} style={{ width: '100%' }} placeholder="m³ / 单位" />
          </Form.Item>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12 }}>
          <Form.Item label="内部条形码 / 二维码" name="barcode">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="物料描述 / 备注" name="description">
            <Input placeholder="可选" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
