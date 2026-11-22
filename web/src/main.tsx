import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { themes, defaultThemeSlug } from "./astryx-themes";
import { usePrefs } from "./prefs";
import Layout, { RouterLink } from "./Layout";
import Login from "./pages/Login";
import Brain from "./pages/Brain";
import Agents from "./pages/Agents";
import Activity from "./pages/Activity";
import Appearance from "./pages/Appearance";
import Projects from "./pages/Projects";
import Backup from "./pages/Backup";

const router = createBrowserRouter(
  [
    { path: "/login", element: <Login /> },
    {
      element: <LinkProvider component={RouterLink}><Layout /></LinkProvider>,
      children: [
        { path: "/", element: <Brain /> },
        { path: "/agentes", element: <Agents /> },
        { path: "/atividade", element: <Activity /> },
        { path: "/projetos", element: <Projects /> },
        { path: "/aparencia", element: <Appearance /> },
        { path: "/backup", element: <Backup /> },
      ],
    },
  ],
  { basename: "/admin" },
);

function App() {
  const { theme } = usePrefs();
  return (
    <Theme theme={themes[defaultThemeSlug]} mode={theme}>
      <RouterProvider router={router} />
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
