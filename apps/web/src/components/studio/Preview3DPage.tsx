import { useState } from 'react';
import { Select, Tooltip, Typography } from 'antd';
import { BgColorsOutlined, HomeOutlined, WindowsOutlined } from '@ant-design/icons';
import { useStore } from '../../store';
import { Preview3D } from '../Preview3D';
import { ColorSwatches } from './ColorSwatches';

interface IconAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}

/** 3D 渲染页：仅保留渲染界面 + 首页 / 2D设计 / 颜色设置（居中图标） */
export function Preview3DPage({ onGoHome, onGo2D }: { onGoHome: () => void; onGo2D: () => void }) {
  const [colorOpen, setColorOpen] = useState(false);
  const orderConfig = useStore((s) => s.orderConfig);
  const setOrderConfig = useStore((s) => s.setOrderConfig);

  const actions: IconAction[] = [
    { key: 'home', label: '首页', icon: <HomeOutlined />, onClick: onGoHome },
    { key: '2d', label: '2D 设计', icon: <WindowsOutlined />, onClick: onGo2D },
    { key: 'color', label: '颜色设置', icon: <BgColorsOutlined />, onClick: () => setColorOpen((v) => !v), active: colorOpen },
  ];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#14161c' }}>
      {/* 渲染界面（Three.js） */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <Preview3D />
      </div>

      {/* 居中图标功能栏 */}
      <div
        style={{
          position: 'absolute',
          top: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          gap: 6,
          background: 'rgba(20,22,28,0.72)',
          backdropFilter: 'blur(8px)',
          borderRadius: 30,
          padding: '6px 10px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        }}
      >
        {actions.map((a) => (
          <Tooltip key={a.key} title={a.label} placement="bottom">
            <button
              onClick={a.onClick}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                minWidth: 58,
                padding: '6px 10px',
                border: 'none',
                borderRadius: 18,
                cursor: 'pointer',
                background: a.active ? 'rgba(22,119,255,0.9)' : 'transparent',
                color: a.active ? '#fff' : '#d7dbe3',
                fontSize: 18,
                transition: 'background .15s ease, color .15s ease',
              }}
              onMouseEnter={(e) => {
                if (!a.active) (e.currentTarget.style.color = '#fff');
              }}
              onMouseLeave={(e) => {
                if (!a.active) (e.currentTarget.style.color = '#d7dbe3');
              }}
            >
              {a.icon}
              <Typography.Text
                style={{
                  fontSize: 10,
                  lineHeight: 1,
                  color: 'inherit',
                  margin: 0,
                }}
              >
                {a.label}
              </Typography.Text>
            </button>
          </Tooltip>
        ))}
      </div>

      {/* 颜色设置面板 */}
      {colorOpen && (
        <div
          style={{
            position: 'absolute',
            top: 86,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 11,
            width: 360,
            background: 'rgba(255,255,255,0.97)',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
          }}
        >
          <Typography.Text strong style={{ fontSize: 13 }}>
            室外面颜色（外侧）
          </Typography.Text>
          <div style={{ margin: '8px 0 14px' }}>
            <ColorSwatches value={orderConfig.outerColor} onChange={(v) => setOrderConfig({ outerColor: v })} />
          </div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            室内面颜色（内侧）
          </Typography.Text>
          <div style={{ margin: '8px 0 4px' }}>
            <ColorSwatches value={orderConfig.innerColor} onChange={(v) => setOrderConfig({ innerColor: v })} />
          </div>
          <Typography.Text strong style={{ fontSize: 13, display: 'block', marginTop: 6 }}>
            纱窗（3D 网纹）
          </Typography.Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>网孔</Typography.Text>
            <Select
              size="small"
              value={orderConfig.screenMeshSize}
              onChange={(v) => setOrderConfig({ screenMeshSize: v })}
              style={{ width: 84 }}
              options={[6, 8, 10, 12].map((v) => ({ value: v, label: `${v}mm` }))}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>网线色</Typography.Text>
            <Select
              size="small"
              value={orderConfig.screenMeshColor}
              onChange={(v) => setOrderConfig({ screenMeshColor: v })}
              style={{ width: 96 }}
              options={['深灰', '黑色', '浅灰', '不锈钢'].map((c) => ({ value: c, label: c }))}
            />
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 11, margin: '10px 0 0' }}>
            切换颜色后 3D 渲染实时更新（外框=外形颜色，扇料/玻璃=内色，纱窗帘=可配置网纹）。
          </Typography.Paragraph>
        </div>
      )}
    </div>
  );
}