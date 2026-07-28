import { JoinForm } from "@/components/join-form";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Join party</h1>
          <p className="text-sm text-muted-foreground">You're joining party <span className="font-mono">{code.toUpperCase()}</span></p>
        </header>
        <JoinForm initialCode={code} />
      </section>
    </main>
  );
}
