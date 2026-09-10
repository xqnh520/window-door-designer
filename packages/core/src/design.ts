import type { SeriesSpec, WindowDesign, WindowType } from '@wdd/schema';
import { randomId } from './util.js';
import type { WindowTemplate } from '@wdd/schema';
import { createDesignModelFromTemplate, isTemplateCompatible } from './window-template.js';

export interface DesignOptions {
  openingW: number;
  openingH: number;
  seriesId: string;
  name: string;
}

export function createDesign(type: WindowType, options: DesignOptions, series: SeriesSpec): WindowDesign {
  const innerW = options.openingW - 2 * series.installGap - 2 * series.frameWidth;
  const innerH = options.openingH - 2 * series.installGap - 2 * series.frameWidth;

  const panels = createPanels(type, innerW, innerH);
  return {
    id: randomId(),
    name: options.name,
    seriesId: options.seriesId,
    openingW: options.openingW,
    openingH: options.openingH,
    glassId: 'g-5-12a-5',
    panels,
    note: '',
  };
}

export function createDesignFromTemplate(
  template: WindowTemplate,
  options: DesignOptions,
  series: SeriesSpec,
): WindowDesign {
  const model = createDesignModelFromTemplate(template, {
    openingW: options.openingW,
    openingH: options.openingH,
    series,
    seriesId: options.seriesId,
    glassId: 'g-5-12a-5',
    name: options.name,
  });
  if (!isTemplateCompatible(template, series)) {
    throw new Error(`模板 ${template.name} 与系列 ${series.name} 不兼容`);
  }
  return {
    id: model.id,
    name: model.name,
    seriesId: model.seriesId,
    openingW: model.openingW,
    openingH: model.openingH,
    glassId: model.glassId,
    panels: model.components
      .filter((c) => c.kind === 'fixedGlass' || c.kind === 'casementSash' || c.kind === 'slidingSash' || c.kind === 'topHungSash')
      .map((c) => ({
        id: c.id,
        x: Math.max(0, Math.round(c.x)),
        y: Math.max(0, Math.round(c.y)),
        w: Math.max(1, Math.round(c.w)),
        h: Math.max(1, Math.round(c.h)),
        windowType: c.windowType ?? 'fixed',
        hasSash: c.kind !== 'fixedGlass',
      })),
    note: '',
  };
}

function createPanels(type: WindowType, innerW: number, innerH: number) {
  switch (type) {
    case 'fixed':
      return [panel(type, 0, 0, innerW, innerH, false)];
    case 'casement':
      return [
        panel('fixed', 0, 0, Math.round(innerW * 0.45), innerH, false),
        panel('casement', Math.round(innerW * 0.45), 0, Math.round(innerW * 0.55), innerH, true),
      ];
    case 'sliding':
      return [panel('sliding', 0, 0, innerW, innerH, true)];
    case 'topHinged':
      return [panel('topHinged', 0, 0, innerW, innerH, true)];
    case 'casementUp':
      return [
        panel('casementUp', 0, 0, Math.round(innerW * 0.55), innerH, true),
        panel('fixed', Math.round(innerW * 0.55), 0, Math.round(innerW * 0.45), innerH, false),
      ];
    case 'tiltSlide':
      return [panel('tiltSlide', 0, 0, innerW, innerH, true)];
  }
}

function panel(
  windowType: WindowType,
  x: number,
  y: number,
  w: number,
  h: number,
  hasSash: boolean,
) {
  return {
    id: randomId(),
    windowType,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    w: Math.max(1, Math.round(w)),
    h: Math.max(1, Math.round(h)),
    hasSash,
  };
}
