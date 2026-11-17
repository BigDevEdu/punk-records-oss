import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";
import Layout from "./Layout";
import Login from "./pages/Login";
import Brain from "./pages/Brain";
import { Page } from "./pages/Page";

// T8 (Agentes, Atividade) troca estes placeholders.
const router = createBrowserRouter(
  [
    { path: "/login", element: <Login /> },
    {
      element: <Layout />,
      children: [
        { path: "/", element: <Brain /> },
        { path: "/agentes", element: <Page title="Agentes" /> },
        { path: "/atividade", element: <Page title="Atividade" /> },
      ],
    },
  ],
  { basename: "/admin" },
);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
