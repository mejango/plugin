"use client";

import {
  useAuthenticateWithEmailOrPhone,
  useAuthenticateWithOAuth,
  useResendVerificationCode,
  useVerifyNewAccount,
} from "@getpara/react-sdk-lite";
import type { StateSnapshot, TOAuthMethod } from "@getpara/web-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnect, useConnectors } from "wagmi";

import { BrandMark, WalletFallbackMark } from "@/components/BrandMarks";
import { offerableWallets } from "@/lib/wallet-list";
import { PARA_PORTAL_THEME, getParaClient } from "./para-config";

/** Not exported by the SDK on its own, but reachable through the snapshot. */
type AuthPhase = StateSnapshot["authPhase"];

/** Every method Para can broker. `TWITTER` is the wire value — Para never
 *  renamed the enum after X did, so the label and the value differ. */
const OAUTH_METHODS: { method: TOAuthMethod; label: string }[] = [
  { method: "GOOGLE", label: "Google" },
  { method: "TWITTER", label: "X" },
  { method: "APPLE", label: "Apple" },
  { method: "DISCORD", label: "Discord" },
  { method: "FARCASTER", label: "Farcaster" },
  { method: "TELEGRAM", label: "Telegram" },
  { method: "FACEBOOK", label: "Facebook" },
];

/**
 * Phases that only occur because of something the visitor just did here.
 *
 * `awaiting_session_start` and `waiting_for_session` are deliberately absent:
 * Para sits in them while it polls, including with the code field still
 * untouched, so counting them as busy disables the close button and Escape on
 * a sheet that is doing nothing.
 */
const BUSY_PHASES: ReadonlySet<AuthPhase> = new Set<AuthPhase>([
  "authenticating_email_phone",
  "authenticating_oauth",
  "processing_authentication",
  "verifying_new_account",
]);

type Identifier =
  | { kind: "empty" }
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: `+${number}` }
  | { kind: "invalid"; hint: string };

/**
 * One field for either an email or a phone number, rather than a mode switch
 * the visitor has to set before typing. An `@` is the only reliable signal —
 * no phone number contains one, and no address omits one.
 */
function parseIdentifier(raw: string): Identifier {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (value.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
      ? { kind: "email", email: value }
      : { kind: "invalid", hint: "That email address looks incomplete." };
  }
  const compact = value.replace(/[\s().-]/g, "");
  if (/^\+\d{6,15}$/.test(compact)) {
    return { kind: "phone", phone: compact as `+${number}` };
  }
  // Guessing a country code would silently text the wrong country, so ask.
  if (/^\d{6,15}$/.test(compact)) {
    return { kind: "invalid", hint: "Add your country code, like +1." };
  }
  return { kind: "invalid", hint: "Enter an email address or phone number." };
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

const FIELD =
  "w-full border-2 border-black bg-white px-[.9rem] py-[.7rem] text-inherit rounded-none appearance-none placeholder:text-[#888] focus:outline-3 focus:outline-black focus:outline-offset-2";
const TILE =
  "flex h-11 w-11 cursor-pointer items-center justify-center border-2 border-black bg-white hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const GO =
  "display cursor-pointer border-2 border-black bg-black px-[1.2em] py-[.45em] text-[1.05rem] tracking-[.03em] text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-40";
const SECTION = "mb-2 mt-5 text-[.7rem] uppercase tracking-[.18em] text-[#777]";
const QUIET = "cursor-pointer border-none bg-transparent p-0 text-[.8rem] text-[#555] underline underline-offset-[3px] hover:text-black";

/**
 * The way in, driven by Para's headless auth hooks. Para's packaged modal is
 * never opened — its branding belongs to whoever owns the API key, and the
 * patch bay has its own.
 *
 * The hooks poll internally, so this component must stay mounted for the whole
 * flow: closing is blocked while `BUSY_PHASES` is active.
 */
export default function ParaAuthSheet({
  onClose,
  entry,
  onEntryChange,
}: {
  onClose: () => void;
  /** Held above this component so an address typed while Para was still
   *  starting up is not thrown away when the placeholder hands over. */
  entry: string;
  onEntryChange: (value: string) => void;
}) {
  // The same singleton ParaProvider was handed, so the state stream below is
  // the one the hooks are driving.
  const para = getParaClient();
  const allConnectors = useConnectors();
  const { connectAsync } = useConnect();

  const connectors = useMemo(() => offerableWallets(allConnectors), [allConnectors]);

  const { authenticateWithEmailOrPhoneAsync, error: authError } = useAuthenticateWithEmailOrPhone();
  const { authenticateWithOAuthAsync, error: oauthError } = useAuthenticateWithOAuth();
  const { verifyNewAccountAsync, isPending: verifying, error: verifyError } = useVerifyNewAccount();
  const { resendVerificationCodeAsync } = useResendVerificationCode();

  const [code, setCode] = useState("");
  const [authPhase, setAuthPhase] = useState<AuthPhase>("unauthenticated");
  const [pendingMethod, setPendingMethod] = useState<TOAuthMethod | "local" | null>(null);
  const [resent, setResent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [hostedVerifyUrl, setHostedVerifyUrl] = useState<string | null>(null);
  // Set when the account's key is being created on Para's own origin. A blocked
  // popup looks exactly like a slow one, so the sheet says which window to look
  // for and offers it again.
  const [walletSetupUrl, setWalletSetupUrl] = useState<string | null>(null);

  const popupRef = useRef<Window | null>(null);
  const lastUrlRef = useRef<string | null>(null);
  const settledRef = useRef(false);

  /**
   * Claim a popup window NOW, while a click is still on the stack.
   *
   * The URL that goes in it does not exist yet — Para answers with it a second
   * or two later — and by then the gesture is gone and `window.open` is a
   * blocked popup. So the window is opened blank and navigated when the URL
   * lands.
   */
  const claimPopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) return;
    popupRef.current = window.open("", "ParaAuth", "popup,width=420,height=560");
  }, []);

  const sendPopupTo = useCallback((url: string) => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.location.replace(url);
      popupRef.current.focus();
      return;
    }
    popupRef.current = window.open(url, "ParaAuth", "popup,width=420,height=560");
  }, []);

  const identifier = parseIdentifier(entry);

  // Para hands portal URLs back through the state stream rather than the hook
  // promise, so placing them is our job — and where they go differs by kind.
  //
  // The verification code goes in an IFRAME, inside this sheet: Para confirmed
  // that page can be framed, and a basic-login account has no WebAuthn step to
  // break. Passkey, password and PIN still take a window — WebAuthn silently
  // fails inside an iframe, and credential entry belongs on the origin that
  // owns the credential.
  useEffect(() => {
    const unsubscribe = para.onStatePhaseChange((snapshot: StateSnapshot) => {
      setAuthPhase(snapshot.authPhase);
      const info = snapshot.authStateInfo;
      if (info.verificationUrl) {
        setHostedVerifyUrl(info.verificationUrl);
        // The window claimed on the click was insurance against a URL that
        // needed one. This one does not, so give it straight back.
        popupRef.current?.close();
        popupRef.current = null;
      }
      const next = info.passkeyUrl ?? info.passwordUrl ?? info.pinUrl ?? null;
      if (next && next !== lastUrlRef.current) {
        lastUrlRef.current = next;
        setWalletSetupUrl(next);
        sendPopupTo(next);
      }
      // Closing is what settles the flow: the host reports the transition,
      // which is what tells Wagmi to pick the new Para session up.
      if (snapshot.corePhase === "authenticated" && !settledRef.current) {
        settledRef.current = true;
        setHostedVerifyUrl(null);
        setWalletSetupUrl(null);
        popupRef.current?.close();
        onClose();
      }
    });
    return () => {
      unsubscribe();
      lastUrlRef.current = null;
    };
  }, [para, onClose, sendPopupTo]);

  const busy = BUSY_PHASES.has(authPhase) || verifying;

  // A sheet you can only leave by hunting for the X is one people get stuck in.
  // Mid-flight is the exception: unmounting then would strand Para's poll.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  // Para reports this phase only for accounts the app may verify itself.
  // Basic-login accounts arrive as a `verificationUrl` and take the portal
  // branch instead.
  const awaitingCode = authPhase === "awaiting_account_verification";

  const submitIdentifier = useCallback(async () => {
    if (identifier.kind !== "email" && identifier.kind !== "phone") return;
    setLocalError(null);
    setPendingMethod("local");
    try {
      await authenticateWithEmailOrPhoneAsync({
        auth:
          identifier.kind === "email" ? { email: identifier.email } : { phone: identifier.phone },
        // Para bakes the theme into the URL it generates, so it has to be asked
        // for here rather than applied to the iframe afterwards — nothing of
        // ours can reach inside that frame.
        portalTheme: PARA_PORTAL_THEME,
        sessionPollingCallbacks: {
          onPoll: () => {
            if (popupRef.current?.closed) popupRef.current = null;
          },
        },
      });
    } catch (error) {
      setLocalError(messageOf(error));
    } finally {
      setPendingMethod(null);
    }
  }, [authenticateWithEmailOrPhoneAsync, identifier]);

  const submitOAuth = useCallback(
    async (method: TOAuthMethod) => {
      setLocalError(null);
      setPendingMethod(method);
      try {
        await authenticateWithOAuthAsync({
          method,
          redirectCallbacks: {
            onOAuthPopup: (popup) => {
              popupRef.current = popup;
            },
          },
          oAuthPollingCallbacks: {
            onPoll: () => {
              if (popupRef.current?.closed) popupRef.current = null;
            },
          },
        });
      } catch (error) {
        setLocalError(messageOf(error));
      } finally {
        setPendingMethod(null);
      }
    },
    [authenticateWithOAuthAsync],
  );

  const submitCode = useCallback(async () => {
    setLocalError(null);
    // Same reason as above: the key-creation URL comes back from the call
    // below, too late to open a window without a blocker eating it.
    claimPopup();
    try {
      // Verifying the code is only half of a signup: it answers with the portal
      // URL for creating the account's key, and NOTHING else advances the flow
      // until that window is opened. The URL arrives in this promise, not in
      // the state stream — waiting on that stream is what leaves this sitting
      // at "Confirming…" forever.
      const signup = await verifyNewAccountAsync({
        verificationCode: code.trim(),
        portalTheme: PARA_PORTAL_THEME,
      });
      const setupUrl = signup?.passkeyUrl ?? signup?.passwordUrl ?? signup?.pinUrl ?? null;
      if (!setupUrl) return;
      lastUrlRef.current = setupUrl;
      setWalletSetupUrl(setupUrl);
      sendPopupTo(setupUrl);
      // Key generation runs on Para's side; this settles when it lands, and the
      // state stream then reports `authenticated` and closes the sheet.
      await para.waitForWalletCreation({
        onPoll: () => {
          if (popupRef.current?.closed) popupRef.current = null;
        },
      });
    } catch (error) {
      setLocalError(messageOf(error));
    }
  }, [verifyNewAccountAsync, code, para, claimPopup, sendPopupTo]);

  const error =
    localError ?? messageOf(verifyError) ?? messageOf(authError) ?? messageOf(oauthError);

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      disabled={busy}
      aria-label="Close"
      className="-mr-1 -mt-1 shrink-0 cursor-pointer border-none bg-transparent p-1 text-[1.4rem] leading-none text-[#777] hover:text-black disabled:opacity-40"
    >
      ×
    </button>
  );

  const codeHeader = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="display text-[1.6rem]">Enter the code</h2>
        <p className="mt-1 text-[.85rem] text-[#555]">
          Sent to <span className="text-black">{entry.trim()}</span>.
        </p>
      </div>
      {closeButton}
    </div>
  );

  const resendButton = (
    <button
      type="button"
      onClick={() => {
        setResent(true);
        void resendVerificationCodeAsync({ type: "SIGNUP" }).catch(() => setResent(false));
      }}
      className={QUIET}
    >
      {resent ? "Code resent" : "Resend code"}
    </button>
  );

  // Para has this project on basic login: the code is entered on its portal and
  // `verifyNewAccount` is not a call we may make — it never settles, so a field
  // of ours here would take a code, accept a wrong one, and hang.
  if (hostedVerifyUrl) {
    return (
      <div className="w-full">
        {codeHeader}
        {/* Cropped to the boxes and nothing else. Para's page repeats the
            heading and the address above them — which this sheet has already
            said in its own words — and below them puts a label that looks like
            a link and is not one. The offsets are measured against that page,
            so they are what to revisit if its layout moves. */}
        <div className="relative mt-4 h-[72px] w-full overflow-hidden">
          <div aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="animate-pulse text-[.75rem] text-[#777]">Loading secure entry…</span>
          </div>
          <iframe
            src={hostedVerifyUrl}
            title="Verification code"
            className="absolute left-0 top-[-104px] h-72 w-full border-0"
          />
        </div>
        <div className="mt-3">{resendButton}</div>
      </div>
    );
  }

  if (awaitingCode) {
    return (
      <div className="w-full">
        {codeHeader}
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Verification code"
          className={`${FIELD} mt-5 text-center text-[1.3rem] tracking-[.4em]`}
        />
        {error ? <p className="mt-2 text-[.75rem] text-[#c00]">{error}</p> : null}
        <div className="mt-4 flex items-center justify-between">
          {resendButton}
          <button
            type="button"
            onClick={submitCode}
            disabled={verifying || code.trim().length === 0}
            className={GO}
          >
            {/* Only this call's own state, never Para's ambient phase: the
                phase sits in "waiting for session" while the field is still
                empty, which reads as the button already working. */}
            {verifying ? "Confirming…" : "Confirm"}
          </button>
        </div>
        {walletSetupUrl ? (
          <p className="mt-3 text-[.75rem] leading-relaxed text-[#555]">
            Finish setting up your account in the window we opened.{" "}
            <button type="button" onClick={() => sendPopupTo(walletSetupUrl)} className={QUIET}>
              Don&apos;t see it?
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="display text-[1.6rem]">Sign in</h2>
          <p className="mt-1 text-[.85rem] text-[#555]">You will receive a code.</p>
        </div>
        {closeButton}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitIdentifier();
        }}
        className="mt-5"
      >
        <input
          type="text"
          value={entry}
          onChange={(event) => onEntryChange(event.target.value)}
          placeholder="you@email.com | +1 222 333 4444"
          aria-label="Email address or phone number"
          autoComplete="email"
          autoFocus
          className={FIELD}
        />
        {identifier.kind === "invalid" && entry.trim().length > 3 ? (
          <p className="mt-1.5 text-[.75rem] text-[#555]">{identifier.hint}</p>
        ) : null}
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={busy || (identifier.kind !== "email" && identifier.kind !== "phone")}
            className={GO}
          >
            {pendingMethod === "local" ? "Sending…" : "Continue"}
          </button>
        </div>
      </form>

      <p className={SECTION}>Or, use socials</p>
      <div className="flex flex-wrap gap-1.5">
        {OAUTH_METHODS.map(({ method, label }) => (
          <button
            key={method}
            type="button"
            title={label}
            aria-label={label}
            aria-busy={pendingMethod === method}
            className={TILE}
            onClick={() => void submitOAuth(method)}
            disabled={busy}
          >
            <BrandMark
              method={method}
              className={`h-5 w-5 shrink-0 ${pendingMethod === method ? "animate-pulse" : ""}`}
            />
          </button>
        ))}
      </div>

      {/* Always rendered, with the row's height reserved. EIP-6963 wallets
          announce themselves over the first few hundred milliseconds, so
          revealing this once they arrive would resize a panel the visitor is
          already looking at — and it is centred, so it jumps. */}
      <p className={SECTION}>… or, a wallet.</p>
      <div className="flex min-h-11 flex-wrap gap-1.5">
        {connectors.map((connector) => (
          <button
            key={connector.id}
            type="button"
            title={connector.name}
            aria-label={connector.name}
            className={TILE}
            onClick={() => {
              connectAsync({ connector })
                .then(onClose)
                .catch((cause) => setLocalError(messageOf(cause)));
            }}
          >
            {connector.icon ? (
              // EIP-6963 hands us the wallet's own mark as a data URI.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connector.icon} alt="" className="h-5 w-5 shrink-0" />
            ) : (
              <WalletFallbackMark id={connector.id} className="h-5 w-5 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-[.75rem] text-[#c00]">{error}</p> : null}
    </div>
  );
}
