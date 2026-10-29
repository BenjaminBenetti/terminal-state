// Iteration 13 (MAT-A): a tiny evaluator for the straight-line GLSL ES 3.0 that three r186's GLSLNodeBuilder generates
// (assignments, ternaries, vector maths, swizzles, mat * vec, user functions with a return). Tests run the GENERATED
// shader code of a node graph on sample inputs and compare with a CPU reference, so a codegen problem (e.g. operator
// precedence around an emitted ternary) fails a test instead of only showing up in the browser. Not a GLSL compiler:
// no loops, no if-blocks (they throw), float maths in double precision.

import * as THREE from 'three';

export type Val = number | boolean | number[] | {mat: number[]; n: 3 | 4} | Val[][];
export type Env = Map<string, Val>;
type Fn = (args: Val[]) => Val;

type Tok = {t: 'num'; v: number} | {t: 'id'; v: string} | {t: 'op'; v: string};

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+\.\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|\d+(?:e[+-]?\d+)?)|([A-Za-z_]\w*)|(<=|>=|==|!=|&&|\|\||[-+*/<>?:!(),.[\]]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`glslEval: cannot lex at "${src.slice(i, i + 30)}"`);
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({t: 'num', v: Number(m[1])});
    else if (m[2] !== undefined) out.push({t: 'id', v: m[2]});
    else out.push({t: 'op', v: m[3]});
  }
  return out;
}

const SW: Record<string, number> = {x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3};
const num = (v: Val): number => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as number));
const isVec = (v: Val): v is number[] => Array.isArray(v);
const isMat = (v: Val): v is {mat: number[]; n: 3 | 4} => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A uniform array (e.g. instance matrices) is wrapped as [[...items]] so it is never mistaken for a vector. */
export const arrayVal = (items: Val[]): Val => [items] as unknown as Val;
const isArr = (v: Val): v is Val[][] => Array.isArray(v) && Array.isArray((v as unknown[])[0]);
/** Column-major 3x3 inverse (three's Matrix3: fromArray / elements are column-major). */
const mat3Inverse = (m: number[]): number[] => new THREE.Matrix3().fromArray(m).invert().elements.slice();

function zip(a: Val, b: Val, f: (x: number, y: number) => number): Val {
  if (isVec(a) && isVec(b)) { if (a.length !== b.length) throw new Error('glslEval: vector size mismatch'); return a.map((x, i) => f(x, b[i])); }
  if (isVec(a)) return a.map(x => f(x, num(b)));
  if (isVec(b)) return b.map(y => f(num(a), y));
  return f(num(a), num(b));
}
const map1 = (a: Val, f: (x: number) => number): Val => (isVec(a) ? a.map(f) : f(num(a)));

function mul(a: Val, b: Val): Val {
  if (isMat(a) && isVec(b)) {
    const n = a.n, out = new Array(n).fill(0);
    for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) out[r] += a.mat[c * n + r] * b[c];
    return out;
  }
  if (isMat(a) || isMat(b)) throw new Error('glslEval: unsupported matrix product');
  return zip(a, b, (x, y) => x * y);
}

const flat = (args: Val[]): number[] => args.flatMap(a => (isVec(a) ? a : [num(a)]));
const vecN = (n: number) => (args: Val[]): Val => { const f = flat(args); return f.length === 1 ? new Array(n).fill(f[0]) : f.slice(0, n); };
const fract = (x: number) => x - Math.floor(x);
const len = (v: Val) => Math.sqrt(isVec(v) ? v.reduce((s, x) => s + x * x, 0) : num(v) ** 2);

export const BUILTINS: Record<string, Fn> = {
  vec2: vecN(2), vec3: vecN(3), vec4: vecN(4), float: a => num(a[0]), int: a => Math.trunc(num(a[0])), uint: a => Math.trunc(num(a[0])), bool: a => num(a[0]) !== 0,
  abs: a => map1(a[0], Math.abs), floor: a => map1(a[0], Math.floor), fract: a => map1(a[0], fract), sqrt: a => map1(a[0], Math.sqrt),
  inversesqrt: a => map1(a[0], x => 1 / Math.sqrt(x)), exp: a => map1(a[0], Math.exp), exp2: a => map1(a[0], x => 2 ** x),
  pow: a => zip(a[0], a[1], (x, y) => x ** y), min: a => zip(a[0], a[1], Math.min), max: a => zip(a[0], a[1], Math.max),
  mod: a => zip(a[0], a[1], (x, y) => x - y * Math.floor(x / y)), step: a => zip(a[0], a[1], (e, x) => (x < e ? 0 : 1)),
  clamp: a => zip(zip(a[0], a[1], Math.max), a[2], Math.min),
  mix: a => { const t = a[2]; return zip(zip(a[0], t, (x, s) => x * (1 - s)), zip(a[1], t, (y, s) => y * s), (p, q) => p + q); },
  smoothstep: a => { const t = zip(zip(zip(a[2], a[0], (x, e0) => x - e0), zip(a[1], a[0], (e1, e0) => e1 - e0), (p, q) => p / q), 0, Math.max); const u = map1(t, x => Math.min(1, x)); return map1(u, x => x * x * (3 - 2 * x)); },
  dot: a => flat([a[0]]).reduce((s, x, i) => s + x * flat([a[1]])[i], 0), length: a => len(a[0]),
  mat3: a => ({mat: flat(a).slice(0, 9), n: 3}),
  transpose: a => { const m = a[0] as {mat: number[]; n: 3 | 4}, n = m.n, o = new Array(n * n); for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) o[r * n + c] = m.mat[c * n + r]; return {mat: o, n}; },
  inverse: a => { const m = a[0] as {mat: number[]; n: 3 | 4}; if (m.n !== 3) throw new Error('glslEval: inverse(mat4)'); return {mat: mat3Inverse(m.mat), n: 3}; },
  normalize: a => { const l = len(a[0]); return map1(a[0], x => x / l); },
  cross: a => { const [p, q] = [a[0] as number[], a[1] as number[]]; return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; },
};

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[], private readonly env: Env, private readonly fns: Record<string, Fn>) {}
  private peek(): Tok | undefined { return this.toks[this.i]; }
  private isOp(v: string): boolean { const t = this.peek(); return !!t && t.t === 'op' && t.v === v; }
  private eat(v: string): void { if (!this.isOp(v)) throw new Error(`glslEval: expected "${v}" at token ${this.i}`); this.i++; }
  done(): boolean { return this.i >= this.toks.length; }
  expr(): Val {
    const c = this.binary(0);
    if (!this.isOp('?')) return c;
    this.i++;
    const a = this.expr();
    this.eat(':');
    const b = this.expr();
    return num(c) !== 0 ? a : b;
  }
  private static readonly PREC: [string[], number][] = [[['||'], 1], [['&&'], 2], [['==', '!='], 3], [['<', '>', '<=', '>='], 4], [['+', '-'], 5], [['*', '/'], 6]];
  private prec(v: string): number { for (const [ops, p] of Parser.PREC) if (ops.includes(v)) return p; return -1; }
  private binary(min: number): Val {
    let lhs = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') return lhs;
      const p = this.prec(t.v);
      if (p < 0 || p < min) return lhs;
      this.i++;
      const rhs = this.binary(p + 1);
      lhs = this.apply(t.v, lhs, rhs);
    }
  }
  private apply(op: string, a: Val, b: Val): Val {
    switch (op) {
      case '*': return mul(a, b);
      case '/': return zip(a, b, (x, y) => x / y);
      case '+': return zip(a, b, (x, y) => x + y);
      case '-': return zip(a, b, (x, y) => x - y);
      case '<': return num(a) < num(b);
      case '>': return num(a) > num(b);
      case '<=': return num(a) <= num(b);
      case '>=': return num(a) >= num(b);
      case '==': return num(a) === num(b);
      case '!=': return num(a) !== num(b);
      case '&&': return num(a) !== 0 && num(b) !== 0;
      case '||': return num(a) !== 0 || num(b) !== 0;
    }
    throw new Error(`glslEval: operator ${op}`);
  }
  private unary(): Val {
    if (this.isOp('-')) { this.i++; return map1(this.unary(), x => -x); }
    if (this.isOp('!')) { this.i++; return !(num(this.unary()) !== 0); }
    return this.postfix(this.primary());
  }
  private primary(): Val {
    const t = this.toks[this.i++];
    if (!t) throw new Error('glslEval: unexpected end');
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = this.expr(); this.eat(')'); return v; }
    if (t.t === 'id') {
      if (this.isOp('(')) {
        this.i++;
        const args: Val[] = [];
        while (!this.isOp(')')) { args.push(this.expr()); if (this.isOp(',')) this.i++; }
        this.eat(')');
        const f = this.fns[t.v] ?? BUILTINS[t.v];
        if (!f) throw new Error(`glslEval: unknown function ${t.v}`);
        return f(args);
      }
      if (t.v === 'true' || t.v === 'false') return t.v === 'true';
      const v = this.env.get(t.v);
      if (v === undefined) throw new Error(`glslEval: unbound ${t.v}`);
      return v;
    }
    throw new Error(`glslEval: unexpected token ${JSON.stringify(t)}`);
  }
  private postfix(v: Val): Val {
    for (;;) {
      if (this.isOp('[')) {
        this.i++;
        const idx = num(this.expr());
        this.eat(']');
        if (isArr(v)) v = v[0][idx];
        else if (isMat(v)) v = v.mat.slice(idx * v.n, idx * v.n + v.n);
        else if (isVec(v)) v = v[idx];
        else throw new Error('glslEval: bad index');
        continue;
      }
      if (this.isOp('.')) {
        this.i++;
        const t = this.toks[this.i++];
        if (!t || t.t !== 'id') throw new Error('glslEval: bad member');
        const comps = [...t.v].map(c => SW[c]);
        if (!isVec(v) || comps.some(c => c === undefined)) throw new Error(`glslEval: bad swizzle .${t.v}`);
        v = comps.length === 1 ? v[comps[0]] : comps.map(c => (v as number[])[c]);
        continue;
      }
      return v;
    }
  }
}

/** Evaluate one GLSL expression. */
export function evalExpr(src: string, env: Env, fns: Record<string, Fn> = {}): Val {
  const p = new Parser(lex(src), env, fns);
  const v = p.expr();
  if (!p.done()) throw new Error(`glslEval: trailing tokens in "${src}"`);
  return v;
}

/** Statements of a straight-line block ("name = expr;", declarations skipped, "return expr;" returned). */
export function runBlock(code: string, env: Env, fns: Record<string, Fn> = {}, stopAfter?: string): Val | undefined {
  for (const raw of code.split(';')) {
    const s = raw.replace(/\/\/[^\n]*/g, '').trim();
    if (!s) continue;
    if (/^(if|for|while)\b|[{}]/.test(s)) throw new Error(`glslEval: control flow not supported: "${s.slice(0, 60)}"`);
    if (/^(float|int|uint|bool|vec[234]|ivec[234]|mat[34])\s+\w+$/.test(s)) continue; // declaration
    const r = /^return\s+([\s\S]+)$/.exec(s);
    if (r) return evalExpr(r[1], env, fns);
    const a = /^(\w+)(?:\.(\w+))?\s*=\s*([\s\S]+)$/.exec(s);
    if (!a) throw new Error(`glslEval: unsupported statement "${s.slice(0, 60)}"`);
    const v = evalExpr(a[3], env, fns);
    if (a[2]) {
      const cur = (env.get(a[1]) as number[]).slice();
      [...a[2]].forEach((c, i) => { cur[SW[c]] = isVec(v) ? v[i] : num(v); });
      env.set(a[1], cur);
    } else env.set(a[1], v);
    if (stopAfter && a[1] === stopAfter) return env.get(a[1]);
  }
  return undefined;
}

/** User functions defined in a generated shader ("float name ( vec3 p ) { ... }"), evaluable by name. */
export function shaderFunctions(code: string): Record<string, Fn> {
  const fns: Record<string, Fn> = {};
  const re = /\n(?:float|vec[234]|int|bool) (\w+) \(([^)]*)\) \{([\s\S]*?)\n\}/g;
  for (const m of code.matchAll(re)) {
    const params = m[2].split(',').map(p => p.trim().split(/\s+/).pop()!).filter(Boolean);
    const body = m[3];
    fns[m[1]] = args => {
      const env: Env = new Map(params.map((p, i) => [p, args[i]] as [string, Val]));
      const v = runBlock(body, env, fns);
      if (v === undefined) throw new Error(`glslEval: ${m[1]} returned nothing`);
      return v;
    };
  }
  return fns;
}

/** Body of `void main() { ... }`. */
export function mainBody(code: string): string {
  const i = code.indexOf('void main()');
  const open = code.indexOf('{', i), close = code.lastIndexOf('}');
  return code.slice(open + 1, close);
}

/** Column-major mat4 value (THREE.Matrix4.elements). */
export const mat4 = (elements: ArrayLike<number>): Val => ({mat: Array.from(elements), n: 4});
