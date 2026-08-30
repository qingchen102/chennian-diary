/* ==========================================================================
   store.js — 尘年往事 数据层
   IndexedDB 存储：books / entries / images / settings
   ========================================================================== */
import { refreshLineBaseline } from "./pageflow.js";

const DB_NAME = "chennian-diary";
const DB_VER = 1;

export const FONTS = [
  { name: "楷体", css: '"楷体", "KaiTi", serif' },
  { name: "宋体", css: '"宋体", "SimSun", serif' },
  { name: "黑体", css: '"黑体", "SimHei", sans-serif' },
  { name: "仿宋", css: '"仿宋", "FangSong", serif' },
  { name: "华文行楷", css: '"华文行楷", "STXingkai", "楷体", serif' },
  { name: "方正舒体", css: '"方正舒体", "FZShuTi", "楷体", serif' },
  { name: "方正姚体", css: '"方正姚体", "FZYaoTi", serif' },
  { name: "华文新魏", css: '"华文新魏", "STXinwei", serif' },
  { name: "隶书", css: '"隶书", "LiSu", serif' },
  { name: "幼圆", css: '"幼圆", "YouYuan", sans-serif' },
  { name: "华文中宋", css: '"华文中宋", "STZhongsong", serif' },
  { name: "微软雅黑", css: '"Microsoft YaHei", sans-serif' },
  { name: "手写体", css: '"手写体", "楷体", serif' }
];

export const COLORS = [
  { name: "墨黑", value: "#3a332a" },
  { name: "深灰", value: "#555555" },
  { name: "靛蓝", value: "#1e3a5f" },
  { name: "黛绿", value: "#2e5e3a" },
  { name: "赭红", value: "#8a3b2e" },
  { name: "绛紫", value: "#5b3a8a" }
];

export const WEATHERS = ["晴", "多云", "阴", "小雨", "中雨", "大雨", "雷阵雨", "雪", "雾", "风", "热", "凉"];

export const MOODS = ["😊", "😄", "😌", "🤔", "😴", "🥰", "😢", "😤", "😎", "🌧️"];

export const DEFAULT_SETTINGS = {
  font: "楷体",
  fontSize: 16,
  color: "#3a332a",
  sound: true,
  night: false,
  bookNames: { diary: "日记本", essay: "随笔本" }
};

/* ---------- 内部状态 ---------- */
const state = {
  books: [],            // [{id, kind, name, entryIds: []}]
  entries: new Map(),   // id → entry
  settings: { ...DEFAULT_SETTINGS },
  loaded: false
};

const listeners = new Set();
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } }

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "id" });
      if (!d.objectStoreNames.contains("entries")) d.createObjectStore("entries", { keyPath: "id" });
      if (!d.objectStoreNames.contains("images")) d.createObjectStore("images", { keyPath: "id" });
      if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}
function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadAll() {
  db = await openDB();
  const [books, entries, settings] = await Promise.all([
    reqP(tx("books").getAll()),
    reqP(tx("entries").getAll()),
    reqP(tx("settings").get("app"))
  ]);
  state.books = books.length
    ? books
    : [
        { id: "diary", kind: "diary", name: "日记本", entryIds: [] },
        { id: "essay", kind: "essay", name: "随笔本", entryIds: [] }
      ];
  state.entries = new Map(entries.map((e) => [e.id, e]));
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // bookNames 需要深合并：老数据里可能只有 diary 没有essay，缺的用默认值补齐
  state.settings.bookNames = { ...DEFAULT_SETTINGS.bookNames, ...(settings?.bookNames || {}) };
  if (!books.length) {
    // 首次启动：写入默认双本
    const t = db.transaction("books", "readwrite");
    for (const b of state.books) t.objectStore("books").put(b);
    await new Promise((r) => { t.oncomplete = r; t.onerror = r; });
  }
  state.loaded = true;
}

/** 返回已就绪的顶层状态（引用） */
export async function ready() {
  if (!state.loaded) await loadAll();
  return state;
}

export function getState() { return state; }
export function getBook(id) { return state.books.find((b) => b.id === id); }
export function entriesOf(bookId) { return state.books.find((b) => b.id === bookId)?.entryIds.map((id) => state.entries.get(id)).filter(Boolean) || []; }

/* ---------- 工具 ---------- */
export function uid(prefix = "e") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
export function pad2(n) { return String(n).padStart(2, "0"); }
/** "YYYY-MM-DD" → "公元 YYYY 年 MM 月 DD 日" */
export function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `公元 ${y} 年 ${m} 月 ${d} 日`;
}
export function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
}
/** "YYYY-MM-DD HH:MM" */
export function nowStamp() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
}
export function weekdayCn(dateStr) {
  const n = new Date(dateStr + "T00:00:00");
  return ["日", "一", "二", "三", "四", "五", "六"][n.getDay()];
}

/* ---------- 写操作 ---------- */
export async function saveEntry(entry) {
  entry.updatedAt = Date.now();
  const pendingIds = entry._pendingImageIds || [];
  delete entry._pendingImageIds; // 临时字段不落库
  const t = db.transaction("entries", "readwrite");
  t.objectStore("entries").put(entry);
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
  state.entries.set(entry.id, entry);
  // 若新条目，追加到书末
  const book = getBook(entry.bookId);
  if (book && !book.entryIds.includes(entry.id)) {
    book.entryIds.push(entry.id);
    const t2 = db.transaction("books", "readwrite");
    t2.objectStore("books").put(book);
    await new Promise((r, j) => { t2.oncomplete = r; t2.onerror = () => j(t2.error); });
  }
  // 收编保存前插入的图片（编辑器显式传入当时记下的 id，避免把已取消草稿
  // 遗留的 pending 图误挂到这一篇上）
  if (pendingIds.length) await attachImagesToEntry(pendingIds, entry.id);
  emit();
}

/** 把一组图片记录挂到某篇日记名下（编辑器保存时调用） */
export async function attachImagesToEntry(ids, entryId) {
  const t = db.transaction("images", "readwrite");
  const s = t.objectStore("images");
  for (const id of ids) {
    const rec = await reqP(s.get(id)); // 同一事务内读写，避免事务提前提交
    if (rec) { rec.entryId = entryId; s.put(rec); }
  }
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
}

/** 按 id 删除图片记录（取消编辑时清理 pending 图、保存时清理被移除的附件） */
export async function deleteImages(ids) {
  if (!ids || !ids.length) return;
  const t = db.transaction("images", "readwrite");
  for (const id of ids) t.objectStore("images").delete(id);
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
}

export async function deleteEntry(id) {
  const entry = state.entries.get(id);
  if (entry) {
    const t = db.transaction("entries", "readwrite");
    t.objectStore("entries").delete(id);
    await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
    state.entries.delete(id);
    const book = getBook(entry.bookId);
    if (book) {
      book.entryIds = book.entryIds.filter((x) => x !== id);
      const t2 = db.transaction("books", "readwrite");
      t2.objectStore("books").put(book);
      await new Promise((r, j) => { t2.oncomplete = r; t2.onerror = () => j(t2.error); });
    }
    await deleteImagesByEntry(id);
    emit();
  }
}

export async function renameBook(id, name) {
  const book = getBook(id);
  if (!book) return;
  book.name = name;
  state.settings.bookNames[id] = name;
  await saveSettings({ bookNames: state.settings.bookNames });
  const t = db.transaction("books", "readwrite");
  t.objectStore("books").put(book);
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
  emit();
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  const t = db.transaction("settings", "readwrite");
  t.objectStore("settings").put(state.settings, "app");
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
  applySettings(state.settings);
  emit();
}

/* ---------- 图片 ---------- */
export async function putImage(img) {
  const t = db.transaction("images", "readwrite");
  t.objectStore("images").put(img);
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
}
export async function getImageBlob(id) {
  const rec = await reqP(tx("images").get(id));
  return rec ? rec.blob : null;
}
async function deleteImagesByEntry(entryId) {
  const all = await reqP(tx("images").getAll());
  const ids = all.filter((i) => i.entryId === entryId).map((i) => i.id);
  if (!ids.length) return;
  const t = db.transaction("images", "readwrite");
  for (const id of ids) t.objectStore("images").delete(id);
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
}

/* 自定义印章图片（entryId 固定为 "stamp"，全局复用，不随某篇删除） */
export async function stampImages() {
  const all = await reqP(tx("images").getAll());
  return all.filter((i) => i.entryId === "stamp").sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}
export async function deleteStampImage(id) {
  const t = db.transaction("images", "readwrite");
  t.objectStore("images").delete(id);
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
}

/* ---------- 全局设置生效 ---------- */
export function applySettings(s) {
  document.documentElement.dataset.night = s.night ? "true" : "false";
  const root = document.documentElement.style;
  root.setProperty("--writing-font", fontCss(s.font));
  root.setProperty("--writing-size", `${s.fontSize}px`);
  root.setProperty("--writing-color", s.color);
  // 横线基线随字体/字号重算
  try { refreshLineBaseline(); } catch { }
}
export function fontCss(name) {
  return FONTS.find((f) => f.name === name)?.css || '"楷体", "KaiTi", serif';
}
export function currentFontCss() { return fontCss(state.settings.font); }

/** 事件计时：取同书同名事件的最大 Day + 1 */
export function nextEventDay(bookId, eventName) {
  const es = entriesOf(bookId).filter((e) => e.dateMode === "event" && e.eventName === eventName);
  return es.reduce((m, e) => Math.max(m, e.eventDay || 0), 0) + 1;
}

/* ---------- 导出全量数据（供 ZIP 备份） ---------- */
export async function exportAllData() {
  const books = state.books.map((b) => ({ ...b }));
  const entries = [...state.entries.values()].map((e) => JSON.parse(JSON.stringify(e)));
  const images = await reqP(tx("images").getAll());
  return { books, entries, images, settings: state.settings };
}

/* ---------- 导入恢复（整体替换，调用前须让用户确认并先做快照） ---------- */
/** payload: { books, entries, images: [{id,blob,mime,entryId,addedAt}], settings } */
export async function importAllData(payload) {
  if (!db) throw new Error("数据库未就绪");
  if (!Array.isArray(payload.books) || !Array.isArray(payload.entries)) {
    throw new Error("备份数据不完整");
  }
  const t = db.transaction(["books", "entries", "images", "settings"], "readwrite");
  t.objectStore("books").clear();
  t.objectStore("entries").clear();
  t.objectStore("images").clear();
  t.objectStore("settings").clear();
  for (const b of payload.books) t.objectStore("books").put(b);
  for (const e of payload.entries) t.objectStore("entries").put(e);
  for (const im of payload.images || []) {
    if (im && im.id && im.blob) t.objectStore("images").put(im);
  }
  t.objectStore("settings").put(payload.settings || {}, "app");
  await new Promise((r, j) => { t.oncomplete = r; t.onerror = () => j(t.error); });
  await reloadFromDb();
}

/** 重新从 IndexedDB 加载内存状态（导入恢复后调用） */
export async function reloadFromDb() {
  const [books, entries, settings] = await Promise.all([
    reqP(tx("books").getAll()),
    reqP(tx("entries").getAll()),
    reqP(tx("settings").get("app"))
  ]);
  state.books = books;
  state.entries = new Map(entries.map((e) => [e.id, e]));
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.settings.bookNames = { ...DEFAULT_SETTINGS.bookNames, ...(settings?.bookNames || {}) };
  applySettings(state.settings);
  emit();
}
