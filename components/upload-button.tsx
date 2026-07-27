"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const MAX_BYTES = 15 * 1024 * 1024;

export function UploadButton({ partyCode }: { partyCode: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast({ title: `${file.name} too large`, description: "Max 15 MB." });
        fail++;
        continue;
      }
      try {
        const r1 = await fetch("/api/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partyCode, contentType: file.type, contentLength: file.size }),
        });
        if (!r1.ok) throw new Error("upload-url failed");
        const { uploadUrl, key }: { uploadUrl: string; key: string } = await r1.json();
        const r2 = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!r2.ok) throw new Error("R2 PUT failed");
        const dims = await readDims(file).catch(() => ({ width: null, height: null }));
        const r3 = await fetch("/api/photos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partyCode, key, bytes: file.size, contentType: file.type, width: dims.width, height: dims.height }),
        });
        if (!r3.ok) throw new Error("photos insert failed");
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(false);
    if (ok > 0) toast({ title: `Uploaded ${ok} photo${ok > 1 ? "s" : ""}` });
    if (fail > 0) toast({ title: `Failed: ${fail}`, variant: "destructive" });
    window.dispatchEvent(new Event("photohere:reload"));
  }

  return (
    <>
      <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? "Uploading…" : "Upload photos"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}

function readDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
