import http from "node:http";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";

const TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);

export function createWireReader({ compressed = false } = {}) {
  let buf = Buffer.alloc(0);
  let pending = null;
  const inflater = compressed ? zlib.createInflateRaw() : null;
  const messages = [];

  const inflate = (payload) => new Promise((resolve, reject) => {
    const chunks = [];
    const onData = (d) => chunks.push(d);
    const onError = (e) => reject(e);
    inflater.on("data", onData);
    inflater.once("error", onError);
    inflater.write(Buffer.concat([payload, TAIL]), () => {
      inflater.flush(zlib.constants.Z_SYNC_FLUSH, () => {
        inflater.off("data", onData);
        inflater.off("error", onError);
        resolve(Buffer.concat(chunks));
      });
    });
  });

  async function push(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const rsv1 = (buf[0] & 0x40) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      if (masked) throw new Error("a server frame must not be masked");
      if (buf.length < at + len) return;
      const payload = buf.subarray(at, at + len);
      const wire = at + len;
      buf = buf.subarray(wire);
      if (opcode >= 0x8) {
        messages.push({ control: true, opcode, wire, payload: Buffer.from(payload) });
        continue;
      }
      if (opcode !== 0) pending = { opcode, rsv1, parts: [], wire: 0 };
      if (!pending) throw new Error("a continuation frame with no message to continue");
      pending.parts.push(Buffer.from(payload));
      pending.wire += wire;
      if (!fin) continue;
      const raw = Buffer.concat(pending.parts);
      const done = pending;
      pending = null;
      const body = done.rsv1 ? await inflate(raw) : raw;
      messages.push({ control: false, opcode: done.opcode, compressed: done.rsv1, wire: done.wire, plain: body.length, body });
    }
  }

  return { push, messages };
}

export function wireSession(baseURL, path, headers, { ms = 3000, minMessages = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseURL);
    const req = http.request({
      host: u.hostname, port: u.port, path, method: "GET",
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), "Sec-WebSocket-Version": "13", ...headers },
    });
    req.on("upgrade", (res, socket, head) => {
      const extensions = res.headers["sec-websocket-extensions"];
      const reader = createWireReader({ compressed: typeof extensions === "string" && /permessage-deflate/i.test(extensions) });
      let queue = Promise.resolve();
      const feed = (d) => { queue = queue.then(() => reader.push(d)).catch(reject); };
      if (head && head.length) feed(head);
      socket.on("data", feed);
      const start = Date.now();
      const bytesBefore = socket.bytesRead;
      const finish = () => {
        queue.then(() => {
          const wireTotal = socket.bytesRead - bytesBefore + (head ? head.length : 0);
          socket.destroy();
          resolve({ status: res.statusCode, headers: res.headers, extensions, messages: reader.messages, socketBytes: wireTotal });
        });
      };
      const timer = setInterval(() => {
        const data = reader.messages.filter((m) => !m.control).length;
        if (Date.now() - start >= ms && data >= minMessages) { clearInterval(timer); finish(); }
        else if (Date.now() - start >= ms * 4) { clearInterval(timer); finish(); }
      }, 50);
    });
    req.on("response", (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, extensions: undefined, messages: [], body }));
    });
    req.on("error", reject);
    req.end();
  });
}

export function summariseWire(messages) {
  const data = messages.filter((m) => !m.control);
  const sum = (key) => data.reduce((n, m) => n + m[key], 0);
  const kinds = {};
  for (const m of data) {
    let k = "other";
    try { const f = JSON.parse(m.body.toString("utf8")); k = f.k === "ctl" ? "ctl." + f.t : f.k; } catch { k = "other"; }
    const e = kinds[k] || (kinds[k] = { n: 0, wire: 0, plain: 0, deflated: 0 });
    e.n++; e.wire += m.wire; e.plain += m.plain; if (m.compressed) e.deflated++;
  }
  return { messages: data.length, deflated: data.filter((m) => m.compressed).length, wire: sum("wire"), plain: sum("plain"), kinds };
}
