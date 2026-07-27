"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast({ title: "Could not create party", description: data.error });
      return;
    }
    r.push(`/p/${data.code}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <label className="text-sm font-medium">Party title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sam & Alex's Wedding" maxLength={80} required />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Your name (optional)</label>
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Sam" maxLength={40} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating…" : "Create party"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Parties and all photos are automatically deleted 90 days after creation.
      </p>
    </form>
  );
}
