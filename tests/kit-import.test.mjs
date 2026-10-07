import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import Papa from "papaparse";
const source = await readFile(
  new URL("../src/lib/kitImport.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { parseKitMatrix, checkKitRows, pairKey } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
test("Horizontal CSV mantém códigos e aceita produtos repetidos e colunas vazias", () => {
  const matrix = Papa.parse(
    "PRODUTO;Comp 1;Comp 2;Comp 3\n 00123 ; C-1 ;; C 2 \n00123;C-3;C-1;",
    { skipEmptyLines: "greedy" },
  ).data;
  const rows = parseKitMatrix(matrix);
  assert.deepEqual(
    rows.map((row) => [row.product, row.component, row.status]),
    [
      ["00123", "C-1", "new"],
      ["00123", "C 2", "new"],
      ["00123", "C-3", "new"],
      ["00123", "C-1", "duplicate"],
    ],
  );
  assert.equal(rows[1].column, 4);
});
test("Validação em memória separa novos, existentes e códigos ausentes", () => {
  const rows = parseKitMatrix([
    ["Produto", "A", "B", "C", "D"],
    ["P", "C1", "C2", "missing"],
    ["missing", "C1"],
    ["inactive", "C1"],
  ]);
  const checked = checkKitRows(
    rows,
    [
      { id: "p", code: "P", active: true },
      { id: "q", code: "inactive", active: false },
    ],
    [
      { id: "a", code: "C1", active: true },
      { id: "b", code: "C2", active: true },
    ],
    new Set([pairKey("P", "C1")]),
  );
  assert.deepEqual(
    checked.map((row) => row.status),
    ["existing", "new", "component_missing", "product_missing", "inactive"],
  );
});
test("Planilha sem componentes nunca limpa o kit e aceita centenas de colunas", () => {
  assert.equal(
    parseKitMatrix([
      ["Produto", "A"],
      ["P", "", " "],
    ])[0].status,
    "invalid",
  );
  assert.equal(
    parseKitMatrix([
      ["Produto"],
      ["P", ...Array.from({ length: 800 }, (_, i) => `C${i}`)],
    ]).length,
    800,
  );
  assert.equal(
    parseKitMatrix([
      ["Produto", "A"],
      ["", "C1"],
    ])[0].status,
    "invalid",
  );
});
