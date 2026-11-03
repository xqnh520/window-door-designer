import type { WindowSashSpec, SashType } from './window-tree.js';

/**
 * 默认放置规范：由 core 统一定义，UI 只负责选择类型并提交 set-sash intent。
 * 标签仍沿用现有画布语义，避免迁移后历史图纸出现名称漂移。
 */
export function specForSash(type: SashType): Pick<WindowSashSpec, 'windowType' | 'label' | 'hingeSide' | 'openDirection'> {
  switch (type) {
    case 'screen':
      return { windowType: 'screen', label: 'WC' };
    case 'casement':
      return { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out' };
    case 'casementUp':
      return { windowType: 'casementUp', label: 'A1', hingeSide: 'left', openDirection: 'out' };
    case 'tiltSlide':
      return { windowType: 'tiltSlide', label: 'A1', hingeSide: 'left', openDirection: 'in' };
    case 'sliding':
      return { windowType: 'sliding', label: 'S1' };
    case 'topHinged':
      return { windowType: 'topHinged', label: 'A1', hingeSide: 'top', openDirection: 'out' };
    default:
      return { windowType: 'fixed', label: 'F1' };
  }
}
