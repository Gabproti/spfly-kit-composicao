import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/lib/passwordRecovery.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  passwordResetUrl,
  passwordError,
  hasRecoveryLink,
  hasRecoveryError,
  rememberRecovery,
  isRecoverySession,
} = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
test("Link de retorno preserva o caminho do GitHub Pages e suporta desenvolvimento", () => {
  assert.equal(
    passwordResetUrl("https://gabproti.github.io", "/spfly-kit-composicao/"),
    "https://gabproti.github.io/spfly-kit-composicao/",
  );
  assert.equal(
    passwordResetUrl("http://127.0.0.1:5173", "/"),
    "http://127.0.0.1:5173/",
  );
});
test("Nova senha respeita limites e confirmação sem remover espaços", () => {
  assert.ok(passwordError("12345678901", "12345678901"));
  assert.ok(passwordError("x".repeat(129), "x".repeat(129)));
  assert.equal(passwordError("123456789012", "123456789012"), "");
  assert.equal(passwordError("x".repeat(128), "x".repeat(128)), "");
  assert.match(passwordError(" 123456789012", "123456789012"), /conferem/);
});
test("Identifica recuperação e link expirado; nenhum token é persistido", () => {
  assert.equal(
    hasRecoveryLink("#type=recovery&access_token=TEST"),
    "true" === "true",
  );
  assert.equal(hasRecoveryLink("#type=signup"), false);
  assert.equal(
    hasRecoveryLink("#error=access_denied&error_code=otp_expired"),
    true,
  );
  assert.equal(hasRecoveryError("#error_code=otp_expired"), true);
  assert.equal(hasRecoveryError("#type=recovery"), false);
  const values = new Map();
  globalThis.sessionStorage = {
    setItem: (k, v) => values.set(k, v),
    getItem: (k) => values.get(k) ?? null,
    removeItem: (k) => values.delete(k),
  };
  try {
    rememberRecovery("user-a");
    assert.equal(isRecoverySession("user-a"), true);
    assert.equal(isRecoverySession("user-b"), false);
    assert.deepEqual([...values.values()], ["user-a"]);
    rememberRecovery(null);
    assert.equal(isRecoverySession("user-a"), false);
  } finally {
    delete globalThis.sessionStorage;
  }
  assert.doesNotThrow(() => rememberRecovery("user-a"));
  assert.equal(isRecoverySession("user-a"), false);
});
