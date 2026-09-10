import { useCallback, useEffect, useState } from 'react';
import { Button, Descriptions, Empty, List, Modal, Space, Typography, message } from 'antd';
import { fetchOrders, type Order } from '../api';

export function OrdersHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await fetchOrders());
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>订单记录</Typography.Title>
        <Button size="small" onClick={load} loading={loading}>刷新</Button>
      </Space>
      <div style={{ marginTop: 12 }}>
        {orders.length === 0 ? (
          <Empty description="暂无订单" />
        ) : (
          <List
            dataSource={orders}
            renderItem={(order) => (
              <List.Item
                actions={[<Button key="view" size="small" onClick={() => setDetail(order)}>详情</Button>]}
              >
                <List.Item.Meta
                  title={`#${order.id} ${order.designName}`}
                  description={`客户：${order.customer}${order.phone ? ` / ${order.phone}` : ''} · ${new Date(order.createdAt).toLocaleString()}`}
                />
                <Typography.Text strong>¥ {order.total.toFixed(2)}</Typography.Text>
              </List.Item>
            )}
          />
        )}
      </div>
      <Modal
        title={`订单 #${detail?.id}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={640}
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="客户">{detail.customer}</Descriptions.Item>
            <Descriptions.Item label="电话">{detail.phone ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="设计名称">{detail.designName}</Descriptions.Item>
            <Descriptions.Item label="洞口尺寸">
              {detail.openingW ? `${detail.openingW}×${detail.openingH} mm` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="系列">{detail.seriesId ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="总价">¥ {detail.total.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>{new Date(detail.createdAt).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="BOM 项数" span={2}>{Array.isArray(detail.bom) ? detail.bom.length : 0} 条</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
