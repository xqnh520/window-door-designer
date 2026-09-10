import type { BomResult } from './bom.js';
import type { CuttingResult } from './cutting.js';
import type { QuoteResult } from './quote.js';

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** 下料单 / BOM → CSV（UTF-8 BOM，便于 Excel 直接打开中文）。 */
export function bomToCsv(bom: BomResult, title = '门窗下料单'): string {
  const rows: (string | number)[][] = [['下料单 / BOM', '', '', '', '', '', '', '']];
  rows.push(['分类', '名称', '编码', '规格', '单位', '数量', '单价(元)', '金额(元)']);
  for (const item of bom.items) {
    rows.push([categoryLabel(item.category), item.name, item.code, item.spec, item.unit, item.quantity, item.unitPrice, item.amount]);
  }
  rows.push(['合计', '', '', '', '', '', '', bom.totalAmount]);
  return '\uFEFF' + toCsv(rows);
}

/** 生产下料单 → CSV（逐根型材）。 */
export function cuttingToCsv(cutting: CuttingResult, title = '门窗生产下料单'): string {
  const rows: (string | number)[][] = [[title, '', '', '', '', '', '', '', '']];
  rows.push(['型材名称', '编码', '颜色', '长度(mm)', '数量', '左切角', '右切角', '位置', '来源构件']);
  for (const item of cutting.items) {
    rows.push([
      item.name,
      item.code,
      item.color,
      item.lengthMm,
      item.quantity,
      item.cutAngleLeft ?? '',
      item.cutAngleRight ?? '',
      item.position,
      item.sourceComponentId,
    ]);
  }
  rows.push(['合计', '', '', cutting.totalLengthMm, cutting.totalPieces, '', '', '', '']);
  return '\uFEFF' + toCsv(rows);
}

/** 排料结果 → CSV（按原料分组）。 */
export function cuttingPackToCsv(cutting: CuttingResult, title = '门窗排料单'): string {
  const rows: (string | number)[][] = [[title, '', '', '', '', '', '', '', '']];
  rows.push(['#', '型材', '编码', '颜色', '原料长度(mm)', '已用(mm)', '余料(mm)', '利用率', '切割明细']);
  cutting.packs.forEach((pack, idx) => {
    const cuts = pack.cuts.map((cut) => `${cut.position} ${cut.lengthMm}mm`).join(' / ');
    const rate = pack.stockLengthMm > 0 ? Math.round((pack.usedLengthMm / pack.stockLengthMm) * 100) : 0;
    rows.push([
      idx + 1,
      pack.name,
      pack.code,
      pack.color,
      pack.stockLengthMm,
      pack.usedLengthMm,
      pack.wasteLengthMm,
      `${rate}%`,
      cuts,
    ]);
  });
  rows.push(['合计', '', '', '', cutting.totalStockLengthMm, cutting.totalLengthMm, '', `${(cutting.utilizationRate * 100).toFixed(1)}%`, '']);
  return '\uFEFF' + toCsv(rows);
}

/** 报价单 → CSV（UTF-8 BOM）。 */
export function quoteToCsv(quote: QuoteResult, title = '门窗报价单'): string {
  const rows: (string | number)[][] = [[title, '', '', '', '']];
  rows.push(['费用项', '明细', '单位', '数量', '金额(元)']);
  for (const line of quote.lines) {
    rows.push([line.name, line.detail, line.unit, line.quantity, line.amount]);
  }
  rows.push(['洞口面积(㎡)', quote.openingAreaM2, '', '', '']);
  rows.push(['计价面积(㎡)', quote.billedAreaM2, '', '', '']);
  rows.push(['小计(元)', '', '', '', quote.subtotal]);
  rows.push(['优惠(元)', '', '', '', quote.discount]);
  rows.push(['总价(元)', '', '', '', quote.total]);
  return '\uFEFF' + toCsv(rows);
}

function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    profile: '型材',
    glass: '玻璃',
    hardware: '五金',
    accessory: '辅料',
  };
  return map[category] ?? category;
}
