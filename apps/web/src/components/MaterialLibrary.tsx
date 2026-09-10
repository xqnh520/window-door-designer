import { useState } from 'react';
import { Button, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { MaterialCategoryLabel, MaterialStatusLabel, type IMaterial, type MaterialCategory } from '@wdd/schema';
import { ProfileCategoryLabel, type ProfileCategory } from '@wdd/schema';
import { useStore } from '../store';
import { MaterialFormModal, type MaterialFormValues } from './MaterialForm';

const LS_KEY = 'wdd-materials-catalog';

function loadLocal(): IMaterial[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as IMaterial[]) : [];
  } catch {
    return [];
  }
}

function persistLocal(list: IMaterial[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略本地存储失败 */
  }
}

function newMaterialId(): string {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '';
  return uuid || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MaterialLibrary() {
  const library = useStore((s) => s.library);
  // 物料档案（本地持久化演示；对接服务端时可替换为 api.ts 的 fetchMaterials/createMaterial/updateMaterial/deleteMaterial）
  const [materials, setMaterials] = useState<IMaterial[]>(loadLocal);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IMaterial | null>(null);

  const saveList = (next: IMaterial[]) => {
    setMaterials(next);
    persistLocal(next);
  };

  const handleSubmit = (values: MaterialFormValues) => {
    const now = new Date().toISOString();
    if (editing) {
      saveList(materials.map((m) => (m.id === editing.id ? { ...m, ...values, updatedAt: now, updatedBy: 'webshell' } : m)));
      message.success('物料已更新');
    } else {
      const material: IMaterial = {
        id: newMaterialId(),
        ...values,
        createdAt: now,
        updatedAt: now,
        createdBy: 'webshell',
        isDeleted: false,
      };
      if (materials.some((m) => m.code === material.code)) {
        message.error(`物料编码 ${material.code} 已存在`);
        return;
      }
      saveList([material, ...materials]);
      message.success('物料已新增');
    }
    setModalOpen(false);
    setEditing(null);
  };

  const toggleStatus = (m: IMaterial) => {
    const next = m.status === 'active' ? 'inactive' : 'active';
    saveList(materials.map((x) => (x.id === m.id ? { ...x, status: next, updatedAt: new Date().toISOString() } : x)));
  };

  const archivalColumns = [
    { title: '编码', dataIndex: 'code', width: 150 },
    { title: '名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'category', width: 76, render: (v: MaterialCategory) => MaterialCategoryLabel[v] },
    { title: '规格型号', dataIndex: 'specModel', width: 130 },
    { title: '颜色', dataIndex: 'color', width: 120 },
    { title: '单位', dataIndex: 'unit', width: 76 },
    { title: '重量(kg)', dataIndex: 'weightKg', width: 96, align: 'right' as const, render: (v?: number) => (v == null ? '—' : v) },
    { title: '体积(m³)', dataIndex: 'volumeM3', width: 96, align: 'right' as const, render: (v?: number) => (v == null ? '—' : v) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 76,
      render: (v: IMaterial['status']) => <Tag color={v === 'active' ? 'green' : 'default'}>{MaterialStatusLabel[v]}</Tag>,
    },
    {
      title: '操作',
      width: 130,
      render: (_: unknown, m: IMaterial) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => { setEditing(m); setModalOpen(true); }}>
            编辑
          </Button>
          <Button size="small" type="link" danger={m.status === 'active'} onClick={() => toggleStatus(m)}>
            {m.status === 'active' ? '停用' : '启用'}
          </Button>
        </Space>
      ),
    },
  ];

  const profileColumns = [
    { title: '系列', dataIndex: 'seriesId', render: (v: string) => library.series.find((s) => s.id === v)?.name ?? v },
    { title: '编码', dataIndex: 'code', width: 110 },
    { title: '名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'category', render: (v: ProfileCategory) => ProfileCategoryLabel[v], width: 90 },
    { title: '断面宽(mm)', dataIndex: 'sectionWidth', width: 110, align: 'right' as const },
    { title: '料宽(mm)', width: 170, render: (_: unknown, p: (typeof library.profiles)[number]) => {
      const s = library.series.find((x) => x.id === p.seriesId);
      const ss = s?.showSetting ?? {};
      const fmt = (k: string) => (ss[k] != null ? String(ss[k]) : '—');
      return `框 ${fmt('frame')} / 扇 ${fmt('sash')} / 压线 ${fmt('bead')}`;
    } },
    { title: '单价(元/m)', dataIndex: 'unitPrice', width: 110, align: 'right' as const },
    { title: '颜色', dataIndex: 'color', width: 90 },
  ];

  const glassColumns = [
    { title: '名称', dataIndex: 'name' },
    { title: '厚度(mm)', dataIndex: 'thickness', width: 110 },
    { title: '层数', dataIndex: 'layers', width: 90 },
    { title: '单价(元/㎡)', dataIndex: 'unitPrice', width: 120, align: 'right' as const },
  ];

  const hardwareColumns = [
    { title: '编码', dataIndex: 'code', width: 110 },
    { title: '名称', dataIndex: 'name' },
    { title: '单位', dataIndex: 'unit', width: 90 },
    { title: '单价(元)', dataIndex: 'unitPrice', width: 110, align: 'right' as const },
  ];

  const accessoryColumns = [
    { title: '编码', dataIndex: 'code', width: 110 },
    { title: '名称', dataIndex: 'name' },
    { title: '单位', dataIndex: 'unit', width: 90 },
    { title: '用量(/㎡)', dataIndex: 'perM2', width: 110, align: 'right' as const },
    { title: '单价(元)', dataIndex: 'unitPrice', width: 110, align: 'right' as const },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>材料库</Typography.Title>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setEditing(null); setModalOpen(true); }}>
          新增物料
        </Button>
      </div>
      <div style={{ height: 12 }} />
      <Tabs
        items={[
          {
            key: 'archival',
            label: `物料档案 (${materials.length})`,
            children: (
              <Table
                size="small"
                rowKey="id"
                dataSource={materials}
                columns={archivalColumns}
                pagination={false}
                locale={{ emptyText: '暂无物料档案，点击右上角「新增物料」创建（编码自动生成）' }}
              />
            ),
          },
          {
            key: 'profile',
            label: `型材 (${library.profiles.length})`,
            children: <Table size="small" rowKey="id" dataSource={library.profiles} columns={profileColumns} pagination={false} />,
          },
          {
            key: 'glass',
            label: `玻璃 (${library.glass.length})`,
            children: <Table size="small" rowKey="id" dataSource={library.glass} columns={glassColumns} pagination={false} />,
          },
          {
            key: 'hardware',
            label: `五金 (${library.hardware.length})`,
            children: <Table size="small" rowKey="id" dataSource={library.hardware} columns={hardwareColumns} pagination={false} />,
          },
          {
            key: 'accessory',
            label: `辅料 (${library.accessory.length})`,
            children: <Table size="small" rowKey="id" dataSource={library.accessory} columns={accessoryColumns} pagination={false} />,
          },
        ]}
      />
      {/* 新增 / 编辑物料弹窗（Ant Design 表单） */}
      <MaterialFormModal
        open={modalOpen}
        initial={editing}
        existingCodes={materials.map((m) => m.code)}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
