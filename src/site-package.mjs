import { lstat, opendir, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

export const MAX_FILES = 600;
export const MAX_BYTES = 100 * 1024 * 1024;
const EXCLUDED = /^(?:\.git|\.svn|\.hg|\.ssh|\.aws|\.azure|node_modules|\.next|\.cache|\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\..*)?)$/i;
const PRIVATE_FILE = /(?:\.(?:pem|key|p12|pfx|keystore)|^id_(?:rsa|dsa|ecdsa|ed25519)|^credentials(?:\.json)?|^service[-_]?account.*\.json)$/i;
const SECRET = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\b(?:spc_|spo_[arc]_)[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])|\bgh[pousr]_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{80,255}\b|\bsk_(?:live|test)_[A-Za-z0-9]{24,255}\b|\bsk-proj-[A-Za-z0-9_-]{80,255}\b|\bxox[baprs]-[A-Za-z0-9-]{24,255}\b/;

function assertPublicBytes(bytes) {
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    if (SECRET.test(bytes.subarray(offset, offset + 65536 + 512).toString("latin1"))) throw new Error("Remova e revogue a credencial privada antes de enviar este site.");
  }
}

/** Root is selected when the client is configured, never by an AI tool argument. */
export async function prepareSitePackage(directory, { includeArchive = true } = {}) {
  if (typeof directory !== "string" || !directory.trim() || !path.isAbsolute(directory)) throw new Error("Configure uma pasta absoluta para o site estático pronto.");
  const requestedRoot = path.resolve(directory);
  const rootInfo = await lstat(requestedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Escolha uma pasta real, sem atalhos ou links simbólicos.");
  const root = await realpath(requestedRoot);
  const entryFile = await lstat(path.join(root, "index.html")).catch(() => null);
  if (!entryFile?.isFile() || entryFile.isSymbolicLink()) throw new Error("Selecione a saída pronta com index.html na raiz, como dist ou out. O conector não executa builds.");
  const files = Object.create(null);
  let totalBytes = 0;
  let fileCount = 0;
  let excludedCount = 0;
  let hasIndex = false;
  let scannedEntries = 0;
  const hash = createHash("sha256");

  async function walk(relative = "") {
    const entries = [];
    for await (const entry of await opendir(path.join(root, relative))) {
      if (++scannedEntries > 2400) throw new Error("A pasta contém arquivos ou diretórios demais. Selecione somente a saída pronta do site.");
      entries.push(entry);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if ((entry.name.startsWith(".") && entry.name !== ".well-known") || EXCLUDED.test(entry.name) || PRIVATE_FILE.test(entry.name)) { excludedCount++; continue; }
      if (entry.isSymbolicLink()) throw new Error("O pacote contém um link simbólico. Envie somente arquivos reais.");
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (relativePath.length > 500 || /[\\\0\r\n]/.test(relativePath) || relativePath.split("/").some((part) => part === ".." || part === ".")) throw new Error("O pacote contém um caminho não permitido.");
      const absolutePath = path.resolve(root, relativePath);
      const check = path.relative(root, absolutePath);
      if (check.startsWith("..") || path.isAbsolute(check)) throw new Error("O arquivo está fora da pasta autorizada.");
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error("O pacote contém um link simbólico.");
      if (info.isDirectory()) { await walk(relativePath); continue; }
      if (!info.isFile()) throw new Error("O pacote contém um arquivo especial não permitido.");
      if (++fileCount > MAX_FILES || info.size > MAX_BYTES - totalBytes) throw new Error("O site excede 600 arquivos ou 100 MB. Reduza a pasta antes de enviar.");
      const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new Error("Um arquivo mudou durante a preparação. Tente novamente.");
        bytes = Buffer.alloc(opened.size);
        let read = 0;
        while (read < bytes.length) {
          const next = await handle.read(bytes, read, Math.min(65536, bytes.length - read), read);
          if (!next.bytesRead) throw new Error("Um arquivo mudou durante a preparação. Tente novamente.");
          read += next.bytesRead;
        }
        const extra = Buffer.alloc(1);
        if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead) throw new Error("Um arquivo cresceu durante a preparação. Tente novamente.");
        const final = await handle.stat();
        if (final.size !== opened.size || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs) throw new Error("Um arquivo mudou durante a preparação. Tente novamente.");
      } finally { await handle.close(); }
      assertPublicBytes(bytes);
      totalBytes += bytes.length;
      hasIndex ||= relativePath === "index.html";
      hash.update(relativePath).update("\0").update(String(bytes.length)).update("\0").update(bytes);
      if (includeArchive) files[relativePath] = bytes;
    }
  }
  await walk();
  if (!hasIndex) throw new Error("Selecione a saída pronta com index.html na raiz, como dist ou out. O conector não executa builds.");
  const summary = { fileCount, totalBytes, excludedCount, contentSha256: hash.digest("hex") };
  if (!includeArchive) return summary;
  // Fixed entry dates make network retries reproducible without persisting a ZIP.
  const archive = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { mtime: new Date("2020-01-01T00:00:00Z"), level: 6 }]]))));
  if (archive.length > MAX_BYTES) throw new Error("O ZIP excede 100 MB. Reduza a pasta antes de enviar.");
  return { ...summary, archive };
}
