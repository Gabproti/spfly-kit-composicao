import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import ExcelJS from "exceljs";
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const validation = transpile(
  await readFile(
    new URL("../src/lib/importValidation.ts", import.meta.url),
    "utf8",
  ),
);
const validationUrl = `data:text/javascript;base64,${Buffer.from(validation).toString("base64")}`;
let fileSource = transpile(
  await readFile(new URL("../src/lib/importFiles.ts", import.meta.url), "utf8"),
);
fileSource = fileSource
  .replace('"papaparse"', JSON.stringify(import.meta.resolve("papaparse")))
  .replace('"./importValidation"', JSON.stringify(validationUrl))
  .replaceAll('"exceljs"', JSON.stringify(import.meta.resolve("exceljs")));
const { readImportFile } = await import(
  `data:text/javascript;base64,${Buffer.from(fileSource).toString("base64")}`
);
test("XLSX horizontal aceita centenas de colunas e preserva zeros formatados", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Kits");
  sheet.addRow([
    "CODIGO_PRODUTO",
    ...Array.from({ length: 350 }, (_, i) => `COMPONENTE_${i + 1}`),
  ]);
  sheet.addRow([123, ...Array.from({ length: 350 }, (_, i) => ` C-${i + 1} `)]);
  sheet.getCell("A2").numFmt = "00000";
  const file = new File([await book.xlsx.writeBuffer()], "kits.xlsx");
  const rows = await readImportFile(file, true);
  assert.equal(rows[1][0], "00123");
  assert.equal(rows[1].length, 351);
  await assert.rejects(readImportFile(file), /30 colunas/);
});
test("CSV e XLSX rejeitam fórmulas Excel e mantém códigos em texto", async () => {
  const rows = await readImportFile(
    new File(["Produto;A;B\n00123;0001;0002"], "kits.csv"),
    true,
  );
  assert.deepEqual(rows[1], ["00123", "0001", "0002"]);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Kits");
  sheet.addRow(["Produto", "A"]);
  sheet.addRow(["P", { formula: "1+1", result: 2 }]);
  await assert.rejects(
    readImportFile(
      new File([await book.xlsx.writeBuffer()], "kits.xlsx"),
      true,
    ),
    /fórmulas/,
  );
});
