import { useMemo } from 'react';
import { Button, Divider, Empty, Space, Table, Typography } from 'antd';
import { computeBomFromDesignModel, computeCuttingList, cuttingPackToCsv, cuttingToCsv } from '@wdd/core';
import type { DesignModel } from '@wdd/schema';
import { selectCurrentDesignName, selectCurrentSeriesId, useStore } from '../store';
import { downloadText } from '../util/download';
import { projectAssembly } from '../canvas/modelProjection';

export function CuttingListTable({ modelOverride }: { modelOverride?: DesignModel | null }) {
  const designName = useStore(selectCurrentDesignName);
  const seriesId = useStore(selectCurrentSeriesId);
  const library = useStore((s) => s.library);
  const assembly = useStore((s) => s.assembly);
  const series = library.series.find((s) => s.id === seriesId) ?? library.series[0];

  const cutting = useMemo(() => {
    const model = modelOverride !== undefined ? modelOverride : projectAssembly(assembly);
    return model ? computeCuttingList(computeBomFromDesignModel(model, series, library), series) : null;
  }, [series, library, assembly, modelOverride]);

  if (!cutting) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="画布为空，暂无下料数据" />;

  const exportItems = () => {
    downloadText(`${designName}-下料明细.csv`, cuttingToCsv(cutting, `${designName} 门窗下料明细`));
  };
  const exportPacks = () => {
    downloadText(`${designName}-排料单.csv`, cuttingPackToCsv(cutting, `${designName} 门窗排料单`));
  };

  const packRows = cutting.packs.map((pack, i) => ({ ...pack, index: i + 1 }));
  const itemRows = cutting.items.map((item, i) => ({ ...item, index: i + 1 }));
  const reusableRemnants = cutting.remnants.filter((r) => r.reusable);

  const packColumns = [
    { title: '#', dataIndex: 'index', width: 48 },
    { title: '型材', dataIndex: 'name', width: 140 },
    { title: '编码', dataIndex: 'code', width: 110 },
    { title: '颜色', dataIndex: 'color', width: 80 },
    { title: '原料长度', dataIndex: 'stockLengthMm', width: 90 },
    { title: '已用长度', dataIndex: 'usedLengthMm', width: 90 },
    { title: '余料', dataIndex: 'wasteLengthMm', width: 80 },
    {
      title: '切割明细',
      dataIndex: 'cuts',
      render: (cuts: { lengthMm: number; quantity: number; position: string }[]) => (
        <Space direction="vertical" size={2}>
          {cuts.map((cut, idx) => (
            <Typography.Text key={idx} style={{ fontSize: 12 }}>
              {cut.position} · {cut.lengthMm}mm × {cut.quantity}
            </Typography.Text>
          ))}
        </Space>
      ),
    },
  ];

  const itemColumns = [
    { title: '#', dataIndex: 'index', width: 44 },
    { title: '型材', dataIndex: 'name', width: 110 },
    { title: '编码', dataIndex: 'code', width: 100 },
    { title: '颜色', dataIndex: 'color', width: 70 },
    { title: '长度(mm)', dataIndex: 'lengthMm', width: 90 },
    { title: '数量', dataIndex: 'quantity', width: 60 },
    { title: '左切角', dataIndex: 'cutAngleLeft', width: 64 },
    { title: '右切角', dataIndex: 'cutAngleRight', width: 64 },
    { title: '位置', dataIndex: 'position', width: 90 },
    { title: '来源构件', dataIndex: 'sourceComponentId', width: 130 },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Typography.Title level={5} style={{ margin: 0 }}>生产下料单 / 排料</Typography.Title>
        <Space>
          <Typography.Text type="secondary">总根数 {cutting.totalPieces}</Typography.Text>
          <Typography.Text type="secondary">总长度 {cutting.totalLengthMm}mm</Typography.Text>
          <Button size="small" onClick={exportItems}>导出下料明细</Button>
          <Button size="small" onClick={exportPacks}>导出排料单</Button>
        </Space>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
        总原料 {cutting.totalStockLengthMm}mm · 总余料 <Typography.Text strong style={{ fontSize: 12 }}>{cutting.totalWasteMm}mm</Typography.Text> · 可再利用余料{' '}
        <Typography.Text strong style={{ fontSize: 12, color: '#389e0d' }}>{cutting.reusableWasteMm}mm</Typography.Text> · 总利用率{' '}
        {(cutting.utilizationRate * 100).toFixed(1)}%
      </Typography.Text>
      <Divider style={{ margin: '10px 0 8px' }}>逐根下料明细（可追溯构件）</Divider>
      <Table
        size="small"
        rowKey={(row) => row.sourceComponentId + row.lengthMm + row.index}
        dataSource={itemRows}
        columns={itemColumns}
        pagination={false}
        scroll={{ x: 900 }}
      />
      <Divider style={{ margin: '12px 0 8px' }}>排料方案（按原料）</Divider>
      <Table
        size="small"
        rowKey={(row) => `${row.code}-${row.index}`}
        dataSource={packRows}
        columns={packColumns}
        pagination={false}
        scroll={{ x: 1000 }}
        expandable={{
          expandedRowRender: (pack) => (
            <Space direction="vertical" size={2} style={{ marginLeft: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                利用率 {pack.stockLengthMm > 0 ? `${Math.round((pack.usedLengthMm / pack.stockLengthMm) * 100)}%` : '0%'} · 原料 {pack.stockLengthMm}mm · 已用 {pack.usedLengthMm}mm · 余料 {pack.wasteLengthMm}mm
              </Typography.Text>
              {pack.cuts.map((cut, idx) => (
                <Typography.Text key={idx} style={{ fontSize: 12 }}>
                  {cut.sourceComponentId} · {cut.position} · {cut.lengthMm}mm
                </Typography.Text>
              ))}
            </Space>
          ),
          rowExpandable: () => true,
        }}
      />
      {reusableRemnants.length > 0 && (
        <>
          <Divider style={{ margin: '12px 0 8px' }}>可再利用余料（≥300mm）</Divider>
          <Space wrap size={[4, 4]}>
            {reusableRemnants.map((r, idx) => (
              <Typography.Text key={idx} style={{ fontSize: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, padding: '2px 6px' }}>
                {r.name} {r.lengthMm}mm
              </Typography.Text>
            ))}
          </Space>
        </>
      )}
    </div>
  );
}
