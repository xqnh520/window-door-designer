/**
 * PDF 导出工具（零依赖）：通过隐藏 iframe 渲染 HTML → window.print() → 浏览器「另存为 PDF」。
 * 提供两类导出内容：
 *  1. buildMaterialsPdfHtml —— 当前图形材料清单（图纸缩略图 + BOM 表）
 *  2. buildDrawingQuotePdfHtml —— 图纸（画布 PNG）+ 报价单
 */
import type { BomResult, QuoteResult, CuttingResult } from '@wdd/core';
import { computeGeometry } from '@wdd/core';
import type { SeriesSpec, WindowDesign } from '@wdd/schema';

const CATEGORY_LABEL: Record<string, string> = { profile: '型材', glass: '玻璃', hardware: '五金', accessory: '辅料' };

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pageCss(): string {
  return `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; color: #1a1a1a; margin: 0; font-size: 12px; }
    h1 { font-size: 20px; text-align: center; margin: 0 0 6px; }
    .meta { display: flex; flex-wrap: wrap; gap: 3px 24px; font-size: 11px; color: #555; margin: 6px 0 10px; justify-content: center; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #b5b5b5; padding: 4px 6px; font-size: 11px; }
    th { background: #eef3fa; text-align: left; }
    .num { text-align: right; }
    tfoot td { font-weight: bold; background: #fafafa; }
    .drawing { text-align: center; margin: 6px 0 10px; }
    .drawing img { max-width: 100%; max-height: 190mm; border: 1px solid #ccc; }
    .section { margin-top: 14px; }
    .section h2 { font-size: 14px; border-left: 4px solid #1677ff; padding-left: 8px; margin: 10px 0 6px; }
    .info-table th { width: 130px; background: #f7f9fc; }
    .footer { margin-top: 16px; font-size: 10px; color: #999; text-align: center; }
    .page-break { page-break-before: always; }
    .total-line { margin-top: 8px; text-align: right; font-size: 13px; }
    .total-line b { font-size: 15px; color: #c0182c; }
  `;
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>门窗设计导出</title><style>${pageCss()}</style></head><body>${body}<div class="footer">本文件由「门窗设计软件」自动生成 · ${new Date().toLocaleString('zh-CN')}</div></body></html>`;
}

/** 图纸（画布 PNG）区块 */
function drawingBlock(imageDataUrl?: string): string {
  return imageDataUrl ? '<div class="drawing"><img src="' + imageDataUrl + '" alt="图形"/></div>' : '';
}

/** 图纸信息表格（与设计页「图纸信息」一致） */
function infoTable(design: WindowDesign, series: SeriesSpec): string {
  const geometry = computeGeometry(design, series);
  const rows: [string, string][] = [
    ['产品系列', series.name],
    ['窗型', design.panels.map((p) => p.windowType).join(' / ')],
    ['洞口尺寸', `${design.openingW} × ${design.openingH} mm`],
    ['外框尺寸', `${geometry.sizes.frameOuterW} × ${geometry.sizes.frameOuterH} mm`],
    ['扇面数量', String(design.panels.length)],
    ['玻璃规格', `${design.glassId}`],
    ['材质', `${series.cornerType}° 组角 / 断桥铝`],
    ['单位', 'mm（毫米）'],
  ];
  const trs = rows.map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>').join('');
  return '<table class="info-table">' + trs + '</table>';
}

// =====================================================================
// ① 材料清单 PDF（当前图形材料）
// =====================================================================
export function buildMaterialsPdfHtml(opts: {
  design: WindowDesign;
  series: SeriesSpec;
  bom: BomResult;
  imageDataUrl?: string;
}): string {
  const { design, series, bom, imageDataUrl } = opts;
  const header =
    '<h1>门窗材料清单（下料单）</h1>' +
    '<div class="meta">' +
    '<span>编号：' + esc(design.name) + '</span>' +
    '<span>系列：' + esc(series.name) + '</span>' +
    '<span>洞口：' + design.openingW + '×' + design.openingH + ' mm</span>' +
    '<span>扇面：' + design.panels.length + '</span>' +
    '<span>计价面积：' + bom.billedAreaM2.toFixed(2) + ' ㎡</span>' +
    '</div>' +
    drawingBlock(imageDataUrl);

  const trs = bom.items
    .map(
      (it, i) =>
        '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(CATEGORY_LABEL[it.category] ?? it.category) + '</td>' +
        '<td>' + esc(it.code) + '</td>' +
        '<td>' + esc(it.name) + '</td>' +
        '<td>' + esc(it.spec) + '</td>' +
        '<td>' + esc(it.unit) + '</td>' +
        '<td class="num">' + it.quantity + '</td>' +
        '<td class="num">' + it.unitPrice.toFixed(2) + '</td>' +
        '<td class="num">' + it.amount.toFixed(2) + '</td>' +
        '</tr>',
    )
    .join('');

  const body =
    header +
    '<table>' +
    '<thead><tr><th>#</th><th>分类</th><th>编码</th><th>名称</th><th>规格</th><th>单位</th><th class="num">数量</th><th class="num">单价(元)</th><th class="num">金额(元)</th></tr></thead>' +
    '<tbody>' + trs + '</tbody>' +
    '<tfoot><tr><td colspan="8">合计（单樘）</td><td class="num">¥ ' + bom.totalAmount.toFixed(2) + '</td></tr></tfoot>' +
    '</table>';
  return wrapHtml(body);
}

// =====================================================================
// ② 图纸 + 报价 PDF
// =====================================================================
export function buildDrawingQuotePdfHtml(opts: {
  design: WindowDesign;
  series: SeriesSpec;
  bom: BomResult;
  quote: QuoteResult;
  windowCount: number;
  imageDataUrl?: string;
}): string {
  const { design, series, quote, windowCount, imageDataUrl } = opts;

  // 第 1 页：图纸
  const page1 =
    '<h1>门窗图纸</h1>' +
    '<div class="meta">' +
    '<span>编号：' + esc(design.name) + '</span>' +
    '<span>系列：' + esc(series.name) + '</span>' +
    '</div>' +
    drawingBlock(imageDataUrl) +
    infoTable(design, series);

  // 第 2 页：报价单
  const trs = quote.lines
    .map(
      (line) =>
        '<tr>' +
        '<td>' + esc(line.name) + '</td>' +
        '<td>' + esc(line.detail) + '</td>' +
        '<td>' + esc(line.unit) + '</td>' +
        '<td class="num">' + line.quantity + '</td>' +
        '<td class="num">' + line.unitPrice.toFixed(2) + '</td>' +
        '<td class="num">' + line.amount.toFixed(2) + '</td>' +
        '</tr>',
    )
    .join('');

  const page2 =
    '<div class="page-break"></div>' +
    '<h1>门窗报价单</h1>' +
    '<div class="meta">' +
    '<span>编号：' + esc(design.name) + '</span>' +
    '<span>洞口面积：' + quote.openingAreaM2.toFixed(2) + ' ㎡</span>' +
    '<span>计价面积：' + quote.billedAreaM2.toFixed(2) + ' ㎡</span>' +
    '<span>数量：' + windowCount + ' 樘</span>' +
    '</div>' +
    '<table>' +
    '<thead><tr><th>项目</th><th>明细</th><th>单位</th><th class="num">数量</th><th class="num">单价(元)</th><th class="num">金额(元)</th></tr></thead>' +
    '<tbody>' + trs + '</tbody>' +
    '</table>' +
    '<div class="total-line">小计：¥ ' + quote.subtotal.toFixed(2) + '</div>' +
    (quote.discount > 0 ? '<div class="total-line">优惠：- ¥ ' + quote.discount.toFixed(2) + '</div>' : '') +
    '<div class="total-line">总价（' + windowCount + ' 樘）：<b>¥ ' + quote.total.toFixed(2) + '</b></div>';

  return wrapHtml(page1 + page2);
}

// =====================================================================
// ③ 生产下料 PDF
// =====================================================================
/** 可再利用余料区块（无余料时不输出） */
function remainderBlock(cutting: CuttingResult): string {
  const reusable = cutting.remnants?.filter((r) => r.reusable) ?? [];
  if (!reusable.length) return '';
  const rows = reusable
    .map(
      (r) => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.code) + '</td><td class="num">' + r.lengthMm + '</td><td class="num">1</td></tr>',
    )
    .join('');
  return (
    '<h2>可再利用余料</h2>' +
    '<table><thead><tr><th>型材</th><th>编码</th><th class="num">余料长(mm)</th><th class="num">根数</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>'
  );
}

export function buildCuttingPdfHtml(opts: {
  design: WindowDesign;
  series: SeriesSpec;
  cutting: CuttingResult;
  imageDataUrl?: string;
}): string {
  const { design, series, cutting, imageDataUrl } = opts;
  const rows = cutting.packs
    .map((pack, idx) => {
      const cuts = pack.cuts.map((cut) => `${cut.position} ${cut.lengthMm}mm`).join(' / ');
      const rate = pack.stockLengthMm > 0 ? Math.round((pack.usedLengthMm / pack.stockLengthMm) * 100) : 0;
      return '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + esc(pack.name) + '</td>' +
        '<td>' + esc(pack.code) + '</td>' +
        '<td>' + esc(pack.color) + '</td>' +
        '<td class="num">' + pack.stockLengthMm + '</td>' +
        '<td class="num">' + pack.usedLengthMm + '</td>' +
        '<td class="num">' + pack.wasteLengthMm + '</td>' +
        '<td class="num">' + rate + '%</td>' +
        '<td>' + esc(cuts) + '</td>' +
        '</tr>';
    })
    .join('');

  const body =
    '<h1>门窗生产下料单</h1>' +
    '<div class="meta">' +
    '<span>编号：' + esc(design.name) + '</span>' +
    '<span>系列：' + esc(series.name) + '</span>' +
    '<span>总根数：' + cutting.totalPieces + '</span>' +
    '<span>总长度：' + cutting.totalLengthMm + ' mm</span>' +
    '<span>总原料：' + cutting.totalStockLengthMm + ' mm</span>' +
    '<span>总余料：' + cutting.totalWasteMm + ' mm</span>' +
    '<span>可再利用余料：' + cutting.reusableWasteMm + ' mm</span>' +
    '<span>总利用率：' + (cutting.utilizationRate * 100).toFixed(1) + '%</span>' +
    '</div>' +
    drawingBlock(imageDataUrl) +
    '<table>' +
    '<thead><tr><th>#</th><th>型材</th><th>编码</th><th>颜色</th><th class="num">原料长(mm)</th><th class="num">已用(mm)</th><th class="num">余料(mm)</th><th class="num">利用率</th><th>切割明细</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>' +
    remainderBlock(cutting);
  return wrapHtml(body);
}

// =====================================================================
// 打印执行：隐藏 iframe + window.print()（浏览器「另存为 PDF」）
// =====================================================================
export function printHTML(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();

    const doPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('打印失败:', err);
      }
      window.setTimeout(() => {
        iframe.remove();
        resolve();
      }, 1000);
    };

    // 等待内嵌图纸图片加载完成后再打印
    const imgs = Array.from(doc.images);
    if (imgs.length) {
      let loaded = 0;
      const check = () => {
        loaded += 1;
        if (loaded >= imgs.length) doPrint();
      };
      for (const img of imgs) {
        if (img.complete) check();
        else {
          img.onload = check;
          img.onerror = check;
        }
      }
    } else {
      doPrint();
    }
  });
}
