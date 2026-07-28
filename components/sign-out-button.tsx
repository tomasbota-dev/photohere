"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const r = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    r.push("/");
    r.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
