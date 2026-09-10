import type { DesignComponent, DesignModel, MaterialLibrary, SeriesSpec } from '@wdd/schema';
import type { BomItem, BomOptions } from './bom.js';
import type { FormulaContext } from './formula-context.js';

/** 参与算料的面板构件（固定玻璃、各类开启扇与纱窗 + 构件体系扩展类型） */
export const PANEL_KINDS = new Set([
  'fixedGlass',
  'casementSash',
  'slidingSash',
  'topHungSash',
  'screen',
  'securityFrame',
  'securityBar',
  'waterGuard',
  'decorBar',
  'frostedGlass',
  'subSash',
  'sashInSash',
  'pushInSash',
  'foldSash',
  'foldScreen',
  'fakeMullion',
  'sashBead',
  'screenBead',
  'sashMullion',
  'screenMullion',
  'panelBead',
]);

export interface BomCalculatorContext {
  model: DesignModel;
  series: SeriesSpec;
  library: MaterialLibrary;
  options: BomOptions;
  context: FormulaContext;
  /** 全部外框构件（组合窗可能有多个） */
  frames: DesignComponent[];
}

/**
 * 窗型算料计算器（策略模式）：新增窗型通过注册新计算器扩展，
 * 无需修改既有平开/推拉逻辑。
 */
export interface BomCalculator {
  id: string;
  label: string;
  /** 是否适用于当前模型结构；不适用时继续查询下一个计算器 */
  supports(input: BomCalculatorContext): boolean;
  /** 输出该窗型下的全部 BOM 行（型材/玻璃/五金/压线） */
  compute(input: BomCalculatorContext): BomItem[];
}

/** 按注册顺序选择第一个适用的计算器；无匹配时回退到最后一个（兜底计算器） */
export function resolveBomCalculator(input: BomCalculatorContext, calculators: BomCalculator[]): BomCalculator {
  const matched = calculators.find((c) => c.supports(input));
  const fallback = calculators[calculators.length - 1];
  if (matched) return matched;
  if (!fallback) throw new Error('未注册任何 BOM 计算器');
  return fallback;
}