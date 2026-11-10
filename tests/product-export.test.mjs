import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import ExcelJS from "exceljs";
globalThis.productExportExcel = ExcelJS;
const source = (
  await readFile(
    new URL("../src/lib/productExport.ts", import.meta.url),
    "utf8",
  )
)
  .replace(
    "await import('exceljs')",
    "({default:globalThis.productExportExcel})",
  )
  .replace(
    'await import("exceljs")',
    "({default:globalThis.productExportExcel})",
  );
const { createProductExport } = await import(
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
async function read(products) {
  const blob = await createProductExport(products);
  assert.match(blob.type, /spreadsheetml/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  return book.worksheets[0];
}
const product = (code, product_eans = [], active = true) => ({
  id: code,
  code,
  description: "Relógio Citizen",
  image_url: null,
  active,
  product_eans,
});
test("Excel exporta apenas a lista recebida e mantém códigos e EAN com zeros como texto", async () => {
  const sheet = await read([product("00123", [{ ean: "0036000291452" }])]);
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell("A2").value, "00123");
  assert.equal(sheet.getCell("E2").value, "0036000291452");
  assert.equal(sheet.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("E2").numFmt, "@");
  assert.equal(sheet.getCell("D2").value, "Sim");
});
test("Produtos sem EAN e vários EANs mantêm uma linha por produto e o status real", async () => {
  const rows = [
    product("SEM", [], false),
    product("VARIOS", [
      { ean: "96385074" },
      { ean: "0036000291452" },
      { ean: "96385074" },
    ]),
  ];
  const sheet = await read(rows);
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("C2").value, "Inativo");
  assert.equal(sheet.getCell("D2").value, "Não");
  assert.ok(!sheet.getCell("E2").value);
  assert.equal(sheet.getCell("E3").value, "0036000291452\n96385074");
  assert.equal(rows[1].product_eans.length, 3);
});
test("Conteúdo semelhante a fórmula é exportado como texto literal", async () => {
  const sheet = await read([
    { ...product("=1+1"), description: '=HYPERLINK("https://example.com")' },
  ]);
  assert.equal(sheet.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A2").value, "=1+1");
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
});
