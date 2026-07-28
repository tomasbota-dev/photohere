"use client";
import { useState } from "react";
import { ExpiryPill } from "./expiry-pill";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export function PartyHeader({ code, title, expiresAt, role }: { code: string; title: string; expiresAt: number; role: "host" | "member" }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  return (
    <header className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <ExpiryPill expiresAt={expiresAt} />
        {role === "host" && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">Host</span>}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <code className="font-mono text-lg tracking-wider bg-muted px-3 py-1.5 rounded-lg">{code}</code>
        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(`${location.origin}/j/${code}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy join link"}
        </Button>
      </div>
    </header>
  );
}
