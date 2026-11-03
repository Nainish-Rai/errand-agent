"use client";

import { ShieldCheck } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The console's door. The token is checked by the backend on every request; this form only keeps it
// for the tab. `refused` says the last token didn't open the console, without saying why.

export function OperatorSignIn({ refused, onSignIn }: { readonly refused: boolean; readonly onSignIn: (token: string) => void }) {
  const [token, setToken] = useState("");
  const inputId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() !== "") onSignIn(token.trim());
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-canvas p-4">
      <form aria-label="Operator sign-in" className="grid w-full max-w-sm gap-3 rounded-lg border border-edge bg-surface-card p-4" onSubmit={submit}>
        <h1 className="m-0 flex items-center gap-2 text-panel font-medium text-fg-emph">
          <ShieldCheck aria-hidden className="size-4 text-fg-meta" />
          Operator console
        </h1>
        <p className="m-0 text-body text-fg-meta">Run traces, context logs and costs are for operators. Sign in with your operator token.</p>
        <label className="grid gap-1 text-label text-fg-body" htmlFor={inputId}>
          Operator token
          <Input autoComplete="off" id={inputId} spellCheck={false} type="password" value={token} onChange={(event) => setToken(event.target.value)} />
        </label>
        {refused && (
          <p className="m-0 rounded-md bg-err-tint px-3 py-2 text-body text-fg-body" role="alert">
            That token doesn&apos;t open the console.
          </p>
        )}
        <Button disabled={token.trim() === ""} type="submit">
          Sign in
        </Button>
      </form>
    </main>
  );
}
