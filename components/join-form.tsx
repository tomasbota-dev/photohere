"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    const data: any = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast({ title: "Could not join", description: data.error });
      return;
    }
    r.push(`/p/${data.code}`);
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="code">Party code</Label>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="AB3X9K"
          maxLength={6}
          required
          className="h-12 text-center text-2xl font-mono uppercase tracking-[0.4em]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nickname">Your name (optional)</Label>
        <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Sam" maxLength={40} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full" size="lg">{submitting ? "Joining…" : "Join party"}</Button>
    </form>
  );
}
