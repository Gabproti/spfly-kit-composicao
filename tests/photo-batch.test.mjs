import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function load(name, replace) {
  let text = await readFile(
    new URL("../src/lib/" + name + ".ts", import.meta.url),
    "utf8",
  );
  if (replace) text = replace(text);
  return import(
    "data:text/javascript;base64," +
      Buffer.from(
        ts.transpileModule(text, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString("base64")
  );
}
globalThis.photoBatchRules = await load("photoRules");
const { applyExistingChoice, batchConflicts, readyPhoto, preparePhotoBatch } =
  await load("photoBatch", (s) =>
    s.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]\.\/photoRules['"];?/,
      "const {duplicateTargets}=globalThis.photoBatchRules;",
    ),
  );
const row = (code, image = null, choice = "upload") => ({
  target: { id: code, code, description: "", image_url: image },
  choice,
  source: { error: "" },
});
test("Uma escolha aplica substituição a milhares de produtos fotografados sem alterar códigos", () => {
  const rows = Array.from({ length: 2000 }, (_, i) =>
    row("00" + i, "old.png", "keep"),
  );
  const updated = applyExistingChoice(rows, "upload");
  assert.ok(updated.every((r) => r.choice === "upload"));
  assert.deepEqual(
    updated.map((r) => r.target.code),
    rows.map((r) => r.target.code),
  );
  assert.ok(rows.every((r) => r.choice === "keep"));
  assert.ok(
    applyExistingChoice(updated, "keep").every((r) => r.choice === "keep"),
  );
});
test("Escolha em lote preserva novos, concluídos, inválidos e arquivos ignorados", () => {
  const rows = [
    row("NEW"),
    { ...row("DONE", "x"), done: true },
    { ...row("BAD", "x"), source: { error: "invalid" } },
    row("SKIP", "x", "skip"),
    { choice: "upload", source: { error: "" } },
    row("OLD", "x", "keep"),
  ];
  const next = applyExistingChoice(rows, "upload");
  for (let i = 0; i < 5; i++) assert.equal(next[i], rows[i]);
  assert.equal(next[5].choice, "upload");
});
test("Arquivos problemáticos não impedem importar os válidos e não recebem destino arbitrário", () => {
  const rows = [
    row("DUP"),
    row("DUP"),
    row("OK"),
    { choice: "upload", source: { error: "" } },
  ];
  const conflicts = batchConflicts(rows);
  assert.deepEqual(
    rows.map((r) => readyPhoto(r, conflicts)),
    [false, false, true, false],
  );
  const prepared = preparePhotoBatch(rows);
  assert.deepEqual(
    prepared.map((r) => r.choice),
    ["skip", "skip", "upload", "upload"],
  );
  assert.equal(rows[0].choice, "upload");
  assert.equal(prepared[3].target, undefined);
});
test("Ignorar uma foto resolve o conflito; manter a atual nunca é tratado como envio", () => {
  const rows = [row("A"), row("A", null, "skip"), row("B", "old", "keep")];
  const conflicts = batchConflicts(rows);
  assert.equal(conflicts.size, 0);
  assert.ok(readyPhoto(rows[0], conflicts));
  assert.equal(readyPhoto(rows[2], conflicts), false);
  assert.equal(preparePhotoBatch(rows)[2].choice, "keep");
});
