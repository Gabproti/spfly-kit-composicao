export type KitStatus =
  | "new"
  | "existing"
  | "duplicate"
  | "product_missing"
  | "component_missing"
  | "inactive"
  | "invalid"
  | "inserted";
export type KitRow = {
  line: number;
  column: number;
  product: string;
  component: string;
  status: KitStatus;
  detail?: string;
  result?: string;
  done?: boolean;
};
export type KitCatalogItem = { id: string; code: string; active: boolean };
export const kitLabels: Record<KitStatus, string> = {
  new: "Novo vínculo",
  existing: "Já existe",
  duplicate: "Duplicidade no arquivo",
  product_missing: "Produto não encontrado",
  component_missing: "Componente não encontrado",
  inactive: "Cadastro inativo",
  invalid: "Código inválido",
  inserted: "Vínculo criado",
};
export const pairKey = (product: string, component: string) =>
  JSON.stringify([product, component]);
export function parseKitMatrix(matrix: string[][]): KitRow[] {
  if (matrix.length < 2)
    throw new Error("Inclua um cabeçalho e os dados abaixo dele.");
  const rows: KitRow[] = [];
  const seen = new Set<string>();
  matrix.slice(1).forEach((cells, index) => {
    const product = (cells[0] ?? "").trim();
    cells.slice(1).forEach((value, col) => {
      const component = (value ?? "").trim();
      if (!component) return;
      const key = pairKey(product, component);
      const invalid = !product || product.length > 80 || component.length > 80;
      const status = invalid ? "invalid" : seen.has(key) ? "duplicate" : "new";
      seen.add(key);
      rows.push({
        line: index + 2,
        column: col + 2,
        product,
        component,
        status,
      });
      if (rows.length > 100000)
        throw new Error(
          "Importe até 100.000 relações por arquivo. Divida arquivos maiores em lotes.",
        );
    });
    if (!cells.slice(1).some((value) => value?.trim()) && product)
      rows.push({
        line: index + 2,
        column: 1,
        product,
        component: "",
        status: "invalid",
        detail: "Nenhum componente informado; kit preservado.",
      });
  });
  if (!rows.length)
    throw new Error("Nenhum componente foi encontrado na planilha.");
  return rows;
}
export function checkKitRows(
  rows: KitRow[],
  products: KitCatalogItem[],
  components: KitCatalogItem[],
  existing: Set<string>,
): KitRow[] {
  const p = new Map(products.map((item) => [item.code, item]));
  const c = new Map(components.map((item) => [item.code, item]));
  return rows.map((row) => {
    if (row.status !== "new") return row;
    const product = p.get(row.product),
      component = c.get(row.component);
    return {
      ...row,
      status: !product
        ? "product_missing"
        : !component
          ? "component_missing"
          : !product.active || !component.active
            ? "inactive"
            : existing.has(pairKey(row.product, row.component))
              ? "existing"
              : "new",
    };
  });
}
