"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

export function CreateForm() {
  const r = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/party", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, nickname }),
    });
    const data: any = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast({ title: "Could not create party", description: data.error });
      return;
    }
    r.push(`/p/${data.code}`);
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="title">Party title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sam & Alex's Wedding" maxLength={80} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nickname">Your name (optional)</Label>
        <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Sam" maxLength={40} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full" size="lg">
        {submitting ? "Creating…" : "Create party"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Parties and all photos are automatically deleted 90 days after creation.
      </p>
    </form>
  );
}
