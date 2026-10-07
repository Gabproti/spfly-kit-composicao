export type ImportKind = "products" | "components" | "compositions";
export type ImportRecord = Record<string, string>;
export type CheckedRow = { line: number; values: ImportRecord; error: string };
export const columns: Record<ImportKind, string[]> = {
  products: ["codigo", "descricao", "ativo"],
  components: ["codigo", "tipo", "descricao", "ativo"],
  compositions: ["codigo_produto", "codigo_componente", "quantidade"],
};
export function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}
export function activeValue(value: string): boolean | undefined {
  const text = normalizeHeader(value);
  if (!text) return undefined;
  if (["sim", "true", "1", "ativo"].includes(text)) return true;
  if (["nao", "false", "0", "inativo"].includes(text)) return false;
  throw new Error("Ativo deve ser sim ou não.");
}
export function validateRows(
  matrix: string[][],
  kind: ImportKind,
  types: readonly string[],
): CheckedRow[] {
  if (!matrix.length) throw new Error("A planilha está vazia.");
  const headers = matrix[0].map(normalizeHeader);
  if (new Set(headers).size !== headers.length)
    throw new Error("Existem cabeçalhos repetidos.");
  const required = columns[kind].filter(
    (c) => c !== "ativo" && c !== "descricao",
  );
  if (required.some((c) => !headers.includes(c)))
    throw new Error(`Colunas obrigatórias: ${required.join(", ")}.`);
  const rows = matrix
    .slice(1)
    .map((cells, i) => ({
      line: i + 2,
      values: Object.fromEntries(
        headers.map((h, j) => [h, (cells[j] ?? "").trim()]),
      ),
      error: "",
    }))
    .filter((row) => Object.values(row.values).some(Boolean));
  if (rows.length > 5000)
    throw new Error("Importe até 5.000 linhas por arquivo.");
  const counts = new Map<string, number>();
  const key = (r: CheckedRow) =>
    kind === "compositions"
      ? JSON.stringify([r.values.codigo_produto, r.values.codigo_componente])
      : r.values.codigo;
  rows.forEach((r) => counts.set(key(r), (counts.get(key(r)) ?? 0) + 1));
  return rows.map((r) => {
    try {
      const codes =
        kind === "compositions"
          ? [r.values.codigo_produto, r.values.codigo_componente]
          : [r.values.codigo];
      if (codes.some((c) => !c || c.length > 80))
        throw new Error("Código obrigatório, com até 80 caracteres.");
      if ((counts.get(key(r)) ?? 0) > 1)
        throw new Error(
          "Código ou par produto/componente repetido no arquivo.",
        );
      if (kind === "compositions") {
        if (
          !/^\d+$/.test(r.values.quantidade) ||
          Number(r.values.quantidade) < 1 ||
          Number(r.values.quantidade) > 9999
        )
          throw new Error("Quantidade inteira de 1 a 9999.");
      } else {
        if ((r.values.descricao ?? "").length > 300)
          throw new Error("Descrição deve ter até 300 caracteres.");
        activeValue(r.values.ativo ?? "");
        if (kind === "components") {
          const type = types.find(
            (t) => normalizeHeader(t) === normalizeHeader(r.values.tipo),
          );
          if (!type) throw new Error("Tipo de componente inválido.");
          r.values.tipo = type;
        }
      }
    } catch (e) {
      r.error = e instanceof Error ? e.message : "Linha inválida.";
    }
    return r;
  });
}
export function photoCode(name: string) {
  return name.replace(/\.(jpe?g|png|webp)$/i, "");
}
