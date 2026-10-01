import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  CheckCircle2,
  PackageSearch,
  RotateCcw,
  Search,
  ScanLine,
} from "lucide-react";
import { db, fail } from "../lib/supabase";
import type { Kit } from "../lib/types";
import { ProductImage } from "../components/UI";
export default function Consult() {
  const [code, setCode] = useState("");
  const [kit, setKit] = useState<Kit | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  async function consult(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    setKit(null);
    setSearched(false);
    try {
      const { data, error } = await db().rpc("consult_kit", {
        p_code: code.trim(),
      });
      fail(error);
      setKit(data as Kit | null);
      setSearched(true);
    } catch {
      setError(
        "Não foi possível realizar a consulta. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setCode("");
    setKit(null);
    setSearched(false);
    setError("");
    input.current?.focus();
  }
  return (
    <div className="consult-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO</span>
          <h1>Consulta de kit</h1>
          <p>Informe o código do produto para visualizar sua composição.</p>
        </div>
        <span className="heading-icon">
          <ScanLine size={30} />
        </span>
      </div>
      <form className="search-panel" onSubmit={consult}>
        <label htmlFor="product-code">Código do produto</label>
        <div className="consult-search">
          <div className="code-field">
            <Search size={24} />
            <input
              id="product-code"
              ref={input}
              value={code}
              maxLength={80}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Digite ou informe o código"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          <button className="primary" disabled={busy || !code.trim()}>
            {busy ? "CONSULTANDO…" : "CONSULTAR"}
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {!searched && !busy && !error && (
          <div className="consult-idle">
            <PackageSearch size={56} />
            <h2>Pronto para conferir</h2>
            <p>
              Digite o código para ver a foto e todos os componentes do kit.
            </p>
          </div>
        )}
        {busy && (
          <div className="empty">
            <div className="spinner" />
            Localizando produto…
          </div>
        )}
        {searched && !kit && (
          <div className="not-found">
            <PackageSearch size={48} />
            <h2>PRODUTO NÃO ENCONTRADO</h2>
            <p>O código informado não possui uma composição disponível.</p>
            <button className="primary" onClick={reset}>
              <RotateCcw size={19} /> NOVA CONSULTA
            </button>
          </div>
        )}
        {kit && (
          <section className="kit-result">
            <div className="result-heading">
              <span className="found-label">
                <CheckCircle2 size={21} /> KIT ENCONTRADO
              </span>
              <button className="secondary" onClick={reset}>
                <RotateCcw size={18} /> NOVA CONSULTA
              </button>
            </div>
            <div className="kit-content">
              <ProductImage path={kit.product.image_url} large />
              <div className="kit-details">
                <span className="eyebrow">PRODUTO</span>
                <div className="product-code">{kit.product.code}</div>
                <h2>{kit.product.description}</h2>
                <div className="kit-info">
                  {kit.items.length} tipos de componentes <span>·</span>{" "}
                  {kit.items.reduce((n, i) => n + Number(i.quantity), 0)}{" "}
                  unidades no kit
                </div>
                <div className="composition-title">
                  <h3>Composição do kit</h3>
                  <span>Confira todos os itens</span>
                </div>
                <div className="table-wrap">
                  <table className="composition-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Código</th>
                        <th>Descrição</th>
                        <th className="quantity">Qtd.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kit.items.map((i) => (
                        <tr key={i.code}>
                          <td>
                            <span className="type-pill">{i.type}</span>
                          </td>
                          <td className="mono">{i.code}</td>
                          <td>{i.description}</td>
                          <td className="quantity">
                            <strong>{i.quantity}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
