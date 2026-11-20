import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Center } from "@astryxdesign/core/Center";
import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Appear } from "../Page";
import { post } from "../api";
import { POP, useEnter } from "../motion";
import { Logo, apiError } from "../Layout";

export default function Login() {
  const nav = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const card = useEnter<HTMLElement>(POP);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) { setError("Cole o token para entrar."); return; }
    setBusy(true);
    setError("");
    try {
      await post("/login", { token });
      nav("/", { replace: true });
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  }

  return (
    <Center height="100dvh" padding={4}>
      <VStack ref={card} width="100%" maxWidth={400}><Card>
        <form onSubmit={submit}>
          <VStack gap={4}>
            <HStack gap={2} vAlign="center"><Logo size="lg" /><Heading level={1}>Punk-Records</Heading></HStack>
            <TextInput label="Token de administrador" type="password" autoComplete="current-password" hasAutoFocus
              value={token} onChange={setToken} />
            <Text type="supporting" color="secondary">
              Precisa ser um token com papel global. Para criar um:{" "}
              <Text type="code">punk-records token new admin --role global</Text>
            </Text>
            <Button label={busy ? "Entrando" : "Entrar"} type="submit" variant="primary" isLoading={busy} />
            {error && <Appear><Banner status="error" title={error} /></Appear>}
          </VStack>
        </form>
      </Card></VStack>
    </Center>
  );
}
