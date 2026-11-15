import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("R340 preserves the six legacy dashboard tiles in one three-column board",()=>{
  const view=readFileSync(new URL("../src/noor-personal-application-view.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../src/noor-functional-r331.css",import.meta.url),"utf8");
  const start=view.indexOf('<section className="np-r331-board np-card"');
  const end=view.indexOf("</section>",start);
  assert.ok(start>=0&&end>start,"R331 board markup must remain mounted");
  const board=view.slice(start,end);
  assert.equal((board.match(/className="np-r331-tile/g)??[]).length,6,"the board must contain exactly six legacy tiles");
  assert.match(css,/\.np-r331-board-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,"the board must use three columns");
});
