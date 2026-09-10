import type { DesignComponent, DesignModel, WindowType } from '@wdd/schema';
import type { DesignerStore, SketchShape } from '../store';

export function buildShapesFromDesignModel(model: DesignModel): SketchShape[] {
  const components = [...model.components].sort((a, b) => rankKind(a.kind) - rankKind(b.kind));
  const shapes: SketchShape[] = [];

  for (const component of components) {
    const shape: SketchShape = {
      id: component.sourceShapeId ?? component.id,
      type: 'rect',
      bbox: { x: component.x, y: component.y, w: component.w, h: component.h },
      topRatio: 1,
      text: component.label ?? '',
      componentKind: component.kind,
      materialRole: materialRoleFromKind(component.kind),
      windowType: component.windowType,
      side: component.hingeSide === 'left' || component.hingeSide === 'right' ? component.hingeSide : undefined,
      openDir: component.openDirection,
      label: component.label,
    };
    if (component.kind === 'mullion') {
      shape.type = Math.abs(component.w) >= Math.abs(component.h) ? 'rect' : 'line';
      if (shape.type === 'line') {
        shape.p1 = { x: component.x, y: component.y };
        shape.p2 = { x: component.x + component.w, y: component.y + component.h };
        shape.text = '';
      }
    }
    shapes.push(shape);
  }

  return shapes;
}

export function buildDesignModelFromShapes(shapes: SketchShape[], state: DesignerStore): DesignModel | null {
  const areaShapes = shapes.filter((s) => ['rect', 'trapezoid', 'arch', 'gothic'].includes(s.type));
  const lineShapes = shapes.filter((s) => s.type === 'line');
  if (!areaShapes.length) return null;

  // 组合窗支持：显式标记为外框的图形都作为外框；否则取最大图形兜底
  const explicitFrames = areaShapes.filter((s) => s.componentKind === 'outerFrame');
  const frameShapes = explicitFrames.length ? explicitFrames : [largestShape(areaShapes)];
  const frameIds = new Set(frameShapes.map((f) => f.id));
  const components: DesignComponent[] = frameShapes.map((fs) => ({
    id: `c-frame-${fs.id}`,
    kind: 'outerFrame',
    x: fs.bbox.x,
    y: fs.bbox.y,
    w: fs.bbox.w,
    h: fs.bbox.h,
    sourceShapeId: fs.id,
  }));

  /** 面板/中梃归属：中心点所在的最近外框，未命中回退第一个外框 */
  const hostFrameId = (shape: SketchShape): string => {
    const cx = shape.bbox.x + shape.bbox.w / 2;
    const cy = shape.bbox.y + shape.bbox.h / 2;
    const host = frameShapes.find(
      (f) => cx >= f.bbox.x && cx <= f.bbox.x + f.bbox.w && cy >= f.bbox.y && cy <= f.bbox.y + f.bbox.h,
    );
    return `c-frame-${(host ?? frameShapes[0]).id}`;
  };

  for (const shape of areaShapes) {
    if (frameIds.has(shape.id)) continue;
    if (shape.sashes?.length) continue;
    const kind = shape.componentKind ?? inferKind(shape);
    components.push({
      id: `c-glass-${shape.id}`,
      kind,
      x: shape.bbox.x,
      y: shape.bbox.y,
      w: shape.bbox.w,
      h: shape.bbox.h,
      sourceShapeId: shape.id,
      parentId: hostFrameId(shape),
      windowType: shape.windowType ?? inferWindowType(shape),
      hingeSide: shape.side,
      openDirection: shape.openDir,
      label: shape.label,
    });
  }

  for (const line of lineShapes) {
    const kind = line.componentKind === 'mullion' || line.materialRole === 'mullion' ? 'mullion' : 'annotation';
    if (kind === 'annotation') continue;
    const len = line.p1 && line.p2 ? Math.hypot(line.p2.x - line.p1.x, line.p2.y - line.p1.y) : Math.max(line.bbox.w, line.bbox.h);
    components.push({
      id: `c-mullion-${line.id}`,
      kind: 'mullion',
      x: line.bbox.x,
      y: line.bbox.y,
      w: Math.max(1, line.p1 && line.p2 ? Math.abs(line.p2.x - line.p1.x) || len : line.bbox.w),
      h: Math.max(1, line.p1 && line.p2 ? Math.abs(line.p2.y - line.p1.y) || len : line.bbox.h),
      sourceShapeId: line.id,
      parentId: hostFrameId(line),
      windowType: 'fixed',
    });
  }

  for (const shape of areaShapes) {
    for (const sash of shape.sashes ?? []) {
      const kind = sash.hingeSide === 'top' || sash.hingeSide === 'bottom' ? 'topHungSash' : 'casementSash';
      const sashId = `c-sash-${shape.id}-${components.length}`;
      components.push({
        id: sashId,
        kind,
        x: shape.bbox.x + sash.rect.x,
        y: shape.bbox.y + sash.rect.y,
        w: sash.rect.w,
        h: sash.rect.h,
        sourceShapeId: shape.id,
        parentId: `c-frame-${shape.id}`,
        windowType: windowTypeFromSash(kind),
        hingeSide: sash.hingeSide,
        openDirection: sash.openDirection,
        label: sash.label,
      });
      const glassInset = Math.max(8, Math.floor(Math.min(sash.rect.w, sash.rect.h) * 0.08));
      components.push({
        id: `c-glass-${shape.id}-${components.length}`,
        kind: 'fixedGlass',
        x: shape.bbox.x + sash.rect.x + glassInset,
        y: shape.bbox.y + sash.rect.y + glassInset,
        w: Math.max(1, sash.rect.w - glassInset * 2),
        h: Math.max(1, sash.rect.h - glassInset * 2),
        sourceShapeId: shape.id,
        parentId: sashId,
        windowType: windowTypeFromSash(kind),
        label: sash.label,
      });
    }
  }

  return {
    id: state.design.id,
    name: state.design.name,
    openingW: state.design.openingW,
    openingH: state.design.openingH,
    seriesId: state.design.seriesId,
    glassId: state.design.glassId,
    components,
  };
}

function largestShape(shapes: SketchShape[]): SketchShape {
  return shapes.reduce((best, next) => (area(next) > area(best) ? next : best), shapes[0]);
}

function inferKind(shape: SketchShape): DesignComponent['kind'] {
  if (shape.componentKind === 'mullion' || shape.materialRole === 'mullion') return 'mullion';
  if (shape.windowType === 'sliding') return 'slidingSash';
  if (shape.windowType === 'topHinged') return 'topHungSash';
  if (shape.componentKind === 'annotation') return 'annotation';
  if (shape.side || shape.openDir) return 'casementSash';
  return 'fixedGlass';
}

function inferWindowType(shape: SketchShape): WindowType {
  if (shape.windowType) return shape.windowType;
  if (shape.side || shape.openDir) return 'casement';
  return 'fixed';
}

function area(shape: SketchShape): number {
  return shape.bbox.w * shape.bbox.h;
}

function windowTypeFromSash(kind: 'casementSash' | 'topHungSash'): WindowType {
  return kind === 'topHungSash' ? 'topHinged' : 'casement';
}

function materialRoleFromKind(kind: DesignComponent['kind']): string | undefined {
  switch (kind) {
    case 'outerFrame':
      return 'frame';
    case 'fixedGlass':
      return 'glass';
    case 'casementSash':
    case 'slidingSash':
    case 'topHungSash':
      return 'sash';
    case 'mullion':
      return 'mullion';
    default:
      return undefined;
  }
}

function rankKind(kind: DesignComponent['kind']): number {
  switch (kind) {
    case 'outerFrame':
      return 0;
    case 'mullion':
      return 1;
    case 'fixedGlass':
      return 2;
    case 'slidingSash':
    case 'casementSash':
    case 'topHungSash':
      return 3;
    default:
      return 4;
  }
}
