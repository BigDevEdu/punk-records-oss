import { Fragment, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Selector } from "@astryxdesign/core/Selector";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table";
import { ActivityRow, request } from "../api";
import { dayLabel, latency, outcomeLabel, toolLabel } from "../agents";
import { ProjectDot, apiError, type LayoutCtx } from "../Layout";
import { Page } from "../Page";

const time = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const COLS = ["Hora", "Agente", "Ação", "Projetos", "Resultados", "Tempo", "Resultado"];
const dash = <Text color="secondary">—</Text>;

export default function Activity() {
  const { agents, colorOf: color } = useOutletContext<LayoutCtx>();
  const [agent, setAgent] = useState("");
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      request<ActivityRow[]>(`/activity?limit=200` + (agent ? `&agent=${encodeURIComponent(agent)}` : ""))
        .then((r) => { if (live) { setRows(r); setError(""); } })
        .catch((e) => live && setError(apiError(e)));
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [agent]);

  const shown = (rows ?? []).filter((r) => !onlyErrors || r.outcome !== "ok");
  const errors = (rows ?? []).filter((r) => r.outcome !== "ok").length;
  const message = !rows ? (error ? null : "Carregando") : shown.length === 0 ? (onlyErrors ? "Nenhum erro." : "Nenhuma atividade ainda.") : null;

  return (
    <Page isFlush
      title={<>
        <Text as="h1" type="large" weight="semibold">Atividade</Text>
        <HStack gap={1} vAlign="center"><StatusDot variant="success" label="Ao vivo" isPulsing /><Text type="supporting" color="secondary">Ao vivo</Text></HStack>
      </>}
      actions={<>
        <CheckboxInput label={rows ? `Só erros (${errors})` : "Só erros"} size="sm" value={onlyErrors} onChange={setOnlyErrors} />
        <Selector label="Agente" isLabelHidden size="sm" value={agent} onChange={(v) => setAgent(v ?? "")} hasSearch={agents.length > 8}
          searchPlaceholder="Filtrar" options={[{ value: "", label: "Todos os agentes" }, ...agents.map((a) => ({ value: a.id, label: a.id }))]} />
      </>}>
      {error && <Banner status="error" title={error} container="section" />}
      <Table density="compact">
        <TableHeader><TableRow isHeaderRow>{COLS.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>
          {shown.map((r, i) => {
            const day = dayLabel(r.ts);
            const head = i === 0 || dayLabel(shown[i - 1].ts) !== day;
            return (
              <Fragment key={`${r.ts}-${r.agent_id}-${r.tool}-${i}`}>
                {head && <TableRow><TableCell colSpan={COLS.length} scope="rowgroup"><Text type="label" color="secondary">{day}</Text></TableCell></TableRow>}
                <TableRow>
                  <TableCell><Text color="secondary" hasTabularNumbers>{time(r.ts)}</Text></TableCell>
                  <TableCell>{r.agent_id}</TableCell>
                  <TableCell>{toolLabel(r.tool)}</TableCell>
                  <TableCell>
                    {(r.projects ?? []).length === 0 ? dash : (
                      <HStack gap={2} wrap="wrap">
                        {(r.projects ?? []).map((p) => <HStack key={p} gap={1} vAlign="center"><ProjectDot color={color(p)} /><Text>{p}</Text></HStack>)}
                      </HStack>
                    )}
                  </TableCell>
                  <TableCell>{r.n_results == null ? dash : `${r.n_results} resultados`}</TableCell>
                  <TableCell><Text color="secondary" hasTabularNumbers>{latency(r.latency_ms)}</Text></TableCell>
                  <TableCell><Badge variant={r.outcome === "ok" ? "success" : "error"} label={outcomeLabel(r.outcome)} /></TableCell>
                </TableRow>
              </Fragment>
            );
          })}
          {message && <TableRow><TableCell colSpan={COLS.length}><Text color="secondary">{message}</Text></TableCell></TableRow>}
        </TableBody>
      </Table>
    </Page>
  );
}
