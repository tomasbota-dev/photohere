"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const r = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/party/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, nickname }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast({ title: "Could not join", description: data.error });
      return;
    }
    r.push(`/p/${data.code}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <label className="text-sm font-medium">Party code</label>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AB3X9K" maxLength={6} required className="font-mono uppercase" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Your name (optional)</label>
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Sam" maxLength={40} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full">{submitting ? "Joining…" : "Join party"}</Button>
    </form>
  );
}
