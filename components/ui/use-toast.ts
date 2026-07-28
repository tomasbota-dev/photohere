import { toast as toastManager } from "@/components/ui/toast";

export function useToast() {
  function toast({ title, description, variant }: { title?: string; description?: string; variant?: "default" | "destructive" }) {
    toastManager.add({
      title,
      description,
      type: variant === "destructive" ? "error" : "info",
    });
  }
  return { toast };
}
