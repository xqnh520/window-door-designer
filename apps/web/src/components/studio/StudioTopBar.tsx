import { useRef } from 'react';
import { Button, Dropdown, Space, Tooltip, Typography, message } from 'antd';
import { BoxPlotOutlined, DownloadOutlined, FunctionOutlined, HomeOutlined, ShareAltOutlined } from '@ant-design/icons';
import { useStore } from '../../store';

/** 可导出的内容类型（由 DesignStudio 处理实际逻辑） */
export type ExportKind = 'material-pdf' | 'material-csv' | 'quote-pdf' | 'cutting-pdf';

/** 门窗设计顶栏：Logo + 右侧（公式 / 导出含方案JSON / 3D 渲染 / 返回首页 / 分享） */
export function StudioTopBar({
  onGo3D,
  onGoHome,
  onExport,
  onExportScheme,
  onImportScheme,
  onOpenFormula,
}: {
  onGo3D: () => void;
  onGoHome: () => void;
  /** 导出：材料 PDF / 材料 CSV（表格）/ 图纸+报价 PDF / 生产下料 PDF */
  onExport?: (kind: ExportKind) => void;
  /** 导出方案 JSON（分享/备份） */
  onExportScheme?: () => void;
  /** 导入方案 JSON（离线协作） */
  onImportScheme?: (text: string) => void;
  /** 打开「自定义计算公式」配置弹窗 */
  onOpenFormula?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  /** 分享：复制完整方案（设计 + 画布 + 订单配置），而非仅有 design */
  const share = async () => {
    try {
      await navigator.clipboard.writeText(useStore.getState().exportScheme());
      message.success('完整方案已复制到剪贴板（可粘贴给对方导入）');
    } catch {
      message.error('复制失败');
    }
  };

  const handleImportFile = (file: File) => {
    file
      .text()
      .then((text) => onImportScheme?.(text))
      .catch(() => message.error('读取方案文件失败'));
  };

  return (
    <div
      style={{
        background: '#fff',
        borderBottom: '1px solid #e8e8e8',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 52,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'linear-gradient(135deg,#1677ff,#69b1ff)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          🪟
        </span>
        <Typography.Text strong style={{ fontSize: 15 }}>
          门窗设计
        </Typography.Text>
      </div>
      <div style={{ flex: 1 }} />
      <Space size={6}>
        {onOpenFormula && (
          <Tooltip title="系列/窗型自定义计算公式（安全解析，BOM/报价/下料单实时联动）">
            <Button size="small" icon={<FunctionOutlined />} onClick={onOpenFormula}>
              公式
            </Button>
          </Tooltip>
        )}
        <Dropdown
          menu={{
            items: [
              { key: 'material-pdf', label: '材料清单 PDF（含图纸）' },
              { key: 'material-csv', label: '材料清单 CSV（表格）' },
              { type: 'divider' },
              { key: 'quote-pdf', label: '图纸 + 报价 PDF' },
              { key: 'cutting-pdf', label: '生产下料 PDF' },
              { type: 'divider' },
              { key: 'scheme-export', label: '导出方案 JSON（分享/备份）' },
              { key: 'scheme-import', label: '导入方案 JSON' },
            ],
            onClick: ({ key }) => {
              if (key === 'scheme-export') {
                onExportScheme?.();
                return;
              }
              if (key === 'scheme-import') {
                fileRef.current?.click();
                return;
              }
              onExport?.(key as ExportKind);
            },
          }}
        >
          <Button size="small" icon={<DownloadOutlined />}>
            导出
          </Button>
        </Dropdown>
        <Tooltip title="进入 Three.js 3D 预览">
          <Button size="small" icon={<BoxPlotOutlined />} onClick={onGo3D}>
            3D 渲染
          </Button>
        </Tooltip>
        <Tooltip title="返回首页">
          <Button size="small" icon={<HomeOutlined />} onClick={onGoHome}>
            返回
          </Button>
        </Tooltip>
        <Button size="small" icon={<ShareAltOutlined />} onClick={share}>
          分享
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
      </Space>
    </div>
  );
}