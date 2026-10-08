import { lazy, Suspense, useCallback, useEffect, useState } from "react";
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
import {
  configured,
  db,
  fail,
  supabase,
  recoveryRequested,
  recoveryLinkError,
} from "./lib/supabase";
import { isRecoverySession, rememberRecovery } from "./lib/passwordRecovery";
import ResetPassword from "./pages/ResetPassword";
import type { Profile } from "./lib/types";
import Login from "./pages/Login";
const Consult = lazy(() => import("./pages/Consult"));
const Catalog = lazy(() => import("./pages/Catalog"));
const Compositions = lazy(() => import("./pages/Compositions"));
const UserManagement = lazy(() => import("./pages/Users"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const History = lazy(() => import("./pages/History"));
const Imports = lazy(() => import("./pages/Imports"));
const ComponentTypes = lazy(() => import("./pages/ComponentTypes"));
import Brand from "./components/Brand";
import { connectionMessage, withTimeout } from "./lib/connection";
const nav = [
  { id: "dashboard", label: "Início", icon: LayoutDashboard },
  { id: "products", label: "Produtos", icon: Package },
  { id: "components", label: "Componentes", icon: Boxes },
  { id: "component-types", label: "Tipos de componentes", icon: Settings },
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
  const [recovering, setRecovering] = useState(recoveryRequested);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await withTimeout(
      db().from("profiles").select("*").eq("id", userId).single(),
    );
    fail(error);
    if (!data.active)
      throw new Error("Seu acesso está inativo. Procure o administrador.");
    return data as Profile;
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    let revision = 0;
    let readyUser: string | null = null;
    let recovery = recoveryRequested;
    let recoveryUserId: string | null = null;
    const startupTimer = setTimeout(() => {
      if (!live) return;
      setError(connectionMessage);
      setLoading(false);
    }, 15000);
    const sync = async (next: Session | null) => {
      clearTimeout(startupTimer);
      const current = ++revision;
      setLoading(true);
      setError("");
      setSession(next);
      setProfile(null);
      readyUser = null;
      try {
        if (next) {
          const p = await loadProfile(next.user.id);
          if (live && current === revision) {
            readyUser = p.id;
            setProfile(p);
          }
        }
      } catch (e) {
        if (live && current === revision)
          setError(
            e instanceof Error && e.message.includes("inativo")
              ? e.message
              : "Não foi possível validar seu perfil. Verifique a conexão com o Supabase ou procure o administrador.",
          );
      } finally {
        if (live && current === revision) setLoading(false);
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setTimeout(() => {
        if (!live) return;
        if (
          !recoveryLinkError &&
          (event === "PASSWORD_RECOVERY" ||
            (next && isRecoverySession(next.user.id)))
        ) {
          recovery = true;
          setRecovering(true);
          if (next) {
            recoveryUserId = next.user.id;
            rememberRecovery(next.user.id);
          }
        }
        if (recovery) {
          clearTimeout(startupTimer);
          ++revision;
          readyUser = null;
          setSession(next);
          setHasRecoverySession(
            Boolean(next && next.user.id === recoveryUserId),
          );
          setProfile(null);
          setLoading(false);
          return;
        }
        // Token refresh and repeated sign-in notifications must not unmount
        // a working screen (including an import in progress).
        if (
          next &&
          next.user.id === readyUser &&
          (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")
        ) {
          setSession(next);
          return;
        }
        void sync(next);
      }, 0);
    });
    // INITIAL_SESSION provides the initial session once. A second getSession
    // previously started a duplicate profile request on every initial load.
    return () => {
      live = false;
      clearTimeout(startupTimer);
      subscription.unsubscribe();
    };
  }, [loadProfile]);
  useEffect(() => {
    if (profile) setPage(profile.role === "admin" ? "dashboard" : "consult");
  }, [profile?.id, profile?.role]);
  const logout = async () => {
    const { error } = await db().auth.signOut({ scope: "local" });
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
  if (recovering)
    return (
      <ResetPassword
        hasSession={hasRecoverySession && Boolean(session)}
        onDone={() => {
          rememberRecovery(null);
          history.replaceState(null, "", location.pathname + location.search);
          // Restart Auth initialization after leaving recovery mode.
          location.reload();
        }}
      />
    );
  if (!session) return <Login sessionError={error} />;
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
          <Suspense
            fallback={
              <div className="loading-screen">
                <div className="spinner" />
                <p>Carregando tela…</p>
              </div>
            }
          >
            {!admin || page === "consult" ? (
              <Consult />
            ) : page === "dashboard" ? (
              <Dashboard navigate={setPage} />
            ) : page === "products" ? (
              <Catalog kind="products" />
            ) : page === "components" ? (
              <Catalog kind="components" />
            ) : page === "component-types" ? (
              <ComponentTypes />
            ) : page === "compositions" ? (
              <Compositions />
            ) : page === "users" ? (
              <UserManagement currentUser={profile.id} />
            ) : page === "imports" ? (
              <Imports onBusy={setImporting} />
            ) : (
              <History />
            )}
          </Suspense>
        </main>
        <footer>
          SPFLY <span>Consulta e composição de kits</span>
        </footer>
      </div>
    </div>
  );
}
