import { useMemo, useState } from 'react';
import { Button, Empty, Space, Table, Tag, Typography } from 'antd';
import { bomToCsv, computeBomFromDesignModel } from '@wdd/core';
import type { DesignModel } from '@wdd/schema';
import { selectCurrentDesignName, selectCurrentSeriesId, useStore } from '../store';
import { downloadText } from '../util/download';
import { projectAssembly } from '../canvas/modelProjection';
import { BatchPickModal } from '../warehouse/BatchPickModal';

const CATEGORY_LABEL: Record<string, string> = {
  profile: '型材',
  glass: '玻璃',
  hardware: '五金',
  accessory: '辅料',
};

const CATEGORY_COLOR: Record<string, string> = {
  profile: 'blue',
  glass: 'cyan',
  hardware: 'orange',
  accessory: 'green',
};

export function BomTable({ modelOverride }: { modelOverride?: DesignModel | null }) {
  const [pickOpen, setPickOpen] = useState(false);
  const designName = useStore(selectCurrentDesignName);
  const seriesId = useStore(selectCurrentSeriesId);
  const library = useStore((s) => s.library);
  const assembly = useStore((s) => s.assembly);
  const series = library.series.find((s) => s.id === seriesId) ?? library.series[0];

  const bom = useMemo(() => {
    const model = modelOverride !== undefined ? modelOverride : projectAssembly(assembly);
    return model ? computeBomFromDesignModel(model, series, library) : null;
  }, [series, library, assembly, modelOverride]);

  if (!bom) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="画布为空，暂无材料清单" />;

  const dataSource = bom.items.map((item, i) => ({ ...item, index: i + 1 }));

  const columns = [
    { title: '#', dataIndex: 'index', width: 48 },
    {
      title: '分类',
      dataIndex: 'category',
      width: 72,
      render: (v: string) => <Tag color={CATEGORY_COLOR[v] ?? 'default'}>{CATEGORY_LABEL[v] ?? v}</Tag>,
    },
    { title: '名称', dataIndex: 'name', width: 150 },
    { title: '编码', dataIndex: 'code', width: 110 },
    { title: '规格', dataIndex: 'spec', width: 150 },
    { title: '单位', dataIndex: 'unit', width: 64 },
    { title: '数量', dataIndex: 'quantity', width: 90 },
    { title: '单价(元)', dataIndex: 'unitPrice', width: 100, align: 'right' as const },
    { title: '金额(元)', dataIndex: 'amount', width: 100, align: 'right' as const },
  ];

  const exportBom = () => {
    downloadText(`${designName}-材料清单.csv`, bomToCsv(bom, `${designName} 门窗材料清单`));
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Typography.Title level={5} style={{ margin: 0 }}>材料清单 / BOM</Typography.Title>
        <Space>
          <Typography.Text type="secondary">计价面积 {bom.billedAreaM2}㎡</Typography.Text>
          <Button size="small" onClick={exportBom}>导出材料清单</Button>
          <Button size="small" type="primary" onClick={() => setPickOpen(true)}>领料出库</Button>
        </Space>
      </Space>
      <Table
        size="small"
        rowKey="key"
        dataSource={dataSource}
        columns={columns}
        pagination={false}
        scroll={{ x: 1000 }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={8}>
              <Typography.Text strong>合计 (单樘)</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={8} align="right">
              <Typography.Text strong>¥ {bom.totalAmount.toFixed(2)}</Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
      <BatchPickModal
        open={pickOpen}
        bomItems={bom.items}
        designName={designName}
        onCancel={() => setPickOpen(false)}
        onDone={() => setPickOpen(false)}
      />
    </div>
  );
}
