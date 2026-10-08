import { useState, type FormEvent } from "react";
import { db } from "../lib/supabase";
import { withTimeout, connectionMessage } from "../lib/connection";
import { passwordError } from "../lib/passwordRecovery";
import Brand from "../components/Brand";
export default function ResetPassword({
  hasSession,
  onDone,
}: {
  hasSession: boolean;
  onDone: () => void;
}) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function leave() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await withTimeout(db().auth.signOut({ scope: "local" }));
      if (result.error) throw result.error;
      onDone();
    } catch {
      setError(
        "Não foi possível encerrar a sessão. Tente voltar ao login novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || saved || !hasSession) return;
    const invalid = passwordError(password, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await withTimeout(
        db().auth.updateUser({ password }),
        20000,
      );
      if (result.error) {
        setError(
          result.error.code === "same_password"
            ? "Escolha uma senha diferente da atual."
            : result.error.code === "weak_password"
              ? "A senha não atende aos requisitos. Use uma senha mais forte."
              : "Não foi possível alterar a senha. O link pode ter expirado; solicite outro.",
        );
        return;
      }
      setPassword("");
      setConfirmation("");
      setSaved(true);
      try {
        await withTimeout(db().auth.signOut({ scope: "global" }));
      } catch {
        /* Local sign-out remains available via the return button. */
      }
    } catch {
      setError(connectionMessage);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="setup">
      <Brand dark />
      <h1>Redefinir senha</h1>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {saved ? (
        <>
          <div className="notice success" role="status">
            Senha alterada com sucesso. Entre novamente com sua nova senha.
          </div>
          <button className="primary" disabled={busy} onClick={leave}>
            Voltar ao login
          </button>
        </>
      ) : !hasSession ? (
        <>
          <p role="alert">
            Não foi possível validar o link. Ele pode ter expirado ou já ter
            sido utilizado.
          </p>
          <button className="primary" disabled={busy} onClick={leave}>
            Voltar ao login e solicitar outro link
          </button>
        </>
      ) : (
        <form onSubmit={save} className="reset-password-form">
          <p>Escolha uma senha entre 12 e 128 caracteres.</p>
          <label>
            Nova senha
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
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
              value={confirmation}
              disabled={busy}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={leave}
            >
              Cancelar
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar nova senha"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
