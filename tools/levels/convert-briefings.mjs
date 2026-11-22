// One-time conversion (2026-11-22): the original briefing.json files were the Flash timeline's
// placements, with the mission text baked into static-text symbols (screen_mc/text N, glyph
// numbers, not strings). This decodes those glyphs and writes the editable briefing model
// ({title, body, captions, graphics}, see levels/README.md). It also gives the bold Digital
// Display font the advances and metrics a live text field needs (the FLA only used it as static
// text, so it had none). Re-running it on a converted level does nothing.
//
// Usage: node tools/levels/convert-briefings.mjs [NN_Name ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIEFING_STYLES, briefingJSON } from './compile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = path.join(ROOT, 'source/library');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sym = (name) => { const f = path.join(LIB, name + '.json'); return fs.existsSync(f) ? read(f) : null; };
const fonts = {};
const font = (name) => (fonts[name] ||= sym(name));
const round2 = (v) => Math.round(v * 100) / 100;

// --- the bold font: advances from every static text that uses it, metrics from the regular cut
{
  const name = 'fonts/Digital Display Regular Bold', file = path.join(LIB, name + '.json');
  const bold = read(file);
  if (!bold.advances) {
    const reg = sym('fonts/Digital Display Regular');
    const adv = new Array(bold.codes.length).fill(null);
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        if (!e.name.endsWith('.json')) continue;
        const o = read(f);
        if (o.kind !== 'static text') continue;
        for (const r of o.records || []) if (r.font === name) for (const [g, a] of r.glyphs) if (adv[g] === null) adv[g] = round2(a * bold.em / r.size);
      }
    })(LIB);
    const regAdv = new Map(reg.codes.map((c, i) => [c, reg.advances[i]]));
    bold.advances = adv.map((a, i) => a ?? regAdv.get(bold.codes[i]) ?? round2(bold.em * 0.5));
    for (const k of ['ascent', 'descent', 'leading']) bold[k] = reg[k];
    const { fullName, ...rest } = bold;
    fs.writeFileSync(file, JSON.stringify({ ...rest, fullName }, null, 2) + '\n');
    console.log('gave', name, 'advances and metrics');
  }
}

const styleOf = (r) => {
  const f = r.font, s = r.size;
  if (f === 'fonts/Digital Display Regular Bold') return s >= 30 ? 'title' : 'label';
  if (f === 'fonts/Consolas') return s >= 13 ? 'body' : 'note';
  if (f === 'fonts/Digital Display Regular') return 'name';
  return null;
};
const lineHeight = (fontName, size) => { const f = font(fontName); return ((f.ascent ?? f.em * 0.8) + (f.descent ?? f.em * 0.2)) * size / f.em; };
const TEMPLATE = new Set(['interface/mask wipe', 'interface/buttons/btn play mission', 'interface/buttons/btn back to main menu', 'interface/screens/briefing monitor scanlines anim']);

const folders = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(ROOT, 'levels')).filter((d) => /^\d\d_/.test(d));
for (const folder of folders) {
  const file = path.join(ROOT, 'levels', folder, 'briefing.json');
  if (!fs.existsSync(file)) continue;
  const old = read(file);
  if (!old.changes) { console.log(folder, 'already converted'); continue; }
  const index = +folder.slice(0, 2);
  const out = { title: '', body: '', captions: [], graphics: [] };
  for (const c of [...old.changes].sort((a, b) => a.depth - b.depth)) {
    if (TEMPLATE.has(c.place)) continue;
    if (/^screen_mc\/shape [12]$/.test(c.place) && c.depth <= 3370 && !c.x && !c.y) { if (c.place !== 'screen_mc/shape 2') out.backdrop = c.place; continue; }
    const t = sym(c.place);
    if (!t || t.kind !== 'static text') { const { depth, place: symbol, clipEvents, ...g } = c; out.graphics.push({ symbol, ...g }); continue; }
    const recs = t.records;
    const style = styleOf(recs[0]);
    const codes = font(recs[0].font).codes;
    const lines = recs.map((r) => r.glyphs.map(([g]) => String.fromCharCode(codes[g])).join('').replace(/\s+$/, ''));
    const text = lines.join('\n');
    const st = BRIEFING_STYLES[style];
    const ox = c.x + t.matrix[4], oy = c.y + t.matrix[5];
    const spacing = recs.length > 1 ? (recs[recs.length - 1].y - recs[0].y) / (recs.length - 1) : null;
    const leading = spacing === null ? undefined : round2(spacing - lineHeight(recs[0].font, recs[0].size));
    if (style === 'title') out.title = text;
    else if (style === 'label') { if (text !== 'LVL.' + String(index).padStart(2, '0')) out.label = text; }
    else if (style === 'body') { out.body = text; if (leading !== undefined && Math.abs(leading - st.leading) > 0.3) out.bodyLeading = leading; }
    else {
      const r0 = recs[0];
      const w = r0.glyphs.reduce((s, [, a]) => s + a, 0);
      const cap = { style, text, x: round2(ox + (r0.x || 0) + w / 2), y: round2(oy + r0.y - st.asc) };
      if (leading !== undefined && Math.abs(leading - (st.leading ?? 2)) > 0.3) cap.leading = leading;
      out.captions.push(cap);
    }
  }
  fs.writeFileSync(file, briefingJSON(out));
  console.log(folder, '->', JSON.stringify({ title: out.title, captions: out.captions.length, graphics: out.graphics.length }));
}
