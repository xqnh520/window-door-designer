/**
 * 单据号生成：{前缀}-{yyyyMMdd}-{4 位当日序号}
 * 序号存 localStorage；服务端对重复单据号有幂等兜底（batch-outbound 会拒绝重复单号）。
 */
export type DocPrefix = 'PO' | 'WO' | 'IC';

export const DOC_PREFIX_LABEL: Record<DocPrefix, string> = {
  PO: '入库单',
  WO: '出库单',
  IC: '盘点单',
};

export function todayStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function nextDocNo(prefix: DocPrefix): string {
  const day = todayStamp();
  try {
    const key = `wdd-doc-seq-${prefix}-${day}`;
    const seq = Number(localStorage.getItem(key) ?? '0') + 1;
    localStorage.setItem(key, String(seq));
    return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
  } catch {
    // localStorage 不可用（隐私模式等）时用时间戳兜底，仍能保证单号唯一
    return `${prefix}-${day}-${Date.now().toString().slice(-4)}`;
  }
}
