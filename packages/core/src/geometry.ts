import type { SeriesSpec, WindowDesign, WindowPanel, WindowType } from '@wdd/schema';

export interface Sizes {
  frameOuterW: number;
  frameOuterH: number;
  frameInnerW: number;
  frameInnerH: number;
  panels: PanelSize[];
}

export interface PanelSize {
  panelId: string;
  windowType: WindowType;
  panelOpenW: number;
  panelOpenH: number;
  sashCount: number;
  sashW: number;
  sashH: number;
  glassW: number;
  glassH: number;
}

export interface DesignGeometry {
  sizes: Sizes;
  mullions: Mullion[];
}

export interface Mullion {
  orientation: 'vertical' | 'horizontal';
  length: number;
  position: number;
}

export function computeGeometry(design: WindowDesign, series: SeriesSpec): DesignGeometry {
  const frameOuterW = design.openingW - 2 * series.installGap;
  const frameOuterH = design.openingH - 2 * series.installGap;
  const frameInnerW = frameOuterW - 2 * series.frameWidth;
  const frameInnerH = frameOuterH - 2 * series.frameWidth;

  const panels = design.panels.map((panel) =>
    computePanelSize(panel, frameInnerW, frameInnerH, series),
  );

  const mullions = computeMullions(design.panels, frameInnerW, frameInnerH);

  return {
    sizes: {
      frameOuterW,
      frameOuterH,
      frameInnerW,
      frameInnerH,
      panels,
    },
    mullions,
  };
}

function computePanelSize(
  panel: WindowPanel,
  innerW: number,
  innerH: number,
  series: SeriesSpec,
): PanelSize {
  const leftMullion = panel.x > 0 ? series.frameWidth : 0;
  const rightMullion = panel.x + panel.w < innerW ? series.frameWidth : 0;
  const topMullion = panel.y > 0 ? series.frameWidth : 0;
  const bottomMullion = panel.y + panel.h < innerH ? series.frameWidth : 0;

  const panelOpenW = panel.w - leftMullion - rightMullion;
  const panelOpenH = panel.h - topMullion - bottomMullion;

  if (panel.windowType === 'fixed' || !panel.hasSash) {
    return {
      panelId: panel.id,
      windowType: 'fixed',
      panelOpenW,
      panelOpenH,
      sashCount: 0,
      sashW: 0,
      sashH: 0,
      glassW: Math.max(1, Math.round(panelOpenW - 2 * series.glassGap)),
      glassH: Math.max(1, Math.round(panelOpenH - 2 * series.glassGap)),
    };
  }

  if (panel.windowType === 'sliding') {
    const sashW = Math.round((panelOpenW + series.overlap) / 2);
    const sashH = Math.round(panelOpenH - 2 * series.frameWidth + 2 * series.overlap);
    const glassW = Math.max(1, Math.round(sashW - 2 * series.sashWidth - 2 * series.glassGap));
    const glassH = Math.max(1, Math.round(sashH - 2 * series.sashWidth - 2 * series.glassGap));
    return {
      panelId: panel.id,
      windowType: 'sliding',
      panelOpenW,
      panelOpenH,
      sashCount: 2,
      sashW,
      sashH,
      glassW,
      glassH,
    };
  }

  const sashW = Math.round(panelOpenW - 2 * series.frameWidth + 2 * series.overlap);
  const sashH = Math.round(panelOpenH - 2 * series.frameWidth + 2 * series.overlap);
  const glassW = Math.max(1, Math.round(sashW - 2 * series.sashWidth - 2 * series.glassGap));
  const glassH = Math.max(1, Math.round(sashH - 2 * series.sashWidth - 2 * series.glassGap));

  return {
    panelId: panel.id,
    windowType: panel.windowType,
    panelOpenW,
    panelOpenH,
    sashCount: 1,
    sashW,
    sashH,
    glassW,
    glassH,
  };
}

function computeMullions(
  panels: WindowPanel[],
  innerW: number,
  innerH: number,
): Mullion[] {
  const mullions: Mullion[] = [];
  const verticals = new Set<number>();
  const horizontals = new Set<number>();

  for (const panel of panels) {
    if (panel.x > 0) verticals.add(panel.x);
    if (panel.y > 0) horizontals.add(panel.y);
  }

  for (const x of [...verticals].sort((a, b) => a - b)) {
    mullions.push({ orientation: 'vertical', position: x, length: innerH });
  }
  for (const y of [...horizontals].sort((a, b) => a - b)) {
    mullions.push({ orientation: 'horizontal', position: y, length: innerW });
  }

  return mullions;
}