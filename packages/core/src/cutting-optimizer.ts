import type { CuttingPack, CuttingPackCut } from './cutting.js';

export interface OptimizeCuttingInput {
  stockLengthMm: number;
  wasteRate: number;
}

export interface OptimizeCuttingGroup {
  materialId: string;
  code: string;
  name: string;
  color: string;
  lengthMm: number;
  quantity: number;
  sourceComponentId: string;
  position: string;
}

export function optimizeCuttingPacks(
  cutsByGroup: OptimizeCuttingGroup[],
  input: OptimizeCuttingInput,
): CuttingPack[] {
  const expanded = cutsByGroup.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({ ...item, quantity: 1 })),
  );
  const sorted = [...expanded].sort((a, b) => b.lengthMm - a.lengthMm);
  const packs: CuttingPack[] = [];

  for (const cut of sorted) {
    let target = packs.find((pack) => pack.materialId === cut.materialId && pack.color === cut.color && pack.usedLengthMm + cut.lengthMm <= pack.stockLengthMm);
    if (!target) {
      target = {
        materialId: cut.materialId,
        code: cut.code,
        name: cut.name,
        color: cut.color,
        stockLengthMm: input.stockLengthMm,
        cuts: [],
        usedLengthMm: 0,
        wasteLengthMm: 0,
      };
      packs.push(target);
    }
    const detail: CuttingPackCut = {
      lengthMm: cut.lengthMm,
      quantity: 1,
      sourceComponentId: cut.sourceComponentId,
      position: cut.position,
    };
    target.cuts.push(detail);
    target.usedLengthMm += cut.lengthMm;
    target.wasteLengthMm = Math.max(0, Math.round(target.stockLengthMm - target.usedLengthMm * (1 + input.wasteRate)));
  }

  return packs.sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.color !== b.color) return a.color.localeCompare(b.color);
    return b.usedLengthMm - a.usedLengthMm;
  });
}
