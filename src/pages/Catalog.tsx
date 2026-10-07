import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Search, Pencil, ImagePlus, Trash2 } from "lucide-react";
import { db, fail } from "../lib/supabase";
import { loadComponentTypes } from "../lib/componentTypes";
import type { Product, Component } from "../lib/types";
import {
  Empty,
  Modal,
  ProductImage,
  Status,
  uploadPhoto,
  message,
} from "../components/UI";
type Draft = {
  id?: string;
  code: string;
  description: string;
  type: string;
  image_url: string | null;
  active: boolean;
};
const blank: Draft = {
  code: "",
  description: "",
  type: "",
  image_url: null,
  active: true,
};
export default function Catalog({ kind }: { kind: "products" | "components" }) {
  const components = kind === "components";
  const noun = components ? "componente" : "produto";
  const [rows, setRows] = useState<(Product | Component)[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db().from(kind).select("*").order("code");
      fail(error);
      setRows(data ?? []);
      if (kind === "components") setComponentTypes(await loadComponentTypes());
    } catch {
      setError("Não foi possível carregar os cadastros.");
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => {
    setSearch("");
    setStatus("all");
    setError("");
    setNotice("");
    void load();
  }, [load]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const close = useCallback(() => {
    if (!busy) {
      setDraft(null);
      setFile(null);
    }
  }, [busy]);
  function edit(row?: Product | Component) {
    setError("");
    setFile(null);
    setDraft(
      row
        ? { ...row, type: "type" in row ? (row.type ?? "") : "" }
        : { ...blank },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    let uploaded: string | null = null;
    try {
      const image = file
        ? (uploaded = await uploadPhoto(file))
        : draft.image_url;
      const values = {
        code: draft.code.trim(),
        description: draft.description.trim(),
        active: draft.active,
        image_url: image,
        ...(components ? { type: draft.type || null } : {}),
      };
      if (!values.code) throw new Error("Informe o código.");
      const result = draft.id
        ? await db().from(kind).update(values).eq("id", draft.id)
        : await db().from(kind).insert(values);
      if (result.error?.code === "23505")
        throw new Error("Este código já está cadastrado.");
      fail(result.error);
      setDraft(null);
      setFile(null);
      setNotice(`${components ? "Componente" : "Produto"} salvo com sucesso.`);
      await load();
    } catch (e) {
      if (uploaded)
        await db().storage.from("product-images").remove([uploaded]);
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(row: Product) {
    if (changing) return;
    setChanging(row.id);
    setError("");
    try {
      const { error } = await db()
        .from(kind)
        .update({ active: !row.active })
        .eq("id", row.id);
      fail(error);
      await load();
      setNotice(
        `${components ? "Componente" : "Produto"} ${row.active ? "inativado" : "ativado"}.`,
      );
    } catch {
      setError("Não foi possível alterar o status.");
    } finally {
      setChanging(null);
    }
  }
  const visible = rows.filter(
    (r) =>
      (status === "all" || r.active === (status === "active")) &&
      `${r.code} ${r.description}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CADASTROS</span>
          <h1>{components ? "Componentes" : "Produtos"}</h1>
          <p>
            {components
              ? "Organize os itens disponíveis para compor seus kits."
              : "Gerencie os produtos e suas fotos de referência."}
          </p>
        </div>
        <button className="primary" onClick={() => edit()}>
          <Plus size={20} />
          Novo {noun}
        </button>
      </div>
      {error && !draft && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <section className="panel">
        <div className="toolbar">
          <div className="filter-field">
            <Search size={20} />
            <input
              aria-label={`Pesquisar ${noun}`}
              placeholder="Pesquisar código ou descrição"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
          <span className="record-count">{visible.length} registros</span>
        </div>
        {loading ? (
          <Empty>Carregando…</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Foto</th>
                  <th>Código</th>
                  {components && <th>Tipo</th>}
                  <th>Descrição</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <ProductImage path={row.image_url} />
                    </td>
                    <td className="mono">{row.code}</td>
                    {"type" in row && <td>{row.type || "Sem tipo"}</td>}
                    <td className="description-cell">{row.description}</td>
                    <td>
                      <Status active={row.active} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="secondary small"
                          onClick={() => edit(row)}
                        >
                          <Pencil size={16} />
                          Editar
                        </button>
                        <button
                          className={`text-button ${row.active ? "danger" : ""}`}
                          disabled={changing !== null}
                          onClick={() => toggle(row)}
                        >
                          {row.active ? "Inativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <Empty>Nenhum {noun} encontrado.</Empty>}
          </div>
        )}
      </section>
      {draft && (
        <Modal title={`${draft.id ? "Editar" : "Novo"} ${noun}`} close={close}>
          <form onSubmit={save}>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <div className="form-grid">
              <label>
                Código
                <input
                  required
                  maxLength={80}
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
              </label>
              {components && (
                <label>
                  Tipo (opcional)
                  <select
                    value={draft.type}
                    onChange={(e) =>
                      setDraft({ ...draft, type: e.target.value })
                    }
                  >
                    <option value="">Sem tipo</option>
                    {componentTypes.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="full">
                Descrição (opcional)
                <input
                  maxLength={300}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label>
                Status
                <select
                  value={String(draft.active)}
                  onChange={(e) =>
                    setDraft({ ...draft, active: e.target.value === "true" })
                  }
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </label>
            </div>
            <div className="photo-editor">
              <label>
                Foto {components ? "do componente (opcional)" : "do produto"}
              </label>
              {preview ? (
                <img
                  className="photo-preview"
                  src={preview}
                  alt="Prévia da imagem selecionada"
                />
              ) : draft.image_url ? (
                <ProductImage path={draft.image_url} large />
              ) : null}
              <label className="upload-button">
                <ImagePlus size={22} />
                {file || draft.image_url
                  ? "Alterar imagem"
                  : "Selecionar imagem"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    if (selected) setFile(selected);
                  }}
                />
              </label>
              <small>JPG, PNG ou WebP · Até 5 MB</small>
              {(file || draft.image_url) && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    setFile(null);
                    setDraft({ ...draft, image_url: null });
                  }}
                >
                  <Trash2 size={16} />
                  Remover imagem
                </button>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={close}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar cadastro"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
