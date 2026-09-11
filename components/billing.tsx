import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CreditCard, Crown, Loader2, Ticket } from "lucide-react";
import { useAccount } from "./account";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export type Usage = {
  plan: "free" | "pro";
  allowance: number;
  consumed: number;
  reserved: number;
  remaining: number;
  ticketBreakdown: {
    monthly: number;
    refill: number;
    trial: number;
    other: number;
  };
  renewsAt: string | null;
  subscriptionStatus: string | null;
  testMode: boolean | null;
  billingEnabled: boolean;
};

type PurchaseKind = "subscription" | "topup";
type BillingContext = {
  usage: Usage | null;
  loading: boolean;
  busy: boolean;
  error: string;
  refresh: () => Promise<Usage | null>;
  openPaywall: () => void;
  checkout: (kind: PurchaseKind) => Promise<void>;
  manage: () => void;
};

const Context = createContext<BillingContext | null>(null);

export function useBilling() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing billing provider");
  return value;
}

export function ticketBreakdownLabel(usage: Usage) {
  const parts = [
    [usage.ticketBreakdown.monthly, "monthly"],
    [usage.ticketBreakdown.refill, "refill"],
    [usage.ticketBreakdown.trial, "trial"],
    [usage.ticketBreakdown.other, "bonus"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(" + ");
}

function formatBillingDate(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function removeBillingQuery() {
  const params = new URLSearchParams(location.search);
  params.delete("billing");
  history.replaceState(
    null,
    "",
    location.pathname + (params.size ? `?${params}` : "") + location.hash,
  );
}

export function BillingProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"purchase" | "manage">("purchase");

  const refresh = useCallback(async () => {
    if (!account.user) {
      setUsage(null);
      return null;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/usage");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Usage is unavailable.");
      setUsage(body);
      setError("");
      return body as Usage;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Usage is unavailable.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [account.user?.id]);

  useEffect(() => {
    setUsage(null);
    setError("");
    setConfirmation("");
    setOpen(false);
    if (account.user) void refresh();
  }, [account.user?.id, refresh]);

  useEffect(() => {
    const reload = () => void refresh();
    window.addEventListener("peritia:usage-changed", reload);
    return () => window.removeEventListener("peritia:usage-changed", reload);
  }, [refresh]);

  useEffect(() => {
    if (!account.user) return;
    const purchase = new URLSearchParams(location.search).get("billing");
    if (purchase !== "subscription" && purchase !== "topup") return;
    setView("purchase");
    setOpen(true);
    setBusy(true);
    setConfirmation("");
    const baseline = Number(sessionStorage.getItem("peritia:billing-baseline") || 0);
    let active = true;
    let attempts = 0;
    const poll = async () => {
      const next = await refresh();
      if (!active) return;
      const ready = purchase === "subscription"
        ? Boolean(next?.plan === "pro" && next.remaining > baseline)
        : Boolean(next && next.remaining > baseline);
      if (ready) {
        setBusy(false);
        setConfirmation(
          purchase === "subscription"
            ? "Payment confirmed. Peritia Pro is active and your monthly tickets are ready."
            : "Payment confirmed. Your 50 refill tickets are ready.",
        );
        sessionStorage.removeItem("peritia:billing-baseline");
        removeBillingQuery();
        return;
      }
      if (++attempts >= 20) {
        setBusy(false);
        setError("Payment is still being confirmed. Your tickets will appear after the verified webhook arrives.");
        sessionStorage.removeItem("peritia:billing-baseline");
        removeBillingQuery();
        return;
      }
      setTimeout(() => void poll(), 1_500);
    };
    void poll();
    return () => { active = false; };
  }, [account.user?.id, refresh]);

  const checkout = async (kind: PurchaseKind) => {
    if (!account.user) {
      account.open();
      return;
    }
    setBusy(true);
    setError("");
    setConfirmation("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.url !== "string")
        throw new Error(body.error || "Checkout is unavailable.");
      sessionStorage.setItem("peritia:billing-baseline", String(usage?.remaining || 0));
      location.assign(body.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout is unavailable.");
      setBusy(false);
    }
  };

  const manage = () => {
    if (!account.user) {
      account.open();
      return;
    }
    setView("manage");
    setError("");
    setConfirmation("");
    setOpen(true);
  };

  const openPortal = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/portal");
      const body = await response.json();
      if (!response.ok || typeof body.url !== "string")
        throw new Error(body.error || "The subscription portal is unavailable.");
      location.assign(body.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The subscription portal is unavailable.");
      setBusy(false);
    }
  };

  const cancelSubscription = async () => {
    if (!window.confirm("Cancel future Pro renewals? Your current access remains available until the paid-through date.")) return;
    setBusy(true);
    setError("");
    setConfirmation("");
    try {
      const response = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok || body.status !== "cancelled")
        throw new Error(body.error || "The subscription could not be cancelled.");
      await refresh();
      setConfirmation(
        `Renewal cancelled. Pro remains active until ${formatBillingDate(body.endsAt || null)}.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The subscription could not be cancelled.");
    } finally {
      setBusy(false);
    }
  };

  const billing = {
    usage,
    loading,
    busy,
    error,
    refresh,
    openPaywall: () => {
      if (!account.user) return account.open();
      setView("purchase");
      setError("");
      setConfirmation("");
      setOpen(true);
    },
    checkout,
    manage,
  };

  return (
    <Context.Provider value={billing}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="billing-dialog">
          <DialogHeader>
            <span className="billing-icon"><Crown size={21} /></span>
            <DialogTitle>
              {view === "manage"
                ? "Manage Peritia Pro."
                : usage?.plan === "pro"
                  ? "Keep explaining without waiting."
                  : "Continue with Peritia Pro."}
            </DialogTitle>
            <DialogDescription>
              {view === "manage"
                ? "Review your tickets, renewal, and subscription status."
                : usage?.plan === "pro"
                ? "Add tickets now and keep your monthly renewal unchanged."
                : "A predictable monthly allowance for learning unfamiliar codebases."}
            </DialogDescription>
          </DialogHeader>
          {busy ? (
            <div className="billing-pending" role="status">
              <Loader2 className="spin" size={20} />
              {view === "manage" ? "Updating your subscription…" : "Confirming your purchase securely…"}
            </div>
          ) : view === "manage" && usage?.plan === "pro" ? (
            <div className="billing-management">
              <div className="billing-balance">
                <span className="mini-label">AVAILABLE TICKETS</span>
                <strong>{usage.remaining}</strong>
                <span>{ticketBreakdownLabel(usage) || "No tickets remaining"}</span>
              </div>
              <dl className="billing-details">
                <div>
                  <dt>Status</dt>
                  <dd>{usage.subscriptionStatus === "cancelled" ? "Cancels at period end" : "Active"}</dd>
                </div>
                <div>
                  <dt>{usage.subscriptionStatus === "cancelled" ? "Available until" : "Next renewal"}</dt>
                  <dd>{formatBillingDate(usage.renewsAt)}</dd>
                </div>
              </dl>
              {usage.testMode && (
                <p className="billing-test-note">
                  Test subscription: Lemon Squeezy blocks its hosted customer portal until the store is activated. You can cancel this test subscription here.
                </p>
              )}
              {!usage.testMode && (
                <button className="primary-button" onClick={() => void openPortal()}>
                  Open billing portal
                </button>
              )}
              {usage.subscriptionStatus !== "cancelled" && (
                <button className="billing-cancel-button" onClick={() => void cancelSubscription()}>
                  Cancel subscription
                </button>
              )}
            </div>
          ) : usage?.plan === "pro" ? (
            <div className="billing-offer">
              <span className="mini-label">PRO REFILL</span>
              <strong>$6 <small>one time</small></strong>
              <p><Ticket size={16} /> 50 additional explanation tickets</p>
              <p className="metadata-note">Refill tickets do not expire. Available when your balance reaches zero.</p>
              <button
                className="primary-button"
                disabled={!usage.billingEnabled || usage.remaining > 0}
                onClick={() => void checkout("topup")}
              >
                Buy 50 tickets
              </button>
              {usage.remaining > 0 && (
                <p className="metadata-note">You still have {usage.remaining} tickets. Refills unlock at zero.</p>
              )}
              <button className="small-link" onClick={manage}>Manage subscription</button>
            </div>
          ) : (
            <div className="billing-offer">
              <span className="mini-label">PERITIA PRO</span>
              <strong>$9 <small>per month</small></strong>
              <p><Ticket size={16} /> 100 explanation tickets every billing cycle</p>
              <ul>
                <li>Complete-file, streamed LLM explanations</li>
                <li>Failed attempts restore their reserved ticket</li>
                <li>Cancel anytime from your Peritia account</li>
              </ul>
              <button
                className="primary-button"
                disabled={!usage?.billingEnabled}
                onClick={() => void checkout("subscription")}
              >
                Go Pro for $9.99/month
              </button>
              {!usage?.billingEnabled && (
                <p className="metadata-note">Purchases will open after billing is configured.</p>
              )}
            </div>
          )}
          {confirmation && <p className="billing-success" role="status">{confirmation}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

export function GoProButton() {
  const account = useAccount();
  const { usage, loading, busy, openPaywall, manage } = useBilling();
  const pro = Boolean(account.user && usage?.plan === "pro");
  return (
    <button
      className={pro ? "go-pro-button billing-manage-button" : "go-pro-button"}
      onClick={pro ? manage : openPaywall}
      disabled={!account.ready || loading || busy}
    >
      {loading || busy
        ? <Loader2 className="spin" size={15} />
        : pro ? <CreditCard size={15} /> : <Crown size={15} />}
      <span>{pro ? "Manage plan" : "Go Pro"}</span>
    </button>
  );
}
