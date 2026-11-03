import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/**
 * 左侧工具栏的构件飞出面板：紧贴 64px 图标栏右侧弹出，按分组渲染双列带文字按钮。
 * 所有构件类别共用这一个面板（形状 25 项、格条 16 项这种量级用竖排 Dropdown 要滚很久）。
 */

export interface FlyoutItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface FlyoutGroup {
  /** 分组小标题；省略则不渲染标题行 */
  label?: string;
  items: FlyoutItem[];
}

const PANEL_W = 252;

export function StudioToolFlyout({
  open,
  title,
  hint,
  groups,
  extra,
  currentId,
  onPick,
  onClose,
  ignoreRef,
}: {
  open: boolean;
  title: string;
  /** 一句话说明这一类点下去会发生什么（生效对象/后续操作） */
  hint?: string;
  groups: FlyoutGroup[];
  /** 面板尾部附属控件（窄边比 / 顶部横档 / 列行） */
  extra?: ReactNode;
  /** 当前生效项 id：高亮用 */
  currentId?: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  /** 落在该元素内的点击不触发「点外部关闭」（传工具栏自身，否则点类别按钮会被先关再开） */
  ignoreRef?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || ignoreRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 阻断到 window 的冒泡：设计器把 Esc 也用作「退回选择工具」，此处只该关掉本面板
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, ignoreRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        left: 64,
        top: 0,
        bottom: 0,
        width: PANEL_W,
        zIndex: 40,
        background: '#fff',
        borderRight: '1px solid #e8e8e8',
        boxShadow: '4px 0 14px rgba(0,0,0,0.10)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 'none',
          padding: '8px 10px 6px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{title}</div>
        {hint && <div style={{ fontSize: 11, color: '#999', marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 10px' }}>
        {groups.map((grp, gi) => (
          <div key={grp.label ?? `g${gi}`}>
            {grp.label && (
              <div
                style={{
                  fontSize: 11,
                  color: '#999',
                  margin: gi === 0 ? '8px 0 4px' : '10px 0 4px',
                  paddingTop: gi === 0 ? 0 : 6,
                  borderTop: gi === 0 ? 'none' : '1px solid #f5f5f5',
                }}
              >
                {grp.label}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {grp.items.map((it) => {
                const active = !!currentId && it.id === currentId;
                return (
                  <button
                    key={it.id}
                    disabled={it.disabled}
                    title={it.label}
                    onClick={() => onPick(it.id)}
                    style={{
                      padding: '5px 4px',
                      border: `1px solid ${active ? '#1677ff' : '#e8e8e8'}`,
                      borderRadius: 6,
                      background: active ? '#e6f4ff' : it.disabled ? '#fafafa' : '#fff',
                      color: active ? '#1677ff' : it.disabled ? '#bbb' : '#444',
                      fontSize: 12,
                      lineHeight: '18px',
                      cursor: it.disabled ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {it.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {extra && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>{extra}</div>
        )}
      </div>
    </div>
  );
}
