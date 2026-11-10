import type { Product } from "./types";

export async function createProductExport(products: readonly Product[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Produtos");
  sheet.columns = [
    { header: "COD PRODUTO", key: "product", width: 26 },
    { header: "DESCRICAO", key: "description", width: 48 },
    { header: "STATUS", key: "status", width: 14 },
    { header: "POSSUI EAN", key: "has_ean", width: 17 },
    { header: "COD EAN", key: "ean", width: 30 },
  ];
  sheet.getColumn("product").numFmt = "@";
  sheet.getColumn("ean").numFmt = "@";
  sheet.getColumn("ean").alignment = { vertical: "top", wrapText: true };
  sheet.getColumn("description").alignment = {
    vertical: "top",
    wrapText: true,
  };
  for (const product of products) {
    const eans = [
      ...new Set((product.product_eans ?? []).map((item) => item.ean)),
    ].sort();
    const row = sheet.addRow({
      product: product.code,
      description: product.description,
      status: product.active ? "Ativo" : "Inativo",
      has_ean: eans.length ? "Sim" : "Não",
      ean: eans.join("\n"),
    });
    if (eans.length > 1) row.height = 15 * eans.length;
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: 5 },
  };
  return new Blob([await workbook.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
