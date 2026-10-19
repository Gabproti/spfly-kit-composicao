import { useCallback, useEffect, useState } from "react";
import type { Component } from "../lib/types";
import { db, fail } from "../lib/supabase";
import { Modal } from "./UI";
type Preview = {
  token: string;
  component_code: string;
  component_description: string;
  total: number;
  existing: number;
  adding: number;
  inactive: number;
  adding_inactive: number;
  quantity: number;
  expires_at: string;
};
const explain = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "Não foi possível concluir. Confira a conexão e tente novamente.";
export default function BulkComponent({
  components,
  disabled,
  onLock,
  onDone,
}: {
  components: Component[];
  disabled: boolean;
  onLock: (locked: boolean) => void;
  onDone: () => void;
}) {
  const [enabled, setEnabled] = useState(false),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null),
    [code, setCode] = useState(""),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    onLock(busy || Boolean(preview));
    return () => onLock(false);
  }, [busy, preview, onLock]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (busy) e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);
  const close = useCallback(() => {
    if (!busy) {
      setPreview(null);
      setCode("");
      setChecked(false);
      setError("");
    }
  }, [busy]);
  async function inspect() {
    if (disabled || busy || !selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    setCode("");
    setChecked(false);
    try {
      const r = await db().rpc("admin_preview_component_all", {
        p_component_id: selected,
      });
      fail(r.error);
      setPreview(r.data as Preview);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || busy || !checked || code !== preview.component_code) return;
    setBusy(true);
    setError("");
    try {
      const r = await db().rpc("admin_apply_component_all", {
        p_token: preview.token,
        p_confirmation_code: code,
      });
      fail(r.error);
      setNotice(
        `${r.data.inserted} vínculos adicionados para ${r.data.component_code}, com quantidade 1. Os vínculos e as quantidades anteriores foram preservados.`,
      );
      setPreview(null);
      setEnabled(false);
      setSelected("");
      setCode("");
      setChecked(false);
      onDone();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  const authorized = components.filter((c) => c.active && c.allow_bulk);
  return (
    <section className="panel import-panel">
      <label className="import-choice">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled || busy || Boolean(preview) || !authorized.length}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setError("");
            setNotice("");
            setSelected("");
          }}
        />
        Adicionar um componente a todos os produtos
      </label>
      {!authorized.length && (
        <p>
          Para usar esta função, abra Componentes → Editar e marque “Permitir
          adicionar a todos os produtos” nos componentes desejados.
        </p>
      )}
      {disabled && (
        <p>Salve as alterações da composição atual antes de usar esta opção.</p>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {error && !preview && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {enabled && (
        <>
          <p>
            Marcar esta opção não altera os cadastros. Primeiro confira o
            impacto; a gravação exigirá uma segunda confirmação. Inclui produtos
            ativos e inativos já cadastrados.
          </p>
          <div className="toolbar">
            <label>
              Componente a adicionar
              <select
                value={selected}
                disabled={disabled || busy || Boolean(preview)}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setError("");
                }}
              >
                <option value="">Selecione um componente ativo</option>
                {authorized.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.description || c.type || "Sem descrição"}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={disabled || busy || !selected || Boolean(preview)}
              onClick={inspect}
            >
              {busy ? "Conferindo…" : "1. Conferir impacto"}
            </button>
          </div>
        </>
      )}
      {preview && (
        <Modal title="Confira antes de adicionar a todos" close={close}>
          <p>
            Componente:{" "}
            <strong className="mono">{preview.component_code}</strong> —{" "}
            {preview.component_description || "Sem descrição"}
          </p>
          <div className="notice">
            <p>
              <strong>{preview.adding}</strong> produtos receberão este
              componente com <strong>quantidade 1</strong>.
            </p>
            <p>
              <strong>{preview.existing}</strong> já possuem o vínculo e
              manterão a quantidade atual.
            </p>
            <p>
              Total conferido: <strong>{preview.total}</strong> produtos,
              incluindo <strong>{preview.inactive}</strong> inativos. Novos
              vínculos em inativos: <strong>{preview.adding_inactive}</strong>.
            </p>
          </div>
          <p>
            Nenhum item será removido ou substituído. O componente será
            acrescentado ao final das composições que ainda não o possuem.
            Produtos cadastrados futuramente não serão incluídos
            automaticamente.
          </p>
          {preview.adding === 0 ? (
            <p>
              Todos os produtos já possuem este componente, ou não há produtos
              cadastrados. Nenhuma alteração é necessária.
            </p>
          ) : (
            <>
              <label className="import-choice">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                Conferi o componente e a quantidade de produtos e quero
                adicionar esses vínculos.
              </label>
              <label>
                Para confirmar, digite o código {preview.component_code}
                <input
                  value={code}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={preview.component_code}
                />
              </label>
            </>
          )}
          <p>
            Esta conferência vale por 10 minutos. Se os produtos ou os vínculos
            deste componente mudarem, será necessário conferir novamente.
          </p>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary" disabled={busy} onClick={close}>
              Cancelar sem alterar
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !checked ||
                code !== preview.component_code ||
                !preview.adding
              }
              onClick={confirm}
            >
              {busy
                ? "Adicionando…"
                : `2. Confirmar ${preview.adding} novos vínculos`}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
