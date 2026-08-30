/* ==========================================================================
   search.js — 全文检索抽屉
   ========================================================================== */
import * as store from "../store.js";
import * as nav from "../nav.js";
import { el, openDrawer, clear } from "../ui.js";
import { htmlToText } from "../sanitize.js";

export function openSearch() {
  const drawer = openDrawer({ title: "检索", content: build });

  function build(body, { close }) {
    const input = el("input", {
      placeholder: "搜索标题 / 正文 / 旁注 / 地点……",
      oninput: () => run(input.value.trim())
    });
    const results = el("div", { class: "search-results" });
    const empty = el("div", { class: "sr-empty", style: { display: "none" } }, "没有找到相关内容");

    body.append(el("div", { class: "search-box" }, input), results, empty);

    function run(q) {
      clear(results);
      if (!q) { empty.style.display = "none"; return; }
      const lower = q.toLowerCase();
      const hits = [];
      const allEntries = store.getState().books.flatMap((b) =>
        store.entriesOf(b.id).map((e) => ({ book: b, e })));

      for (const { book, e } of allEntries) {
        const text = [
          e.title, e.place, e.weather,
          htmlToText(e.html),
          ...(e.annotations || []).map((a) => a.text || "")
        ].join(" ").toLowerCase();
        if (!text.includes(lower)) continue;
        const snippet = snippetOf(e, q);
        hits.push({ book, e, snippet });
      }

      if (!hits.length) { empty.style.display = ""; return; }
      hits.slice(0, 60).forEach(({ book, e, snippet }) => {
        const dateStr = e.dateMode === "event" ? `${e.eventName || "事件"} Day${e.eventDay || 1}` : store.fmtDate(e.date);
        const item = el("div", {
          class: "sr-item",
          onclick: () => { close(); nav.go("book", { bookId: book.id, entryId: e.id }); }
        },
          el("div", { class: "sr-head" },
            el("span", { class: "sr-book" }, book.name),
            el("span", { class: "sr-date" }, dateStr)),
          el("div", { class: "sr-title" }, e.title),
          el("div", { class: "sr-snip" }, snippet));
        results.append(item);
      });
    }

    function snippetOf(e, q) {
      const title = e.title || "";
      const text = [e.place, e.weather, htmlToText(e.html)].filter(Boolean).join(" · ");
      const hay = `${title} ${text}`;
      const i = hay.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, i - 18);
      const frag = (i < 0 ? hay : hay.slice(start, i + q.length + 40)).replace(/\s+/g, " ");
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      // 转义正则元字符，否则搜索 ( * [ 等符号会抛异常导致整个检索失效
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return esc(frag).replace(new RegExp(esc(safe), "gi"), (m) => `<mark>${m}</mark>`);
    }

    setTimeout(() => input.focus(), 60);
  }
}
