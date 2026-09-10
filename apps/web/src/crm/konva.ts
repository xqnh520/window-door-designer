/**
 * Konva 数据流辅助：设计器 Store（useStore）⇄ CRM 方案（DesignScheme）之间的桥接
 *
 * 保存方向：collectDesignerPayload() 收集画布图形/颜色/尺寸/系列
 * 回显方向：prepareCrmScheme(scheme) 预装设计器 Store（须在 ShapeCanvas 挂载前执行，
 *          画布挂载时以 useStore.getState().shapes 为 initialModels 实现 100% 还原）
 */
import type { MaterialLibrary } from '@wdd/schema';
import { useStore } from '../store';
import type { ColorConfig, DesignScheme, ShapeModelJson } from './types';

/** 系列名称 → 系列 ID（设计器用 seriesId，CRM 存 seriesName；未匹配取第一个系列） */
export function seriesNameToId(name: string, library: MaterialLibrary, fallback?: string): string {
  const hit = library.series.find((s) => s.name === name);
  return hit?.id ?? fallback ?? library.series[0]?.id ?? name;
}

/** 收集设计器当前状态，生成保存方案所需的载荷 */
export function collectDesignerPayload(): {
  shapes: ShapeModelJson[];
  colorConfig: ColorConfig;
  totalWidth: number;
  totalHeight: number;
  seriesName: string;
} {
  const st = useStore.getState();
  const series = st.library.series.find((s) => s.id === st.design.seriesId) ?? st.library.series[0];
  return {
    shapes: st.shapes as unknown as ShapeModelJson[],
    colorConfig: { outerColor: st.orderConfig.outerColor, innerColor: st.orderConfig.innerColor },
    totalWidth: st.design.openingW,
    totalHeight: st.design.openingH,
    seriesName: series?.name ?? '',
  };
}

/**
 * 加载方案回显：在进入设计页**之前**调用，把方案数据预装进设计器 Store。
 * - 方案：图形(designData→shapes)、总宽高、系列、颜色 全部预装
 * - null（新建方案）：清空画布（仅网格），尺寸/系列/颜色沿用当前
 */
export function prepareCrmScheme(scheme: DesignScheme | null): void {
  const st = useStore.getState();
  if (scheme) {
    // 防御：列表摘要可能不含 designData；缺省视为空画布（避免 undefined.map 崩溃）
    const shapes = Array.isArray(scheme.designData) ? scheme.designData.map(normalizeShapeJson) : [];
    st.setShapesFromCanvas(shapes as unknown as Parameters<typeof st.setShapesFromCanvas>[0]);
    st.setOpeningSize(scheme.totalWidth, scheme.totalHeight);
    st.setSeries(seriesNameToId(scheme.seriesName, st.library, st.seriesId));
    st.setOrderConfig({ outerColor: scheme.colorConfig.outerColor, innerColor: scheme.colorConfig.innerColor });
  } else {
    st.setShapesFromCanvas([]);
  }
}

function normalizeShapeJson(shape: ShapeModelJson): ShapeModelJson {
  return {
    ...shape,
    componentKind: shape.componentKind ?? undefined,
    materialRole: shape.materialRole ?? undefined,
    windowType: shape.windowType ?? undefined,
  };
}
