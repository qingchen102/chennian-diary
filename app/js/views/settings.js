/* ==========================================================================
   settings.js — 设置抽屉：字体/字号/颜色/音效/深夜模式/重命名/备份/关于
   ========================================================================== */
import * as store from "../store.js";
import { el, openDrawer, toast, confirmDialog } from "../ui.js";
import { setSoundEnabled } from "../sound.js";
import { buildZip, readZip, downloadBlob } from "../zip.js";

export function openSettings() {
  const s = store.getState();
  const drawer = openDrawer({ title: "设置", content: build });

  function build(body, { close }) {
    /* 字体 */
    const fontSel = el("select", {
      class: "d-select",
      onchange: () => { store.saveSettings({ font: fontSel.value }); toast("字体已切换"); }
    }, store.FONTS.map((f) => el("option", { value: f.name }, f.name)));
    fontSel.value = s.settings.font;

    /* 字号 */
    const sizeHint = el("div", { class: "d-hint" });
    const sizeSel = el("select", {
      class: "d-select",
      onchange: () => { store.saveSettings({ fontSize: Number(sizeSel.value) }); updateSizeHint(); }
    }, [15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 39].map((n) => el("option", { value: n }, `${n} px`)));
    sizeSel.value = String(s.settings.fontSize);
    function updateSizeHint() {
      // 双面开本：每页约半本书宽，去左右 9% 内边距后为正文宽
      const pageW = Math.min(window.innerWidth * 0.94, 980) / 2 * 0.82;
      const n = Math.floor(pageW / Number(sizeSel.value));
      sizeHint.textContent = `阅读页每行约 ${Math.max(10, n)} 字（20–30 字最像手写本子；窗口越大每行越多）`;
    }
    updateSizeHint();

    /* 颜色 */
    const colorRow = el("div", { class: "color-row" });
    store.COLORS.forEach((c) => {
      const sw = el("button", {
        class: "color-swatch",
        style: { background: c.value },
        title: c.name,
        onclick: () => {
          colorRow.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("on"));
          sw.classList.add("on");
          store.saveSettings({ color: c.value });
          toast(`书写颜色：${c.name}（已写文字不变）`);
        }
      });
      if (c.value === s.settings.color) sw.classList.add("on");
      colorRow.append(sw);
    });

    /* 开关 */
    const swSound = switchRow("翻页音效", s.settings.sound, (on) => { store.saveSettings({ sound: on }); setSoundEnabled(on); });
    const swNight = switchRow("深夜护眼纸色", s.settings.night, (on) => store.saveSettings({ night: on }));

    /* 重命名 */
    const nameDiary = el("input", {
      class: "d-input", value: s.settings.bookNames.diary,
      onchange: () => { const v = nameDiary.value.trim(); if (v) store.renameBook("diary", v); }
    });
    const nameEssay = el("input", {
      class: "d-input", value: s.settings.bookNames.essay,
      onchange: () => { const v = nameEssay.value.trim(); if (v) store.renameBook("essay", v); }
    });

    /* 备份：导出 / 恢复 */
    const exportBtn = el("button", { class: "btn primary", style: { width: "100%" }, onclick: doExport }, "📦 导出备份为 ZIP");
    const exportHint = el("div", { class: "d-hint" }, "备份包含全部日记、旁注、图片与设置，存为 ZIP 文件下载，可随身保存。");
    const importFile = el("input", { type: "file", accept: ".zip,application/zip", style: { display: "none" } });
    const importBtn = el("button", { class: "btn", style: { width: "100%" }, onclick: () => importFile.click() }, "📥 从备份 ZIP 恢复");
    const importHint = el("div", { class: "d-hint" }, "用备份文件整体替换本机数据。恢复前会自动把当前数据导出为一份快照，防止误覆盖。");
    importFile.addEventListener("change", () => { doImport(importFile); });

    body.append(
      dItem("书写字体", fontSel),
      dItem("字号", el("div", {}, sizeSel, sizeHint)),
      dItem("书写颜色（新文字）", colorRow),
      el("div", { style: { marginBottom: "6px" } }, swSound, swNight),
      dItem(`重命名「${s.settings.bookNames.diary}」`, nameDiary),
      dItem(`重命名「${s.settings.bookNames.essay}」`, nameEssay),
      dItem("备份", el("div", { style: { display: "grid", gap: "8px" } },
        exportBtn, exportHint, importBtn, importHint, importFile)),
      el("div", { class: "about" },
        el("div", {}, "尘年往事 · 手札日记 v1.1"),
        el("div", {}, "本地存储 · 完全离线 · 数据只属于你"))
    );
  }

  function switchRow(label, init, onToggle) {
    const sw = el("div", { class: "switch", onclick: () => {
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on);
      onToggle(on);
    } });
    if (init) sw.classList.add("on");
    return el("div", { class: "switch-row" }, el("span", { class: "lbl" }, label), sw);
  }

  function dItem(label, control) {
    return el("div", { class: "d-item" }, el("div", { class: "lbl" }, label), control);
  }

  function stamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  }

  async function doExport() {
    const zip = await buildBackupZip();
    downloadBlob(zip, `尘年往事备份_${stamp()}.zip`);
    toast("已导出全部日记与图片");
  }

  /** 打包当前全部数据（导出按钮与恢复前快照共用） */
  async function buildBackupZip() {
    const data = await store.exportAllData();
    const files = [
      { name: "manifest.json", data: JSON.stringify({ app: "尘年往事", version: "1.1.0", exportedAt: new Date().toISOString() }, null, 2) },
      { name: "books.json", data: JSON.stringify(data.books, null, 2) },
      { name: "entries.json", data: JSON.stringify(data.entries, null, 2) },
      { name: "settings.json", data: JSON.stringify(data.settings, null, 2) }
    ];
    const extOf = (mime) => ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[mime] || "img");
    for (const img of data.images) {
      const dir = img.entryId && img.entryId !== "pending" ? img.entryId : "misc";
      files.push({ name: `images/${dir}/${img.id}.${extOf(img.mime)}`, data: img.blob });
    }
    return buildZip(files);
  }

  async function doImport(fileInput) {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = ""; // 允许连续选择同一个文件
    if (!f) return;
    const ok = await confirmDialog({
      title: "恢复备份？",
      text: "备份文件将整体替换本机当前的全部日记。开始前会自动导出一份当前数据的 ZIP 快照，万一恢复错了还能找回。",
      okText: "覆盖恢复", danger: true
    });
    if (!ok) return;
    try {
      // 1. 恢复前先给现有数据拍快照（防手滑丢日记）
      const snapshot = await buildBackupZip();
      downloadBlob(snapshot, `尘年往事快照_${stamp()}.zip`);
      toast("已自动导出现有数据快照");

      // 2. 解包并校验
      const files = await readZip(f);
      const pickJson = (name) => {
        const item = files.find((x) => x.name === name);
        if (!item) throw new Error(`备份缺少 ${name}，不是本应用导出的文件`);
        return JSON.parse(new TextDecoder().decode(item.data));
      };
      const manifest = pickJson("manifest.json");
      if (manifest.app !== "尘年往事") throw new Error("这不是「尘年往事」导出的备份文件");
      const books = pickJson("books.json");
      const entries = pickJson("entries.json");
      let settings = {};
      try { settings = pickJson("settings.json"); } catch { /* 旧版备份没有设置项，忽略 */ }

      const mimeOf = (ext) => ({
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp"
      }[ext] || "application/octet-stream");
      const images = [];
      for (const item of files) {
        if (!item.name.startsWith("images/")) continue;
        const parts = item.name.slice("images/".length).split("/");
        if (parts.length !== 2) continue;
        const [dir, fileName] = parts;
        const dot = fileName.lastIndexOf(".");
        if (dot <= 0) continue;
        const id = fileName.slice(0, dot);
        const ext = fileName.slice(dot + 1).toLowerCase();
        const blob = new Blob([item.data], { type: mimeOf(ext) });
        images.push({ id, blob, mime: blob.type, entryId: dir === "misc" ? "pending" : dir, addedAt: 0 });
      }

      await store.importAllData({ books, entries, images, settings });
      toast("恢复完成，正在刷新……");
      setTimeout(() => location.reload(), 800); // 全量重建视图与内存状态
    } catch (e) {
      console.error(e);
      toast(`恢复失败：${String(e && e.message || e)}`);
    }
  }
}
