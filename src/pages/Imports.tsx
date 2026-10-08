import { useEffect, useState } from "react";
import { Download, FileUp } from "lucide-react";
import Papa from "papaparse";
import { db, fail } from "../lib/supabase";
import type { Product } from "../lib/types";
import { loadComponentTypes } from "../lib/componentTypes";
import {
  activeValue,
  columns,
  validateRows,
  type CheckedRow,
  type ImportKind,
} from "../lib/importValidation";
import {
  downloadFile,
  downloadTemplate,
  readImportFile,
} from "../lib/importFiles";
import PhotoImport from "../components/PhotoImport";
import KitImport from "../components/KitImport";
type Row = CheckedRow & { existing?: Product; result?: string; done?: boolean };
async function catalog(table: "products" | "components") {
  const rows: Product[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db()
      .from(table)
      .select("id,code,description,image_url,active")
      .order("id")
      .range(offset, offset + 999);
    fail(error);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
const explanation = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Falha ao salvar. Confira a conexão e seu acesso.";
export default function Imports({
  onBusy,
}: {
  onBusy: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<ImportKind>("products");
  const [rows, setRows] = useState<Row[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filename, setFilename] = useState("");
  const [update, setUpdate] = useState(false);
  const [progress, setProgress] = useState("");
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  useEffect(() => {
    loadComponentTypes()
      .then(setComponentTypes)
      .catch(() =>
        setError("Não foi possível carregar os tipos de componentes."),
      );
  }, []);
  useEffect(() => {
    onBusy(busy || photoBusy);
    return () => onBusy(false);
  }, [busy, photoBusy, onBusy]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy || photoBusy) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy, photoBusy]);
  async function analyze(file: File) {
    setBusy(true);
    setRows([]);
    setError("");
    setNotice("");
    setFilename(file.name);
    setProgress("Lendo e validando arquivo…");
    try {
      const types = kind === "components" ? await loadComponentTypes() : [];
      if (kind === "components") setComponentTypes(types);
      const checked = validateRows(await readImportFile(file), kind, types);
      if (!checked.length)
        throw new Error("Inclua os dados abaixo do cabeçalho.");
      if (kind !== "compositions") {
        const stored = await catalog(kind);
        const byCode = new Map(stored.map((r) => [r.code, r]));
        setRows(
          checked.map((r) => ({ ...r, existing: byCode.get(r.values.codigo) })),
        );
      }
    } catch (e) {
      setError(explanation(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function importData() {
    setBusy(true);
    setError("");
    setNotice("");
    const results = rows.map((r) => ({ ...r }));
    try {
      if (kind !== "compositions") {
        for (const [index, row] of results.entries()) {
          if (row.done) continue;
          setProgress(`Cadastro ${index + 1} de ${results.length}`);
          if (row.existing && !update) {
            row.result = "Ignorado: código já cadastrado";
            row.done = true;
            setRows([...results]);
            continue;
          }
          const active = activeValue(row.values.ativo ?? "");
          const values = {
            code: row.values.codigo,
            description: row.values.descricao,
            ...(active === undefined
              ? row.existing
                ? {}
                : { active: true }
              : { active }),
            ...(kind === "components" &&
            (row.values.tipo !== undefined || !row.existing)
              ? { type: row.values.tipo || null }
              : {}),
          };
          const response = row.existing
            ? await db()
                .from(kind)
                .update(values)
                .eq("id", row.existing.id)
                .select("id")
                .single()
            : await db().from(kind).insert(values).select("id").single();
          row.result = response.error
            ? `Falha: ${response.error.message}`
            : row.existing
              ? "Atualizado"
              : "Criado";
          row.done = !response.error;
          setRows([...results]);
        }
      }
      setNotice(
        "Processamento concluído. Confira o resultado de cada linha; registros com falha podem ser tentados novamente.",
      );
    } catch (e) {
      setError(explanation(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  function report() {
    const data = rows.map((r) => ({
      linha: r.line,
      ...r.values,
      resultado: r.error || r.result || "Pendente",
    }));
    downloadFile(
      "relatorio-importacao.csv",
      new Blob(
        [
          "\uFEFF" +
            Papa.unparse(data, { delimiter: ";", escapeFormulae: true }),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
  }
  const errors = rows.filter((r) => r.error).length;
  const blocked = busy || photoBusy;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CARGA DE DADOS</span>
          <h1>Importações</h1>
          <p>Confira a prévia e depois confirme a gravação.</p>
        </div>
      </div>
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
          {progress || "Preparando…"} Mantenha esta página aberta.
        </div>
      )}
      <section className="panel import-panel" inert={photoBusy}>
        <h2>1. Planilhas de cadastros e kits</h2>
        <p>
          Importe primeiro produtos e componentes; depois as composições. Excel
          (.xlsx), primeira aba, ou CSV em UTF-8, até 10 MB. Cadastros: até
          5.000 linhas; kits: até 50.000 linhas e 100.000 relações.
        </p>
        <div className="toolbar">
          <label>
            Dados
            <select
              value={kind}
              disabled={blocked}
              onChange={(e) => {
                setKind(e.target.value as ImportKind);
                setRows([]);
                setNotice("");
                setError("");
                setFilename("");
              }}
            >
              <option value="products">Produtos</option>
              <option value="components">Componentes</option>
              <option value="compositions">Composições</option>
            </select>
          </label>
          {kind !== "compositions" && (
            <>
              <button
                className="secondary"
                disabled={blocked}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await downloadTemplate(kind);
                  } catch {
                    setError("Não foi possível gerar o modelo.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Download size={19} />
                Baixar modelo Excel
              </button>
              <label className={`upload-button ${blocked ? "disabled" : ""}`}>
                <FileUp size={20} />
                Selecionar planilha
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  disabled={blocked}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void analyze(f);
                  }}
                />
              </label>
            </>
          )}
        </div>
        {kind === "compositions" ? (
          <KitImport onBusy={setBusy} />
        ) : (
          <>
            <p>
              Colunas: <strong>{columns[kind].join(", ")}</strong>. Formate
              códigos como texto para preservar zeros à esquerda. Descrição é
              opcional e a coluna pode ser omitida. Ativo: sim/não; vazio mantém
              o status existente e cria novos registros ativos.
            </p>
            {kind === "components" && (
              <p>
                Tipo é opcional; a coluna pode ser omitida. Cadastre novos tipos
                em “Tipos de componentes” e vincule depois em Componentes →
                Editar. Tipos cadastrados: {componentTypes.join(", ")}.
              </p>
            )}
            {rows.length > 0 && (
              <>
                <h3>{filename}</h3>
                <p>
                  {rows.length} linhas · {errors} com erro ·{" "}
                  {rows.filter((r) => r.existing).length} códigos já
                  cadastrados.
                </p>
                {
                  <label className="import-choice">
                    <input
                      type="checkbox"
                      checked={update}
                      disabled={blocked}
                      onChange={(e) => setUpdate(e.target.checked)}
                    />
                    Atualizar descrição, tipo e status de códigos já
                    cadastrados. As fotos serão preservadas.
                  </label>
                }
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Linha</th>
                        {columns[kind].map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                        <th>Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 100).map((r) => (
                        <tr key={r.line}>
                          <td>{r.line}</td>
                          {columns[kind].map((c) => (
                            <td key={c}>{r.values[c]}</td>
                          ))}
                          <td>
                            {r.error ||
                              r.result ||
                              (r.existing ? "Já cadastrado" : "Pronto")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  A prévia exibe até 100 linhas. O relatório inclui todas. Os
                  cadastros são gravados individualmente. Uma falha não desfaz
                  as gravações concluídas.
                </p>
                <div className="panel-actions">
                  <button
                    className="secondary"
                    disabled={blocked}
                    onClick={report}
                  >
                    Baixar relatório
                  </button>
                  <button
                    className="primary"
                    disabled={
                      blocked || errors > 0 || rows.every((r) => r.done)
                    }
                    onClick={importData}
                  >
                    Confirmar importação
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
      <PhotoImport onBusy={setPhotoBusy} disabled={busy} />
    </>
  );
}
