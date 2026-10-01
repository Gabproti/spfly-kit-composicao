import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { db, fail } from "../lib/supabase";
import type { Product, Component, CompositionItem } from "../lib/types";
import { Empty, ProductImage, message } from "../components/UI";
export default function Compositions() {
  const [products, setProducts] = useState<Product[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [productId, setProductId] = useState("");
  const [items, setItems] = useState<CompositionItem[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    Promise.all([
      db().from("products").select("*").order("code"),
      db().from("components").select("*").order("code"),
    ])
      .then(([p, c]) => {
        fail(p.error);
        fail(c.error);
        setProducts(p.data ?? []);
        setComponents(c.data ?? []);
      })
      .catch(() => setError("Não foi possível carregar os cadastros."));
  }, []);
  useEffect(() => {
    let live = true;
    setItems([]);
    setSelected("");
    setNotice("");
    setDirty(false);
    if (!productId) return;
    setLoading(true);
    db()
      .from("compositions")
      .select("component_id,quantity")
      .eq("product_id", productId)
      .order("position")
      .then(({ data, error }) => {
        if (!live) return;
        setLoading(false);
        if (error) setError("Não foi possível carregar a composição.");
        else setItems(data ?? []);
      });
    return () => {
      live = false;
    };
  }, [productId]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function add() {
    if (!selected || items.some((i) => i.component_id === selected)) return;
    setItems([...items, { component_id: selected, quantity: 1 }]);
    setSelected("");
    setNotice("");
    setDirty(true);
  }
  async function save() {
    if (!productId || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (
        items.some(
          (i) =>
            !Number.isInteger(i.quantity) ||
            i.quantity < 1 ||
            i.quantity > 9999,
        )
      )
        throw new Error("A quantidade deve ser inteira, entre 1 e 9999.");
      const { error } = await db().rpc("save_composition", {
        p_product_id: productId,
        p_items: items.map((i) => ({
          component_id: i.component_id,
          quantity: i.quantity,
        })),
      });
      fail(error);
      setNotice("Composição salva com sucesso.");
      setDirty(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const product = products.find((p) => p.id === productId);
  const available = components.filter(
    (c) => c.active && !items.some((i) => i.component_id === c.id),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MONTAGEM</span>
          <h1>Composições</h1>
          <p>Defina os componentes e as quantidades de cada kit.</p>
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
      <section className="panel composition-selector">
        <label>
          Selecione o produto
          <select
            value={productId}
            disabled={busy}
            onChange={(e) => {
              if (
                dirty &&
                !window.confirm("Descartar as alterações ainda não salvas?")
              )
                return;
              setError("");
              setProductId(e.target.value);
            }}
          >
            <option value="">Escolha um produto</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.description}
                {p.active ? "" : " (inativo)"}
              </option>
            ))}
          </select>
        </label>
      </section>
      {!product ? (
        <Empty>
          Selecione um produto para cadastrar ou editar sua composição.
        </Empty>
      ) : (
        <section className="panel">
          <div className="composition-product">
            <ProductImage path={product.image_url} />
            <div>
              <span className="eyebrow">CÓDIGO {product.code}</span>
              <h2>{product.description}</h2>
            </div>
            <span className="record-count">{items.length} itens</span>
          </div>
          {loading ? (
            <Empty>Carregando composição…</Empty>
          ) : (
            <>
              <div className="add-item">
                <label>
                  Componente
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">Selecione um componente cadastrado</option>
                    {available.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.type} · {c.description}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={!selected || busy}
                  onClick={add}
                >
                  <Plus size={20} />
                  ADICIONAR ITEM
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th>Quantidade</th>
                      <th>Remover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i, index) => {
                      const c = components.find((c) => c.id === i.component_id);
                      return (
                        <tr key={i.component_id}>
                          <td>{c?.type}</td>
                          <td className="mono">{c?.code}</td>
                          <td>
                            {c?.description}
                            {c && !c.active && (
                              <span className="badge red">
                                Inativo — substitua ou remova
                              </span>
                            )}
                          </td>
                          <td>
                            <input
                              className="quantity-input"
                              type="number"
                              min={1}
                              max={9999}
                              step={1}
                              aria-label={`Quantidade de ${c?.description}`}
                              value={i.quantity}
                              disabled={busy}
                              onChange={(e) => {
                                setItems(
                                  items.map((item, n) =>
                                    n === index
                                      ? {
                                          ...item,
                                          quantity: Number(e.target.value),
                                        }
                                      : item,
                                  ),
                                );
                                setDirty(true);
                                setNotice("");
                              }}
                            />
                          </td>
                          <td>
                            <button
                              className="icon-button danger"
                              disabled={busy}
                              aria-label={`Remover ${c?.description}`}
                              onClick={() => {
                                setItems(items.filter((_, n) => n !== index));
                                setDirty(true);
                                setNotice("");
                              }}
                            >
                              <Trash2 size={20} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!items.length && (
                  <Empty>
                    Esta composição ainda não tem itens. Adicione os componentes
                    acima.
                  </Empty>
                )}
              </div>
              <div className="panel-actions">
                <small>
                  {!items.length
                    ? "Sem componentes, o kit não aparece na consulta."
                    : dirty
                      ? "Alterações ainda não salvas."
                      : "Os componentes serão apresentados nesta ordem."}
                </small>
                <button
                  className="primary"
                  onClick={save}
                  disabled={
                    busy ||
                    items.some(
                      (i) =>
                        !components.find((c) => c.id === i.component_id)
                          ?.active,
                    )
                  }
                >
                  <Save size={20} />
                  {busy ? "SALVANDO…" : "SALVAR COMPOSIÇÃO"}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
