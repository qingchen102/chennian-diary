/* ==========================================================================
   zip.js — 零依赖 ZIP 打包/解包（deflate-raw + stored 回退）
   用浏览器原生 CompressionStream / DecompressionStream，完全离线。
   ========================================================================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRaw(data) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([data]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time & 0xffff, date & 0xffff];
}

/**
 * 打包为 ZIP Blob
 * @param files [{ name: "dir/file.ext", data: Uint8Array|Blob|string, date?: Date }]
 */
export async function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const raw = f.data instanceof Uint8Array
      ? f.data
      : f.data instanceof Blob
        ? new Uint8Array(await f.data.arrayBuffer())
        : encoder.encode(String(f.data));
    const compressed = await deflateRaw(raw);
    const useDeflate = compressed !== null && compressed.length < raw.length;
    const body = useDeflate ? compressed : raw;
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(raw);
    const [dtime, ddate] = dosDateTime(f.date || new Date());

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // bit 11：文件名按 UTF-8 解码（中文名不乱码）
    lh.setUint16(8, useDeflate ? 8 : 0, true);
    lh.setUint16(10, dtime, true);
    lh.setUint16(12, ddate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, body);

    central.push({ nameBytes, crc, bodyLen: body.length, rawLen: raw.length, method: useDeflate ? 8 : 0, dtime, ddate, offset });
    offset += 30 + nameBytes.length + body.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); // bit 11：UTF-8 文件名（与局部头一致）
    ch.setUint16(10, c.method, true);
    ch.setUint16(12, c.dtime, true);
    ch.setUint16(14, c.ddate, true);
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.bodyLen, true);
    ch.setUint32(24, c.rawLen, true);
    ch.setUint16(28, c.nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, c.offset, true);
    chunks.push(new Uint8Array(ch.buffer), c.nameBytes);
    offset += 46 + c.nameBytes.length;
  }
  const cdSize = offset - cdStart;

  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(4, 0, true);
  eo.setUint16(6, 0, true);
  eo.setUint16(8, central.length, true);
  eo.setUint16(10, central.length, true);
  eo.setUint32(12, cdSize, true);
  eo.setUint32(16, cdStart, true);
  eo.setUint16(20, 0, true);
  chunks.push(new Uint8Array(eo.buffer));

  return new Blob(chunks, { type: "application/zip" });
}

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------- 解包（导入备份用） ---------- */

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** 解析 ZIP（buildZip 产出的格式）：返回 [{ name, data: Uint8Array }] */
export async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  // 从尾部向前找 EOCD（0x06054b50）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件");
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = [];
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > bytes.length || dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const csize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const lho = dv.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (lho + 30 > bytes.length || dv.getUint32(lho, true) !== 0x04034b50) {
      throw new Error(`ZIP 内部损坏（${name}）`);
    }
    // 局部头的名字/额外字段长度可能与中央目录不同，必须按局部头算数据起点
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      data = await inflateRaw(raw);
      if (!data) throw new Error(`无法解压 ${name}（浏览器不支持 deflate-raw）`);
    } else {
      throw new Error(`不支持的压缩方式：${method}（${name}）`);
    }
    files.push({ name, data });
  }
  return files;
}
