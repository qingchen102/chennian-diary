/* ==========================================================================
   main.js — 尘年往事 入口
   ========================================================================== */
import * as store from "./store.js";
import { register, start } from "./nav.js";
import { renderBookshelf } from "./views/bookshelf.js";
import { openBook } from "./views/book.js";
import { openEditor } from "./views/editor.js";
import { setSoundEnabled } from "./sound.js";
import { revokeImageUrls } from "./ui.js";

const app = document.getElementById("app");
let cleanup = null;

function navigate(name, params) {
  if (cleanup) { try { cleanup(); } catch { /* 忽略 */ } cleanup = null; }
  revokeImageUrls();
  if (name === "bookshelf") renderBookshelf(app);
  else if (name === "book") cleanup = openBook(app, params);
  else if (name === "editor") cleanup = openEditor(app, params);
}

register("bookshelf", (p) => navigate("bookshelf", p));
register("book", (p) => navigate("book", p));
register("editor", (p) => navigate("editor", p));

async function boot() {
  const s = await store.ready();
  setSoundEnabled(s.settings.sound);
  store.applySettings(s.settings); // 让字体/颜色/深夜等设置变量生效
  try { navigator.storage?.persist?.(); } catch { } // 申请持久存储，降低浏览器清库导致丢日记的风险
  start(); // 按 hash 恢复视图（无 hash 时回书架）
}

boot().catch((e) => {
  console.error(e);
  app.innerHTML = `<div style="padding:40px;font-size:15px;color:#8a3b2e;">启动失败：${String(e && e.message || e)}</div>`;
});
