import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
import "../app/features.css";
import { AccountProvider } from "../components/account";
import { BillingProvider } from "../components/billing";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(
  <AccountProvider>
    <BillingProvider>
      <Home />
    </BillingProvider>
  </AccountProvider>,
);
