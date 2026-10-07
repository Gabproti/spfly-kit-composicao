import { useEffect, useState } from "react";
import Papa from "papaparse";
import { db, fail } from "../lib/supabase";
import {
  downloadFile,
  downloadTemplate,
  readImportFile,
} from "../lib/importFiles";
import {
  checkKitRows,
  kitLabels,
  pairKey,
  parseKitMatrix,
  type KitCatalogItem,
  type KitRow,
  type KitStatus,
} from "../lib/kitImport";

async function loadCatalog(table: "products" | "components") {
  const rows: KitCatalogItem[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db()
      .from(table)
      .select("id,code,active")
      .order("id")
      .range(offset, offset + 999);
    fail(error);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
async function existingLinks(
  products: KitCatalogItem[],
  components: KitCatalogItem[],
  rows: KitRow[],
) {
  const wanted = new Set(rows.map((row) => row.product));
  const p = new Map(products.map((item) => [item.id, item.code]));
  const c = new Map(components.map((item) => [item.id, item.code]));
  const ids = products
    .filter((item) => wanted.has(item.code))
    .map((item) => item.id);
  const existing = new Set<string>();
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db()
        .from("compositions")
        .select("id,product_id,component_id")
        .in("product_id", ids.slice(start, start + 100))
        .order("id")
        .range(offset, offset + 999);
      fail(error);
      (data ?? []).forEach((item) =>
        existing.add(
          pairKey(p.get(item.product_id)!, c.get(item.component_id)!),
        ),
      );
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return existing;
}
const errorText = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Não foi possível processar a importação. Verifique a conexão.";

export default function KitImport({
  onBusy,
}: {
  onBusy: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<KitRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [stage, setStage] = useState("");
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  async function analyze(file: File) {
    setBusy(true);
    setRows([]);
    setError("");
    setFinished(false);
    setFilename(file.name);
    setProgress({ completed: 0, total: 0 });
    setStage("Analisando planilha e vínculos existentes…");
    try {
      const parsed = parseKitMatrix(await readImportFile(file, true));
      const [products, components] = await Promise.all([
        loadCatalog("products"),
        loadCatalog("components"),
      ]);
      const existing = await existingLinks(products, components, parsed);
      setRows(checkKitRows(parsed, products, components, existing));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  async function confirm() {
    const results = rows.map((row) => ({ ...row }));
    const pending = results.filter((row) => row.status === "new" && !row.done);
    if (!pending.length) return;
    setBusy(true);
    setError("");
    setFinished(false);
    setStage("Importando composição dos kits…");
    setProgress({ completed: 0, total: pending.length });
    try {
      for (let offset = 0; offset < pending.length; offset += 500) {
        const batch = pending.slice(offset, offset + 500);
        const { data, error } = await db().rpc("import_kit_links", {
          p_links: batch.map((row) => ({
            product: row.product,
            component: row.component,
          })),
        });
        fail(error);
        const outcomes = data as { index: number; status: KitStatus }[];
        if (!Array.isArray(outcomes) || outcomes.length !== batch.length)
          throw new Error(
            "Resposta incompleta do servidor. Analise a planilha novamente para conferir o resultado.",
          );
        for (const outcome of outcomes) {
          const row = batch[outcome.index];
          if (!row || !kitLabels[outcome.status])
            throw new Error("Resultado inválido do servidor.");
          row.status = outcome.status;
          row.done = true;
          row.result = kitLabels[outcome.status];
        }
        setRows([...results]);
        setProgress({
          completed: offset + batch.length,
          total: pending.length,
        });
      }
      setFinished(true);
    } catch (e) {
      setError(
        `${errorText(e)} Os lotes concluídos foram preservados. Você pode tentar novamente; vínculos repetidos não serão criados.`,
      );
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  function report() {
    const csv = Papa.unparse(
      rows.map((row) => ({
        linha: row.line,
        coluna: row.column,
        produto: row.product,
        componente: row.component,
        situacao: row.detail || row.result || kitLabels[row.status],
      })),
      { delimiter: ";", escapeFormulae: true },
    );
    downloadFile(
      "relatorio-composicao-kits.csv",
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
  }
  const count = (status: KitStatus) =>
    rows.filter((row) => row.status === status).length;
  const productMissing = new Set(
    rows
      .filter((row) => row.status === "product_missing")
      .map((row) => row.product),
  ).size;
  const missingCodes = new Set(
    rows
      .filter((row) => row.status === "product_missing")
      .map((row) => row.product),
  );
  const foundProducts = new Set(
    rows
      .filter(
        (row) =>
          row.product &&
          !missingCodes.has(row.product) &&
          row.status !== "invalid",
      )
      .map((row) => row.product),
  ).size;
  const preview = rows.slice(0, 200);
  return (
    <div className="kit-import">
      <h3>Importação de composição dos kits</h3>
      <p>
        A primeira coluna é o código do produto. Todas as demais contêm códigos
        de componentes. Células vazias são ignoradas e cada novo vínculo recebe
        quantidade 1. Os vínculos anteriores e suas quantidades são preservados.
      </p>
      <p>
        Use XLSX (primeira aba) ou CSV em UTF-8, com cabeçalho, até 10 MB,
        50.000 linhas e 100.000 relações por arquivo. Você pode adicionar
        colunas de componentes ao modelo. Formate os códigos como texto.
      </p>
      <div className="toolbar">
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadTemplate("compositions");
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Baixar modelo de kits
        </button>
        <label className={`upload-button ${busy ? "disabled" : ""}`}>
          Selecionar planilha de kits
          <input
            type="file"
            accept=".xlsx,.csv"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void analyze(file);
            }}
          />
        </label>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <div className="notice" role="status">
          {stage || "Preparando…"} Mantenha esta página aberta.
          {progress.total > 0 && (
            <>
              <progress
                max={progress.total}
                value={progress.completed}
                aria-label="Progresso da importação"
              />
              <p>
                {progress.completed.toLocaleString("pt-BR")} /{" "}
                {progress.total.toLocaleString("pt-BR")} relações processadas (
                {Math.round((progress.completed / progress.total) * 100)}%)
              </p>
            </>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <h3>{filename}</h3>
          {finished && (
            <div className="notice success" role="status">
              Importação concluída! {count("inserted")} novos vínculos criados.
            </div>
          )}
          <div className="notice">
            <p>
              Produtos encontrados: {foundProducts} · Componentes identificados:{" "}
              {rows.filter((row) => row.component).length}
            </p>
            <p>
              Novos vínculos: {count("new")} · Vínculos já existentes:{" "}
              {count("existing")} · Vínculos criados: {count("inserted")}
            </p>
            <p>
              Produtos não encontrados: {productMissing} · Relações com
              componente não encontrado: {count("component_missing")} ·
              Duplicidades: {count("duplicate")} · Inválidos ou inativos:{" "}
              {count("invalid") + count("inactive")}
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Linha / coluna</th>
                  <th>Produto</th>
                  <th>Componente</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, index) => (
                  <tr key={index}>
                    <td>
                      {row.line} / {row.column}
                    </td>
                    <td className="mono">{row.product || "—"}</td>
                    <td className="mono">{row.component || "—"}</td>
                    <td>{row.detail || row.result || kitLabels[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A prévia exibe até 200 relações; o relatório inclui todas. Apenas os
            novos vínculos válidos serão adicionados, em lotes. Uma falha não
            desfaz os lotes concluídos. Produtos e componentes ausentes ou
            inativos devem ser cadastrados ou ativados antes.
          </p>
          <div className="panel-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setRows([]);
                setError("");
                setFilename("");
                setFinished(false);
              }}
            >
              Cancelar
            </button>
            <button className="secondary" disabled={busy} onClick={report}>
              Baixar relatório completo
            </button>
            <button
              className="primary"
              disabled={
                busy || !rows.some((row) => row.status === "new" && !row.done)
              }
              onClick={confirm}
            >
              Confirmar importação de kits
            </button>
          </div>
        </>
      )}
    </div>
  );
}
