import { useMemo, useState } from 'react';
import { Button, Divider, Empty, Form, Input, InputNumber, List, Select, Space, Typography, message } from 'antd';
import { computeBomFromDesignModel, quoteToCsv, quoteFromDesignModel, defaultQuoteRuleSet } from '@wdd/core';
import type { DesignModel } from '@wdd/schema';
import { selectCurrentDesignName, selectCurrentSeriesId, useStore } from '../store';
import { downloadText } from '../util/download';
import { createOrder } from '../api';
import { projectAssembly } from '../canvas/modelProjection';

/** 报价策略：成本加成（默认，叠加加价项） / 面积单价（与 BOM 解耦，按洞口面积×单价） */
const QUOTE_RULES = {
  ...defaultQuoteRuleSet,
  colorUpcharges: { 咖啡色: 30, 木纹转印: 60, 白色: 0 },
  hardwareUpcharges: { 进口五金: 500, 国产中高端: 200, 国产五金: 0 },
  sashUpcharge: 150,
  specialShapeUpcharge: 300,
  packagingPerUnit: 100,
  transportPerM2: 6,
};

export function QuotePanel({ modelOverride }: { modelOverride?: DesignModel | null }) {
  const designName = useStore(selectCurrentDesignName);
  const seriesId = useStore(selectCurrentSeriesId);
  const library = useStore((s) => s.library);
  const windowCount = useStore((s) => s.windowCount);
  const discountRate = useStore((s) => s.discountRate);
  const setDiscountRate = useStore((s) => s.setDiscountRate);
  const assembly = useStore((s) => s.assembly);
  const orderConfig = useStore((s) => s.orderConfig);
  const [strategy, setStrategy] = useState<'cost' | 'area'>('cost');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const series = library.series.find((s) => s.id === seriesId) ?? library.series[0];

  const result = useMemo(() => {
    const model = modelOverride !== undefined ? modelOverride : projectAssembly(assembly);
    if (!model) return null;
    const b = computeBomFromDesignModel(model, series, library);
    // 报价业务上下文：开启扇数 / 异形形状 / 颜色 / 五金档位 / 玻璃规格
    const sashCount =
      model?.components.filter((c) => c.kind === 'casementSash' || c.kind === 'slidingSash' || c.kind === 'topHungSash').length ?? 0;
    const specialShape =
      !!model?.components.find((c) => c.kind === 'outerFrame' && c.shape && c.shape !== 'rect');
    const rules =
      strategy === 'area'
        ? { ...QUOTE_RULES, areaPricePerM2: orderConfig.unitPrice || 680 }
        : QUOTE_RULES;
    const q = quoteFromDesignModel(model, b, rules, windowCount, discountRate, {
      sashCount,
      specialShape,
      color: orderConfig.outerColor,
      hardware: orderConfig.hardware,
      glassId: model.glassId,
    });
    return { bom: b, quote: q, model };
  }, [series, library, windowCount, discountRate, assembly, strategy, orderConfig, modelOverride]);

  if (!result) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="画布为空，暂无报价" />;
  const { bom, quote, model } = result;

  const exportQuote = () => {
    downloadText(`${designName}-报价单.csv`, quoteToCsv(quote, `${designName} 门窗报价单`));
  };

  const submitOrder = async () => {
    if (!customer.trim()) {
      message.warning('请填写客户名称');
      return;
    }
    setSubmitting(true);
    try {
      await createOrder({
        customer: customer.trim(),
        phone: phone.trim() || undefined,
        designName: model.name,
        designId: model.id,
        openingW: model.openingW,
        openingH: model.openingH,
        seriesId: model.seriesId,
        total: quote.total,
        bom: bom.items,
      });
      message.success('订单已提交');
      setCustomer('');
      setPhone('');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Typography.Title level={5} style={{ margin: 0 }}>报价</Typography.Title>
        <Space size={6}>
          <Select
            size="small"
            value={strategy}
            onChange={setStrategy}
            style={{ width: 116 }}
            options={[
              { value: 'cost', label: '材料成本加成' },
              { value: 'area', label: '面积单价' },
            ]}
          />
          <Button size="small" onClick={exportQuote}>导出报价单</Button>
        </Space>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        计价方式：{quote.mode === 'area' ? `面积单价 ¥${orderConfig.unitPrice || 680}/㎡（按洞口面积，不依赖材料 BOM）` : '材料成本加成（型材/玻璃/五金 + 加工 + 加价项）'}
      </Typography.Text>
      <List
        size="small"
        dataSource={quote.lines}
        renderItem={(line) => (
          <List.Item extra={<Typography.Text strong style={{ color: line.amount < 0 ? '#1677ff' : undefined }}>¥ {line.amount.toFixed(2)}</Typography.Text>}>
            <List.Item.Meta title={line.name} description={`${line.detail} × ${line.quantity}`} />
          </List.Item>
        )}
      />
      <Divider style={{ margin: '8px 0' }} />
      <Typography.Text type="secondary">
        洞口面积 {quote.openingAreaM2}㎡ / 计价面积 {quote.billedAreaM2}㎡
      </Typography.Text>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <span>折扣</span>
        <InputNumber
          min={0}
          max={1}
          step={0.01}
          value={discountRate}
          style={{ width: 100 }}
          formatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
          parser={(s) => (s ? Number(s.replace('%', '')) / 100 : 0)}
          onChange={(v) => setDiscountRate(v ?? 0)}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <Typography.Text strong style={{ fontSize: 16 }}>总价 (×{windowCount}樘)</Typography.Text>
        <Typography.Text strong style={{ fontSize: 18, color: '#cf1322' }}>
          ¥ {quote.total.toFixed(2)}
        </Typography.Text>
      </div>

      <Divider style={{ margin: '12px 0' }}>生成订单</Divider>
      <Form layout="vertical" size="small">
        <Form.Item label="客户名称" style={{ marginBottom: 8 }}>
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="客户姓名 / 单位" />
        </Form.Item>
        <Form.Item label="联系电话" style={{ marginBottom: 8 }}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" />
        </Form.Item>
        <Button block type="primary" onClick={submitOrder} loading={submitting}>
          提交订单（保存至服务端）
        </Button>
      </Form>
    </div>
  );
}
