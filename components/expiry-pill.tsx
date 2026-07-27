"use client";
export function ExpiryPill({ expiresAt }: { expiresAt: number }) {
  const days = Math.ceil((expiresAt - Date.now()) / 86400000);
  const text = days <= 0 ? "Expiring today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
  const color = days <= 1 ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30" :
                days <= 7 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30" :
                "bg-muted text-muted-foreground border border-border";
  return <span className={`text-xs px-2 py-1 rounded-full font-medium ${color}`}>{text}</span>;
}
