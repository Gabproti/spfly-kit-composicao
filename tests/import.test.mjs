import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import Papa from "papaparse";
import ExcelJS from "exceljs";
const source = await readFile(
  new URL("../src/lib/importValidation.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { validateRows, activeValue, photoCode } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
test("CSV com BOM, acentos, aspas e zeros preservados", () => {
  const data = Papa.parse(
    '\uFEFFCódigo;Descrição;Ativo\r\n00123;"Kit; especial";não',
    { skipEmptyLines: "greedy" },
  ).data;
  const [r] = validateRows(data, "products", []);
  assert.equal(r.error, "");
  assert.equal(r.values.codigo, "00123");
  assert.equal(r.values.descricao, "Kit; especial");
  assert.equal(activeValue(r.values.ativo), false);
});
test("todos os códigos repetidos e campos inválidos são bloqueados", () => {
  const rows = validateRows(
    [
      ["codigo", "descricao"],
      ["123", "A"],
      ["123", "B"],
      ["", "Sem código"],
    ],
    "products",
    [],
  );
  assert.equal(rows.filter((r) => r.error).length, 3);
  assert.throws(
    () => validateRows([["descricao"]], "products", []),
    /obrigatórias/,
  );
  assert.throws(() => activeValue("talvez"));
});
test("composição rejeita pares duplicados, quantidades fracionárias e fora do limite", () => {
  const rows = validateRows(
    [
      ["codigo_produto", "codigo_componente", "quantidade"],
      ["001", "02", "1"],
      ["001", "02", "2"],
      ["001", "03", "1.5"],
      ["001", "04", "0"],
      ["001", "05", "10000"],
    ],
    "compositions",
    [],
  );
  assert.equal(rows.filter((r) => r.error).length, 5);
});
test("tipos de componente são normalizados e status vazio pode preservar cadastro", () => {
  const [r] = validateRows(
    [
      ["codigo", "tipo", "descricao"],
      ["01", "relogio", "Descrição"],
    ],
    "components",
    ["Relógio"],
  );
  assert.equal(r.error, "");
  assert.equal(r.values.tipo, "Relógio");
  assert.equal(activeValue(""), undefined);
  assert.equal(photoCode("00123.JPG"), "00123");
  assert.equal(photoCode("AB.12.webp"), "AB.12");
});
test("modelo Excel usa texto nos códigos e pode ser relido", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dados");
  sheet.addRow(["codigo", "descricao"]);
  sheet.getColumn(1).numFmt = "@";
  sheet.addRow(["0001", "Produto"]);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(loaded.worksheets[0].getCell("A2").text, "0001");
  assert.equal(loaded.worksheets[0].getColumn(1).numFmt, "@");
});

test("descrição opcional: vazia ou sem coluna, para produtos e componentes", () => {
  for (const [kind, matrix] of [
    ["products", [["codigo"], ["00123"]]],
    [
      "products",
      [
        ["codigo", "descricao"],
        ["00123", ""],
      ],
    ],
    [
      "components",
      [
        ["codigo", "tipo"],
        ["C1", "Caixa"],
      ],
    ],
    [
      "components",
      [
        ["codigo", "tipo", "descricao"],
        ["C1", "Caixa", ""],
      ],
    ],
  ])
    assert.equal(validateRows(matrix, kind, ["Caixa"])[0].error, "");
  assert.match(
    validateRows(
      [
        ["codigo", "descricao"],
        ["P", "a".repeat(301)],
      ],
      "products",
      [],
    )[0].error,
    /300/,
  );
});
