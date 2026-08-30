/* ==========================================================================
   quotes.js — 每日短句（诗词/名言，标注出处）
   素材来自 quotes-data.js（window.DIARY_QUOTES）
   ========================================================================== */

const list = () => (window.DIARY_QUOTES || []);

/** 按日期取当日短句（确定性，同一天固定同一句） */
export function todayQuote() {
  const l = list();
  if (!l.length) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return l[day % l.length];
}

/** 从某一句往后取第 n 句（用于"换一句"） */
export function quoteAt(offset) {
  const l = list();
  if (!l.length) return null;
  return l[((offset % l.length) + l.length) % l.length];
}

export function quoteCount() { return list().length; }
