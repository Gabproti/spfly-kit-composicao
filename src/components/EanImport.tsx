import { useEffect, useState } from "react";
import Papa from "papaparse";
import { db, fail } from "../lib/supabase";
import { downloadFile, readImportFile } from "../lib/importFiles";
import { eanLabels, parseEanRows, type EanRow } from "../lib/ean";
const errorText = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String(e.message)
    : "Não foi possível importar. Verifique a conexão.";
export default function EanImport({
  onBusy,
  disabled = false,
}: {
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<EanRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [filename, setFilename] = useState(""),
    [page, setPage] = useState(0),
    [completed, setCompleted] = useState(false);
  const [rule, setRule] = useState<"exact" | "remove_suffix_N">("exact");
  const locked = busy || disabled,
    newCount = rows.filter((r) => !r.error && r.status === "new").length;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  async function template() {
    setBusy(true);
    setError("");
    try {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("EAN");
      sheet.addRow(["COD EAN", "COD PRODUTO"]);
      sheet.getRow(1).font = { bold: true };
      for (let i = 1; i <= 2; i++) {
        sheet.getColumn(i).width = 28;
        sheet.getColumn(i).numFmt = "@";
      }
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      downloadFile(
        "modelo-ean-produto.xlsx",
        new Blob([await book.xlsx.writeBuffer()], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function classify(
    checked: EanRow[],
    apply: boolean,
    selectedRule = rule,
  ) {
    const eligible = checked
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.error && (!apply || row.status === "new"));
    if (!eligible.length) return checked;
    const r = await db().rpc("admin_import_product_eans", {
      p_rows: eligible.map(({ row }) => ({
        ean: row.ean,
        product: row.product,
        rule: selectedRule,
        ...(apply ? { expected_product_id: row.matchedProductId } : {}),
      })),
      p_apply: apply,
    });
    fail(r.error);
    const result = checked.map((row) => ({ ...row }));
    for (const entry of r.data ?? []) {
      const i = eligible[entry.index]?.index;
      if (i === undefined)
        throw new Error("Resposta de importação inválida. Analise novamente.");
      result[i].status = entry.status;
      result[i].result = eanLabels[entry.status] ?? entry.status;
      result[i].matchedProduct = entry.product_code ?? undefined;
      result[i].matchedProductId = entry.product_id ?? undefined;
      result[i].ruleApplied = entry.rule_applied;
    }
    return result;
  }
  async function analyze(file: File) {
    setBusy(true);
    setRows([]);
    setError("");
    setNotice("");
    setFilename(file.name);
    setPage(0);
    setCompleted(false);
    try {
      const parsed = parseEanRows(
        await readImportFile(file, false, true),
        true,
      );
      setRows(await classify(parsed, false));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeRule(selected: "exact" | "remove_suffix_N") {
    setRule(selected);
    setError("");
    setNotice("");
    setPage(0);
    if (!rows.length) return;
    const original = rows;
    setRows([]);
    setBusy(true);
    try {
      setRows(await classify(original, false, selected));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!newCount || locked) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await classify(rows, true);
      setRows(result);
      setCompleted(true);
      setNotice(
        `${result.filter((r) => r.status === "inserted").length} EANs vinculados. Os códigos dos produtos e as composições foram preservados. Confira os demais resultados no relatório.`,
      );
    } catch (e) {
      setError(errorText(e));
      setNotice(
        "Se a conexão caiu, analise a mesma planilha novamente para conferir o que foi concluído. Reimportar não duplica nem troca vínculos.",
      );
    } finally {
      setBusy(false);
    }
  }
  function report() {
    downloadFile(
      "relatorio-ean-produto.csv",
      new Blob(
        [
          "\uFEFF" +
            Papa.unparse(
              rows.map((r) => ({
                linha: r.line,
                "COD EAN": r.ean,
                "COD PRODUTO": r.product,
                produto_encontrado: r.matchedProduct ?? "",
                regra_aplicada:
                  r.ruleApplied === "remove_suffix_N"
                    ? "Remover N final"
                    : "Exata",
                resultado:
                  r.error ||
                  r.result ||
                  eanLabels[r.status ?? ""] ||
                  "Pendente",
              })),
              { delimiter: ";", escapeFormulae: true },
            ),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
  }
  return (
    <section className="panel import-panel">
      <h2>EAN e código de barras</h2>
      <p>
        Vincule os códigos de barras aos produtos já cadastrados. A consulta
        aceitará tanto o código do produto quanto o EAN.
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {busy && (
        <div className="notice" role="status">
          {completed ? "Processando…" : "Conferindo EANs…"} Mantenha esta página
          aberta.
        </div>
      )}
      <div className="toolbar">
        <label>
          Regra para COD PRODUTO
          <select
            value={rule}
            disabled={locked || completed}
            onChange={(e) =>
              void changeRule(e.target.value as "exact" | "remove_suffix_N")
            }
          >
            <option value="exact">Correspondência exata</option>
            <option value="remove_suffix_N">
              Remover N final do COD PRODUTO
            </option>
          </select>
        </label>
        <button className="secondary" disabled={locked} onClick={template}>
          Baixar modelo EAN
        </button>
        <label className={`upload-button ${locked ? "disabled" : ""}`}>
          Selecionar planilha de EAN
          <input
            type="file"
            accept=".xlsx,.csv"
            disabled={locked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void analyze(file);
            }}
          />
        </label>
      </div>
      <p>
        A busca exata sempre tem prioridade. Com a regra de N final, AN3666-51AN
        pode encontrar AN3666-51A. A regra só remove um N maiúsculo do código da
        planilha; não altera o EAN nem o cadastro do produto.
      </p>
      <p>
        Colunas: <strong>COD EAN</strong> e <strong>COD PRODUTO</strong>, em
        qualquer ordem. Excel (.xlsx) ou CSV, até 5.000 linhas e 10 MB. Formate
        ambas como texto para preservar zeros à esquerda. EAN/GTIN: 8, 12, 13 ou
        14 dígitos, com verificador válido.
      </p>
      <p>
        Um produto pode ter mais de um EAN. Um EAN pertence a um único produto;
        conflitos ficam fora da importação e nunca substituem vínculos
        existentes.
      </p>
      {rows.length > 0 && (
        <>
          <h3>{filename}</h3>
          <p>
            {rows.length} linhas · {newCount} novos vínculos ·{" "}
            {rows.filter((r) => r.status === "existing").length} já existentes ·{" "}
            {
              rows.filter(
                (r) =>
                  r.error ||
                  !["new", "inserted", "existing", "duplicate"].includes(
                    r.status ?? "",
                  ),
              ).length
            }{" "}
            para revisar.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>COD EAN</th>
                  <th>COD PRODUTO</th>
                  <th>Produto encontrado</th>
                  <th>Regra aplicada</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 100, (page + 1) * 100).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td className="mono">{r.ean}</td>
                    <td className="mono">{r.product}</td>
                    <td className="mono">{r.matchedProduct ?? "—"}</td>
                    <td>
                      {r.error
                        ? "—"
                        : r.ruleApplied === "remove_suffix_N"
                          ? "Remover N final"
                          : r.matchedProduct
                            ? "Exata"
                            : "—"}
                    </td>
                    <td>
                      {r.error ||
                        r.result ||
                        eanLabels[r.status ?? ""] ||
                        "Pendente"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <div className="panel-actions">
              <button
                className="secondary"
                disabled={locked || !page}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page + 1} de {Math.ceil(rows.length / 100)}
              </span>
              <button
                className="secondary"
                disabled={locked || (page + 1) * 100 >= rows.length}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
          )}
          <div className="panel-actions">
            <button className="secondary" disabled={locked} onClick={report}>
              Baixar relatório EAN
            </button>
            <button
              className="primary"
              disabled={locked || !newCount || completed}
              onClick={save}
            >
              Confirmar {newCount} novos vínculos de EAN
            </button>
          </div>
          <p>
            Somente vínculos válidos serão adicionados. Produtos inexistentes
            precisam ser cadastrados primeiro. Nenhum produto, foto, componente
            ou composição será criado ou alterado por esta importação.
          </p>
        </>
      )}
    </section>
  );
}
