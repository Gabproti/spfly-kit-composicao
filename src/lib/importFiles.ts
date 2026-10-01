import Papa from "papaparse";
import { columns, type ImportKind } from "./importValidation";
export async function readImportFile(file: File): Promise<string[][]> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("O arquivo deve ter até 10 MB.");
  if (/\.csv$/i.test(file.name)) {
    const result = Papa.parse<string[]>(await file.text(), {
      skipEmptyLines: "greedy",
    });
    if (result.errors.length)
      throw new Error(`CSV inválido: ${result.errors[0].message}`);
    return result.data;
  }
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("Selecione um arquivo .xlsx ou .csv.");
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet = book.worksheets[0];
  if (!sheet) throw new Error("O arquivo não contém uma aba.");
  if (sheet.rowCount > 5001 || sheet.columnCount > 30)
    throw new Error("Limite de 5.000 linhas e 30 colunas.");
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values: string[] = [];
    for (let i = 1; i <= sheet.columnCount; i++) {
      const cell = row.getCell(i);
      if (
        cell.type === ExcelJS.ValueType.Formula ||
        cell.type === ExcelJS.ValueType.Error
      )
        throw new Error(
          `Linha ${row.number}: substitua fórmulas e erros por valores.`,
        );
      if (
        typeof cell.value === "number" &&
        !Number.isSafeInteger(cell.value) &&
        /codigo/.test(
          String(sheet.getRow(1).getCell(i).text)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, ""),
        )
      )
        throw new Error(`Linha ${row.number}: formate o código como texto.`);
      values.push(cell.text);
    }
    matrix.push(values);
  });
  return matrix;
}
export function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadTemplate(kind: ImportKind) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Dados");
  sheet.addRow(columns[kind]);
  sheet.getRow(1).font = { bold: true };
  columns[kind].forEach((c, i) => {
    sheet.getColumn(i + 1).width = c === "descricao" ? 45 : 24;
    if (c.startsWith("codigo")) sheet.getColumn(i + 1).numFmt = "@";
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  downloadFile(
    `modelo-${kind}.xlsx`,
    new Blob([await book.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
