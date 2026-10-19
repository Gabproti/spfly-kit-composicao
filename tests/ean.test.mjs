import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import ExcelJS from "exceljs";
const source = await readFile(
  new URL("../src/lib/ean.ts", import.meta.url),
  "utf8",
);
const lib = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString("base64")
);
const { eanKey, parseEanRows } = lib;
test("Pesquisa administrativa encontra código, descrição, EAN com zeros e variante UPC equivalente", () => {
  const product = {
    code: "00123",
    description: "Relógio Citizen",
    product_eans: [{ ean: "0036000291452" }],
  };
  for (const query of ["00123", "citizen", "0036000291452", "036000291452"])
    assert.ok(lib.matchesProductSearch(product, query));
  assert.equal(lib.matchesProductSearch(product, "inexistente"), false);
});
test("EAN preserva zeros e reconhece formatos equivalentes sem aceitar números inválidos", () => {
  assert.equal(eanKey("4006381333931"), "04006381333931");
  assert.equal(eanKey("036000291452"), eanKey("0036000291452"));
  assert.equal(eanKey("00000096385074"), eanKey("96385074"));
  for (const invalid of [
    "",
    "123",
    "4006381333932",
    "0000000000000",
    "4.006381333931E+12",
    "4006381333931.0",
    " 4006381333931",
    "400638133393X",
  ])
    assert.equal(eanKey(invalid), null);
});
test("Duas colunas em qualquer ordem, BOM e cabeçalhos equivalentes preservam EAN e produto", () => {
  const [r] = parseEanRows([
    ["\uFEFFCOD PRODUTO", "COD EAN"],
    ["00123", "0036000291452"],
  ]);
  assert.equal(r.product, "00123");
  assert.equal(r.ean, "0036000291452");
  assert.equal(r.error, "");
  assert.equal(
    parseEanRows([
      ["codigo_ean", "codigo_produto"],
      ["4006381333931", "AT8020-03L"],
    ])[0].error,
    "",
  );
});
test("Conflitos entre produtos bloqueiam todas as variantes do mesmo EAN e repetição simples é ignorada", () => {
  const conflict = parseEanRows([
    ["COD EAN", "COD PRODUTO"],
    ["036000291452", "A"],
    ["0036000291452", "B"],
  ]);
  assert.ok(conflict.every((r) => r.error.includes("produtos diferentes")));
  const same = parseEanRows([
    ["COD EAN", "COD PRODUTO"],
    ["036000291452", "A"],
    ["0036000291452", "A"],
  ]);
  assert.equal(same[0].error, "");
  assert.equal(same[1].status, "duplicate");
});
test("Cabeçalhos ausentes/repetidos, dados vazios e códigos inválidos são rejeitados", () => {
  assert.throws(
    () => parseEanRows([["EAN", "EAN", "COD PRODUTO"]]),
    /cabeçalhos/,
  );
  assert.throws(() => parseEanRows([["EAN", "PRODUTO"]]), /COD EAN/);
  assert.throws(() => parseEanRows([["EAN", "COD PRODUTO"]]), /dados/);
  const rows = parseEanRows([
    ["EAN", "COD PRODUTO"],
    ["123", "A"],
    ["4006381333931", ""],
  ]);
  assert.ok(rows.every((r) => r.error));
});
test("Leitura XLSX de EAN recupera zeros do formato numérico sem alterar a leitura normal", async () => {
  let code = await readFile(
    new URL("../src/lib/importFiles.ts", import.meta.url),
    "utf8",
  );
  code = code
    .replace('import Papa from "papaparse";', "const Papa={};")
    .replace(
      /import \{ columns, type ImportKind \} from "\.\/importValidation";/,
      "const columns={};",
    )
    .replace('await import("exceljs")', "({default:globalThis.eanExcel})");
  globalThis.eanExcel = ExcelJS;
  const { readImportFile } = await import(
    "data:text/javascript;base64," +
      Buffer.from(
        ts.transpileModule(code, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString("base64")
  );
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("EAN");
  sheet.addRow(["COD EAN", "COD PRODUTO"]);
  sheet.addRow([36000291452, 123]);
  sheet.getCell("A2").numFmt = "0000000000000";
  sheet.getCell("B2").numFmt = "00000";
  const file = new File([await book.xlsx.writeBuffer()], "ean.xlsx");
  const rows = await readImportFile(file, false, true);
  assert.equal(rows[1][0], "0036000291452");
  assert.equal(rows[1][1], "00123");
  assert.equal(parseEanRows(rows)[0].error, "");
});
