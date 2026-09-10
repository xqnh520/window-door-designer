import { Button, Space, Typography } from 'antd';
import type { WindowType } from '@wdd/schema';
import { WindowTypeLabel } from '@wdd/schema';
import { useStore } from '../store';

const TYPES: WindowType[] = ['fixed', 'casement', 'sliding', 'topHinged', 'casementUp', 'tiltSlide'];

export function WindowGallery() {
  const designType = useStore((s) => s.designType);
  const setWindowType = useStore((s) => s.setWindowType);

  return (
    <div>
      <Typography.Text type="secondary">窗型选择</Typography.Text>
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        {TYPES.map((type) => (
          <Button
            key={type}
            block
            type={designType === type ? 'primary' : 'default'}
            onClick={() => setWindowType(type)}
          >
            {WindowTypeLabel[type]}
          </Button>
        ))}
      </Space>
    </div>
  );
}