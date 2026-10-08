import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import JSZip from "jszip";
async function load(name) {
  let source = await readFile(
    new URL("../src/lib/" + name + ".ts", import.meta.url),
    "utf8",
  );
  source = source.replace(
    'import JSZip from "jszip";',
    "const JSZip=globalThis.photoTestJSZip;",
  );
  return import(
    "data:text/javascript;base64," +
      Buffer.from(
        ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString("base64")
  );
}
globalThis.photoTestJSZip = JSZip;
const { matchImage, productIndex, duplicateTargets, customRuleError } =
  await load("photoRules");
const { readPhotoSources, boundedZipBytes, validatePhoto, MAX_PHOTO_BYTES } =
  await load("photoFiles");
const product = (code) => ({
  id: code,
  code,
  description: "",
  image_url: null,
});
test("Exata tem prioridade em todas as regras, inclusive personalizada inválida", () => {
  const map = productIndex(
    ["AN3666-51AN", "AN3666-51A", "N3666-51AN"].map(product),
  );
  for (const rule of [
    "exact",
    "remove_suffix_N",
    "remove_last_character",
    "remove_first_character",
    "normalize",
    "custom",
  ]) {
    const r = matchImage("AN3666-51AN.jpg", rule, map);
    assert.equal(r.target.code, "AN3666-51AN");
    assert.equal(r.rule, "exact");
  }
});
test("N final é removido apenas da imagem nos quatro exemplos", () => {
  for (const code of ["AN3666-51A", "AN3700-89Z", "AN8175-55E", "AN8192-56P"]) {
    const p = product(code),
      r = matchImage(code + "N.jpg", "remove_suffix_N", productIndex([p]));
    assert.equal(r.target, p);
    assert.equal(r.code, code);
    assert.equal(r.rule, "remove_suffix_N");
    assert.equal(p.code, code);
  }
});
test("Produto cujo código termina em N exige exata ou imagem com N adicional", () => {
  const map = productIndex([product("AT8020-03LN")]);
  assert.equal(
    matchImage("AT8020-03L.jpg", "remove_suffix_N", map).status,
    "not_found",
  );
  assert.equal(
    matchImage("AT8020-03LNN.jpg", "remove_suffix_N", map).target.code,
    "AT8020-03LN",
  );
});
test("Regras não encadeiam; personalizada combina apenas o que foi escolhido", () => {
  const map = productIndex([product("00123")]);
  assert.equal(matchImage("X00123N.png", "normalize", map).status, "not_found");
  assert.equal(
    matchImage("X00123N.png", "custom", map, { prefix: 1, suffix: 1 }).target
      .code,
    "00123",
  );
  assert.equal(
    matchImage("00123x.png", "remove_last_character", map).target.code,
    "00123",
  );
  assert.equal(
    matchImage("X00123.png", "remove_first_character", map).target.code,
    "00123",
  );
  assert.equal(matchImage("x00123.png", "exact", map).status, "not_found");
  assert.ok(customRuleError({ prefix: 21, suffix: 0 }));
});
test("Normalização com candidatos distintos exige vínculo manual", () => {
  const r = matchImage(
    "XABC.jpg",
    "normalize",
    productIndex(["XAB", "ABC"].map(product)),
  );
  assert.equal(r.status, "ambiguous");
  assert.equal(r.target, undefined);
  assert.deepEqual(
    r.candidates.map((p) => p.code),
    ["XAB", "ABC"],
  );
});
test("Variantes que encontram o mesmo produto são deduplicadas e concorrência entre fotos bloqueada", () => {
  const p = product("ABC"),
    r = matchImage("ABCN.jpg", "normalize", productIndex([p]));
  assert.equal(r.status, "ready");
  assert.equal(
    duplicateTargets([
      { target: p, ignored: false },
      { target: p, ignored: false },
    ]).size,
    1,
  );
  assert.equal(
    duplicateTargets([
      { target: p, ignored: false },
      { target: p, ignored: true },
    ]).size,
    0,
  );
});
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
test("ZIP preserva pasta/nome e reporta imagens inválidas sem descartar a prévia", async () => {
  const zip = new JSZip();
  zip.file("fotos/00123.png", png);
  zip.file("fotos/falso.jpg", "not an image");
  zip.file("leia.txt", "readme");
  zip.file("__MACOSX/meta", "ignore");
  const file = new File(
    [await zip.generateAsync({ type: "uint8array" })],
    "CITIZEN.zip",
  );
  const rows = await readPhotoSources([file], () => {});
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "fotos/00123.png");
  assert.equal(rows[0].error, "");
  assert.equal((await rows[0].read()).type, "image/png");
  assert.match(rows[1].error, /conteúdo/);
  assert.match(rows[2].error, /Formato/);
});
test("Extração limita bytes reais de um ZIP muito comprimido", async () => {
  const zip = new JSZip();
  zip.file("bomb.png", new Uint8Array(MAX_PHOTO_BYTES + 1));
  const loaded = await JSZip.loadAsync(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
  await assert.rejects(
    boundedZipBytes(loaded.file("bomb.png")),
    /maior que 5 MB/,
  );
});
test("Arquivos vazios, ZIP inválido e lote acima de 5000 são recusados", async () => {
  await assert.rejects(
    validatePhoto(new File([], "vazio.png", { type: "image/png" })),
    /vazia/,
  );
  await assert.rejects(
    readPhotoSources([new File(["x"], "broken.zip")], () => {}),
    /ZIP inválido/,
  );
  await assert.rejects(
    readPhotoSources(Array(5001).fill(new File([png], "x.png")), () => {}),
    /5.000/,
  );
});
