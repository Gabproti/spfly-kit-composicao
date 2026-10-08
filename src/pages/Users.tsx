import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Pencil, Search, KeyRound } from "lucide-react";
import { db, fail } from "../lib/supabase";
import type { Profile, Role } from "../lib/types";
import { Empty, Modal, Status, message } from "../components/UI";
import { passwordError, passwordResetUrl } from "../lib/passwordRecovery";
import { withTimeout } from "../lib/connection";
type UserDraft = {
  id?: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  password: string;
};
export default function UserManagement({
  currentUser,
}: {
  currentUser: string;
}) {
  const [rows, setRows] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetUser, setResetUser] = useState<Profile | null>(null);
  const [resetMode, setResetMode] = useState<"email" | "direct">("email");
  const [newPassword, setNewPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [resetError, setResetError] = useState("");
  const closeReset = useCallback(() => {
    if (!busy) {
      setResetUser(null);
      setNewPassword("");
      setConfirmation("");
    }
  }, [busy]);
  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetUser || busy) return;
    setResetError("");
    if (resetMode === "direct") {
      const invalid = passwordError(newPassword, confirmation);
      if (invalid) {
        setResetError(invalid);
        return;
      }
    }
    setBusy(true);
    setNotice("");
    try {
      if (resetMode === "email") {
        const result = await withTimeout(
          db().auth.resetPasswordForEmail(resetUser.email, {
            redirectTo: passwordResetUrl(
              location.origin,
              import.meta.env.BASE_URL,
            ),
          }),
          20000,
        );
        if (result.error) throw result.error;
      } else {
        const result = await withTimeout(
          db().functions.invoke("admin-users", {
            body: {
              action: "reset-password",
              user_id: resetUser.id,
              password: newPassword,
            },
          }),
          20000,
        );
        if (result.error || result.data?.error)
          throw new Error(
            result.data?.error ?? "Falha na função administrativa.",
          );
      }
      setNotice(
        resetMode === "email"
          ? `Link de redefinição solicitado para ${resetUser.email}. Peça ao usuário que confira o e-mail e o spam.`
          : `Senha de ${resetUser.name} redefinida. Informe a nova senha ao usuário por um canal privado.`,
      );
      setResetUser(null);
      setNewPassword("");
      setConfirmation("");
    } catch {
      setResetError(
        resetMode === "email"
          ? "Não foi possível enviar o link. Aguarde um minuto e tente novamente."
          : "Não foi possível redefinir a senha. Confira os requisitos da senha e se a atualização da função admin-users foi publicada.",
      );
    } finally {
      setBusy(false);
    }
  }
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db()
        .from("profiles")
        .select("*")
        .order("name");
      fail(error);
      setRows(data ?? []);
    } catch {
      setError("Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const close = useCallback(() => {
    if (!busy) setDraft(null);
  }, [busy]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      if (draft.id) {
        const { error } = await db().rpc("admin_set_profile", {
          p_id: draft.id,
          p_name: draft.name.trim(),
          p_role: draft.role,
          p_active: draft.active,
        });
        fail(error);
      } else {
        const { data, error } = await db().functions.invoke("admin-users", {
          body: {
            name: draft.name.trim(),
            email: draft.email.trim(),
            password: draft.password,
            role: draft.role,
          },
        });
        fail(error);
        if (data?.error) throw new Error(data.error);
      }
      setDraft(null);
      setNotice("Usuário salvo com sucesso.");
      await load();
    } catch (e) {
      setError(
        message(
          e,
          "Não foi possível salvar o usuário. Verifique se o e-mail já existe e se a função admin-users foi publicada.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const visible = rows.filter((r) =>
    `${r.name} ${r.email}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR")),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACESSOS</span>
          <h1>Usuários</h1>
          <p>Gerencie quem consulta e quem administra os kits.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setDraft({
              name: "",
              email: "",
              role: "operator",
              active: true,
              password: "",
            });
          }}
        >
          <Plus size={20} />
          Novo usuário
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
              aria-label="Pesquisar usuário"
              placeholder="Pesquisar nome ou e-mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="record-count">{visible.length} usuários</span>
        </div>
        {loading ? (
          <Empty>Carregando usuários…</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      {u.id === currentUser && (
                        <span className="self-label">Você</span>
                      )}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span
                        className={`badge ${u.role === "admin" ? "orange" : "neutral"}`}
                      >
                        {u.role === "admin" ? "Administrador" : "Consulta"}
                      </span>
                    </td>
                    <td>
                      <Status active={u.active} />
                    </td>
                    <td>
                      <button
                        className="secondary small"
                        onClick={() => {
                          setError("");
                          setDraft({ ...u, password: "" });
                        }}
                      >
                        <Pencil size={16} />
                        Editar
                      </button>
                      <button
                        className="secondary small"
                        disabled={busy}
                        onClick={() => {
                          setResetUser(u);
                          setResetMode("email");
                          setResetError("");
                          setNewPassword("");
                          setConfirmation("");
                        }}
                      >
                        <KeyRound size={16} />
                        Redefinir senha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <Empty>Nenhum usuário encontrado.</Empty>}
          </div>
        )}
      </section>
      {draft && (
        <Modal
          title={draft.id ? "Editar usuário" : "Novo usuário"}
          close={close}
        >
          <form onSubmit={save}>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <label>
              Nome
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                required
                disabled={Boolean(draft.id)}
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </label>
            {!draft.id && (
              <label>
                Senha inicial
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value })
                  }
                />
                <small>
                  Use pelo menos 12 caracteres. Entregue a senha ao usuário por
                  um canal privado.
                </small>
              </label>
            )}
            <div className="form-grid">
              <label>
                Perfil
                <select
                  value={draft.role}
                  disabled={draft.id === currentUser}
                  onChange={(e) =>
                    setDraft({ ...draft, role: e.target.value as Role })
                  }
                >
                  <option value="operator">Usuário de consulta</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={String(draft.active)}
                  disabled={!draft.id || draft.id === currentUser}
                  onChange={(e) =>
                    setDraft({ ...draft, active: e.target.value === "true" })
                  }
                >
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </label>
            </div>
            {draft.id === currentUser && (
              <div className="notice">
                Seu próprio acesso administrativo deve permanecer ativo.
              </div>
            )}
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
                {busy ? "Salvando…" : "Salvar usuário"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {resetUser && (
        <Modal title="Redefinir senha do usuário" close={closeReset}>
          <form onSubmit={resetPassword}>
            <p>
              <strong>{resetUser.name}</strong>
              <br />
              {resetUser.email}
            </p>
            {resetError && (
              <div className="notice error" role="alert">
                {resetError}
              </div>
            )}
            <label>
              Como redefinir
              <select
                value={resetMode}
                disabled={busy}
                onChange={(e) => {
                  setResetMode(e.target.value as "email" | "direct");
                  setResetError("");
                  setNewPassword("");
                  setConfirmation("");
                }}
              >
                <option value="email">Enviar link por e-mail</option>
                <option value="direct">Definir uma nova senha</option>
              </select>
            </label>
            {resetMode === "email" ? (
              <p>
                O usuário receberá um link para escolher a própria senha. O
                perfil e o status do acesso serão preservados.
              </p>
            ) : (
              <>
                <label>
                  Nova senha
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={busy}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <label>
                  Confirmar nova senha
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={busy}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <p>
                  A senha atual será substituída. Use de 12 a 128 caracteres e
                  informe a nova senha ao usuário por um canal privado. Esta
                  alteração não ativa um acesso inativo.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={closeReset}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Processando…"
                  : resetMode === "email"
                    ? "Enviar link"
                    : "Confirmar redefinição"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
