/**
 * CRM 方案兼容边界。
 *
 * 保存方向：WindowAssembly → 旧 ShapeModel JSON（单向投影，不回写 store）
 * 加载方向：旧 ShapeModel JSON → WindowAssembly（进入设计器前一次性迁移）
 */
import type { MaterialLibrary } from '@wdd/schema';
import { selectCurrentOpeningH, selectCurrentOpeningW, selectCurrentSeriesId, useStore } from '../store';
import { assemblyToShapes } from '../canvas/shapes3d';
import { normalizeLegacyShapes } from '../canvas/legacyShapesImport';
import { projectDesignModel } from '../canvas/modelProjection';
import type { ColorConfig, DesignScheme, ShapeModelJson } from './types';

/** 系列名称 → 系列 ID（设计器用 seriesId，CRM 存 seriesName；未匹配取第一个系列） */
export function seriesNameToId(name: string, library: MaterialLibrary, fallback?: string): string {
  const hit = library.series.find((s) => s.name === name);
  return hit?.id ?? fallback ?? library.series[0]?.id ?? name;
}

/** 收集设计器当前状态；兼容图形只在返回载荷中生成。 */
export function collectDesignerPayload(): {
  shapes: ShapeModelJson[];
  colorConfig: ColorConfig;
  totalWidth: number;
  totalHeight: number;
  seriesName: string;
} {
  const st = useStore.getState();
  const seriesId = selectCurrentSeriesId(st);
  const series = st.library.series.find((s) => s.id === seriesId) ?? st.library.series[0];
  const model = projectDesignModel(st);
  return {
    shapes: st.assembly ? (assemblyToShapes(st.assembly, series) as ShapeModelJson[]) : [],
    colorConfig: { outerColor: st.orderConfig.outerColor, innerColor: st.orderConfig.innerColor },
    totalWidth: model?.openingW ?? selectCurrentOpeningW(st),
    totalHeight: model?.openingH ?? selectCurrentOpeningH(st),
    seriesName: series?.name ?? '',
  };
}

/**
 * 加载方案回显：在进入设计页**之前**调用，把方案数据预装进设计器 Store。
 * - 方案：先恢复元数据，再把 designData 一次性迁移成 WindowAssembly
 * - null（新建方案）：清空画布（仅网格），尺寸/系列/颜色沿用当前
 */
export function prepareCrmScheme(scheme: DesignScheme | null): void {
  const st = useStore.getState();
  if (scheme) {
    // 先断开上一方案，防止尺寸/系列更新写入旧装配体。
    st.setWindowTree(null);
    st.setOpeningSize(scheme.totalWidth, scheme.totalHeight);
    st.setSeries(seriesNameToId(scheme.seriesName, st.library, selectCurrentSeriesId(st)));
    st.setOrderConfig({ outerColor: scheme.colorConfig.outerColor, innerColor: scheme.colorConfig.innerColor });
    st.importLegacyShapes(normalizeLegacyShapes(scheme.designData));
  } else {
    st.setWindowTree(null);
    st.importLegacyShapes([]);
  }
}
