import { D2 } from '@terrastruct/d2';
const d2 = new D2();
const src = `x: |md
  <img src="x" onerror="alert(1)" />
  <a href="javascript:alert(2)">go</a>
  <script>alert(3)</script>
|
`;
const r = await d2.compile(src);
const out = await d2.render(r.diagram, r.renderOptions);
const svg = typeof out === 'string' ? out : out.svg ?? JSON.stringify(Object.keys(out));
for (const pat of ['onerror', '<script', 'javascript:', 'alert(']) {
  const i = svg.indexOf(pat);
  console.log(pat.padEnd(12), i < 0 ? 'absent' : JSON.stringify(svg.slice(Math.max(0,i-80), i+80)));
}
