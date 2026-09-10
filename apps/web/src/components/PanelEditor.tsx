import { Button, Divider, Form, InputNumber, Select, Space, Switch, Typography } from 'antd';
import { WindowTypeLabel, type WindowType } from '@wdd/schema';
import { useStore } from '../store';

const TYPES: WindowType[] = ['fixed', 'casement', 'sliding', 'topHinged', 'casementUp', 'tiltSlide'];

export function PanelEditor() {
  const design = useStore((s) => s.design);
  const selectedPanelId = useStore((s) => s.selectedPanelId);
  const selectPanel = useStore((s) => s.selectPanel);
  const updatePanel = useStore((s) => s.updatePanel);
  const splitPanel = useStore((s) => s.splitPanel);
  const removePanel = useStore((s) => s.removePanel);

  const panel = design.panels.find((p) => p.id === selectedPanelId);
  if (!panel) return null;

  return (
    <div>
      <Typography.Title level={5}>扇面编辑</Typography.Title>
      <Form layout="vertical" size="small">
        <Form.Item label="窗型">
          <Select
            value={panel.windowType}
            onChange={(v: WindowType) => updatePanel(panel.id, { windowType: v })}
            options={TYPES.map((t) => ({ value: t, label: WindowTypeLabel[t] }))}
          />
        </Form.Item>
        <Form.Item label="带扇" valuePropName="checked">
          <Switch
            checked={panel.hasSash}
            onChange={(v) => updatePanel(panel.id, { hasSash: v })}
          />
        </Form.Item>
        <Space size={8} style={{ display: 'flex' }}>
          <Form.Item label="X">
            <InputNumber min={0} value={panel.x} onChange={(v) => updatePanel(panel.id, { x: v ?? 0 })} />
          </Form.Item>
          <Form.Item label="Y">
            <InputNumber min={0} value={panel.y} onChange={(v) => updatePanel(panel.id, { y: v ?? 0 })} />
          </Form.Item>
        </Space>
        <Space size={8} style={{ display: 'flex' }}>
          <Form.Item label="宽 W">
            <InputNumber min={1} value={panel.w} onChange={(v) => updatePanel(panel.id, { w: v ?? 1 })} />
          </Form.Item>
          <Form.Item label="高 H">
            <InputNumber min={1} value={panel.h} onChange={(v) => updatePanel(panel.id, { h: v ?? 1 })} />
          </Form.Item>
        </Space>
      </Form>
      <Space wrap>
        <Button size="small" onClick={() => splitPanel(panel.id, 'vertical')}>竖分格</Button>
        <Button size="small" onClick={() => splitPanel(panel.id, 'horizontal')}>横分格</Button>
        <Button size="small" danger onClick={() => removePanel(panel.id)}>删除</Button>
      </Space>
      <Divider style={{ margin: '12px 0' }} />
      <Button block size="small" onClick={() => selectPanel(null)}>完成编辑</Button>
    </div>
  );
}
