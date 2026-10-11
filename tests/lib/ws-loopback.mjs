import crypto from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function textFrame(text) {
  const body = Buffer.from(text);
  let head;
  if (body.length < 126) head = Buffer.from([0x81, body.length]);
  else if (body.length < 65536) head = Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([head, body]);
}

export function decodeFrames(buf) {
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 15;
    let len = buf[i + 1] & 127;
    let p = i + 2;
    if (len === 126) {
      if (p + 2 > buf.length) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const masked = (buf[i + 1] & 128) !== 0;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (p + len > buf.length) break;
    const body = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let k = 0; k < body.length; k++) body[k] ^= mask[k % 4];
    out.push({ op, text: body.toString() });
    i = p + len;
  }
  return { frames: out, rest: buf.subarray(i) };
}

export function attachLoopbackSocket(server, { token, path = "/socket", refuse = new Set(), onJoin = null } = {}) {
  const live = new Set();
  const state = { connections: 0, rejected: 0, joins: [], urls: [] };
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    state.urls.push(url.pathname);
    if (url.pathname !== path) { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    if (url.searchParams.get("token") !== token) {
      state.rejected++;
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\ninvalid token");
      return;
    }
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    state.connections++;
    const conn = { socket, joined: new Set() };
    live.add(conn);
    socket.on("close", () => live.delete(conn));
    socket.on("error", () => {});
    let rest = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      const d = decodeFrames(Buffer.concat([rest, chunk]));
      rest = d.rest;
      for (const f of d.frames) {
        if (f.op === 8) { socket.end(); return; }
        if (f.op !== 1) continue;
        let msg;
        try { msg = JSON.parse(f.text); } catch { continue; }
        if (!msg || msg.msg_type !== "join" || typeof msg.channel !== "string") continue;
        state.joins.push(msg.channel);
        const base = msg.channel.split(":")[0];
        if (refuse.has(base) || refuse.has(msg.channel)) {
          socket.write(textFrame(JSON.stringify([msg.channel, { response: { error: "not permitted" }, status: "error" }])));
          continue;
        }
        conn.joined.add(msg.channel);
        socket.write(textFrame(JSON.stringify([msg.channel, { response: {}, status: "ok" }])));
        if (onJoin) onJoin(msg.channel, conn);
      }
    });
  });
  return {
    state,
    push(channel, payload) {
      let n = 0;
      for (const c of live) {
        if (!c.joined.has(channel)) continue;
        try { c.socket.write(textFrame(JSON.stringify([channel, payload]))); n++; } catch { continue; }
      }
      return n;
    },
    joined: () => Array.from(live).flatMap((c) => Array.from(c.joined)),
    open: () => live.size,
    dropAll() { for (const c of live) c.socket.destroy(); },
    closeAll() { for (const c of live) c.socket.destroy(); live.clear(); },
  };
}
