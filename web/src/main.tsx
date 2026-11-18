import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./styles.css";
import Layout from "./Layout";
import Login from "./pages/Login";
import Brain from "./pages/Brain";
import Agents from "./pages/Agents";
import Activity from "./pages/Activity";
import Appearance from "./pages/Appearance";
import Projects from "./pages/Projects";
import "./prefs"; // aplica o tema antes do primeiro render

const router = createBrowserRouter(
  [
    { path: "/login", element: <Login /> },
    {
      element: <Layout />,
      children: [
        { path: "/", element: <Brain /> },
        { path: "/agentes", element: <Agents /> },
        { path: "/atividade", element: <Activity /> },
        { path: "/projetos", element: <Projects /> },
        { path: "/aparencia", element: <Appearance /> },
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
