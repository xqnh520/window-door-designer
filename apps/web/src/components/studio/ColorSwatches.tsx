import { CheckOutlined } from '@ant-design/icons';
import { FRAME_COLOR_OPTIONS } from './palette';

/** 颜色选项卡板：可点击选择色名，选中态蓝色描边 + 勾选 */
export function ColorSwatches({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {FRAME_COLOR_OPTIONS.map((c) => {
        const active = c.name === value;
        return (
          <div
            key={c.name}
            onClick={() => onChange(c.name)}
            style={{
              border: active ? '2px solid #1677ff' : '1px solid #e0e0e0',
              borderRadius: 8,
              padding: 6,
              textAlign: 'center',
              cursor: 'pointer',
              background: active ? '#f0f7ff' : '#fff',
            }}
          >
            <div
              style={{
                height: 26,
                borderRadius: 4,
                background: `linear-gradient(135deg, ${c.hex}, ${c.hex}99)`,
                border: '1px solid rgba(0,0,0,0.08)',
                position: 'relative',
              }}
            >
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 14,
                  }}
                >
                  <CheckOutlined />
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, color: active ? '#1677ff' : '#555' }}>{c.name}</div>
          </div>
        );
      })}
    </div>
  );
}