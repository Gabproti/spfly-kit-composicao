import { useEffect, useState } from "react";
import { Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { db, fail } from "../lib/supabase";
import type { History as HistoryRow, Profile } from "../lib/types";
import { Empty } from "../components/UI";
import { dayBounds, formatDate } from "../lib/dates";
const size = 30;
export default function History() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [code, setCode] = useState("");
  const [user, setUser] = useState("");
  const [date, setDate] = useState("");
  const [filters, setFilters] = useState({ code: "", user: "", date: "" });
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    db()
      .from("profiles")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (error)
          setError("Não foi possível carregar os usuários para o filtro.");
        else setUsers(data ?? []);
      });
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    let q = db()
      .from("consultation_history")
      .select("*,products(description),profiles(name,email)", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(page * size, (page + 1) * size - 1);
    if (filters.code) q = q.eq("product_code", filters.code);
    if (filters.user) q = q.eq("user_id", filters.user);
    if (filters.date) {
      const bounds = dayBounds(filters.date);
      q = q.gte("created_at", bounds.start).lt("created_at", bounds.end);
    }
    q.then(({ data, error, count }) => {
      if (!live) return;
      try {
        fail(error);
        setRows((data ?? []) as unknown as HistoryRow[]);
        setTotal(count ?? 0);
      } catch {
        setError("Não foi possível carregar o histórico.");
      } finally {
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [filters, page]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">RASTREABILIDADE</span>
          <h1>Histórico de consultas</h1>
          <p>Consultas de kits realizadas pela operação.</p>
        </div>
      </div>
      <section className="panel">
        <form
          className="history-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setFilters({ code: code.trim(), user, date });
          }}
        >
          <label>
            Código
            <input
              value={code}
              placeholder="Código exato"
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label>
            Usuário
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Todos os usuários</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button className="primary">
            <Filter size={18} />
            Filtrar
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setCode("");
              setUser("");
              setDate("");
              setPage(0);
              setFilters({ code: "", user: "", date: "" });
            }}
          >
            Limpar
          </button>
        </form>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <Empty>Carregando histórico…</Empty>
        ) : (
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
                    <td>{r.products?.description ?? "Produto indisponível"}</td>
                    <td>{r.profiles?.name ?? "Usuário indisponível"}</td>
                    <td>{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <Empty>Nenhuma consulta no período selecionado.</Empty>
            )}
          </div>
        )}
        <div className="pagination">
          <small>{total} consultas · Horário de Brasília</small>
          <span>
            Página {page + 1} de {Math.max(1, Math.ceil(total / size))}
          </span>
          <button
            className="secondary small"
            aria-label="Página anterior"
            disabled={page === 0 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="secondary small"
            aria-label="Próxima página"
            disabled={(page + 1) * size >= total || loading}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </section>
    </>
  );
}
