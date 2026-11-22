import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Link } from "@astryxdesign/core/Link";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { CloudUpload, Copy, History, Link2, Unlink } from "lucide-react";
import { type BackupConfig, type BackupFile, post, request } from "../api";
import { apiError, type LayoutCtx } from "../Layout";
import { Appear, Page, SettingsBlock } from "../Page";

const INTERVALS = [
  { value: "0", label: "Desligado" },
  { value: "6", label: "A cada 6 horas" },
  { value: "12", label: "A cada 12 horas" },
  { value: "24", label: "Todo dia" },
  { value: "168", label: "Toda semana" },
];
const KEEP = [3, 7, 14, 30].map((n) => ({ value: String(n), label: `Manter os ${n} mais recentes` }));
const GOOGLE_MSG: Record<string, ["success" | "error" | "warning", string]> = {
  ok: ["success", "Google Drive conectado. A pasta “Punk-Records Backups” está pronta."],
  erro: ["error", "Não foi possível conectar ao Google Drive."],
  negado: ["warning", "A conexão foi cancelada na tela do Google."],
};

const when = (ts: number | string) => new Date(typeof ts === "number" ? ts * 1000 : ts).toLocaleString("pt-BR");
const mb = (size?: string) => (size ? `${(Number(size) / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "");

export default function Backup() {
  const { reload } = useOutletContext<LayoutCtx>();
  const [params, setParams] = useSearchParams();
  const [cfg, setCfg] = useState<BackupConfig | null>(null);
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const google = GOOGLE_MSG[params.get("google") ?? ""];

  const loadFiles = useCallback(() => {
    request<BackupFile[]>("/backup/files").then(setFiles).catch((e) => { setFiles([]); setError(apiError(e)); });
  }, []);

  useEffect(() => {
    request<BackupConfig>("/backup").then((c) => {
      setCfg(c); setClientId(c.client_id);
      if (c.connected) loadFiles(); else setFiles([]);
    }).catch((e) => setError(apiError(e)));
  }, [loadFiles]);

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name); setError(""); setOk("");
    try { await fn(); } catch (e) { setError(apiError(e)); } finally { setBusy(""); }
  }

  const save = (data: Partial<BackupConfig> & { client_secret?: string }) => act("save", async () => {
    setCfg(await request<BackupConfig>("/backup", { method: "PUT", body: JSON.stringify(data) }));
    setSecret("");
  });

  const connect = () => act("connect", async () => {
    await request<BackupConfig>("/backup", { method: "PUT", body: JSON.stringify({ client_id: clientId, client_secret: secret }) });
    location.assign((await post<{ url: string }>("/backup/google/connect")).url);
  });

  const disconnect = () => act("disconnect", async () => {
    const c = await request<BackupConfig>("/backup/google", { method: "DELETE" });
    setCfg((p) => p && { ...p, ...c }); setFiles([]);
  });

  const runNow = () => act("run", async () => {
    const f = await post<BackupFile>("/backup/run");
    setOk(`Backup ${f.name} enviado para o Google Drive.`);
    setCfg(await request<BackupConfig>("/backup"));
    loadFiles();
  });

  const restore = (f: BackupFile) => act("restore", async () => {
    await post("/backup/restore", { file_id: f.id });
    setRestoring(null);
    setOk(`Backup de ${when(f.createdTime)} restaurado. O estado anterior ficou em .pre-restore no volume de dados.`);
    reload();
  });

  if (!cfg) {
    return <Page title="Backup">{error ? <Banner status="error" title={error} /> : <Spinner />}</Page>;
  }

  return (
    <Page title="Backup" actions={cfg.connected && (
      <Button label={busy === "run" ? "Enviando" : "Fazer backup agora"} variant="primary" isLoading={busy === "run"}
        isDisabled={!!busy} icon={<Icon icon={CloudUpload} size="sm" />} onClick={runNow} />
    )}>
      {google && (
        <Appear><Banner status={google[0]} title={google[1]} description={params.get("google") === "erro" ? cfg.last_error ?? undefined : undefined}
          isDismissable dismissLabel="Fechar" onDismiss={() => setParams({})} /></Appear>
      )}
      {ok && <Appear><Banner status="success" title={ok} isDismissable dismissLabel="Fechar" onDismiss={() => setOk("")} /></Appear>}
      {error && <Appear><Banner status="error" title={error} isDismissable dismissLabel="Fechar" onDismiss={() => setError("")} /></Appear>}

      <SettingsBlock title="Google Drive"
        description="Crie um OAuth Client do tipo “Aplicativo da Web” no Google Cloud Console (com a Google Drive API ativada) e cadastre a URI de redirecionamento abaixo. O Punk-Records só enxerga a pasta que ele mesmo cria.">
        <VStack gap={4}>
          <TextInput label="URI de redirecionamento" value={cfg.redirect_uri} isReadOnly
            description="Cole em “URIs de redirecionamento autorizados” do OAuth Client." />
          <HStack hAlign="start">
            <Button label="Copiar URI" size="sm" variant="ghost" icon={<Icon icon={Copy} size="sm" />}
              onClick={() => void navigator.clipboard.writeText(cfg.redirect_uri)} />
          </HStack>
          <TextInput label="Client ID" value={clientId} onChange={setClientId} autoComplete="off"
            placeholder="123456789-abc.apps.googleusercontent.com" />
          <TextInput label="Client Secret" type="password" value={secret} onChange={setSecret} autoComplete="off"
            placeholder={cfg.has_secret ? "•••••••• (salvo; preencha só para trocar)" : "GOCSPX-…"} />
          <HStack gap={2} vAlign="center" wrap="wrap">
            {cfg.connected ? (
              <>
                <Text color="secondary">Conectado.</Text>
                {cfg.folder_url && <Link href={cfg.folder_url} as="a" isExternalLink>Abrir pasta no Drive</Link>}
                <Button label="Salvar credenciais" size="sm" isDisabled={!!busy || (!secret && clientId === cfg.client_id)}
                  onClick={() => save({ client_id: clientId, client_secret: secret })} />
                <Button label="Desconectar" size="sm" variant="ghost" isLoading={busy === "disconnect"} isDisabled={!!busy}
                  icon={<Icon icon={Unlink} size="sm" />} onClick={disconnect} />
              </>
            ) : (
              <Button label="Conectar ao Google Drive" variant="primary" isLoading={busy === "connect"}
                isDisabled={!!busy || !clientId.trim() || (!secret && !cfg.has_secret)}
                icon={<Icon icon={Link2} size="sm" />} onClick={connect} />
            )}
          </HStack>
        </VStack>
      </SettingsBlock>

      <SettingsBlock title="Rotina"
        description="O servidor envia um backup (memórias + agents.yaml) no intervalo escolhido e apaga do Drive os mais antigos.">
        <VStack gap={3}>
          <HStack gap={3} wrap="wrap">
            <Selector label="Frequência" value={String(cfg.interval_hours)} isDisabled={!!busy}
              options={INTERVALS} onChange={(v) => save({ interval_hours: Number(v ?? 0) })} />
            <Selector label="Retenção" value={String(cfg.keep)} isDisabled={!!busy}
              options={KEEP.some((k) => k.value === String(cfg.keep)) ? KEEP : [...KEEP, { value: String(cfg.keep), label: `Manter os ${cfg.keep} mais recentes` }]}
              onChange={(v) => save({ keep: Number(v ?? 7) })} />
          </HStack>
          {!cfg.connected && cfg.interval_hours > 0 && (
            <Text type="supporting" color="secondary">A rotina só roda depois de conectar o Google Drive.</Text>
          )}
          <Text type="supporting" color="secondary">
            {cfg.last_run ? `Último backup: ${when(cfg.last_run)}` : "Nenhum backup feito ainda."}
          </Text>
          {cfg.last_error && <Banner status="error" title="O último backup falhou" description={cfg.last_error} />}
        </VStack>
      </SettingsBlock>

      <SettingsBlock title="Restaurar"
        description="Restaurar troca todas as memórias e os agentes pelos do backup. O estado atual vai para .pre-restore no volume de dados.">
        {files === null ? <Spinner /> : files.length === 0 ? (
          <Text color="secondary">{cfg.connected ? "Nenhum backup na pasta ainda." : "Conecte o Google Drive para ver os backups."}</Text>
        ) : (
          <List hasDividers edge="flush">
            {files.map((f) => (
              <ListItem key={f.id} align="start" label={when(f.createdTime)}
                endContent={<Button label="Restaurar" size="sm" variant="ghost" icon={<Icon icon={History} size="sm" />}
                  isDisabled={!!busy} onClick={() => { setRestoring(f); setError(""); }} />}
                description={
                  <VStack gap={3}>
                    <Text type="supporting" color="secondary">{f.name} · {mb(f.size)}</Text>
                    {restoring?.id === f.id && (
                      <Appear><Banner status="warning" title={`Restaurar o backup de ${when(f.createdTime)}?`} collapsible={false}
                        description="Memórias e agentes criados depois dele somem. Tokens emitidos depois deixam de valer.">
                        <HStack gap={2} hAlign="end">
                          <Button label="Cancelar" onClick={() => setRestoring(null)} />
                          <Button label={busy === "restore" ? "Restaurando" : "Restaurar"} variant="destructive"
                            isLoading={busy === "restore"} onClick={() => restore(f)} />
                        </HStack>
                      </Banner></Appear>
                    )}
                  </VStack>
                } />
            ))}
          </List>
        )}
      </SettingsBlock>
    </Page>
  );
}
