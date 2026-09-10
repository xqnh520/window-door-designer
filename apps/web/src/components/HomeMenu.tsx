import { useState } from 'react';
import { Button, Card, Col, Modal, Row, Space, Typography, message } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  ColumnWidthOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
  OrderedListOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import type { WindowType } from '@wdd/schema';
import { WindowTypeLabel } from '@wdd/schema';
import { useStore } from '../store';

export type HomeTabKey = '2d' | '3d' | 'lib' | 'orders' | 'crm' | 'warehouse';

interface MenuItem {
  key: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  desc: string;
  tab: HomeTabKey | '__gallery' | null; // '__gallery' = 打开窗型图库弹窗；null = 未开发
}

const MENU: MenuItem[] = [
  { key: 'design', title: '门窗设计', icon: <WindowsOutlined />, color: '#1677ff', desc: '2D/3D 窗型设计与尺寸编辑', tab: '2d' },
  { key: 'orders', title: '订单管理', icon: <OrderedListOutlined />, color: '#722ed1', desc: '提交订单与订单记录', tab: 'orders' },
  { key: 'profiles', title: '型材系列', icon: <ColumnWidthOutlined />, color: '#fa8c16', desc: '型材 / 玻璃 / 五金 / 辅料库', tab: 'lib' },
  { key: 'stats', title: '统计', icon: <BarChartOutlined />, color: '#52c41a', desc: '经营数据统计分析', tab: null },
  { key: 'center', title: '个人中心', icon: <UserOutlined />, color: '#13c2c2', desc: '账户信息与偏好设置', tab: null },
  { key: 'gallery', title: '窗型图库', icon: <AppstoreOutlined />, color: '#eb2f96', desc: '精选窗型模板快速选用', tab: '__gallery' },
  { key: 'customers', title: '客户管理', icon: <TeamOutlined />, color: '#2f54eb', desc: '客户档案 / 跟进 / 方案 / 订单（CRM）', tab: 'crm' },
  { key: 'warehouse', title: '仓库管理', icon: <DatabaseOutlined />, color: '#a0d911', desc: '库存 / 出入库 / 盘点 / BOM 领料', tab: 'warehouse' },
  { key: 'tracking', title: '订单跟踪', icon: <NodeIndexOutlined />, color: '#fa541c', desc: '订单生产与交付进度', tab: null },
  { key: 'sunroom', title: '阳光房设计', icon: <SunOutlined />, color: '#fadb14', desc: '阳光房方案与算料', tab: null },
];

export function HomeMenu({ onNavigate }: { onNavigate: (tab: HomeTabKey) => void }) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const setWindowType = useStore((s) => s.setWindowType);
  const designType = useStore((s) => s.designType);

  const handleClick = (item: MenuItem) => {
    if (item.tab === '__gallery') {
      setGalleryOpen(true);
    } else if (item.tab) {
      onNavigate(item.tab);
    } else {
      message.info(`「${item.title}」模块正在开发中`);
    }
  };

  const pickWindowType = (type: WindowType) => {
    setWindowType(type);
    setGalleryOpen(false);
    onNavigate('2d');
  };

  return (
    <div style={{ padding: '36px 24px 48px', maxWidth: 1280, margin: '0 auto' }}>
      {/* 选项卡立体效果（悬浮抬升 / 按下回弹） */}
      <style>{`
        .wdd-menu-card {
          transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
          will-change: transform;
        }
        .wdd-menu-card:hover {
          transform: translateY(-6px) scale(1.02);
          box-shadow:
            0 8px 16px rgba(22,119,255,0.15),
            0 22px 44px -12px rgba(22,119,255,0.30),
            inset 0 1px 0 rgba(255,255,255,0.95);
          border-color: #bcd9ff;
        }
        .wdd-menu-card:active {
          transform: translateY(-2px) scale(0.985);
          box-shadow:
            0 3px 8px rgba(22,119,255,0.18),
            0 10px 20px -8px rgba(22,119,255,0.25);
        }
        .wdd-menu-card:hover .wdd-menu-arrow { opacity: 1; transform: translateX(0); }
      `}</style>
      <Row gutter={[18, 18]}>
        {MENU.map((item) => (
          <Col key={item.key} xs={12} sm={8} md={6} lg={4.8}>
            <Card
              onClick={() => handleClick(item)}
              styles={{ body: { padding: '20px 18px' } }}
              className="wdd-menu-card"
              style={{
                height: '100%',
                borderRadius: 14,
                border: '1px solid #eef1f6',
                background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
                boxShadow:
                  '0 2px 6px rgba(30,60,120,0.05), 0 12px 26px -10px rgba(30,60,120,0.16), inset 0 1px 0 rgba(255,255,255,0.9)',
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <span
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 14,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 26,
                    color: '#fff',
                    background: `linear-gradient(135deg, ${item.color}, ${item.color}99)`,
                    boxShadow: `0 7px 16px ${item.color}44, 0 2px 0 ${item.color}bb inset, 0 -2px 4px rgba(0,0,0,0.18)`,
                  }}
                >
                  {item.icon}
                </span>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {item.title}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {item.desc}
                </Typography.Text>
              </Space>
              <span
                className="wdd-menu-arrow"
                style={{
                  position: 'absolute',
                  right: 14,
                  top: 16,
                  color: '#1677ff',
                  fontWeight: 700,
                  fontSize: 14,
                  opacity: 0,
                  transform: 'translateX(-4px)',
                  transition: 'opacity .18s ease, transform .18s ease',
                }}
              >
                →
              </span>
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        title="窗型图库 — 选择窗型"
        open={galleryOpen}
        onCancel={() => setGalleryOpen(false)}
        footer={null}
        width={480}
      >
        <Row gutter={[12, 12]}>
          {(['fixed', 'casement', 'sliding', 'topHinged', 'casementUp', 'tiltSlide'] as WindowType[]).map((t) => (
            <Col key={t} span={12}>
              <Button
                block
                style={{ height: 48 }}
                type={designType === t ? 'primary' : 'default'}
                onClick={() => pickWindowType(t)}
              >
                {WindowTypeLabel[t]}
              </Button>
            </Col>
          ))}
        </Row>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          选择后将进入 2D 设计并按该窗型生成模板，可在画布中继续分格与编辑。
        </Typography.Text>
      </Modal>
    </div>
  );
}