import { TDSMobileAITProvider } from "@toss/tds-mobile-ait";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import config from "../granite.config.ts";
import App from "./App.tsx";
import "./index.css";
import { RootErrorBoundary } from "./RootErrorBoundary.tsx";

const el = document.getElementById("root");
if (!el) {
  throw new Error('#root 요소가 없습니다. index.html 을 확인해 주세요.');
}

createRoot(el).render(
  <StrictMode>
    <RootErrorBoundary>
      <TDSMobileAITProvider brandPrimaryColor={config.brand.primaryColor}>
        <App />
      </TDSMobileAITProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
