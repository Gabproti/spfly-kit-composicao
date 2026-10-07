import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Camera, X } from "lucide-react";
import { db, fail } from "../lib/supabase";
export function Status({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? "green" : "red"}`}>
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function ProductImage({
  path,
  large = false,
  alt = "Foto de referência do produto",
}: {
  path: string | null;
  large?: boolean;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path)
      db()
        .storage.from("product-images")
        .createSignedUrl(path, 3600)
        .then(({ data }) => {
          if (live) setUrl(data?.signedUrl ?? null);
        });
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <div className={large ? "product-photo large" : "product-photo"}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" onError={() => setUrl(null)} />
      ) : (
        <div className="photo-empty">
          <Camera size={large ? 44 : 22} />
          {large && <span>Foto não disponível</span>}
        </div>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const root = document.getElementById("edit-dialog")!;
    const fields = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        ),
      );
    fields()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const f = fields();
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, [close]);
  return (
    <div className="modal-backdrop">
      <section
        id="edit-dialog"
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar"
            onClick={close}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export async function uploadPhoto(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Selecione JPG, PNG ou WebP de até 5 MB.");
  const extension = file.type.split("/")[1];
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await db()
    .storage.from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  fail(error);
  return path;
}
export function message(
  error: unknown,
  fallback = "Não foi possível concluir. Tente novamente.",
) {
  return error instanceof Error &&
    /Selecione|quantidade|componente|código|administrador|último|próprio/i.test(
      error.message,
    )
    ? error.message
    : fallback;
}
