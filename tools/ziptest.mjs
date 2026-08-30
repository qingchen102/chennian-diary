// ziptest.mjs — 验证 zip.js 的打包/解包往返一致性（在 Node 里跑，无需浏览器）
// 用法：node tools/ziptest.mjs
import { buildZip, readZip } from "../app/js/zip.js";

const enc = new TextEncoder();
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failed++; console.error(`FAIL  ${name} ${detail}`); }
}

// 1. 文本 + 中文文件名 + 大文件
const textCase = { name: "entries.json", data: JSON.stringify({ 标题: "测试", 正文: "一二三四五六七八九十".repeat(500) }) };

// 2. 不可压缩的随机字节（deflate 后更大 → 应自动回退 stored）
const random = new Uint8Array(64 * 1024);
crypto.getRandomValues(random);
const binCase = { name: "images/e_x/img_abc.png", data: random };

// 3. 空文件
const emptyCase = { name: "manifest.json", data: "" };

const zip = await buildZip([textCase, binCase, emptyCase]);
check("zip 体积合理", zip.size > 0, `size=${zip.size}`);

const files = await readZip(zip);
check("条目数量", files.length === 3, `got ${files.length}`);

const byName = (n) => files.find((f) => f.name === n);
const textBack = new TextDecoder().decode(byName("entries.json").data);
check("文本内容一致", textBack === textCase.data);
check("中文/子目录文件名保留", !!byName("images/e_x/img_abc.png"));
const binBack = byName("images/e_x/img_abc.png").data;
check("二进制逐字节一致", binBack.length === random.length && binBack.every((b, i) => b === random[i]));
check("空文件保留", byName("manifest.json").data.length === 0);

// 4. 非法输入 → 明确报错而不是挂死
try {
  await readZip(new Blob([enc.encode("this is not a zip file at all............")]));
  check("非 ZIP 输入报错", false, "未抛出异常");
} catch (e) {
  check("非 ZIP 输入报错", /ZIP/.test(e.message), e.message);
}

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log("\n全部通过");
