/* ==========================================================================
   stats.js — 写作统计抽屉：总篇数 / 累计字数 / 连续天数 / 最早最近 / 本月
   ========================================================================== */
import * as store from "../store.js";
import { el, openDrawer } from "../ui.js";

export function openStats() {
  const s = store.getState();
  const books = s.books.map((b) => ({ book: b, entries: store.entriesOf(b.id) }));
  const all = books.flatMap((x) => x.entries);

  const total = all.length;
  const words = all.reduce((m, e) => m + (e.wordCount || 0), 0);
  const dates = all.map((e) => e.createdAt).sort((a, b) => a - b);
  const first = dates.length ? new Date(dates[0]) : null;
  const last = dates.length ? new Date(dates[dates.length - 1]) : null;
  const now = new Date();
  const thisMonth = all.filter((e) => {
    const d = new Date(e.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  // 连续写作天数（按自然日去重；今天没写则从昨天往前数）
  const daySet = new Set(all.map((e) => new Date(e.createdAt).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!daySet.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (daySet.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const fmt = (d) => d ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日` : "—";

  const drawer = openDrawer({
    title: "写作统计",
    content: el("div", {},
      el("div", { class: "stat-grid" },
        cell(total, "总篇数"),
        cell(words, "累计字数"),
        cell(streak, "连续写作 · 天"),
        cell(thisMonth, "本月篇数"),
        el("div", { class: "stat-cell wide" },
          el("div", { class: "num", style: { fontSize: "15px", fontWeight: "normal" } }, `${first ? fmt(first) : "—"} ～ ${last ? fmt(last) : "—"}`),
          el("div", { class: "lbl" }, "写作跨度"))),
      books.map(({ book, entries: es }) => el("div", { class: "stat-book" },
        el("div", { style: { fontSize: "15px", letterSpacing: "2px", marginBottom: "4px" } }, `📖 ${book.name}`),
        el("div", { class: "row" }, el("span", {}, "篇数"), el("b", {}, String(es.length))),
        el("div", { class: "row" }, el("span", {}, "字数"), el("b", {}, String(es.reduce((m, e) => m + (e.wordCount || 0), 0)))),
        el("div", { class: "row" }, el("span", {}, "旁注"), el("b", {}, String(es.reduce((m, e) => m + (e.annotations || []).length, 0)))))))
  });

  function cell(num, label) {
    return el("div", { class: "stat-cell" }, el("div", { class: "num" }, String(num)), el("div", { class: "lbl" }, label));
  }
}
