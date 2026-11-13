#!/usr/bin/env node
// ActionScript 2 -> JavaScript compiler for the Shrapnel City sources.
//
// Every frame script and instance (onClipEvent / on) script from the FLA is
// translated into a JS function that runs against the Flash-like runtime with
// AS2 (AVM1) scoping rules preserved:
//   * unqualified names resolve: function locals -> defining timeline -> _global
//   * assigning an unknown name creates a timeline variable
//   * top-level `var` and `function` in a frame script live on the timeline,
//     and named functions are hoisted to the top of the frame's action block
//   * property access on undefined is silent (a?.b), as in AS2
//   * for..in walks keys in AS2 order (newest first), including child clips
//   * #include files are inlined, exactly like the Flash compiler did
//
// Usage: node tools/as2js.mjs  (reads assets/symbols.json + as2/*.as,
//        writes src/generated/scripts.js)
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import { generate } from 'astring';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const AS_DIR = path.join(ROOT, 'as2');
const symbols = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/symbols.json'), 'utf8'));

// ---------------------------------------------------------------------------
// preprocessing
function expandIncludes(src, seen = []) {
  return src.replace(/^[ \t]*#include\s+"([^"]+)"[^\n]*$/gm, (m, p) => {
    // "as/frames/x.as" -> as2/frames/x.as; the original "as/object/x.as" paths -> as2/x.as
    let file = path.join(AS_DIR, p.replace(/^as\//, ''));
    if (!fs.existsSync(file)) file = path.join(AS_DIR, path.basename(p));
    if (seen.includes(file)) throw new Error('recursive include ' + p);
    if (!fs.existsSync(file)) throw new Error('missing include ' + p);
    const inc = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    return `/* #include "${p}" */\n` + expandIncludes(inc, [...seen, file]) + `\n/* end #include "${p}" */`;
  });
}

function stripTypes(src) {
  // var x:Type
  src = src.replace(/(\bvar\s+[A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$.]*/g, '$1');
  // function f(a:Type, b:Type):Ret
  src = src.replace(/(\bfunction\b\s*[\w$]*\s*\()([^)]*)\)(\s*:\s*[A-Za-z_$][\w$.]*)?/g, (m, head, params) =>
    head + params.replace(/([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$.]*/g, '$1') + ')');
  // import a.b.C;
  src = src.replace(/^\s*import\s+[\w.*]+\s*;?\s*$/gm, '');
  return src;
}

// split instance scripts into onClipEvent(...) / on(...) handler blocks
function splitHandlers(src) {
  const out = [];
  let i = 0, depth = 0;
  const n = src.length;
  let rest = '';
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; j++; }
      rest += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (depth === 0) {
      const m = /^(onClipEvent|on)\s*\(([^)]*)\)\s*\{/.exec(src.slice(i));
      if (m && (i === 0 || /[\s;}]/.test(src[i - 1]))) {
        // find matching brace
        let j = i + m[0].length, d = 1;
        while (j < n && d > 0) {
          const c = src[j];
          if (c === '/' && src[j + 1] === '/') { const e = src.indexOf('\n', j); j = e < 0 ? n : e; continue; }
          if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
          if (c === '"' || c === "'") { let k = j + 1; while (k < n && src[k] !== c) { if (src[k] === '\\') k++; k++; } j = k + 1; continue; }
          if (c === '{') d++;
          else if (c === '}') d--;
          j++;
        }
        const body = src.slice(i + m[0].length, j - 1);
        const events = m[2].split(',').map((s) => s.trim()).filter(Boolean);
        out.push({ kind: m[1], events, body });
        i = j;
        continue;
      }
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    rest += ch;
    i++;
  }
  return { handlers: out, rest };
}

// ---------------------------------------------------------------------------
// name tables
const CLIP_API = new Set(`_x _y _xscale _yscale _rotation _alpha _visible _name _width _height _xmouse _ymouse
  _root _parent _currentframe _totalframes _target _quality _framesloaded _url _level0
  gotoAndStop gotoAndPlay play stop nextFrame prevFrame attachMovie duplicateMovieClip createEmptyMovieClip
  removeMovieClip getNextHighestDepth getDepth swapDepths hitTest getBounds getRect localToGlobal globalToLocal
  attachBitmap lineStyle beginFill endFill moveTo lineTo curveTo clear setMask getBytesLoaded getBytesTotal
  getInstanceAtDepth filters blendMode cacheAsBitmap useHandCursor enabled transform scrollRect`.split(/\s+/).filter(Boolean));
const AS_BUILTINS = new Set(`trace int random getTimer setTimeout clearTimeout setInterval clearInterval Key Mouse Stage
  SharedObject Color flash TextField ASSetPropFlags MovieClip escape unescape getVersion Sound System`.split(/\s+/).filter(Boolean));
const JS_GLOBALS = new Set(`Math String Number Array Object Boolean Date parseInt parseFloat isNaN isFinite Error Function
  undefined NaN Infinity`.split(/\s+/));
const RESERVED_RENAME = { interface: 'interface_', package: 'package_', private: 'private_', public: 'public_',
  protected: 'protected_', static: 'static_', implements: 'implements_', let: 'let_', yield: 'yield_', enum: 'enum_', await: 'await_' };

// ---------------------------------------------------------------------------
// AST helpers
const id = (name) => ({ type: 'Identifier', name });
const lit = (value) => ({ type: 'Literal', value });
const mem = (object, prop, computed = false) => ({ type: 'MemberExpression', object, property: typeof prop === 'string' && !computed ? id(prop) : prop, computed, optional: false });
const call = (callee, args) => ({ type: 'CallExpression', callee, arguments: args, optional: false });
const C = () => id('$c');
const assign = (left, right, operator = '=') => ({ type: 'AssignmentExpression', operator, left, right });
const exprStmt = (expression) => ({ type: 'ExpressionStatement', expression });

function collectVarNames(body, names) {
  // var + function declarations of a function body, not crossing nested functions
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) names.add(d.id.name);
    if (node.type === 'FunctionDeclaration') { names.add(node.id.name); return; }
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return;
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(body);
  return names;
}

let fnCounter = 0;

class Compiler {
  constructor(globalNames, timelineNames) {
    this.globalNames = globalNames;     // names only ever defined on _global
    this.timelineNames = timelineNames;
    this.unknown = new Set();
  }

  isLocal(name, scope) {
    // AVM1: a `var x` local does not exist until its declaration runs, so `var x = f(x)`
    // reads x from the enclosing scope (pending names skip this function's locals)
    for (let s = scope; s && !s.timeline; s = s.parent) if (s.locals.has(name) && !(s.pending && s.pending.has(name))) return true;
    return false;
  }
  inFunction(scope) { return !!scope && !scope.timeline; }

  // read of an unqualified, non-local name
  readName(name) {
    if (name === '_global') return id('G');
    if (JS_GLOBALS.has(name)) return id(name);
    if (CLIP_API.has(name)) return mem(C(), name);
    if (AS_BUILTINS.has(name) && !this.timelineNames.has(name)) return mem(id('AS'), name);
    if (this.globalNames.has(name) && !this.timelineNames.has(name)) return mem(id('G'), name);
    return call(id('$v'), [C(), lit(name)]);
  }
  writeTarget(name) {
    if (name === '_global') return id('G');
    return mem(C(), name);
  }

  compileBlock(src, label) {
    let ast;
    try {
      ast = acorn.parse(src, { ecmaVersion: 2020, sourceType: 'script', allowReturnOutsideFunction: true,
        allowReserved: true, locations: true });
    } catch (e) {
      const lines = src.split('\n');
      const ln = e.loc ? e.loc.line : 0;
      throw new Error(`${label}: ${e.message}\n${lines.slice(Math.max(0, ln - 3), ln + 2).join('\n')}`);
    }
    const scope = { timeline: true, locals: new Set(), parent: null };
    // hoist top-level function declarations onto the timeline
    const hoisted = [];
    const body = [];
    for (const st of ast.body) {
      if (st.type === 'FunctionDeclaration') hoisted.push(st);
      else body.push(st);
    }
    const out = [];
    for (const fd of hoisted) {
      const fe = this.fn({ ...fd, type: 'FunctionExpression', id: null }, scope);
      out.push(exprStmt(assign(mem(C(), fd.id.name), fe)));
    }
    for (const st of body) {
      const t = this.stmt(st, scope);
      if (t) out.push(t);
    }
    return { type: 'Program', body: out, sourceType: 'module' };
  }

  fn(node, parentScope) {
    const locals = new Set(['arguments']);
    for (const p of node.params) locals.add(p.name);
    collectVarNames(node.body, locals);
    if (node.id) locals.add(node.id.name);
    const scope = { timeline: false, locals, parent: parentScope, calleeName: null, node,
      seen: new Set(['arguments', ...node.params.map((p) => p.name), ...(node.id ? [node.id.name] : [])]), pending: new Set() };
    // arguments.callee support (strict-mode safe): name the function
    const usesCallee = JSON.stringify(node.body, (k, v) => (k === 'start' || k === 'end' || k === 'loc' ? undefined : v))
      .includes('"name":"callee"');
    let fid = node.id;
    if (usesCallee) {
      const nm = '$fn' + (++fnCounter);
      scope.calleeName = nm;
      fid = id(nm);
      locals.add(nm);
    }
    const body = { type: 'BlockStatement', body: node.body.body.map((s) => this.stmt(s, scope)).filter(Boolean) };
    return { type: 'FunctionExpression', id: fid ? id(fid.name) : null, params: node.params.map((p) => id(this.ren(p.name))), body,
      generator: false, async: false, expression: false };
  }

  ren(name) { return RESERVED_RENAME[name] || name; }

  stmt(node, scope) {
    if (!node) return node;
    switch (node.type) {
      case 'VariableDeclaration': {
        if (this.inFunction(scope)) {
          return { type: 'VariableDeclaration', kind: 'var', declarations: node.declarations.map((d) => {
            const nm = d.id.name, early = scope.seen && !scope.seen.has(nm);
            if (early) scope.pending.add(nm);
            const init = d.init ? this.expr(d.init, scope) : null;
            if (early) { scope.pending.delete(nm); scope.seen.add(nm); }
            return { type: 'VariableDeclarator', id: id(this.ren(nm)), init };
          }) };
        }
        // timeline var: assignment onto the clip; bare `var x;` keeps any existing value
        const exprs = node.declarations.filter((d) => d.init).map((d) => assign(this.writeTarget(d.id.name), this.expr(d.init, scope)));
        if (!exprs.length) return null;
        return exprStmt(exprs.length === 1 ? exprs[0] : { type: 'SequenceExpression', expressions: exprs });
      }
      case 'FunctionDeclaration': {
        // nested declaration inside a function: stays local (JS hoists it too)
        const fe = this.fn({ ...node, type: 'FunctionExpression' }, scope);
        return { ...fe, type: 'FunctionDeclaration', id: id(this.ren(node.id.name)) };
      }
      case 'ExpressionStatement': return exprStmt(this.expr(node.expression, scope));
      case 'BlockStatement': return { type: 'BlockStatement', body: node.body.map((s) => this.stmt(s, scope)).filter(Boolean) };
      case 'IfStatement': return { type: 'IfStatement', test: this.expr(node.test, scope),
        consequent: this.stmt(node.consequent, scope) || { type: 'EmptyStatement' }, alternate: node.alternate ? this.stmt(node.alternate, scope) || { type: 'EmptyStatement' } : null };
      case 'ForStatement': {
        let init = node.init;
        if (init && init.type === 'VariableDeclaration') {
          if (this.inFunction(scope)) init = this.stmt(init, scope);
          else {
            const exprs = init.declarations.filter((d) => d.init).map((d) => assign(this.writeTarget(d.id.name), this.expr(d.init, scope)));
            init = exprs.length ? (exprs.length === 1 ? exprs[0] : { type: 'SequenceExpression', expressions: exprs }) : null;
          }
        } else if (init) init = this.expr(init, scope);
        return { type: 'ForStatement', init, test: node.test ? this.expr(node.test, scope) : null,
          update: node.update ? this.expr(node.update, scope) : null, body: this.stmt(node.body, scope) || { type: 'EmptyStatement' } };
      }
      case 'ForInStatement': {
        let left;
        if (node.left.type === 'VariableDeclaration') {
          const nm = node.left.declarations[0].id.name;
          left = this.inFunction(scope) ? { type: 'VariableDeclaration', kind: 'var', declarations: [{ type: 'VariableDeclarator', id: id(this.ren(nm)), init: null }] }
            : this.writeTarget(nm);
        } else left = this.lval(node.left, scope);
        return { type: 'ForOfStatement', await: false, left, right: call(id('$keys'), [this.expr(node.right, scope)]),
          body: this.stmt(node.body, scope) || { type: 'EmptyStatement' } };
      }
      case 'WhileStatement': return { type: 'WhileStatement', test: this.expr(node.test, scope), body: this.stmt(node.body, scope) || { type: 'EmptyStatement' } };
      case 'DoWhileStatement': return { type: 'DoWhileStatement', test: this.expr(node.test, scope), body: this.stmt(node.body, scope) || { type: 'EmptyStatement' } };
      case 'ReturnStatement': return { type: 'ReturnStatement', argument: node.argument ? this.expr(node.argument, scope) : null };
      case 'SwitchStatement': return { type: 'SwitchStatement', discriminant: this.expr(node.discriminant, scope),
        cases: node.cases.map((c) => ({ type: 'SwitchCase', test: c.test ? this.expr(c.test, scope) : null, consequent: c.consequent.map((s) => this.stmt(s, scope)).filter(Boolean) })) };
      case 'BreakStatement': case 'ContinueStatement': case 'EmptyStatement': case 'DebuggerStatement': return node;
      case 'LabeledStatement': return { ...node, body: this.stmt(node.body, scope) };
      case 'ThrowStatement': return { type: 'ThrowStatement', argument: this.expr(node.argument, scope) };
      case 'TryStatement': {
        const handler = node.handler ? (() => {
          const s = { timeline: false, locals: new Set([node.handler.param.name]), parent: scope };
          return { type: 'CatchClause', param: id(node.handler.param.name), body: this.stmt(node.handler.body, this.inFunction(scope) ? s : scope) };
        })() : null;
        return { type: 'TryStatement', block: this.stmt(node.block, scope), handler, finalizer: node.finalizer ? this.stmt(node.finalizer, scope) : null };
      }
      default:
        throw new Error('unsupported statement ' + node.type);
    }
  }

  // assignment target
  lval(node, scope) {
    if (node.type === 'Identifier') {
      if (this.isLocal(node.name, scope)) { if (scope.seen) scope.seen.add(node.name); return id(this.ren(node.name)); }
      return this.writeTarget(node.name);
    }
    if (node.type === 'MemberExpression') {
      const obj = this.expr(node.object, scope, true);
      const safe = this.isSafeObject(obj) ? obj : call(id('$o'), [obj]);
      return mem(safe, node.computed ? this.expr(node.property, scope) : id(node.property.name), node.computed);
    }
    throw new Error('bad lvalue ' + node.type);
  }

  isSafeObject(n) {
    return (n.type === 'Identifier' && (n.name === '$c' || n.name === 'G' || n.name === 'AS' || n.name === 'Math')) || n.type === 'ThisExpression';
  }

  member(node, scope) {
    // optional-chained member read
    const obj = this.expr(node.object, scope, true);
    const prop = node.computed ? this.expr(node.property, scope) : id(node.property.name);
    const m = mem(stripChain(obj), prop, node.computed);
    m.optional = !this.isSafeObject(obj) && !(obj.type === 'Identifier' && JS_GLOBALS.has(obj.name));
    return m;
  }

  expr(node, scope, inChain = false) {
    const r = this.expr0(node, scope);
    // wrap optional chains at their outermost point
    if (!inChain && containsOptional(r)) return { type: 'ChainExpression', expression: r };
    return r;
  }

  expr0(node, scope) {
    switch (node.type) {
      case 'Literal': return node.regex ? node : lit(node.value);
      case 'Identifier': {
        const nm = node.name;
        if (this.isLocal(nm, scope)) return id(this.ren(nm));
        if (nm === 'undefined' || nm === 'NaN' || nm === 'Infinity') return id(nm);
        return this.readName(nm);
      }
      case 'ThisExpression': return this.inFunction(scope) ? node : C();
      case 'ArrayExpression': return { type: 'ArrayExpression', elements: node.elements.map((e) => (e ? this.expr(e, scope) : null)) };
      case 'ObjectExpression': return { type: 'ObjectExpression', properties: node.properties.map((p) => ({
        type: 'Property', kind: 'init', method: false, shorthand: false, computed: false,
        key: p.key.type === 'Identifier' ? id(p.key.name) : lit(p.key.value), value: this.expr(p.value, scope) })) };
      case 'FunctionExpression': return this.fn(node, scope);
      case 'UnaryExpression': {
        if (node.operator === 'typeof') return call(id('$typeof'), [this.expr(node.argument, scope)]);
        if (node.operator === 'delete') {
          const a = node.argument;
          if (a.type === 'Identifier') {
            if (this.isLocal(a.name, scope)) return lit(false);
            return { type: 'UnaryExpression', operator: 'delete', prefix: true, argument: mem(C(), a.name) };
          }
          if (a.type === 'MemberExpression') return { type: 'UnaryExpression', operator: 'delete', prefix: true, argument: this.lval(a, scope) };
        }
        return { type: 'UnaryExpression', operator: node.operator, prefix: true, argument: this.expr(node.argument, scope) };
      }
      case 'UpdateExpression': {
        const a = node.argument;
        if (a.type === 'Identifier' && !this.isLocal(a.name, scope) && !CLIP_API.has(a.name)) {
          return call(id('$inc'), [C(), lit(a.name), lit(node.operator === '++' ? 1 : -1), lit(node.prefix)]);
        }
        return { type: 'UpdateExpression', operator: node.operator, prefix: node.prefix, argument: this.lval(a, scope) };
      }
      case 'BinaryExpression': return { type: 'BinaryExpression', operator: node.operator, left: this.expr(node.left, scope), right: this.expr(node.right, scope) };
      case 'LogicalExpression': return { type: 'LogicalExpression', operator: node.operator, left: this.expr(node.left, scope), right: this.expr(node.right, scope) };
      case 'ConditionalExpression': return { type: 'ConditionalExpression', test: this.expr(node.test, scope), consequent: this.expr(node.consequent, scope), alternate: this.expr(node.alternate, scope) };
      case 'SequenceExpression': return { type: 'SequenceExpression', expressions: node.expressions.map((e) => this.expr(e, scope)) };
      case 'AssignmentExpression': {
        const l = node.left;
        if (l.type === 'Identifier' && !this.isLocal(l.name, scope) && node.operator !== '=' && !CLIP_API.has(l.name)) {
          // x op= v on a scope-chain name: read through the chain, write to the timeline
          const op = node.operator.slice(0, -1);
          return assign(this.writeTarget(l.name), { type: 'BinaryExpression', operator: op, left: this.readName(l.name), right: this.expr(node.right, scope) });
        }
        return assign(this.lval(l, scope), this.expr(node.right, scope), node.operator);
      }
      case 'MemberExpression': {
        // arguments.callee
        if (!node.computed && node.property.name === 'callee' && node.object.type === 'Identifier' && node.object.name === 'arguments') {
          for (let s = scope; s && !s.timeline; s = s.parent) if (s.calleeName) return id(s.calleeName);
        }
        return this.member(node, scope);
      }
      case 'CallExpression': {
        const cal = node.callee;
        const args = node.arguments.map((a) => this.expr(a, scope));
        if (cal.type === 'Identifier' && !this.isLocal(cal.name, scope)) {
          const r = this.readName(cal.name);
          if (r.type === 'MemberExpression' || (r.type === 'Identifier' && JS_GLOBALS.has(r.name))) {
            if (r.type === 'MemberExpression' && r.object.name === 'G') {
              // _global function: AS2 passes the calling timeline as `this`
              return call(mem(r, 'call'), [C(), ...args]);
            }
            return call(r, args);
          }
          return call(id('$call'), [C(), lit(cal.name), ...args]);
        }
        if (cal.type === 'MemberExpression') {
          const m = this.member(cal, scope);
          const c = call(m, args);
          c.optional = m.optional;
          return c;
        }
        const c = call(this.expr(cal, scope, true), args);
        return c;
      }
      case 'NewExpression': return { type: 'NewExpression', callee: clearOptional(stripChain(this.expr(node.callee, scope))), arguments: node.arguments.map((a) => this.expr(a, scope)) };
      default:
        throw new Error('unsupported expression ' + node.type);
    }
  }
}

function clearOptional(n) {
  for (let x = n; x && (x.type === 'MemberExpression' || x.type === 'CallExpression'); x = x.object || x.callee) x.optional = false;
  return n;
}
function stripChain(n) { return n.type === 'ChainExpression' ? n.expression : n; }
function containsOptional(n) {
  while (n && (n.type === 'MemberExpression' || n.type === 'CallExpression')) {
    if (n.optional) return true;
    n = n.type === 'MemberExpression' ? n.object : n.callee;
  }
  return false;
}

// ---------------------------------------------------------------------------
// gather name tables across the whole corpus
function corpusNames(sources) {
  const globals = new Set(), timeline = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/_global\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) globals.add(m[1]);
    let ast;
    try { ast = acorn.parse(src, { ecmaVersion: 2020, sourceType: 'script', allowReturnOutsideFunction: true, allowReserved: true }); } catch (e) { continue; }
    // any unqualified assignment / top-level var / top-level function can create a timeline name
    const walk = (node, inFn) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'FunctionDeclaration' && !inFn) timeline.add(node.id.name);
      if (node.type === 'VariableDeclaration' && !inFn) node.declarations.forEach((d) => timeline.add(d.id.name));
      if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') timeline.add(node.left.name);
      if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') timeline.add(node.argument.name);
      if (node.type === 'ForInStatement' && node.left.type === 'Identifier') timeline.add(node.left.name);
      const fn = inFn || node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression';
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
        else if (v && typeof v.type === 'string') walk(v, fn);
      }
    };
    walk(ast, false);
  }
  return { globals, timeline };
}

// ---------------------------------------------------------------------------
function prep(src) { return stripTypes(expandIncludes(src.replace(/\r\n?/g, '\n'))); }

const KEY_NAMES = { '<Enter>': 13, '<Space>': 32, '<Escape>': 27, '<Left>': 37, '<Right>': 39, '<Up>': 38, '<Down>': 40,
  '<Tab>': 9, '<Delete>': 46, '<Insert>': 45, '<Home>': 36, '<End>': 35, '<PageUp>': 33, '<PageDown>': 34, '<Backspace>': 8 };

function main() {
  const frameSrc = []; // [charId, frame, name, src]
  for (const [cid, sym] of Object.entries(symbols.symbols)) {
    for (const [f, src] of Object.entries(sym.scripts || {})) frameSrc.push([cid, f, sym.name, prep(src)]);
  }
  const instSrc = [];
  for (const [key, src] of Object.entries(symbols.instances)) {
    const { handlers, rest } = splitHandlers(prep(src));
    instSrc.push([key, handlers, rest]);
  }
  const all = [...frameSrc.map((x) => x[3]), ...instSrc.flatMap((x) => x[1].map((h) => h.body))];
  const { globals, timeline } = corpusNames(all);
  const comp = new Compiler(globals, timeline);

  const lines = [];
  lines.push('// GENERATED by tools/as2js.mjs from the original ActionScript 2 sources (as2/ and the FLA timelines).');
  lines.push('// Do not edit by hand: change the compiler or the AS sources and regenerate.');
  lines.push('/* eslint-disable */');
  lines.push('export default function scripts(env) {');
  lines.push('const { G, AS, $v, $call, $o, $keys, $inc, $typeof } = env;');
  lines.push('const frames = {}, instances = {};');
  let errors = 0;
  const emit = (prog) => generate(prog, { indent: '  ' }).trim().replace(/\n/g, '\n  ');
  frameSrc.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [cid, f, name, src] of frameSrc) {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
    if (!stripped) continue;
    try {
      const prog = comp.compileBlock(src, `${name} frame ${f}`);
      lines.push(`// [${name}] frame ${f}`);
      lines.push(`(frames[${cid}] ||= {})[${f}] = function ($c) {\n  ${emit(prog)}\n};`);
    } catch (e) { errors++; console.error(String(e.message || e)); }
  }
  for (const [key, handlers, rest] of instSrc) {
    if (rest.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim()) console.warn('instance', key, 'has code outside handlers:', rest.trim().slice(0, 80));
    if (!handlers.length) continue;
    const parts = [];
    for (const h of handlers) {
      try {
        const prog = comp.compileBlock(h.body, `instance ${key} ${h.kind}(${h.events})`);
        const fnSrc = `function ($c) {\n    ${emit(prog).replace(/\n/g, '\n  ')}\n  }`;
        for (const ev of h.events) {
          let k = ev;
          const kp = /^keyPress\s+"([^"]+)"$/.exec(ev);
          if (kp) k = 'key' + (KEY_NAMES[kp[1]] || kp[1].charCodeAt(0));
          parts.push(`  ${JSON.stringify((h.kind === 'on' ? 'on:' : 'clip:') + k)}: ${fnSrc}`);
        }
      } catch (e) { errors++; console.error(String(e.message || e)); }
    }
    lines.push(`instances[${JSON.stringify(key)}] = {\n${parts.join(',\n')}\n};`);
  }
  lines.push('return { frames, instances };');
  lines.push('}');
  fs.mkdirSync(path.join(ROOT, 'src/generated'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src/generated/scripts.js'), lines.join('\n') + '\n');
  console.log(`compiled ${frameSrc.length} frame scripts, ${instSrc.length} instance scripts, ${errors} errors`);
  if (errors) process.exitCode = 1;
}

main();
