import { useState } from "react";
import type { FormEvent } from "react";
import { LockKeyhole, Eye, EyeOff, PackageCheck } from "lucide-react";
import { db } from "../lib/supabase";
import Brand from "../components/Brand";
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await db().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error)
        setError(
          "Não foi possível entrar. Confira seu e-mail e senha ou tente novamente.",
        );
    } catch {
      setError("Não foi possível conectar. Verifique sua conexão.");
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
        <form onSubmit={login}>
          <span className="form-icon">
            <LockKeyhole size={25} />
          </span>
          <h2>Bem-vindo à operação</h2>
          <p>Entre com seu acesso para continuar.</p>
          {error && (
            <div className="notice error" role="alert">
              {error}
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
          <button className="primary login-button" disabled={busy}>
            {busy ? "Entrando…" : "ENTRAR"}
          </button>
          <div className="login-help">
            Precisa de acesso? Procure o administrador.
          </div>
        </form>
      </section>
    </div>
  );
}
