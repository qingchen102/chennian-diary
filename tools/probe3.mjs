// probe3.mjs — 检查页面加载状态与异常（尽早监听）
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9346;
const PROFILE = "D:/dairy/.edge-probe3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
const edge = spawn(EDGE, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-extensions",
  "--window-size=1400,1000", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
  "http://127.0.0.1:38777/"
], { stdio: "ignore" });
let target = null;
for (let i = 0; i < 60 && !target; i++) {
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find((t) => t.type === "page" && !t.url.startsWith("about:")); } catch { }
  if (!target) await sleep(250);
}
if (!target) { console.log("no target"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
let id = 0; const pending = new Map(); const errs = []; const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(String(m.params.args?.[0]?.value || "").slice(0, 300));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") logs.push(String(m.params.entry.text).slice(0, 300));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "EXC:" + String(r.result.exceptionDetails.text); return r.result?.result?.value; };
await send("Runtime.enable");
await send("Log.enable");
await sleep(4000);
console.log("href:", await ev(`location.href`));
console.log("books:", await ev(`document.querySelectorAll('.books .book').length`));
console.log("bodyStart:", await ev(`document.body ? document.body.textContent.slice(0,150) : 'NO BODY'`));
console.log("failedResources:", await ev(`JSON.stringify(performance.getEntriesByType('resource').filter(r => r.name.includes('127.0.0.1')).map(r => ({n: r.name.split('/').pop(), d: Math.round(r.duration), s: r.transferSize})))`));
console.log("errs:", JSON.stringify(errs));
console.log("consoleErrors:", JSON.stringify(logs));
ws.close(); try { edge.kill(); } catch { }
process.exit(0);
