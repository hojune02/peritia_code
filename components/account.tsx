import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { LogIn, LogOut, Loader2, ShieldCheck } from "lucide-react";

type User = { id: string; email: string; provider: "password" | "google" };
type Account = {
  user: User | null;
  ready: boolean;
  open: () => void;
  refresh: () => Promise<void>;
};
const Context = createContext<Account | null>(null);
export const useAccount = () => {
  const value = useContext(Context);
  if (!value) throw new Error("Missing account provider");
  return value;
};
export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  const [google, setGoogle] = useState(false),
    [opened, setOpened] = useState(false),
    [register, setRegister] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    try {
      const response = await fetch("/api/auth/session");
      if (!response.ok) throw new Error("Account service is unavailable.");
      const data = await response.json();
      setUser(data.user);
      setGoogle(data.googleEnabled);
    } catch {
      setUser(null);
      setError(
        "Could not reach the account service. Check that Express is running, then retry.",
      );
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(location.search);
    const authError = params.get("auth_error");
    if (authError) {
      setError(
        authError === "existing_account"
          ? "This email already has an account. Sign in with your original method; accounts are not automatically linked."
          : "Google sign-in was cancelled, expired, or failed. Please try again.",
      );
      setOpened(true);
      params.delete("auth_error");
      history.replaceState(
        null,
        "",
        location.pathname + (params.size ? "?" + params : "") + location.hash,
      );
    }
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      setUser(data.user);
      setPassword("");
      setOpened(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  const open = () => {
    setPassword("");
    setOpened(true);
    void refresh();
  };
  return (
    <Context.Provider value={{ user, ready, open, refresh }}>
      {children}
      <Dialog
        open={opened}
        onOpenChange={(value) => {
          setOpened(value);
          if (!value) setPassword("");
        }}
      >
        <DialogContent className="account-dialog">
          <DialogHeader>
            <DialogTitle>
              {register ? "Create your Peritia account" : "Welcome to Peritia"}
            </DialogTitle>
            <DialogDescription>
              Sign in for explanations from your local AI model.
            </DialogDescription>
          </DialogHeader>
          <form className="account-form" onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 12 : 1}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {register && (
              <small>
                At least 12 characters. Email addresses are not verified by this
                MVP.
              </small>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy || !ready}>
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <LogIn size={16} />
              )}
              {register ? "Create account" : "Sign in"}
            </button>
          </form>
          <button
            className="small-link"
            onClick={() => {
              setRegister(!register);
              setError("");
              setPassword("");
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          <div className="account-divider">or</div>
          {google ? (
            <a className="google-signin" href="/api/auth/google">
              <span aria-hidden="true">G</span>Continue with Google
            </a>
          ) : (
            <p className="metadata-note">
              Google sign-in is available after the server owner configures a
              Google OAuth client.
            </p>
          )}
          <p className="metadata-note">
            <ShieldCheck size={14} /> Google sign-in uses your identity only.
            Peritia does not request Gmail inbox access. Password reset and
            account linking are not included yet.
          </p>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}
export function AccountControl() {
  const { user, ready, open, refresh } = useAccount();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Could not sign out. Please retry.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-control">
      {user ? (
        <>
          <span className="account-email" title={user.email}>
            {user.email}
          </span>
          <button className="export-button" onClick={logout} disabled={busy}>
            <LogOut size={15} />
            Sign out
          </button>
        </>
      ) : (
        <button className="export-button" onClick={open} disabled={!ready}>
          <LogIn size={15} />
          Sign in
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
