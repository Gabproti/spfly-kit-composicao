export function eanKey(value: string): string | null {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || /^0+$/.test(value))
    return null;
  const body = value.slice(0, -1);
  let sum = 0;
  for (
    let i = body.length - 1, weight = 3;
    i >= 0;
    i--, weight = weight === 3 ? 1 : 3
  )
    sum += Number(body[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(value.at(-1))
    ? value.padStart(14, "0")
    : null;
}
export function matchesProductSearch(
  product: {
    code: string;
    description: string;
    product_eans?: { ean: string }[];
  },
  search: string,
) {
  const query = search.trim().toLocaleLowerCase("pt-BR");
  if (
    `${product.code} ${product.description}`
      .toLocaleLowerCase("pt-BR")
      .includes(query)
  )
    return true;
  const key = eanKey(query);
  return Boolean(
    product.product_eans?.some(
      (item) => item.ean.includes(query) || (key && eanKey(item.ean) === key),
    ),
  );
}
export type EanRow = {
  line: number;
  ean: string;
  product: string;
  error: string;
  status?: string;
  result?: string;
};
const header = (s: string) =>
  s
    .replace(/^\uFEFF/, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
export function parseEanRows(matrix: string[][]): EanRow[] {
  if (!matrix.length) throw new Error("A planilha está vazia.");
  const names = matrix[0].map(header),
    eanColumns = names
      .map((n, i) => (["COD_EAN", "CODIGO_EAN", "EAN"].includes(n) ? i : -1))
      .filter((i) => i >= 0),
    productColumns = names
      .map((n, i) => (["COD_PRODUTO", "CODIGO_PRODUTO"].includes(n) ? i : -1))
      .filter((i) => i >= 0);
  if (eanColumns.length !== 1 || productColumns.length !== 1)
    throw new Error(
      "Inclua uma coluna COD EAN e uma coluna COD PRODUTO, sem cabeçalhos repetidos.",
    );
  const rows: EanRow[] = matrix
    .slice(1)
    .map((cells, i) => ({
      line: i + 2,
      ean: (cells[eanColumns[0]] ?? "").trim(),
      product: (cells[productColumns[0]] ?? "").trim(),
      error: "",
    }))
    .filter((r) => r.ean || r.product);
  if (!rows.length) throw new Error("Inclua os dados abaixo dos cabeçalhos.");
  if (rows.length > 5000)
    throw new Error("Importe até 5.000 linhas por arquivo.");
  const codes = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = eanKey(r.ean);
    if (key) {
      const products = codes.get(key) ?? new Set<string>();
      products.add(r.product);
      codes.set(key, products);
    }
  }
  const seen = new Set<string>();
  return rows.map((r) => {
    const key = eanKey(r.ean);
    if (!key)
      r.error =
        "EAN/GTIN inválido: use 8, 12, 13 ou 14 dígitos, com dígito verificador correto. Preserve zeros à esquerda.";
    else if (!r.product || r.product.length > 80)
      r.error = "COD PRODUTO é obrigatório, com até 80 caracteres.";
    else if (codes.get(key)!.size > 1)
      r.error = "O mesmo EAN aparece para produtos diferentes no arquivo.";
    else if (seen.has(key)) r.status = "duplicate";
    if (key) seen.add(key);
    return r;
  });
}
export const eanLabels: Record<string, string> = {
  new: "Pronto para vincular",
  inserted: "EAN vinculado",
  existing: "Já vinculado a este produto",
  duplicate: "Repetido no arquivo; ignorado",
  conflict: "EAN já vinculado a outro produto",
  product_missing: "Produto não cadastrado",
  code_conflict: "EAN coincide com o código de outro produto",
  invalid: "EAN ou código do produto inválido",
  file_conflict: "Mesmo EAN para produtos diferentes no arquivo",
};
