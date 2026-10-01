import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  ClipboardList,
  History as HistoryIcon,
  LayoutDashboard,
  LogOut,
  Package,
  Search,
  Settings,
  Users,
  FileUp,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { configured, db, fail, supabase } from "./lib/supabase";
import type { Profile } from "./lib/types";
import Login from "./pages/Login";
import Consult from "./pages/Consult";
import Catalog from "./pages/Catalog";
import Compositions from "./pages/Compositions";
import UserManagement from "./pages/Users";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Imports from "./pages/Imports";
import Brand from "./components/Brand";
const nav = [
  { id: "dashboard", label: "Início", icon: LayoutDashboard },
  { id: "products", label: "Produtos", icon: Package },
  { id: "components", label: "Componentes", icon: Boxes },
  { id: "compositions", label: "Composições", icon: ClipboardList },
  { id: "users", label: "Usuários", icon: Users },
  { id: "history", label: "Histórico", icon: HistoryIcon },
  { id: "imports", label: "Importações", icon: FileUp },
  { id: "consult", label: "Consulta de kit", icon: Search },
];
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [page, setPage] = useState("dashboard");
  const [importing, setImporting] = useState(false);
  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await db()
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    fail(error);
    if (!data.active)
      throw new Error("Seu acesso está inativo. Procure o administrador.");
    return data as Profile;
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    let revision = 0;
    const sync = async (next: Session | null) => {
      const current = ++revision;
      setLoading(true);
      setError("");
      setSession(next);
      setProfile(null);
      try {
        if (next) {
          const p = await loadProfile(next.user.id);
          if (live && current === revision) setProfile(p);
        }
      } catch (e) {
        if (live && current === revision)
          setError(
            e instanceof Error && e.message.includes("inativo")
              ? e.message
              : "Não foi possível validar seu perfil. Procure o administrador ou tente novamente.",
          );
      } finally {
        if (live && current === revision) setLoading(false);
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setTimeout(() => {
        if (live) void sync(next);
      }, 0);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!live) return;
      if (error) {
        setLoading(false);
        setError("Não foi possível recuperar sua sessão.");
      } else void sync(data.session);
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);
  useEffect(() => {
    if (profile) setPage(profile.role === "admin" ? "dashboard" : "consult");
  }, [profile?.id, profile?.role]);
  const logout = async () => {
    const { error } = await db().auth.signOut();
    if (error) {
      setError("Não foi possível sair. Tente novamente.");
      return;
    }
    setSession(null);
    setProfile(null);
  };
  if (!configured)
    return (
      <div className="setup">
        <Brand dark />
        <Settings size={40} />
        <h1>Conecte o sistema ao Supabase</h1>
        <p>
          A aplicação está preparada. Configure as duas variáveis públicas do
          arquivo <code>.env.example</code> e aplique a migração do banco para
          liberar o acesso.
        </p>
        <div className="setup-keys">
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
        </div>
        <p>O passo a passo está no README do projeto.</p>
      </div>
    );
  if (loading)
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Validando acesso…</p>
      </div>
    );
  if (!session) return <Login />;
  if (!profile)
    return (
      <div className="setup">
        <h1>Acesso indisponível</h1>
        <p role="alert">{error}</p>
        <button className="primary" onClick={() => location.reload()}>
          Tentar novamente
        </button>
        <button className="secondary" onClick={logout}>
          Sair
        </button>
      </div>
    );
  const admin = profile.role === "admin";
  return (
    <div className={admin ? "app-shell" : "app-shell operator"}>
      {admin && (
        <aside className="sidebar">
          <Brand />
          <div className="menu-label">GESTÃO</div>
          <nav>
            {nav.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? "nav-item selected" : "nav-item"}
                onClick={() => setPage(item.id)}
                disabled={importing}
              >
                <item.icon size={21} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="avatar">
              {profile.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{profile.name}</strong>
              <small>Administrador</small>
            </div>
          </div>
        </aside>
      )}
      <div className="main-shell">
        <header className="topbar">
          {admin ? (
            <span className="breadcrumb">
              SPFLY <span>/</span> {nav.find((n) => n.id === page)?.label}
            </span>
          ) : (
            <Brand compact dark />
          )}
          <div className="header-actions">
            <span>{admin ? "Área administrativa" : profile.name}</span>
            <button
              className="secondary small"
              onClick={logout}
              disabled={importing}
            >
              <LogOut size={18} /> Sair
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {!admin || page === "consult" ? (
            <Consult />
          ) : page === "dashboard" ? (
            <Dashboard navigate={setPage} />
          ) : page === "products" ? (
            <Catalog kind="products" />
          ) : page === "components" ? (
            <Catalog kind="components" />
          ) : page === "compositions" ? (
            <Compositions />
          ) : page === "users" ? (
            <UserManagement currentUser={profile.id} />
          ) : page === "imports" ? (
            <Imports onBusy={setImporting} />
          ) : (
            <History />
          )}
        </main>
        <footer>
          SPFLY <span>Consulta e composição de kits</span>
        </footer>
      </div>
    </div>
  );
}
