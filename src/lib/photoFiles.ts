import JSZip from "jszip";
export const MAX_PHOTOS = 5000,
  MAX_PHOTO_BYTES = 5 * 1024 * 1024,
  MAX_BATCH_BYTES = 200 * 1024 * 1024,
  MAX_ZIP_BYTES = 100 * 1024 * 1024;
export type PhotoSource = {
  name: string;
  read: () => Promise<File>;
  error: string;
};
export function imageMime(name: string) {
  return /\.jpe?g$/i.test(name)
    ? "image/jpeg"
    : /\.png$/i.test(name)
      ? "image/png"
      : /\.webp$/i.test(name)
        ? "image/webp"
        : "";
}
export function hasImageSignature(bytes: Uint8Array, mime: string) {
  return mime === "image/jpeg"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
      : mime === "image/webp"
        ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
        : false;
}
export async function validatePhoto(file: File) {
  if (!file.size || file.size > MAX_PHOTO_BYTES)
    throw new Error("Imagem vazia ou maior que 5 MB.");
  if (
    !hasImageSignature(
      new Uint8Array(await file.slice(0, 12).arrayBuffer()),
      file.type,
    )
  )
    throw new Error("O conteúdo não é uma imagem JPG, PNG ou WebP válida.");
}
// The public StreamHelper API bounds actual decompressed bytes, not just ZIP metadata.
export function boundedZipBytes(
  entry: JSZip.JSZipObject,
  limit = MAX_PHOTO_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let size = 0,
      ended = false;
    stream.on("data", (chunk) => {
      if (ended) return;
      size += chunk.byteLength;
      if (size > limit) {
        ended = true;
        chunks.length = 0;
        stream.pause();
        reject(new Error("Imagem maior que 5 MB após extrair do ZIP."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", (error) => {
      if (!ended) {
        ended = true;
        chunks.length = 0;
        reject(error);
      }
    });
    stream.on("end", () => {
      if (ended) return;
      ended = true;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
    stream.resume();
  });
}
export async function readPhotoSources(
  files: File[],
  progress: (text: string) => void,
): Promise<PhotoSource[]> {
  let sources: PhotoSource[];
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    if (files[0].size > MAX_ZIP_BYTES)
      throw new Error("O ZIP deve ter até 100 MB.");
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await files[0].arrayBuffer());
    } catch {
      throw new Error("ZIP inválido, protegido por senha ou não suportado.");
    }
    const entries = Object.values(zip.files).filter(
      (e) =>
        !e.dir &&
        !e.name.startsWith("__MACOSX/") &&
        !e.name.split("/").at(-1)!.startsWith("."),
    );
    if (entries.length > MAX_PHOTOS)
      throw new Error("Limite de 5.000 arquivos por ZIP.");
    sources = entries.map((entry) => ({
      name: entry.name,
      error: !imageMime(entry.name)
        ? "Formato não suportado."
        : entry.name.length > 300
          ? "Nome de arquivo maior que 300 caracteres."
          : "",
      read: async () =>
        new File(
          [await boundedZipBytes(entry)],
          entry.name.split("/").at(-1)!,
          { type: imageMime(entry.name) },
        ),
    }));
  } else {
    if (files.length > MAX_PHOTOS)
      throw new Error("Limite de 5.000 imagens por lote.");
    sources = files.map((file) => ({
      name: file.name,
      error: !imageMime(file.name)
        ? "Formato não suportado."
        : file.name.length > 300
          ? "Nome de arquivo maior que 300 caracteres."
          : "",
      read: async () =>
        new File([file], file.name, { type: imageMime(file.name) }),
    }));
  }
  if (!sources.length) throw new Error("O arquivo não contém imagens.");
  let total = 0;
  for (const [i, source] of sources.entries()) {
    progress(`Validando imagem ${i + 1} de ${sources.length}…`);
    if (source.error) continue;
    try {
      const file = await source.read();
      total += file.size;
      if (total > MAX_BATCH_BYTES)
        throw new Error(
          "O lote excede 200 MB de imagens extraídas. Divida em ZIPs menores.",
        );
      await validatePhoto(file);
    } catch (e) {
      if (total > MAX_BATCH_BYTES) throw e;
      source.error = e instanceof Error ? e.message : "Imagem inválida.";
    }
  }
  return sources;
}
