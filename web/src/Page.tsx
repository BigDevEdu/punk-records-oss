import type { ReactNode } from "react";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutPanel } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Section } from "@astryxdesign/core/Section";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { DROP, RISE, SLIDE_IN, useEnter } from "./motion";

// Painel lateral: desliza da direita ao abrir e quando troca de conteúdo (`panelKey`).
function PanelBody({ panelKey, children }: { panelKey: unknown; children: ReactNode }) {
  const ref = useEnter<HTMLElement>(SLIDE_IN, panelKey);
  return <VStack ref={ref}>{children}</VStack>;
}

// Aviso que aparece no meio da tela (resultado, confirmação, erro): desce um pouco ao surgir.
export function Appear({ children }: { children: ReactNode }) {
  const ref = useEnter<HTMLElement>(DROP);
  return <VStack ref={ref}>{children}</VStack>;
}

// Moldura comum das telas: cabeçalho com título e ações, conteúdo, painel lateral e rodapé opcionais.
export function Page({ title, actions, panel, panelLabel, panelKey, footer, isFlush, children }: {
  title: ReactNode; actions?: ReactNode; panel?: ReactNode; panelLabel?: string; panelKey?: unknown; footer?: ReactNode;
  isFlush?: boolean; children: ReactNode;
}) {
  const content = useEnter<HTMLDivElement>(RISE); // cada tela entra subindo um pouco
  return (
    <Layout
      header={
        <LayoutHeader hasDivider padding={3}>
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <HStack gap={2} vAlign="center">{typeof title === "string" ? <Text as="h1" type="large" weight="semibold">{title}</Text> : title}</HStack>
            {actions && <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack>}
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent ref={content} padding={isFlush ? 0 : 6}>
          {isFlush ? children : <VStack gap={6} maxWidth={880}>{children}</VStack>}
        </LayoutContent>
      }
      end={panel && <LayoutPanel width={380} hasDivider padding={4} label={panelLabel}><PanelBody panelKey={panelKey}>{panel}</PanelBody></LayoutPanel>}
      footer={footer && <LayoutFooter hasDivider padding={2}>{footer}</LayoutFooter>}
    />
  );
}

// Bloco de configuração: título, explicação e os controles.
export function SettingsBlock({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Section dividers={["top", "bottom", "start", "end"]}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>{title}</Heading>
          <Text type="supporting" color="secondary">{description}</Text>
        </VStack>
        {children}
      </VStack>
    </Section>
  );
}
