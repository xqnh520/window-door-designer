/**
 * 物料档案页签：直连服务端 /materials（与首页「型材系列 → 材料库」页的本地样例数据相互独立）
 * 复用 components/MaterialForm.tsx 的表单弹窗，提交走 warehouseApi 而非 localStorage。
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  MATERIAL_CATEGORIES,
  MaterialCategoryLabel,
  MaterialStatusLabel,
  type IMaterial,
  type MaterialCategory,
} from '@wdd/schema';
import { MaterialFormModal, type MaterialFormValues } from '../components/MaterialForm';
import { useWarehouseStore } from './store';

const date = (v?: string) => (v ? new Date(v).toLocaleDateString('zh-CN') : '—');

export function MaterialCatalogTab() {
  const materials = useWarehouseStore((s) => s.materials);
  const loading = useWarehouseStore((s) => s.loadingMaterials);
  const loadMaterials = useWarehouseStore((s) => s.loadMaterials);
  const saveMaterial = useWarehouseStore((s) => s.saveMaterial);
  const removeMaterial = useWarehouseStore((s) => s.removeMaterial);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IMaterial | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<MaterialCategory | undefined>();

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return materials.filter((m) => {
      if (category && m.category !== category) return false;
      if (!k) return true;
      return (
        m.name.toLowerCase().includes(k) ||
        m.code.toLowerCase().includes(k) ||
        m.specModel.toLowerCase().includes(k) ||
        (m.brand ?? '').toLowerCase().includes(k)
      );
    });
  }, [materials, keyword, category]);

  const handleSubmit = async (values: MaterialFormValues) => {
    try {
      await saveMaterial(values, editing?.id);
      message.success(editing ? '物料已更新' : '物料已新增');
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const toggleStatus = async (m: IMaterial) => {
    try {
      await saveMaterial({ status: m.status === 'active' ? 'inactive' : 'active' }, m.id);
      message.success(m.status === 'active' ? '已停用' : '已启用');
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns = [
    { title: '编码', dataIndex: 'code', width: 150 },
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '分类',
      dataIndex: 'category',
      width: 76,
      render: (v: MaterialCategory) => MaterialCategoryLabel[v],
    },
    { title: '规格型号', dataIndex: 'specModel', width: 130 },
    { title: '颜色', dataIndex: 'color', width: 110, render: (v: string) => v || '—' },
    { title: '单位', dataIndex: 'unit', width: 70 },
    { title: '品牌', dataIndex: 'brand', width: 110, render: (v: string) => v || '—' },
    {
      title: '重量(kg)',
      dataIndex: 'weightKg',
      width: 92,
      align: 'right' as const,
      render: (v?: number) => (v == null ? '—' : v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 76,
      render: (v: IMaterial['status']) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>{MaterialStatusLabel[v]}</Tag>
      ),
    },
    { title: '创建', dataIndex: 'createdAt', width: 104, render: date },
    {
      title: '操作',
      width: 168,
      fixed: 'right' as const,
      render: (_: unknown, m: IMaterial) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => { setEditing(m); setModalOpen(true); }}>
            编辑
          </Button>
          <Button size="small" type="link" danger={m.status === 'active'} onClick={() => void toggleStatus(m)}>
            {m.status === 'active' ? '停用' : '启用'}
          </Button>
          <Popconfirm
            title="删除物料档案？"
            description="逻辑删除，已有库存行将不再展示"
            onConfirm={async () => {
              try {
                await removeMaterial(m.id);
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
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="本页物料档案来自服务端，是库存与领料的唯一数据源"
        description="首页「型材系列 → 材料库」页展示的是本地样例库（用于 2D 算料），两者相互独立、互不同步。"
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          size="small"
          allowClear
          placeholder="编码 / 名称 / 规格 / 品牌"
          style={{ width: 220 }}
          onSearch={setKeyword}
          onChange={(e) => { if (!e.target.value) setKeyword(''); }}
        />
        <Select
          allowClear
          size="small"
          placeholder="全部分类"
          style={{ width: 120 }}
          value={category}
          onChange={setCategory}
          options={MATERIAL_CATEGORIES.map((c) => ({ value: c, label: MaterialCategoryLabel[c] }))}
        />
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditing(null); setModalOpen(true); }}
        >
          新增物料
        </Button>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>共 {rows.length} 条</span>
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 20, showSizeChanger: false, size: 'small' }}
        locale={{ emptyText: '暂无物料档案，点「新增物料」创建（编码可留空自动生成）' }}
      />

      <MaterialFormModal
        open={modalOpen}
        initial={editing}
        existingCodes={materials.map((m) => m.code)}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onSubmit={(values) => void handleSubmit(values)}
      />
    </div>
  );
}
