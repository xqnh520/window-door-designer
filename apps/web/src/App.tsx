import { useState } from 'react';
import { Divider, Layout, Tabs, Typography, message } from 'antd';
import { WindowGallery } from './components/WindowGallery';
import { PropertyPanel } from './components/PropertyPanel';
import { DesignStudio } from './components/studio/DesignStudio';
import { Preview3DPage } from './components/studio/Preview3DPage';
import { BomTable } from './components/BomTable';
import { QuotePanel } from './components/QuotePanel';
import { MaterialLibrary } from './components/MaterialLibrary';
import { OrdersHistory } from './components/OrdersHistory';
import { HomeMenu, type HomeTabKey } from './components/HomeMenu';
import { CustomerListPage } from './crm/CustomerListPage';
import { CustomerDetailPage } from './crm/CustomerDetailPage';
import { useCrmStore } from './crm/store';
import { prepareCrmScheme } from './crm/konva';
import { crmApi } from './crm/api';
import type { DesignScheme, SaveSchemeInput } from './crm/types';
import { WarehousePage } from './warehouse/WarehousePage';

const { Header, Sider, Content } = Layout;

/** 首页渐变背景：浅蓝 → 浅白 → 淡绿，配合蓝色 Header 保持清爽专业 */
const HOME_BG =
  'radial-gradient(1200px 560px at 85% -10%, rgba(22,119,255,0.12), transparent 60%),' +
  'radial-gradient(900px 520px at 0% 115%, rgba(82,196,26,0.10), transparent 55%),' +
  'linear-gradient(160deg, #eaf3ff 0%, #f8fbff 45%, #f1faf4 100%)';

type AppTab = HomeTabKey | 'home' | 'crm-customer' | 'crm-scheme';

export default function App() {
  const [tab, setTab] = useState<AppTab>('home');
  const isHome = tab === 'home';

  // CRM 订阅必须放在组件最顶层（无条件调用钩子）：
  // 若放进 if 分支，从「无钩子」渲染切换到「有钩子」渲染会触发
  // “Rendered more hooks than during the previous render” → 整页白屏
  const selectedCustomerId = useCrmStore((s) => s.selectedCustomerId);
  const editingScheme = useCrmStore((s) => s.currentScheme);

  // ---------- CRM 方案保存（设计器 → 数据库） ----------
  const handleCrmSaveScheme = async (input: SaveSchemeInput) => {
    const crm = useCrmStore.getState();
    const customerId = crm.selectedCustomerId ?? crm.currentCustomer?.id ?? '';
    if (!customerId) {
      message.error('未选择客户，无法保存方案');
      return;
    }
    try {
      const saved = input.schemeId
        ? await crmApi.updateScheme(input.schemeId, {
            name: input.name,
            totalWidth: input.totalWidth,
            totalHeight: input.totalHeight,
            seriesName: input.seriesName,
            colorConfig: input.colorConfig,
            designData: input.shapes,
          })
        : await crmApi.createScheme({
            customerId,
            name: input.name,
            totalWidth: input.totalWidth,
            totalHeight: input.totalHeight,
            seriesName: input.seriesName,
            colorConfig: input.colorConfig,
            designData: input.shapes,
          });
      useCrmStore.getState().setSchemeSaved(saved);
      message.success('方案已保存到云端');
      // 跳转到归属客户详情（新建客户时也生效）
      useCrmStore.getState().openCustomer(saved.customerId);
      setTab('crm-customer');
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const openSchemeEditor = async (scheme: DesignScheme | null) => {
    // 方案列表为摘要（不含 designData），进入设计前必须拉取完整方案，否则画布初始化崩溃（白屏）
    let full: DesignScheme | null = scheme;
    if (scheme) {
      try {
        full = await crmApi.getScheme(scheme.id);
      } catch (err) {
        message.error((err as Error).message);
        return;
      }
    }
    // 图形/尺寸/系列/颜色 预装进设计器 Store（须在 ShapeCanvas 挂载前执行）
    prepareCrmScheme(full);
    useCrmStore.getState().setCurrentScheme(full);
    setTab('crm-scheme');
  };

  // 首页：保留蓝色 Header，内容区使用渐变背景，无文字菜单导航栏
  if (isHome) {
    return (
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center' }}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            🏠 门窗设计软件
          </Typography.Title>
        </Header>
        <Content style={{ overflow: 'auto', background: HOME_BG }}>
          <HomeMenu onNavigate={(t) => setTab(t)} />
        </Content>
      </Layout>
    );
  }

  // 客户管理（CRM）：客户列表
  if (tab === 'crm') {
    return (
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTab('home')}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            🏠 门窗设计软件
          </Typography.Title>
        </Header>
        <Content style={{ padding: 16, overflow: 'auto', background: '#eef1f5' }}>
          <CustomerListPage
            onOpenDetail={(id) => {
              useCrmStore.getState().openCustomer(id);
              setTab('crm-customer');
            }}
          />
        </Content>
      </Layout>
    );
  }

  // 客户详情：跟进 / 方案 / 订单
  if (tab === 'crm-customer') {
    const customerId = selectedCustomerId ?? '';
    return (
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTab('home')}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            🏠 门窗设计软件
          </Typography.Title>
        </Header>
        <Content style={{ padding: 16, overflow: 'auto', background: '#eef1f5' }}>
          <CustomerDetailPage
            customerId={customerId}
            onBack={() => setTab('crm')}
            onNewScheme={() => openSchemeEditor(null)}
            onEditScheme={(scheme) => openSchemeEditor(scheme)}
          />
        </Content>
      </Layout>
    );
  }

  // CRM 方案设计：在设计器中编辑/新建方案（key 按方案 ID 重挂载画布）
  if (tab === 'crm-scheme') {
    const scheme = editingScheme;
    return (
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTab('home')}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            🏠 门窗设计软件
          </Typography.Title>
        </Header>
        <Content style={{ padding: 12, overflow: 'auto', background: '#eef1f5' }}>
          <DesignStudio
            key={scheme?.id ?? 'crm-scheme-new'}
            crmScheme={scheme}
            onSaveScheme={handleCrmSaveScheme}
            onGoHome={() => setTab('crm-customer')}
            onGo3D={() => setTab('3d')}
          />
        </Content>
      </Layout>
    );
  }

  // 仓库管理：整页渲染（库存总览 / 出入库流水 / 物料档案 / 仓库设置）
  if (tab === 'warehouse') {
    return (
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTab('home')}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            🏠 门窗设计软件
          </Typography.Title>
        </Header>
        <Content style={{ padding: 16, overflow: 'auto', background: '#eef1f5' }}>
          <WarehousePage />
        </Content>
      </Layout>
    );
  }

  // 门窗设计页：整页渲染，无文字菜单导航栏（保留蓝色 Header）
  if (tab === '2d') {
    return (
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTab('home')}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            🏠 门窗设计软件
          </Typography.Title>
        </Header>
        <Content style={{ padding: 12, overflow: 'auto', background: '#eef1f5' }}>
          <DesignStudio onGoHome={() => setTab('home')} onGo3D={() => setTab('3d')} />
        </Content>
      </Layout>
    );
  }

  // 3D 渲染页：整屏渲染界面，仅保留 首页 / 2D设计 / 颜色设置（居中图标）
  if (tab === '3d') {
    return (
      <div style={{ height: '100vh', position: 'relative', overflow: 'hidden', background: '#14161c' }}>
        <Preview3DPage onGoHome={() => setTab('home')} onGo2D={() => setTab('2d')} />
      </div>
    );
  }

  // 其余页面：蓝色 Header + 文字菜单导航栏
  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTab('home')}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          🏠 门窗设计软件
        </Typography.Title>
      </Header>
      <Layout>
        <Sider width={200} theme="light" style={{ padding: 16, overflow: 'auto', borderRight: '1px solid #f0f0f0' }}>
          <WindowGallery />
        </Sider>
        <Content style={{ padding: 16, overflow: 'auto' }}>
          <Tabs
            activeKey={tab}
            onChange={(key) => setTab(key as HomeTabKey)}
            items={[
              { key: '2d', label: '2D 设计', children: <DesignStudio onGoHome={() => setTab('home')} onGo3D={() => setTab('3d')} /> },
              { key: '3d', label: '3D 预览', children: <Preview3DPage onGoHome={() => setTab('home')} onGo2D={() => setTab('2d')} /> },
              { key: 'lib', label: '材料库', children: <MaterialLibrary /> },
              { key: 'orders', label: '订单', children: <OrdersHistory /> },
            ]}
          />
          {tab !== 'lib' && tab !== 'orders' && (
            <>
              <Divider />
              <BomTable />
            </>
          )}
        </Content>
        <Sider width={360} theme="light" style={{ padding: 16, overflow: 'auto', borderLeft: '1px solid #f0f0f0' }}>
          <PropertyPanel />
          <Divider />
          <QuotePanel />
        </Sider>
      </Layout>
    </Layout>
  );
}
