import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { db, fail } from "../lib/supabase";
import { downloadFile } from "../lib/importFiles";
import { cleanupDeletedProductImages } from "../lib/productDeletion";
import {
  readPhotoSources,
  validatePhoto,
  type PhotoSource,
} from "../lib/photoFiles";
import {
  customRuleError,
  matchImage,
  photoRules,
  productIndex,
  type PhotoProduct,
  type PhotoRuleId,
} from "../lib/photoRules";
import { Modal, ProductImage, uploadPhoto } from "./UI";
import {
  applyExistingChoice,
  batchConflicts,
  preparePhotoBatch,
  readyPhoto,
  type PhotoChoice as Choice,
} from "../lib/photoBatch";
type Row = {
  source: PhotoSource;
  code: string;
  target?: PhotoProduct;
  rule: string;
  status: string;
  candidates: PhotoProduct[];
  choice: Choice;
  result?: string;
  done?: boolean;
};
type HistoryRow = {
  id: string;
  source: string;
  rule: PhotoRuleId;
  created_at: string;
  status: string;
  total: number;
  linked: number;
  not_found: number;
  ambiguous: number;
  invalid: number;
  errors: number;
  kept: number;
  skipped: number;
  pending: number;
};
const explain = (e: unknown) =>
  e && typeof e === "object" && "message" in e && typeof e.message === "string"
    ? e.message
    : "Falha de conexão. Tente novamente.";
const label = (rule: string) =>
  rule === "manual"
    ? "Vínculo manual"
    : (photoRules.find((r) => r.id === rule)?.label ?? rule);
const csv = (name: string, rows: Record<string, unknown>[]) =>
  downloadFile(
    name,
    new Blob(
      ["\uFEFF" + Papa.unparse(rows, { delimiter: ";", escapeFormulae: true })],
      { type: "text/csv;charset=utf-8" },
    ),
  );
async function loadProducts() {
  const rows: PhotoProduct[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await db()
      .from("products")
      .select("id,code,description,image_url")
      .order("id")
      .range(offset, offset + 999);
    fail(r.error);
    rows.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 1000) return rows;
  }
}
export default function PhotoImport({
  onBusy,
  disabled = false,
}: {
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [rule, setRule] = useState<PhotoRuleId>("exact"),
    [custom, setCustom] = useState({ prefix: 0, suffix: 0 });
  const [existingChoice, setExistingChoice] = useState<"keep" | "upload">(
    "keep",
  );
  const [view, setView] = useState<"ready" | "review" | "all">("ready");
  const [rows, setRows] = useState<Row[]>([]),
    [products, setProducts] = useState<PhotoProduct[]>([]),
    [source, setSource] = useState("");
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState(0),
    [manual, setManual] = useState<number | null>(null),
    [search, setSearch] = useState(""),
    [preview, setPreview] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [historyError, setHistoryError] = useState("");
  const batch = useRef<string | null>(null),
    stop = useRef(false);
  const duplicates = useMemo(() => batchConflicts(rows), [rows]);
  const locked = busy || disabled,
    frozen = locked || Boolean(batch.current);
  const customError = rule === "custom" ? customRuleError(custom) : "";
  const ready = rows.filter((r) => readyPhoto(r, duplicates)).length;
  const needsReview = (r: Row) =>
    !r.done &&
    r.choice !== "skip" &&
    (Boolean(r.source.error) ||
      !r.target ||
      Boolean(r.target && duplicates.has(r.target.id)));
  const reviewCount = rows.filter(needsReview).length;
  const visibleRows = rows
    .map((row, i) => ({ row, i }))
    .filter(
      ({ row }) =>
        view === "all" ||
        (view === "ready" ? readyPhoto(row, duplicates) : needsReview(row)),
    );
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / 100));
  const shownPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (busy) e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);
  const refreshHistory = useCallback(async () => {
    try {
      const r = await db().rpc("admin_image_import_history");
      fail(r.error);
      setHistory(r.data ?? []);
      setHistoryError("");
    } catch {
      setHistoryError(
        "Não foi possível carregar o histórico de imagens. Verifique se a atualização do banco foi aplicada.",
      );
    }
  }, []);
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  const closeManual = useCallback(() => setManual(null), []);
  useEffect(() => {
    let alive = true,
      url = "";
    setPreview("");
    if (manual !== null && !rows[manual].source.error)
      rows[manual].source
        .read()
        .then((file) => {
          if (alive) {
            url = URL.createObjectURL(file);
            setPreview(url);
          }
        })
        .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [manual, rows]);
  function analyzed(
    sources: PhotoSource[],
    stored: PhotoProduct[],
    selected: PhotoRuleId,
    options: typeof custom,
  ): Row[] {
    const map = productIndex(stored);
    return sources.map((s) => {
      const m = matchImage(s.name, selected, map, options);
      return {
        source: s,
        ...m,
        choice: m.target?.image_url ? existingChoice : "upload",
      };
    });
  }
  async function analyze(files: File[]) {
    setBusy(true);
    setError("");
    setNotice("");
    setRows([]);
    batch.current = null;
    setPage(0);
    setView("ready");
    try {
      const sources = await readPhotoSources(files, setProgress);
      setProgress("Carregando produtos…");
      const stored = await loadProducts();
      setProducts(stored);
      setSource(
        files.length === 1
          ? files[0].name
          : `${files.length} imagens selecionadas`,
      );
      setRows(analyzed(sources, stored, rule, custom));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  function changeRule(selected: PhotoRuleId, options = custom) {
    setRule(selected);
    setCustom(options);
    setRows(
      analyzed(
        rows.map((r) => r.source),
        products,
        selected,
        options,
      ),
    );
    setPage(0);
    setNotice("");
  }
  function changeRow(i: number, values: Partial<Row>) {
    setRows((current) =>
      current.map((r, n) => (n === i ? { ...r, ...values } : r)),
    );
  }
  function outcome(r: Row) {
    return r.source.error
      ? "invalid"
      : r.choice === "skip"
        ? "skipped"
        : r.status === "ambiguous"
          ? "ambiguous"
          : !r.target
            ? "not_found"
            : r.choice === "keep"
              ? "kept"
              : "pending";
  }
  function status(r: Row) {
    return (
      r.result ??
      (r.source.error ||
        (r.choice === "skip"
          ? "Cancelada para este arquivo"
          : !r.target
            ? r.status === "ambiguous"
              ? "Ambígua: escolha o produto"
              : "Produto não encontrado"
            : r.choice === "keep"
              ? "Manter foto atual"
              : duplicates.has(r.target.id)
                ? "Conflito: várias fotos para o mesmo produto"
                : !r.choice
                  ? "Já tem foto: escolha uma opção"
                  : "Pronta para envio"))
    );
  }
  async function process() {
    if (!ready || customError) return;
    setBusy(true);
    setError("");
    setNotice("");
    stop.current = false;
    const result = preparePhotoBatch(rows).map((r) => ({
      ...r,
      result:
        !r.done &&
        r.target &&
        duplicates.has(r.target.id) &&
        r.choice === "skip"
          ? "Ignorada: várias fotos para o mesmo produto"
          : r.result,
    }));
    const id = batch.current ?? crypto.randomUUID();
    batch.current = id;
    try {
      const start = await db().rpc("start_image_import", {
        p_id: id,
        p_source: source.slice(0, 300),
        p_rule: rule,
        p_options: rule === "custom" ? custom : {},
        p_entries: result.map((r) => ({
          filename: r.source.name,
          code: r.code,
          product_code: r.target?.code ?? null,
          rule: r.rule,
          outcome: outcome(r),
        })),
      });
      fail(start.error);
      for (const [i, row] of result.entries()) {
        if (stop.current) break;
        if (row.done) continue;
        setProgress(`Arquivo ${i + 1} de ${result.length}`);
        const state = outcome(row);
        if (state !== "pending") {
          const r = await db().rpc("record_image_import_result", {
            p_import_id: id,
            p_position: i,
            p_outcome: state,
            p_message: status(row),
          });
          fail(r.error);
          row.done = true;
          row.result = status(row);
          setRows([...result]);
          continue;
        }
        let path: string | undefined;
        try {
          const file = await row.source.read();
          await validatePhoto(file);
          path = await uploadPhoto(file);
          const saved = await db().rpc("commit_import_image", {
            p_import_id: id,
            p_position: i,
            p_product_id: row.target!.id,
            p_expected_image: row.target!.image_url,
            p_image_path: path,
            p_rule: row.rule,
          });
          fail(saved.error);
          if (saved.data !== path)
            await db().storage.from("product-images").remove([path]);
          row.done = true;
          row.result = "Foto vinculada";
        } catch (e) {
          row.result = `Falha: ${explain(e)}`;
          // Referenced files cannot be removed by the bucket's orphan-only policy.
          if (path) await db().storage.from("product-images").remove([path]);
          const logged = await db().rpc("record_image_import_result", {
            p_import_id: id,
            p_position: i,
            p_outcome: "error",
            p_message: row.result,
          });
          fail(logged.error);
        }
        setRows([...result]);
      }
      const finished = await db().rpc("finish_image_import", {
        p_import_id: id,
        p_status:
          stop.current || result.some((r) => !r.done) ? "stopped" : "completed",
      });
      fail(finished.error);
      // Reconcile receipts if an upload RPC committed before a network timeout.
      for (let offset = 0; ; offset += 1000) {
        const receipts = await db()
          .from("image_import_entries")
          .select("position,outcome")
          .eq("import_id", id)
          .order("position")
          .range(offset, offset + 999);
        fail(receipts.error);
        for (const receipt of receipts.data ?? [])
          if (receipt.outcome === "linked") {
            result[receipt.position].done = true;
            result[receipt.position].result = "Foto vinculada";
          }
        if ((receipts.data?.length ?? 0) < 1000) break;
      }
      setRows([...result]);
      const pending = await cleanupDeletedProductImages().catch(() => 1);
      setNotice(
        `${stop.current ? "Envio interrompido após o arquivo em andamento." : "Processamento concluído. Confira cada resultado."}${pending ? " Algumas fotos antigas aguardam limpeza; a limpeza será tentada novamente em Produtos." : ""}`,
      );
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
      setProgress("");
      void refreshHistory();
    }
  }
  async function reanalyze() {
    setBusy(true);
    setError("");
    try {
      const stored = await loadProducts();
      setProducts(stored);
      setRows(
        analyzed(
          rows.map((r) => r.source),
          stored,
          rule,
          custom,
        ),
      );
      batch.current = null;
      setNotice("Análise atualizada com sua escolha para as fotos existentes.");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  async function historyReport(id: string) {
    setBusy(true);
    setError("");
    try {
      const records: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 1000) {
        const r = await db()
          .from("image_import_entries")
          .select("filename,identified_code,product_code,rule,outcome,message")
          .eq("import_id", id)
          .order("position")
          .range(offset, offset + 999);
        fail(r.error);
        records.push(...(r.data ?? []));
        if ((r.data?.length ?? 0) < 1000) break;
      }
      csv("historico-imagens.csv", records);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  const matches = products
    .filter((p) =>
      (p.code + " " + p.description)
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .slice(0, 100);
  return (
    <section className="panel import-panel">
      <h2>Importar imagens de produtos</h2>
      <p>
        Selecione o arquivo, escolha a regra e importe as fotos encontradas.
        Você só precisa revisar as exceções.
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
          {progress || "Preparando…"} Mantenha esta página aberta.{" "}
          {progress.startsWith("Arquivo") && (
            <button
              className="secondary small"
              onClick={() => {
                stop.current = true;
              }}
            >
              Parar após este arquivo
            </button>
          )}
        </div>
      )}
      <div className="toolbar">
        <label className={`upload-button ${locked ? "disabled" : ""}`}>
          Selecionar ZIP ou imagens
          <input
            type="file"
            multiple
            accept=".zip,.jpg,.jpeg,.png,.webp"
            disabled={locked}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void analyze(files);
            }}
          />
        </label>

        <label>
          Regra de correspondência
          <select
            value={rule}
            disabled={frozen}
            onChange={(e) => changeRule(e.target.value as PhotoRuleId)}
          >
            {photoRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={locked}
          onClick={() => {
            setShowHistory(!showHistory);
            void refreshHistory();
          }}
        >
          Histórico de imagens
        </button>
      </div>
      <details>
        <summary>Como funcionam as regras e os limites?</summary>
        <p>
          Primeiro procuramos o código exato. A regra escolhida só é usada
          quando não houver correspondência exata. Normalização testa remoções
          separadas, sem encadeá-las; vários produtos possíveis exigem escolha
          manual. Até 5.000 arquivos, 5 MB por imagem, ZIP de 100 MB e 200 MB
          extraídos.
        </p>
      </details>
      {rule === "custom" && (
        <div className="toolbar">
          <label>
            Remover caracteres do início
            <input
              type="number"
              min="0"
              max="20"
              value={custom.prefix}
              disabled={frozen}
              onChange={(e) =>
                changeRule(rule, { ...custom, prefix: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Remover caracteres do final
            <input
              type="number"
              min="0"
              max="20"
              value={custom.suffix}
              disabled={frozen}
              onChange={(e) =>
                changeRule(rule, { ...custom, suffix: Number(e.target.value) })
              }
            />
          </label>
          <p>Esta regra combina explicitamente as duas remoções.</p>
        </div>
      )}
      {customError && <div className="notice error">{customError}</div>}
      {rows.length > 0 && (
        <>
          <h3>{source}</h3>
          <div className="toolbar">
            <label>
              Se o produto já tem foto
              <select
                value={existingChoice}
                disabled={frozen}
                onChange={(e) => {
                  const choice = e.target.value as "keep" | "upload";
                  setExistingChoice(choice);
                  setRows((current) => applyExistingChoice(current, choice));
                  setPage(0);
                }}
              >
                <option value="keep">Manter todas as fotos atuais</option>
                <option value="upload">
                  Substituir pelas imagens deste lote
                </option>
              </select>
            </label>
            <button
              className="primary"
              disabled={locked || Boolean(customError) || !ready}
              onClick={process}
            >
              {batch.current ? "Enviar pendentes" : "Importar"} {ready}{" "}
              {ready === 1 ? "foto pronta" : "fotos prontas"}
            </button>
          </div>
          {existingChoice === "upload" &&
            rows.some(
              (r) => r.target?.image_url && r.choice === "upload" && !r.done,
            ) && (
              <p className="notice">
                Ao importar, as fotos atuais dos produtos correspondentes serão
                substituídas.
              </p>
            )}
          <p>
            {rows.length} arquivos · {ready} prontos para enviar ·{" "}
            {
              rows.filter(
                (r) => !r.done && r.choice === "keep" && !r.source.error,
              ).length
            }{" "}
            fotos atuais mantidas · {reviewCount} para revisão ·{" "}
            {rows.filter((r) => r.done && r.result === "Foto vinculada").length}{" "}
            vinculados.
          </p>
          {reviewCount > 0 && (
            <p>
              Você pode importar as fotos prontas agora. Os {reviewCount}{" "}
              arquivos para revisão ficarão fora do envio e aparecerão no
              relatório.
            </p>
          )}
          <div className="toolbar" role="group" aria-label="Filtrar imagens">
            <button
              className={view === "ready" ? "primary small" : "secondary small"}
              disabled={locked}
              onClick={() => {
                setView("ready");
                setPage(0);
              }}
            >
              Prontas ({ready})
            </button>
            <button
              className={
                view === "review" ? "primary small" : "secondary small"
              }
              disabled={locked}
              onClick={() => {
                setView("review");
                setPage(0);
              }}
            >
              Revisar ({reviewCount})
            </button>
            <button
              className={view === "all" ? "primary small" : "secondary small"}
              disabled={locked}
              onClick={() => {
                setView("all");
                setPage(0);
              }}
            >
              Todas ({rows.length})
            </button>
          </div>
          {visibleRows.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Imagem</th>
                    <th>Produto</th>
                    <th>Resultado</th>
                    <th>Ajuste opcional</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows
                    .slice(shownPage * 100, (shownPage + 1) * 100)
                    .map(({ row: r, i }) => (
                      <tr key={i}>
                        <td>
                          {r.source.name}
                          <small>
                            Código identificado: {r.code} · {label(r.rule)}
                          </small>
                        </td>
                        <td>
                          {r.target?.code ?? "—"}
                          <small>{r.target?.description}</small>
                        </td>
                        <td>{status(r)}</td>
                        <td>
                          {!r.source.error && !r.done && (
                            <button
                              className="secondary small"
                              disabled={frozen}
                              onClick={() => {
                                setManual(i);
                                setSearch(
                                  r.status === "ambiguous" ? "" : r.code,
                                );
                              }}
                            >
                              Ajustar vínculo
                            </button>
                          )}
                          {!r.done && !r.source.error && (
                            <select
                              aria-label={"Destino de " + r.source.name}
                              value={r.choice}
                              disabled={frozen}
                              onChange={(e) =>
                                changeRow(i, {
                                  choice: e.target.value as Choice,
                                })
                              }
                            >
                              {r.target?.image_url ? (
                                <>
                                  <option value="keep">Manter atual</option>
                                  <option value="upload">
                                    Substituir foto
                                  </option>
                                </>
                              ) : (
                                <option value="upload">Enviar imagem</option>
                              )}
                              <option value="skip">Ignorar arquivo</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="notice">
              {view === "ready"
                ? "Nenhuma foto pronta para enviar. Confira a regra escolhida ou abra a aba Revisar."
                : view === "review"
                  ? "Nenhum ajuste necessário."
                  : "Nenhum arquivo nesta lista."}
            </p>
          )}
          {pageCount > 1 && (
            <div className="panel-actions">
              <button
                className="secondary"
                disabled={locked || shownPage === 0}
                onClick={() => setPage(shownPage - 1)}
              >
                Anterior
              </button>
              <span>
                Página {shownPage + 1} de {pageCount}
              </span>
              <button
                className="secondary"
                disabled={locked || shownPage + 1 >= pageCount}
                onClick={() => setPage(shownPage + 1)}
              >
                Próxima
              </button>
            </div>
          )}
          <details>
            <summary>Relatório e outras opções</summary>
            <div className="panel-actions">
              <button
                className="secondary"
                disabled={locked}
                onClick={() =>
                  csv(
                    "relatorio-imagens.csv",
                    rows.map((r) => ({
                      arquivo: r.source.name,
                      codigo_identificado: r.code,
                      produto: r.target?.code ?? "",
                      regra: label(r.rule),
                      status: status(r),
                      candidatos: r.candidates.map((p) => p.code).join(" | "),
                    })),
                  )
                }
              >
                Baixar relatório
              </button>
              <button
                className="secondary"
                disabled={locked}
                onClick={reanalyze}
              >
                Atualizar análise
              </button>
            </div>
            <p>
              Depois de iniciar o envio, use Atualizar análise para mudar as
              escolhas. Arquivos com várias fotos para o mesmo produto são
              ignorados; ajuste ou ignore os excedentes antes de importar se
              quiser incluí-los.
            </p>
          </details>
        </>
      )}
      {showHistory && (
        <>
          <h3>Últimas 20 importações</h3>
          {historyError && <div className="notice error">{historyError}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data / origem</th>
                  <th>Regra</th>
                  <th>Total</th>
                  <th>Vinculadas</th>
                  <th>Não encontradas / ambíguas</th>
                  <th>Inválidas / falhas</th>
                  <th>Mantidas / canceladas / pendentes</th>
                  <th>Relatório</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {new Date(h.created_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                      <br />
                      {h.source}
                      <br />
                      {h.status === "completed"
                        ? "Concluída"
                        : h.status === "stopped"
                          ? "Interrompida"
                          : "Em andamento"}
                    </td>
                    <td>{label(h.rule)}</td>
                    <td>{h.total}</td>
                    <td>{h.linked}</td>
                    <td>
                      {h.not_found} / {h.ambiguous}
                    </td>
                    <td>
                      {h.invalid} / {h.errors}
                    </td>
                    <td>
                      {h.kept} / {h.skipped} / {h.pending}
                    </td>
                    <td>
                      <button
                        className="secondary small"
                        disabled={locked}
                        onClick={() => void historyReport(h.id)}
                      >
                        Baixar CSV
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!history.length && !historyError && (
            <p>Nenhuma importação registrada.</p>
          )}
        </>
      )}
      {manual !== null && (
        <Modal title="Escolher produto para a imagem" close={closeManual}>
          <p>{rows[manual].source.name}</p>
          {preview && (
            <img
              src={preview}
              alt="Imagem selecionada"
              style={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain" }}
            />
          )}
          {rows[manual].candidates.length > 1 && (
            <p>
              Candidatos:{" "}
              {rows[manual].candidates.map((p) => p.code).join(", ")}
            </p>
          )}
          <label>
            Buscar código ou descrição
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Digite o código do produto"
            />
          </label>
          <p>
            Até 100 resultados. Refine a busca para encontrar outros produtos.
          </p>
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {matches.map((p) => (
              <div className="toolbar" key={p.id}>
                <span>
                  <strong>{p.code}</strong> {p.description}
                </span>
                <button
                  className="secondary small"
                  onClick={() => {
                    changeRow(manual, {
                      target: p,
                      rule: "manual",
                      status: "ready",
                      choice: p.image_url ? existingChoice : "upload",
                      candidates: [],
                    });
                    setManual(null);
                  }}
                >
                  Vincular a este produto
                </button>
              </div>
            ))}
          </div>
          {rows[manual].target?.image_url && (
            <>
              <p>Foto atual do produto:</p>
              <ProductImage path={rows[manual].target!.image_url} />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
