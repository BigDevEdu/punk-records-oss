import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, post } from "../api";
import { Logo } from "../Layout";

export default function Login() {
  const nav = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/login", { token });
      nav("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Não foi possível entrar. Tente de novo.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <div className="brand login-brand"><Logo size={20} />Punk-Records</div>
        <label htmlFor="token">Token de administrador</label>
        <input id="token" className="field" type="password" autoComplete="current-password"
               autoFocus value={token} onChange={(e) => setToken(e.target.value)} />
        <p className="muted hint">
          Precisa ser um token com papel global. Para criar um:{" "}
          <code>punk-records token new admin --role global</code>
        </p>
        <button className="primary" type="submit" disabled={busy || !token}>Entrar</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
