// Valu-Present for iPad — same-room sharing, sealed: every message between this page and the iPad is encrypted with the room key
// (session code + passcode, PBKDF2-SHA256 200 000 rounds → AES-256-GCM — the same key and format as the internet route), so nothing
// readable travels on the Wi-Fi, even before the direct (WebRTC) connection is up. A same-room page is plain http (no WebCrypto there),
// so the audited @noble/ciphers + @noble/hashes code does the work (lancrypto.js).
import { gcm, pbkdf2Async, sha256 } from './lancrypto.js';
const te = new TextEncoder(), td = new TextDecoder();
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normPass = (p) => String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const lanKey = (code, pass) => pbkdf2Async(sha256, te.encode(normPass(pass)), te.encode('valu-present-share:' + normCode(code)), { c: 200000, dkLen: 32 });
export function lanSeal(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = gcm(key, iv).encrypt(te.encode(JSON.stringify(obj))); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return b64(o); }
export function lanUnseal(key, s) { try { const u = unb64(s); return JSON.parse(td.decode(gcm(key, u.subarray(0, 12)).decrypt(u.subarray(12)))); } catch { return null; } }
