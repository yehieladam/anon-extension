import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { installNetworkMonitor } from "./lib/networkMonitor";

// Patch the network primitives before anything else runs, so the trust badge counts every request.
installNetworkMonitor();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
