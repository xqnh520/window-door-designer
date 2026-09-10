export interface FormulaContext {
  [key: string]: number;
}

export interface FormulaResult {
  ok: boolean;
  value: number;
  error?: string;
}

const ALLOWED_CHARS = /^[0-9+\-*/().,\s_a-zA-Z]+$/;

export function evaluateFormula(formula: string, context: FormulaContext): FormulaResult {
  const expr = formula.trim();
  if (!expr) return { ok: false, value: 0, error: '公式为空' };
  if (!ALLOWED_CHARS.test(expr)) return { ok: false, value: 0, error: '公式包含非法字符' };

  try {
    const tokens = tokenize(expr);
    const rpn = toRpn(tokens);
    const value = evalRpn(rpn, context);
    if (!Number.isFinite(value)) return { ok: false, value: 0, error: '公式结果无效' };
    return { ok: true, value: round2(value) };
  } catch (err) {
    return { ok: false, value: 0, error: err instanceof Error ? err.message : '公式计算失败' };
  }
}

type Token = { type: 'number' | 'ident' | 'op' | 'paren'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      tokens.push({ type: 'number', value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j += 1;
      tokens.push({ type: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    if ('()'.includes(ch)) {
      tokens.push({ type: 'paren', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`不支持的符号：${ch}`);
  }
  return tokens;
}

function toRpn(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const ops: Token[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'number' || t.type === 'ident') {
      out.push(t);
      continue;
    }
    if (t.type === 'op') {
      while (ops.length && ops[ops.length - 1].type === 'op' && precedence(ops[ops.length - 1].value) >= precedence(t.value)) {
        out.push(ops.pop()!);
      }
      ops.push(t);
      continue;
    }
    if (t.value === '(') {
      ops.push(t);
      continue;
    }
    while (ops.length && ops[ops.length - 1].value !== '(') out.push(ops.pop()!);
    if (!ops.length) throw new Error('括号不匹配');
    ops.pop();
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op.value === '(') throw new Error('括号不匹配');
    out.push(op);
  }
  return out;
}

function evalRpn(tokens: Token[], context: FormulaContext): number {
  const stack: number[] = [];
  for (const t of tokens) {
    if (t.type === 'number') {
      stack.push(Number(t.value));
      continue;
    }
    if (t.type === 'ident') {
      if (!(t.value in context)) throw new Error(`未知变量：${t.value}`);
      stack.push(context[t.value]);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error('表达式不完整');
    switch (t.value) {
      case '+': stack.push(a + b); break;
      case '-': stack.push(a - b); break;
      case '*': stack.push(a * b); break;
      case '/': stack.push(b === 0 ? NaN : a / b); break;
      default: throw new Error(`不支持的运算符：${t.value}`);
    }
  }
  if (stack.length !== 1) throw new Error('表达式不完整');
  return stack[0];
}

function precedence(op: string): number {
  return op === '+' || op === '-' ? 1 : 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 公式可用的变量说明（供前端公式配置入口提示与文档） */
export interface FormulaVariableDoc {
  name: string;
  label: string;
  scope: '洞口' | '外框' | '系列' | '扇/玻璃';
  description: string;
}

export const FORMULA_VARIABLES: FormulaVariableDoc[] = [
  { name: 'openingW', label: '洞口宽', scope: '洞口', description: '洞口宽度 (mm)' },
  { name: 'openingH', label: '洞口高', scope: '洞口', description: '洞口高度 (mm)' },
  { name: 'frameOuterW', label: '外框宽', scope: '外框', description: '外框宽度 = 洞口宽 − 2×安装缝 (mm)' },
  { name: 'frameOuterH', label: '外框高', scope: '外框', description: '外框高度 = 洞口高 − 2×安装缝 (mm)' },
  { name: 'outerW', label: '外框宽(别名)', scope: '外框', description: 'frameOuterW 的别名 (mm)' },
  { name: 'outerH', label: '外框高(别名)', scope: '外框', description: 'frameOuterH 的别名 (mm)' },
  { name: 'frameInnerW', label: '框内净宽', scope: '外框', description: '外框内口净宽 (mm)' },
  { name: 'frameInnerH', label: '框内净高', scope: '外框', description: '外框内口净高 (mm)' },
  { name: 'frameWidth', label: '框料断面宽', scope: '系列', description: '系列框料断面宽 (mm)' },
  { name: 'sashWidth', label: '扇料断面宽', scope: '系列', description: '扇料断面宽 (mm)' },
  { name: 'overlap', label: '搭接量', scope: '系列', description: '扇与框搭接量 (mm)' },
  { name: 'glassGap', label: '玻璃间隙', scope: '系列', description: '玻璃安装间隙 (mm)' },
  { name: 'beadWidth', label: '压线宽', scope: '系列', description: '压线宽 (mm)' },
  { name: 'panelOpenW', label: '扇口净宽', scope: '扇/玻璃', description: '单个扇区净宽 (mm)' },
  { name: 'panelOpenH', label: '扇口净高', scope: '扇/玻璃', description: '单个扇区净高 (mm)' },
  { name: 'sashW', label: '扇宽', scope: '扇/玻璃', description: '扇料宽（固定窗为 0）(mm)' },
  { name: 'sashH', label: '扇高', scope: '扇/玻璃', description: '扇料高（固定窗为 0）(mm)' },
  { name: 'glassW', label: '玻璃宽', scope: '扇/玻璃', description: '玻璃宽 (mm)' },
  { name: 'glassH', label: '玻璃高', scope: '扇/玻璃', description: '玻璃高 (mm)' },
  { name: 'sashCount', label: '扇数', scope: '扇/玻璃', description: '该扇区扇数（固定窗为 0）' },
];

/** 提取公式中引用的变量名（按出现顺序、去重）；公式非法时返回已解析部分 */
export function extractFormulaVariables(formula: string): string[] {
  const seen = new Set<string>();
  const variables: string[] = [];
  try {
    for (const t of tokenize(formula)) {
      if (t.type === 'ident' && !seen.has(t.value)) {
        seen.add(t.value);
        variables.push(t.value);
      }
    }
  } catch {
    return variables;
  }
  return variables;
}
