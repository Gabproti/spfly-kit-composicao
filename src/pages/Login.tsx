import { useState } from "react";
import type { FormEvent } from "react";
import { LockKeyhole, Eye, EyeOff, PackageCheck } from "lucide-react";
import { db } from "../lib/supabase";
import Brand from "../components/Brand";
import { connectionMessage, withTimeout } from "../lib/connection";
import { passwordResetUrl } from "../lib/passwordRecovery";
export default function Login({
  sessionError = "",
}: {
  sessionError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState("");
  async function recover(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await withTimeout(
        db().auth.resetPasswordForEmail(email.trim(), {
          redirectTo: passwordResetUrl(
            location.origin,
            import.meta.env.BASE_URL,
          ),
        }),
        20000,
      );
      if (result.error) throw result.error;
      setNotice(
        "Se este e-mail estiver cadastrado, você receberá um link para escolher uma nova senha. Confira também o spam.",
      );
    } catch {
      setError(
        "Não foi possível enviar o link agora. Aguarde um minuto e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await withTimeout(
        db().auth.signInWithPassword({
          email: email.trim(),
          password,
        }),
        20000,
      );
      if (error)
        setError(
          error.code === "invalid_credentials"
            ? "E-mail ou senha incorretos. Confira seus dados e tente novamente."
            : error.code === "email_not_confirmed"
              ? "Seu e-mail ainda não foi confirmado. Procure o administrador."
              : connectionMessage,
        );
    } catch {
      setError(connectionMessage);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-intro">
        <Brand />
        <div className="intro-content">
          <div className="intro-symbol">
            <PackageCheck size={58} />
          </div>
          <span className="eyebrow">CONFERÊNCIA NA OPERAÇÃO</span>
          <h1>
            Cada item.
            <br />
            No kit certo.
          </h1>
          <p>
            Consulte o produto e confira sua composição com uma referência
            visual, direto no seu setor.
          </p>
        </div>
        <small>Consulta e composição de kits · SPFLY</small>
      </section>
      <section className="login-form">
        <form onSubmit={recovering ? recover : login}>
          <span className="form-icon">
            <LockKeyhole size={25} />
          </span>
          <h2>{recovering ? "Recuperar senha" : "Bem-vindo à operação"}</h2>
          <p>
            {recovering
              ? "Informe seu e-mail para receber o link de redefinição."
              : "Entre com seu acesso para continuar."}
          </p>
          {notice && (
            <div className="notice success" role="status">
              {notice}
            </div>
          )}
          {(error || sessionError) && (
            <div className="notice error" role="alert">
              {error || sessionError}
            </div>
          )}
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu.email@empresa.com"
            />
          </label>
          {!recovering && (
            <label>
              Senha
              <div className="password-input">
                <input
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  minLength={1}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite sua senha"
                />
                <button
                  type="button"
                  aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={21} /> : <Eye size={21} />}
                </button>
              </div>
            </label>
          )}
          <button className="primary login-button" disabled={busy}>
            {busy
              ? recovering
                ? "Enviando…"
                : "Entrando…"
              : recovering
                ? "Enviar link de recuperação"
                : "ENTRAR"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setRecovering(!recovering);
              setError("");
              setNotice("");
              setPassword("");
            }}
          >
            {recovering ? "Voltar ao login" : "Esqueci minha senha"}
          </button>
          <div className="login-help">
            Precisa de acesso? Procure o administrador.
          </div>
        </form>
      </section>
    </div>
  );
}
