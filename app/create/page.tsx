import { CreateForm } from "@/components/create-form";

export default function CreatePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Create a party</h1>
          <p className="text-sm text-muted-foreground">Share the code. Everyone uploads. Everyone downloads.</p>
        </header>
        <CreateForm />
      </section>
    </main>
  );
}
