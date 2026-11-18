import { useState } from "react";
import { Check, Copy } from "lucide-react";

// O token vive só neste estado; "Já copiei" fecha e o descarta (o pai desmonta).
export default function TokenOnce({ id, token, rotated, onClose }: {
  id: string; token: string; rotated?: boolean; onClose: () => void;
}) {
  const [copied, setCopied] = useState<"" | "token" | "cmd">("");
  const cmd = `claude mcp add --transport http punk-records https://${location.host}/mcp --header "Authorization: Bearer ${token}"`;
  async function copy(what: "token" | "cmd") {
    try {
      await navigator.clipboard.writeText(what === "token" ? token : cmd);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch { /* sem permissão de área de transferência: o token segue selecionável */ }
  }
  return (
    <div className="card">
      <h3>{rotated ? `Novo token do agente ${id}` : `Agente ${id} criado`}</h3>
      <p className="muted">
        Copie o token agora. Ele não será mostrado de novo; se perder, gere outro na página do agente.
      </p>
      <div className="row">
        <input className="field mono" readOnly value={token} aria-label="Token" onFocus={(e) => e.currentTarget.select()} />
        <button className="plain" onClick={() => copy("token")}>{copied === "token" ? <><Check size={14} aria-hidden />Copiado</> : <><Copy size={14} aria-hidden />Copiar</>}</button>
      </div>
      <p className="muted sub">Para conectar no Claude Code</p>
      <div className="field mono cmd">{cmd}</div>
      <div className="row end">
        <button className="plain" onClick={() => copy("cmd")}>{copied === "cmd" ? <><Check size={14} aria-hidden />Copiado</> : <><Copy size={14} aria-hidden />Copiar comando</>}</button>
        <button className="primary auto" onClick={onClose}>Já copiei</button></div>
    </div>
  );
}
