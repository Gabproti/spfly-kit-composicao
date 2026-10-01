import { useEffect, useState } from "react";
import { Boxes, ClipboardList, Package, Search, Plus } from "lucide-react";
import { db, fail } from "../lib/supabase";
import type { History } from "../lib/types";
import { Empty } from "../components/UI";
import { formatDate } from "../lib/dates";
type Stats = {
  products: number;
  components: number;
  compositions: number;
  today: number;
};
export default function Dashboard({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<History[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([
      db().rpc("dashboard_stats"),
      db()
        .from("consultation_history")
        .select("*,products(description),profiles(name,email)")
        .order("created_at", { ascending: false })
        .limit(6),
    ])
      .then(([s, h]) => {
        fail(s.error);
        fail(h.error);
        if (live) {
          setStats(s.data as Stats);
          setRows((h.data ?? []) as unknown as History[]);
        }
      })
      .catch(() => {
        if (live) setError("Não foi possível carregar os indicadores.");
      });
    return () => {
      live = false;
    };
  }, []);
  const cards = [
    {
      label: "Produtos ativos",
      value: stats?.products,
      icon: Package,
      page: "products",
    },
    {
      label: "Componentes ativos",
      value: stats?.components,
      icon: Boxes,
      page: "components",
    },
    {
      label: "Kits com composição",
      value: stats?.compositions,
      icon: ClipboardList,
      page: "compositions",
    },
    {
      label: "Consultas hoje",
      value: stats?.today,
      icon: Search,
      page: "history",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VISÃO GERAL</span>
          <h1>Painel da operação</h1>
          <p>Produtos, componentes e consultas em um só lugar.</p>
        </div>
        <button className="primary" onClick={() => navigate("consult")}>
          <Search size={20} />
          Consultar kit
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="stat-grid">
        {cards.map((c) => (
          <button
            key={c.page}
            className="stat-card"
            onClick={() => navigate(c.page)}
          >
            <div className="stat-top">
              <span>{c.label}</span>
              <c.icon size={24} />
            </div>
            <strong>{c.value ?? "—"}</strong>
            <small>
              {c.page === "history" ? "Horário de Brasília" : "Ver cadastros"}
            </small>
          </button>
        ))}
      </div>
      <section className="quick-panel">
        <div>
          <span className="eyebrow">GESTÃO DE KITS</span>
          <h2>
            Uma composição bem definida.
            <br />
            Uma conferência mais simples.
          </h2>
          <p>Cadastre os itens e organize a montagem de cada produto.</p>
        </div>
        <div className="quick-actions">
          <button className="primary" onClick={() => navigate("products")}>
            <Plus size={20} />
            Cadastrar produto
          </button>
          <button
            className="secondary"
            onClick={() => navigate("compositions")}
          >
            <ClipboardList size={20} />
            Gerenciar composições
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Últimas consultas</h2>
            <p>Atividade recente da operação</p>
          </div>
          <button className="text-button" onClick={() => navigate("history")}>
            Ver histórico
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Usuário</th>
                <th>Data e hora</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.product_code}</td>
                  <td>{r.products?.description}</td>
                  <td>{r.profiles?.name}</td>
                  <td>{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty>
              {stats
                ? "Ainda não há consultas registradas."
                : "Carregando consultas…"}
            </Empty>
          )}
        </div>
      </section>
    </>
  );
}
