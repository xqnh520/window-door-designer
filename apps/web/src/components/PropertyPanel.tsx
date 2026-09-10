import { Form, InputNumber, Select, Typography } from 'antd';
import { useStore } from '../store';

export function PropertyPanel() {
  const library = useStore((s) => s.library);
  const seriesId = useStore((s) => s.design.seriesId);
  const openingW = useStore((s) => s.openingW);
  const openingH = useStore((s) => s.openingH);
  const windowCount = useStore((s) => s.windowCount);
  const glassId = useStore((s) => s.design.glassId);
  const setSeries = useStore((s) => s.setSeries);
  const setOpeningSize = useStore((s) => s.setOpeningSize);
  const setGlass = useStore((s) => s.setGlass);
  const setWindowCount = useStore((s) => s.setWindowCount);

  return (
    <div>
      <Typography.Title level={5}>参数设置</Typography.Title>
      <Form layout="vertical" size="small">
        <Form.Item label="型材系列">
          <Select
            value={seriesId}
            onChange={setSeries}
            options={library.series.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Form.Item>
        <Form.Item label="洞口宽 (mm)">
          <InputNumber
            min={300}
            max={6000}
            step={10}
            value={openingW}
            style={{ width: '100%' }}
            onChange={(v) => v && setOpeningSize(v, openingH)}
          />
        </Form.Item>
        <Form.Item label="洞口高 (mm)">
          <InputNumber
            min={300}
            max={4000}
            step={10}
            value={openingH}
            style={{ width: '100%' }}
            onChange={(v) => v && setOpeningSize(openingW, v)}
          />
        </Form.Item>
        <Form.Item label="玻璃规格">
          <Select
            value={glassId}
            onChange={setGlass}
            options={library.glass.map((g) => ({ value: g.id, label: g.name }))}
          />
        </Form.Item>
        <Form.Item label="窗数量">
          <InputNumber
            min={1}
            max={999}
            value={windowCount}
            style={{ width: '100%' }}
            onChange={(v) => v && setWindowCount(v)}
          />
        </Form.Item>
      </Form>
    </div>
  );
}