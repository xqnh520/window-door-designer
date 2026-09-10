import type { DesignComponent, DesignModel, SeriesSpec, WindowTemplate } from '@wdd/schema';
import { randomId } from './util.js';

export interface CreateDesignModelFromTemplateOptions {
  openingW: number;
  openingH: number;
  series: SeriesSpec;
  seriesId: string;
  glassId: string;
  name: string;
}

export function createDesignModelFromTemplate(
  template: WindowTemplate,
  options: CreateDesignModelFromTemplateOptions,
): DesignModel {
  const frameOuterW = Math.max(1, options.openingW - options.series.installGap * 2);
  const frameOuterH = Math.max(1, options.openingH - options.series.installGap * 2);
  const idMap = new Map<string, string>();
  const components: DesignComponent[] = template.components.map((part: WindowTemplate['components'][number]) => {
    const id = `tpl-${part.id}-${randomId()}`;
    idMap.set(part.id, id);
    return {
      id,
      kind: part.kind,
      x: Math.round(part.xRatio * frameOuterW),
      y: Math.round(part.yRatio * frameOuterH),
      w: Math.max(1, Math.round(part.wRatio * frameOuterW)),
      h: Math.max(1, Math.round(part.hRatio * frameOuterH)),
      parentId: part.parentId ? idMap.get(part.parentId) : undefined,
      windowType: part.windowType,
      hingeSide: part.hingeSide,
      openDirection: part.openDirection,
      label: part.label,
    };
  });

  return {
    id: randomId(),
    name: options.name,
    openingW: options.openingW,
    openingH: options.openingH,
    seriesId: options.seriesId,
    glassId: options.glassId,
    components,
  };
}

export function isTemplateCompatible(template: WindowTemplate, series: SeriesSpec): boolean {
  const family = (series as SeriesSpec & { windowFamily?: string }).windowFamily ?? 'mixed';
  // 仅当模板明确允许当前窗型家族时才兼容；「mixed」只放行混合家族系列
  return template.allowedFamilies.includes(family as 'fixed' | 'casement' | 'sliding' | 'mixed');
}
