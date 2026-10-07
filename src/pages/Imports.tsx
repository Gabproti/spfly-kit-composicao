import { useEffect, useState } from "react";
import { Download, FileUp, Images } from "lucide-react";
import Papa from "papaparse";
import { db, fail } from "../lib/supabase";
import { componentTypes, type Product } from "../lib/types";
import {
  activeValue,
  columns,
  photoCode,
  validateRows,
  type CheckedRow,
  type ImportKind,
} from "../lib/importValidation";
import {
  downloadFile,
  downloadTemplate,
  readImportFile,
} from "../lib/importFiles";
import { uploadPhoto } from "../components/UI";
import KitImport from "../components/KitImport";
type Row = CheckedRow & { existing?: Product; result?: string; done?: boolean };
type Photo = {
  file: File;
  code: string;
  target?: Product;
  error: string;
  result?: string;
  done?: boolean;
};
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
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filename, setFilename] = useState("");
  const [update, setUpdate] = useState(false);
  const [replacePhotos, setReplacePhotos] = useState(false);
  const [progress, setProgress] = useState("");
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);
  async function analyze(file: File) {
    setBusy(true);
    setRows([]);
    setPhotos([]);
    setError("");
    setNotice("");
    setFilename(file.name);
    setProgress("Lendo e validando arquivo…");
    try {
      const checked = validateRows(
        await readImportFile(file),
        kind,
        componentTypes,
      );
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
            ...(kind === "components" ? { type: row.values.tipo } : {}),
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
  async function analyzePhotos(files: File[]) {
    setBusy(true);
    setRows([]);
    setPhotos([]);
    setError("");
    setNotice("");
    setFilename("");
    setProgress("Associando fotos aos produtos…");
    try {
      if (files.length > 500)
        throw new Error("Selecione até 500 fotos por lote.");
      const stored = await catalog("products");
      const byCode = new Map(stored.map((r) => [r.code, r]));
      const codes = files.map((f) => photoCode(f.name));
      setPhotos(
        files.map((file, i) => ({
          file,
          code: codes[i],
          target: byCode.get(codes[i]),
          error:
            !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
            file.size > 5 * 1024 * 1024
              ? "Formato inválido ou tamanho maior que 5 MB."
              : codes.indexOf(codes[i]) !== codes.lastIndexOf(codes[i])
                ? "Mais de uma foto para este código."
                : !byCode.has(codes[i])
                  ? "Produto não encontrado."
                  : "",
        })),
      );
    } catch (e) {
      setError(explanation(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function importPhotos() {
    setBusy(true);
    setError("");
    setNotice("");
    const results = photos.map((p) => ({ ...p }));
    try {
      for (const [index, photo] of results.entries()) {
        if (photo.error || photo.done || !photo.target) continue;
        if (photo.target.image_url && !replacePhotos) {
          photo.result = "Ignorada: produto já tem foto";
          photo.done = true;
          setPhotos([...results]);
          continue;
        }
        setProgress(`Foto ${index + 1} de ${results.length}`);
        let path: string | undefined;
        try {
          path = await uploadPhoto(photo.file);
          const { error } = await db()
            .from("products")
            .update({ image_url: path })
            .eq("id", photo.target.id)
            .select("id")
            .single();
          fail(error);
          photo.result = "Foto associada";
          photo.done = true;
        } catch (e) {
          photo.result = `Falha: ${explanation(e)}`;
          if (path) await db().storage.from("product-images").remove([path]);
        }
        setPhotos([...results]);
      }
      setNotice(
        "Envio concluído. Arquivos sem correspondência foram mantidos fora da importação. Confira o relatório.",
      );
    } catch (e) {
      setError(explanation(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  function report() {
    const data: Record<string, string | number>[] = rows.length
      ? rows.map((r) => ({
          linha: r.line,
          ...r.values,
          resultado: r.error || r.result || "Pendente",
        }))
      : photos.map((p) => ({
          arquivo: p.file.name,
          codigo: p.code,
          resultado: p.error || p.result || "Pendente",
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
  const photoErrors = photos.filter((p) => p.error).length;
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
      <section className="panel import-panel">
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
              disabled={busy}
              onChange={(e) => {
                setKind(e.target.value as ImportKind);
                setRows([]);
                setPhotos([]);
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
                disabled={busy}
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
              <label className={`upload-button ${busy ? "disabled" : ""}`}>
                <FileUp size={20} />
                Selecionar planilha
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  disabled={busy}
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
              códigos como texto para preservar zeros à esquerda. Ativo:
              sim/não; vazio mantém o status existente e cria novos registros
              ativos.
            </p>
            {kind === "components" && (
              <p>Tipos aceitos: {componentTypes.join(", ")}.</p>
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
                      disabled={busy}
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
                    disabled={busy}
                    onClick={report}
                  >
                    Baixar relatório
                  </button>
                  <button
                    className="primary"
                    disabled={busy || errors > 0 || rows.every((r) => r.done)}
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
      <section className="panel import-panel">
        <h2>2. Fotos por código do produto</h2>
        <p>
          Cadastre os produtos antes. Nomeie cada imagem com o código exato:{" "}
          <strong>00123.jpg</strong> corresponde ao produto{" "}
          <strong>00123</strong>. JPG, PNG ou WebP, até 5 MB por foto e 500
          arquivos por lote.
        </p>
        <label className="upload-button">
          <Images size={20} />
          Selecionar fotos
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void analyzePhotos(files);
            }}
          />
        </label>
        {photos.length > 0 && (
          <>
            <p>
              {photos.length} arquivos · {photoErrors} sem associação válida.
            </p>
            <label className="import-choice">
              <input
                type="checkbox"
                checked={replacePhotos}
                disabled={busy}
                onChange={(e) => setReplacePhotos(e.target.checked)}
              />
              Substituir fotos dos produtos que já possuem imagem.
            </label>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {photos.slice(0, 100).map((p, i) => (
                    <tr key={i}>
                      <td>{p.file.name}</td>
                      <td>{p.code}</td>
                      <td>{p.target?.description ?? "—"}</td>
                      <td>
                        {p.error ||
                          p.result ||
                          (p.target?.image_url ? "Já tem foto" : "Pronta")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Fotos inválidas serão ignoradas. A prévia exibe até 100 arquivos;
              o relatório inclui todos.
            </p>
            <div className="panel-actions">
              <button className="secondary" disabled={busy} onClick={report}>
                Baixar relatório
              </button>
              <button
                className="primary"
                disabled={busy || !photos.some((p) => !p.error && !p.done)}
                onClick={importPhotos}
              >
                Confirmar envio das fotos
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
