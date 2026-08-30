// package.mjs — 生成 GitHub Release 发布包
// 产物：dist/chennian-diary-v<VERSION>-win64.zip
// 内容：尘年往事/（自包含 exe + app 前端[不含字体] + 使用说明.md）
// 用法：node tools/package.mjs [--version 1.1.0]
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildZip, readZip } from "../app/js/zip.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = process.argv.includes("--version")
  ? process.argv[process.argv.indexOf("--version") + 1] : "1.1.0";
const DIST = join(ROOT, "dist");
const PKG = join(DIST, "package");
const FOLDER = "尘年往事";

/* 1. 清场 */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(PKG, FOLDER), { recursive: true });

/* 2. 前端（跳过字体：授权原因不入发布包，应用会回退系统楷体） */
function copyApp(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name.endsWith(".ttf")) continue;
    const s = join(src, name), d = join(dest, name);
    if (statSync(s).isDirectory()) copyApp(s, d);
    else copyFileSync(s, d);
  }
}
copyApp(join(ROOT, "app"), join(PKG, FOLDER, "app"));
copyFileSync(join(ROOT, "release", "使用说明.md"), join(PKG, FOLDER, "使用说明.md"));

/* 3. 自包含单文件 exe（下载者无需安装 .NET 运行时） */
const pub = spawnSync("dotnet", [
  "publish", join(ROOT, "launcher", "Launcher.csproj"),
  "-c", "Release",
  "-p:SelfContained=true", "-p:PublishSingleFile=true",
  "-p:EnableCompressionInSingleFile=true",
  "-o", join(PKG, FOLDER)
], { stdio: "inherit" });
if (pub.status !== 0) { console.error("dotnet publish 失败"); process.exit(1); }

const staged = readdirSync(join(PKG, FOLDER));
const stray = staged.filter((n) => n !== "尘年往事.exe" && n !== "app" && n !== "使用说明.md");
if (stray.length) console.warn("注意：发布输出含额外文件，将一并打包：", stray.join(", "));
if (!staged.includes("尘年往事.exe")) { console.error("未生成 尘年往事.exe"); process.exit(1); }

/* 4. 打包为 ZIP（buildZip，UTF-8 文件名） */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(PKG).map((p) => ({
  // relative(PKG, p) 已以「尘年往事/」开头，即 ZIP 内的顶层文件夹
  name: relative(PKG, p).split("\\").join("/"),
  data: new Uint8Array(readFileSync(p))
}));
const zip = await buildZip(files);
const asset = `chennian-diary-v${VERSION}-win64.zip`;
writeFileSync(join(DIST, asset), Buffer.from(await zip.arrayBuffer()));

/* 5. 自校验：解包比对 */
const back = await readZip(zip);
const names = back.map((f) => f.name);
const ok =
  names.includes(`${FOLDER}/尘年往事.exe`) &&
  names.includes(`${FOLDER}/使用说明.md`) &&
  names.includes(`${FOLDER}/app/index.html`) &&
  !names.some((n) => n.endsWith(".ttf"));
const exeEntry = back.find((f) => f.name === `${FOLDER}/尘年往事.exe`);
const exeOk = exeEntry && exeEntry.data.length === statSync(join(PKG, FOLDER, "尘年往事.exe")).size;

console.log(`条目数：${names.length}`);
console.log(`结构正确（exe/说明/app 齐全且无字体）：${ok}`);
console.log(`exe 字节一致：${!!exeOk}`);
console.log(`产物：dist/${asset}（${(statSync(join(DIST, asset)).size / 1024 / 1024).toFixed(1)} MB）`);
if (!ok || !exeOk) process.exit(1);
