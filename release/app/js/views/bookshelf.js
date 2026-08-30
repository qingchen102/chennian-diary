/* ==========================================================================
   bookshelf.js — 书架视图：木桌、两本书、每日短句便签、检索/统计/设置
   ========================================================================== */
import * as store from "../store.js";
import * as nav from "../nav.js";
import * as quotes from "../quotes.js";
import { el, clear } from "../ui.js";
import { openSettings } from "./settings.js";
import { openSearch } from "./search.js";
import { openStats } from "./stats.js";
import { thudSound } from "../sound.js";

let quoteOffset = 0;

export function renderBookshelf(host) {
  clear(host);
  const v = el("div", { class: "view", id: "view-bookshelf" },
    el("div", { class: "wall" }),
    el("div", { class: "desk" }),
    el("div", { class: "plaque" },
      el("div", { class: "cn" }, "尘年往事"),
      el("div", { class: "sub" }, "手札 · 日记 · 随笔")),
    el("div", { class: "top-actions" },
      actionBtn("🔍", "检索", () => openSearch()),
      actionBtn("📊", "统计", () => openStats()),
      actionBtn("⚙️", "设置", () => openSettings())),
    el("div", { class: "books" },
      bookCard("diary"),
      bookCard("essay")),
    quoteCard(),
    el("div", { class: "shelf-hint" }, "点击书本翻开 · 点击便签换一句 · 右上方为检索 / 统计 / 设置"));
  host.append(v);
}

function actionBtn(icon, tip, fn) {
  return el("button", { class: "brass-btn", onclick: fn },
    el("span", { text: icon }),
    el("span", { class: "tip", text: tip }));
}

function bookCard(bookId) {
  const b = store.getBook(bookId);
  const theme = b.kind === "essay" ? "book-cloth" : "";
  const ornament = b.kind === "essay" ? "❧" : "❦";
  return el("div", {
    class: `book ${theme}`,
    title: `翻开「${b.name}」`,
    onclick: () => { thudSound(); nav.go("book", { bookId }); }
  },
    el("div", { class: "book-shadow" }),
    el("div", { class: "book-body" },
      el("div", { class: "book-pages" }),
      el("div", { class: "book-spine" }),
      el("div", { class: "book-cover" },
        el("div", { class: "ornament" }, ornament),
        el("div", { class: "name" }, b.name),
        el("div", { class: "subname" }, b.kind === "diary" ? "日记 · 日常" : "随笔 · 随想"))));
}

function quoteCard() {
  const q = quotes.todayQuote();
  const card = el("div", { class: "quote-card", title: "点我换一句" },
    el("div", { class: "label" }, "今日短句"),
    el("div", { class: "text" }, q ? q.t : "——"),
    el("div", { class: "source" }, q ? `${q.s}${q.d ? " · " + q.d : ""}` : ""));
  card.addEventListener("click", () => {
    quoteOffset++;
    const q2 = quotes.quoteAt(quoteOffset);
    const t = card.querySelector(".text"), s = card.querySelector(".source");
    if (q2) { t.textContent = q2.t; s.textContent = `${q2.s}${q2.d ? " · " + q2.d : ""}`; }
  });
  return card;
}
