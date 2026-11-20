import { useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useEnter } from "../motion";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";

// O token vive só neste estado; "Já copiei" fecha e o descarta (o pai desmonta).
export default function TokenOnce({ id, token, rotated, onClose }: {
  id: string; token: string; rotated?: boolean; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pop = useEnter<HTMLElement>({ scale: 0.8 }, copied); // confirmação da cópia
  const cmd = `claude mcp add --transport http punk-records https://${location.host}/mcp --header "Authorization: Bearer ${token}"`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sem permissão de área de transferência: o token segue selecionável */ }
  }
  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={2}>{rotated ? `Novo token do agente ${id}` : `Agente ${id} criado`}</Heading>
        <Text type="supporting" color="secondary">
          Copie o token agora. Ele não será mostrado de novo; se perder, gere outro na página do agente.
        </Text>
      </VStack>
      <HStack gap={2} vAlign="end">
        <TextInput label="Token" value={token} isReadOnly width="100%" />
        <HStack ref={pop}><IconButton label={copied ? "Copiado" : "Copiar token"} tooltip={copied ? "Copiado" : "Copiar token"}
          icon={<Icon icon={copied ? "checkDouble" : "copy"} size="sm" />} onClick={copy} /></HStack>
      </HStack>
      <VStack gap={2}>
        <Text type="label" color="secondary">Para conectar no Claude Code</Text>
        <CodeBlock code={cmd} language="bash" isWrapped width="100%" />
      </VStack>
      <HStack hAlign="end"><Button label="Já copiei" variant="primary" onClick={onClose} /></HStack>
    </VStack>
  );
}
