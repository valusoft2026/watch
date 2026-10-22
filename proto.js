// 0.9.9.243 Share the Display — the pieces both sides use (the app's share host and the viewer web page).
// • Rooms: a code (in the link) + a passcode (typed). Everything that leaves a computer is sealed with a key made from
//   both (AES-256-GCM, PBKDF2 200 000 rounds), so the public meeting points can carry it but never read it.
// • Meeting points: free public MQTT brokers over secure WebSockets, several at once (any one is enough). They carry the
//   short "how to reach me" messages; the pictures then go computer-to-computer (WebRTC, encrypted).
// • Relay: if the two computers cannot reach each other directly, the pictures go through the same brokers in sealed chunks
//   (slower — fewer pictures per second — but it works).
export const VERSION = 1;
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://mqtt.eclipseprojects.io:443/mqtt'];
export const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
export const ROLES = ['Attorney', 'Counsel for Plaintiff', 'Counsel for Defendant', 'In-house Counsel', 'Paralegal', 'Legal Assistant', 'Witness', 'Expert Witness', 'Deponent', 'Corporate Representative', 'Party', 'Consultant', 'Jury Consultant', 'Trial Technician', 'Court Reporter', 'Videographer', 'Interpreter', 'Judge', 'Magistrate Judge', 'Special Master', 'Arbitrator', 'Mediator', 'Hearing Officer', 'Law Clerk', 'Courtroom Deputy / Clerk', 'Observer'];
const te = new TextEncoder(), td = new TextDecoder();
export const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const randCode = (n = 6, dash = 3) => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(n)); return [...r].map((x, i) => a[x % a.length] + (dash && i % dash === dash - 1 && i < n - 1 ? '-' : '')).join(''); };
export const randPass = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint8Array(10)); return [...r].map((x, i) => a[x % a.length] + (i === 4 ? '-' : '')).join(''); };
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normPass = (p) => String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export async function roomKey(code, pass) {
  const base = await crypto.subtle.importKey('raw', te.encode(normPass(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('valu-present-share:' + normCode(code)), iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function topicFor(code) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('vp-share-topic:' + normCode(code)))); return 'vpshare/v1/' + [...h.slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export async function seal(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)))); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return b64(o); }
export async function unseal(key, s) { try { const u = unb64(s); return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)))); } catch { return null; } }
// a full legal name: at least two words of two letters or more (initials alone are not enough)
export const fullName = (s) => { const w = String(s || '').trim().split(/\s+/).filter((x) => /\p{L}{2,}/u.test(x)); return w.length >= 2; };

// ---------- a minimal MQTT 3.1.1 client over WebSocket (QoS 0 publish / subscribe — all the meeting point needs)
function enc(s) { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function remLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return o; }
export class Mqtt {
  constructor(url, { onMessage, onState } = {}) { this.url = url; this.onMessage = onMessage; this.onState = onState; this.subs = new Set(); this.ok = false; this.closed = false; this.buf = new Uint8Array(0); this.open(); }
  open() {
    if (this.closed) return; let ws; try { ws = new WebSocket(this.url, ['mqtt']); } catch { this.retry(); return; }
    ws.binaryType = 'arraybuffer'; this.ws = ws; this.buf = new Uint8Array(0);
    ws.onopen = () => { const id = 'vp' + Math.random().toString(36).slice(2, 12); const vh = [...enc('MQTT'), 4, 2, 0, 30]; const pl = enc(id); ws.send(new Uint8Array([0x10, ...remLen(vh.length + pl.length), ...vh, ...pl])); };
    ws.onmessage = (e) => { const d = new Uint8Array(e.data); const b = new Uint8Array(this.buf.length + d.length); b.set(this.buf); b.set(d, this.buf.length); this.buf = b; this.drain(); };
    ws.onclose = () => { this.ok = false; clearInterval(this.ping); this.onState?.(false); this.retry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  retry() { if (this.closed) return; clearTimeout(this.rt); this.rt = setTimeout(() => this.open(), 4000 + Math.random() * 3000); }
  drain() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return; let mul = 1, len = 0, i = 1, byte;
      do { if (i >= b.length) return; byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
      if (b.length < i + len) return; const type = b[0] >> 4, body = b.subarray(i, i + len); this.buf = b.slice(i + len);
      if (type === 2) { this.ok = body[1] === 0; if (this.ok) { for (const t of this.subs) this.sendSub(t); this.ping = setInterval(() => { try { this.ws.send(new Uint8Array([0xc0, 0])); } catch {} }, 20000); } this.onState?.(this.ok); }
      else if (type === 3) { const tl = (body[0] << 8) | body[1]; const topic = td.decode(body.subarray(2, 2 + tl)); const qos = (b[0] >> 1) & 3; const off = 2 + tl + (qos ? 2 : 0); this.onMessage?.(topic, td.decode(body.subarray(off))); }
    }
  }
  sendSub(t) { const pl = [0, 1, ...enc(t), 0]; try { this.ws.send(new Uint8Array([0x82, ...remLen(pl.length), ...pl])); } catch {} }
  subscribe(t) { this.subs.add(t); if (this.ok) this.sendSub(t); }
  publish(t, msg) { if (!this.ok) return false; const tb = enc(t), mb = te.encode(msg); const head = [0x30, ...remLen(tb.length + mb.length)]; const out = new Uint8Array(head.length + tb.length + mb.length); out.set(head); out.set(tb, head.length); out.set(mb, head.length + tb.length); try { this.ws.send(out); return true; } catch { return false; } }
  close() { this.closed = true; clearTimeout(this.rt); clearInterval(this.ping); try { this.ws?.send(new Uint8Array([0xe0, 0])); this.ws?.close(); } catch {} }
}
// all the brokers at once: a message goes out on every one that is up; the same message arriving twice is dropped
export class Meet {
  constructor({ urls = BROKERS, topic, key, me, onMsg, onState }) {
    this.topic = topic; this.key = key; this.me = me; this.onMsg = onMsg; this.seen = new Map(); this.up = new Set(); this.onState = onState;
    this.links = urls.map((u) => new Mqtt(u, { onMessage: (t, m) => this.recv(m), onState: (ok) => { ok ? this.up.add(u) : this.up.delete(u); this.onState?.(this.up.size); } }));
    for (const l of this.links) l.subscribe(topic);
  }
  async recv(m) {
    let o; try { o = JSON.parse(m); } catch { return; } if (!o || o.v !== VERSION || !o.id || this.seen.has(o.id)) return;
    this.seen.set(o.id, Date.now()); if (this.seen.size > 4000) { const cut = Date.now() - 120000; for (const [k, t] of this.seen) if (t < cut) this.seen.delete(k); }
    const body = await unseal(this.key, o.s); if (!body || body.from === this.me) return; if (body.to && body.to !== this.me) return; this.onMsg?.(body);
  }
  async send(body) { const s = await seal(this.key, { ...body, from: this.me }); const id = Math.random().toString(36).slice(2) + Date.now().toString(36); const msg = JSON.stringify({ v: VERSION, id, s }); let any = false; for (const l of this.links) any = l.publish(this.topic, msg) || any; return any; }
  get connected() { return this.up.size; }
  close() { for (const l of this.links) l.close(); }
}
// big pieces (pictures) cut into chunks for a data channel or the relay, and put back together on arrival
export function chunks(id, u8, size = 48000) { const n = Math.max(1, Math.ceil(u8.length / size)); const out = []; for (let i = 0; i < n; i++) out.push({ t: 'chunk', id, i, n, d: b64(u8.subarray(i * size, (i + 1) * size)) }); return out; }
export class Joiner { constructor(onWhole) { this.p = new Map(); this.onWhole = onWhole; }
  add(c) { let e = this.p.get(c.id); if (!e) { e = { n: c.n, got: 0, parts: new Array(c.n), at: Date.now() }; this.p.set(c.id, e); } if (!e.parts[c.i]) { e.parts[c.i] = unb64(c.d); e.got++; }
    if (e.got === e.n) { this.p.delete(c.id); const len = e.parts.reduce((a, x) => a + x.length, 0); const u = new Uint8Array(len); let o = 0; for (const x of e.parts) { u.set(x, o); o += x.length; } this.onWhole(c.id, u); }
    if (this.p.size > 20) { const cut = Date.now() - 20000; for (const [k, v] of this.p) if (v.at < cut) this.p.delete(k); } } }
