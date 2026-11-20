import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Monitor, Moon, Sun } from "lucide-react";
import { Theme, setPrefs, usePrefs } from "../prefs";
import { Page, SettingsBlock } from "../Page";

const THEMES = [
  { id: "system", label: "Sistema", icon: Monitor },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "light", label: "Claro", icon: Sun },
] as const;

export default function Appearance() {
  const prefs = usePrefs();

  return (
    <Page title="Aparência">
      <SettingsBlock title="Tema" description={'"Sistema" acompanha o modo claro ou escuro do seu computador.'}>
        <SegmentedControl label="Tema" value={prefs.theme} onChange={(v) => setPrefs({ theme: v as Theme })}>
          {THEMES.map((t) => <SegmentedControlItem key={t.id} value={t.id} label={t.label} icon={<Icon icon={t.icon} size="sm" />} />)}
        </SegmentedControl>
      </SettingsBlock>
      <Text type="supporting" color="secondary">As cores de cada projeto ficam em <Link href="/projetos">Projetos</Link>.</Text>
    </Page>
  );
}
