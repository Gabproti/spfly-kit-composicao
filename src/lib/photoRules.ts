export type PhotoRuleId =
  | "exact"
  | "remove_suffix_N"
  | "remove_last_character"
  | "remove_first_character"
  | "normalize"
  | "custom";
export type CustomPhotoRule = { prefix: number; suffix: number };
export const photoRules: { id: PhotoRuleId; label: string }[] = [
  { id: "exact", label: "Correspondência exata" },
  { id: "remove_suffix_N", label: "Remover N do final da imagem" },
  { id: "remove_last_character", label: "Remover último caractere da imagem" },
  {
    id: "remove_first_character",
    label: "Remover primeiro caractere da imagem",
  },
  { id: "normalize", label: "Normalização automática" },
  { id: "custom", label: "Personalizada" },
];
const transforms = {
  remove_suffix_N: (code: string) =>
    code.endsWith("N") ? code.slice(0, -1) : code,
  remove_last_character: (code: string) =>
    Array.from(code).slice(0, -1).join(""),
  remove_first_character: (code: string) => Array.from(code).slice(1).join(""),
};
export function imageCode(filename: string) {
  return filename
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "")
    .trim();
}
export function customRuleError(custom: CustomPhotoRule) {
  return [custom.prefix, custom.suffix].some(
    (n) => !Number.isInteger(n) || n < 0 || n > 20,
  ) || custom.prefix + custom.suffix === 0
    ? "Informe de 0 a 20 caracteres em cada ponta, removendo pelo menos um caractere."
    : "";
}
export type PhotoProduct = {
  id: string;
  code: string;
  description: string;
  image_url: string | null;
};
export type PhotoMatch = {
  code: string;
  target?: PhotoProduct;
  rule: string;
  status: "ready" | "not_found" | "ambiguous";
  candidates: PhotoProduct[];
};
export function productIndex(products: PhotoProduct[]) {
  const index = new Map<string, PhotoProduct[]>();
  for (const p of products) {
    const rows = index.get(p.code) ?? [];
    rows.push(p);
    index.set(p.code, rows);
  }
  return index;
}
export function matchImage(
  filename: string,
  rule: PhotoRuleId,
  index: ReturnType<typeof productIndex>,
  custom: CustomPhotoRule = { prefix: 0, suffix: 0 },
): PhotoMatch {
  const original = imageCode(filename),
    exact = index.get(original) ?? [];
  if (exact.length)
    return {
      code: original,
      target: exact.length === 1 ? exact[0] : undefined,
      rule: "exact",
      status: exact.length === 1 ? "ready" : "ambiguous",
      candidates: exact,
    };
  const variants: { code: string; rule: string }[] = [];
  if (rule === "normalize")
    for (const [id, fn] of Object.entries(transforms))
      variants.push({ code: fn(original), rule: id });
  else if (rule === "custom") {
    if (!customRuleError(custom)) {
      const chars = Array.from(original);
      variants.push({
        code: chars
          .slice(custom.prefix, custom.suffix ? -custom.suffix : undefined)
          .join(""),
        rule,
      });
    }
  } else if (rule !== "exact")
    variants.push({ code: transforms[rule](original), rule });
  const matches = new Map<
    string,
    { product: PhotoProduct; code: string; rule: string }
  >();
  for (const v of variants)
    if (v.code && v.code !== original)
      for (const p of index.get(v.code) ?? [])
        if (!matches.has(p.id)) matches.set(p.id, { product: p, ...v });
  const possible = [...matches.values()];
  if (possible.length === 1)
    return {
      code: possible[0].code,
      target: possible[0].product,
      rule: possible[0].rule,
      status: "ready",
      candidates: [possible[0].product],
    };
  return {
    code: possible.length
      ? original
      : (variants.find((v) => v.code)?.code ?? original),
    rule,
    status: possible.length ? "ambiguous" : "not_found",
    candidates: possible.map((v) => v.product),
  };
}
export function duplicateTargets(
  rows: { target?: PhotoProduct; ignored: boolean }[],
) {
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.target && !row.ignored)
      counts.set(row.target.id, (counts.get(row.target.id) ?? 0) + 1);
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([id]) => id),
  );
}
