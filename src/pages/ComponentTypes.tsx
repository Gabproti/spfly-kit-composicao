import { useEffect, useState, type FormEvent } from "react";
import { db, fail } from "../lib/supabase";
import { loadComponentTypes } from "../lib/componentTypes";
import { normalizeHeader } from "../lib/importValidation";
import { message } from "../components/UI";
export default function ComponentTypes() {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    loadComponentTypes()
      .then((data) => {
        if (live) setNames(data);
      })
      .catch(() => {
        if (live) setError("Não foi possível carregar os tipos.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (
        names.some(
          (existing) => normalizeHeader(existing) === normalizeHeader(name),
        )
      )
        throw new Error("Este tipo já está cadastrado.");
      const { error } = await db()
        .from("component_types")
        .insert({ name: name.trim() });
      if (error?.code === "23505")
        throw new Error("Este tipo já está cadastrado.");
      fail(error);
      setNames(await loadComponentTypes());
      setName("");
      setNotice(
        "Tipo cadastrado. Vá a Componentes, edite o item e selecione o novo tipo.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CADASTROS</span>
          <h1>Tipos de componentes</h1>
          <p>Crie os tipos e vincule-os depois aos componentes importados.</p>
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
      <section className="panel import-panel">
        <h2>Cadastrar tipo</h2>
        <form onSubmit={save}>
          <div className="toolbar">
            <label>
              Nome do tipo
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Certificado"
                disabled={busy}
              />
            </label>
            <button
              className="primary"
              disabled={busy || loading || !name.trim()}
            >
              {busy ? "Salvando…" : "Cadastrar tipo"}
            </button>
          </div>
        </form>
        <p>
          O tipo é opcional no cadastro e na planilha. Itens sem classificação
          aparecem como “Sem tipo”. Para vincular: Componentes → Editar → Tipo.
        </p>
      </section>
      <section className="panel import-panel">
        <h2>Tipos cadastrados</h2>
        {loading ? (
          <p>Carregando…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                </tr>
              </thead>
              <tbody>
                {names.map((item) => (
                  <tr key={item}>
                    <td>{item}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!names.length && <p>Nenhum tipo cadastrado.</p>}
          </div>
        )}
      </section>
    </>
  );
}
