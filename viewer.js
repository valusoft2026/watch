// 0.9.9.243 Valu-Present Live Display — the viewer page (any browser, nothing to install).
// 0.9.9.247 clips with sound (direct connections), role at the top, Request control (witnesses), page jump, "Waiting for the next document".
// Same room: the page comes from the presenter's computer and talks to it directly.
// Anywhere else: the page is a plain static page; it finds the presenter through public meeting points, sealed with the passcode.
import { Meet, BROKERS, STUN, ROLES, roomKey, topicFor, normCode, fullName, Joiner } from './proto.js';

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.hash.slice(1));
const vid = 'v' + crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 14);
const V = { lan: false, meet: null, pc: null, dc: null, joined: false, control: false, tool: 'none', name: '', role: '', turn: null, frames: null, url: null, pingT: null, helloT: null, via: 'connecting' };
for (const r of ROLES) { $('role').append(new Option(r, r)); $('roleTop').append(new Option(r, r)); }
const WITNESS = /witness|deponent/i; // only the witness may ask for control
if (P.get('r')) $('code').value = P.get('r');
try { const rj = JSON.parse(sessionStorage.getItem('vp-rejoin') || 'null'); if (rj && !P.get('p') && normCode(rj.code) === normCode($('code').value || rj.code)) { $('code').value = rj.code; $('pass').value = rj.pass; } if (sessionStorage.getItem('vp-auto')) { sessionStorage.removeItem('vp-auto'); setTimeout(() => $('jf').requestSubmit(), 300); } } catch {}
if (P.get('p')) { $('pass').value = P.get('p'); $('pass').closest('label').classList.add('hide'); $('code').closest('label').classList.add('hide'); setTimeout(() => $('name').focus(), 50); } // same-room link: only the name is asked
try { const s = JSON.parse(localStorage.getItem('vp-watch') || '{}'); if (s.name) $('name').value = s.name; if (s.role) $('role').value = s.role; } catch {}
const err = (t) => { $('err').textContent = t || ''; };
const note = (t, ms = 3500) => { const n = $('note'); n.textContent = t; n.classList.remove('hide'); clearTimeout(note.t); note.t = setTimeout(() => n.classList.add('hide'), ms); };

// ---------- the two ways to talk to the presenter
async function lanDetect() { if (location.protocol !== 'http:' && location.protocol !== 'https:') return false; try { const r = await fetch('/lan/hello', { cache: 'no-store' }); if (!r.ok) return false; const j = await r.json(); return !!j.lan; } catch { return false; } }
async function lanSend(body) { try { await fetch('/lan/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid, body }) }); } catch {} }
async function lanPoll() { for (;;) { if (V.ended) return; try { const r = await fetch('/lan/recv?vid=' + vid, { cache: 'no-store' }); if (r.ok) { const list = await r.json(); for (const b of list) onMsg(b); } else await new Promise((x) => setTimeout(x, 1500)); } catch { await new Promise((x) => setTimeout(x, 1500)); } } }
const send = (body) => { if (V.dc?.readyState === 'open') { try { V.dc.send(JSON.stringify(body)); return; } catch {} } if (V.lan) lanSend(body); else V.meet?.send({ ...body, to: 'host' }); };

$('jf').addEventListener('submit', async (e) => {
  e.preventDefault(); err('');
  const code = normCode($('code').value), name = $('name').value.trim().replace(/\s+/g, ' '), role = $('role').value, pass = $('pass').value.trim();
  if (code.length < 6) return err('Type the session code from your invitation.');
  if (!fullName(name)) return err('Please type your full legal name — first and last.');
  if (!pass) return err('Type the passcode from your invitation.');
  try { localStorage.setItem('vp-watch', JSON.stringify({ name, role })); sessionStorage.setItem('vp-rejoin', JSON.stringify({ code, pass })); } catch {}
  V.name = name; V.role = role; $('go').disabled = true; $('go').textContent = 'Joining…';
  V.lan = await lanDetect();
  if (!V.lan) {
    if (!window.isSecureContext || !crypto.subtle) { $('go').disabled = false; $('go').textContent = 'Join'; return err('Open the link exactly as it was sent (it must start with https://).'); }
    const key = await roomKey(code, pass);
    const urls = P.get('b') ? P.get('b').split(',') : BROKERS;
    V.meet = new Meet({ urls, topic: await topicFor(code), key, me: vid, onMsg: (m) => { if (m.from === 'host') onMsg(m); } });
  } else lanPoll();
  const hello = () => send({ t: 'hello', name, role, pass: V.lan ? pass : undefined });
  hello(); V.helloT = setInterval(() => { if (!V.joined) hello(); }, 2500);
  setTimeout(() => { if (!V.joined) { $('go').disabled = false; $('go').textContent = 'Join'; err(V.lan ? 'No answer from the presenter. Check the passcode.' : 'No answer yet. Check the code and passcode — or the presenter has not started sharing.'); clearInterval(V.helloT); V.meet?.close(); V.meet = null; } }, 25000);
});

// ---------- messages from the presenter
V.frames = new Joiner((id, u8) => { V.got = V.got || new Map(); V.got.set(id, u8); if (V.got.size > 6) V.got.delete(V.got.keys().next().value); });
function onMsg(m) {
  if (!m || !m.t) return;
  V.heard = Date.now(); if (m.t === 'hb') return;
  if (m.t === 'denied') { $('go').disabled = false; $('go').textContent = 'Join'; err(m.reason || 'Not allowed in.'); clearInterval(V.helloT); return; }
  if (m.t === 'welcome') { if (V.joined) return; V.joined = true; clearInterval(V.helloT); V.turn = m.turn; V.control = !!m.control; $('roleTop').value = V.role; if (m.title) $('title').textContent = m.title; $('join').classList.add('hide'); $('watch').classList.remove('hide'); drawTools(); V.pingT = setInterval(() => { send({ t: 'ping' }); if (Date.now() - (V.heard || Date.now()) > 30000) end('The presenter is no longer sharing (connection lost).'); }, 10000); return; }
  if (m.t === 'rejoin') { V.joined = false; send({ t: 'hello', name: V.name, role: V.role }); return; }
  if (m.t === 'offer') { answer(m.sdp); return; }
  if (m.t === 'chunk') { V.frames.add(m); return; }
  if (m.t === 'frame') { const u8 = V.got?.get(m.id); if (!u8) return; V.got.delete(m.id); send({ t: 'ack', id: m.id }); const url = URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' })); const old = V.url; V.url = url; $('img').src = url; $('img').onload = () => { if (old) URL.revokeObjectURL(old); layout(); }; V.hasPic = true; waitState(); return; }
  if (m.t === 'crop') { V.crop = m.rect || null; layout(); return; }
  if (m.t === 'hires') { V.hires = !!m.on; $('hiBtn').classList.toggle('on', V.hires); if (!m.on && m.reason === 'slow') note('HI-RES was too slow on this connection — back to standard.', 6000); if (!m.on && m.reason === 'relay') note('HI-RES needs a direct connection.', 5000); return; }
  if (m.t === 'status') { V.st = m; const L = $('live'); L.textContent = !m.presenting ? 'Not presenting' : m.blank ? 'Blank' : m.live ? 'Live' : 'Display'; L.className = 'pill' + (m.presenting && m.live && !m.blank ? ' live' : ''); waitState(); $('gotoOf').textContent = m.pages ? `of ${m.pages}` : ''; if (m.page && document.activeElement !== $('gotoN')) $('gotoN').value = m.page; return; }
  if (m.t === 'mode') { V.mode = m; window.__mode = m; showMode(); return; }
  if (m.t === 'people') { $('pplN').textContent = m.list.length; $('people').innerHTML = '<h3>Watching now</h3>' + m.list.map((p) => `<div class="pp"><b>${esc(p.name)}</b><span>${esc(p.role || '')}</span>${p.control ? '<em>CONTROL</em>' : ''}</div>`).join(''); return; }
  if (m.t === 'control') { const was = V.control; V.control = !!m.on; V.mark = !!m.mark; V.asked = false; if (!V.mark) V.tool = 'none'; drawTools();
    if (V.control && !was) note(V.mark ? 'The presenter gave you control — turn pages, go to a page, or mark the exhibit.' : 'The presenter gave you control — turn pages or go to a page.', 5000);
    else if (!V.control && m.reason === 'tech') note('The presenter took over. Request control again if you need it.', 6000);
    else if (!V.control && m.reason === 'denied') note('The presenter did not give control this time.', 5000);
    else if (!V.control && was) note('Control was taken back.'); return; }
  if (m.t === 'removed') { end('You were removed from this session.'); return; }
  if (m.t === 'ended') { end('The presenter stopped sharing.'); return; }
}
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function end(t) {
  // 0.9.9.248 Rejoin: the same session code and passcode work again once the presenter shares again (24 h)
  if (!/removed/.test(t)) { let rb = document.getElementById('rejoin'); if (!rb) { rb = document.createElement('button'); rb.id = 'rejoin'; rb.className = 'btn on'; rb.textContent = 'Rejoin'; rb.style.marginTop = '10px'; rb.addEventListener('click', () => { try { sessionStorage.setItem('vp-auto', '1'); } catch {} location.reload(); }); $('wait').append(rb); } }
  V.ended = true; try { $('vid').srcObject = null; } catch {} $('snd').classList.add('hide'); $('reqBtn').classList.add('hide'); clearInterval(V.pingT); try { V.pc?.close(); } catch {} V.meet?.close(); $('wait').classList.remove('hide'); $('wait').querySelector('b').textContent = t; $('waitT').textContent = 'You can close this page.'; $('img').removeAttribute('src'); $('tools').classList.add('hide'); setVia('ended'); }
function setVia(v) { V.via = v; $('hiBtn').classList.toggle('hide', v !== 'direct'); const e = $('via'); e.textContent = { direct: 'Direct', relay: 'Relay', connecting: 'Connecting', ended: 'Ended' }[v] || v; e.className = 'pill' + (v === 'direct' ? ' ok' : v === 'relay' ? ' warn' : ''); e.title = v === 'relay' ? 'The direct connection could not be made, so the picture comes through the relay — a little slower.' : ''; }

async function answer(sdp) {
  try { V.pc?.close(); } catch {}
  const pc = new RTCPeerConnection({ iceServers: [...STUN, ...(V.turn?.urls ? [V.turn] : [])] }); V.pc = pc;
  pc.ontrack = (e) => { V.stream ||= new MediaStream(); V.stream.addTrack(e.track); $('vid').srcObject = V.stream; };
  pc.ondatachannel = (e) => { const dc = e.channel; V.dc = dc; dc.onopen = () => setVia('direct'); dc.onclose = () => { if (!V.ended) setVia('relay'); }; dc.onmessage = (x) => { let b; try { b = JSON.parse(x.data); } catch { return; } onMsg(b); }; };
  pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState) && !V.ended) setVia('relay'); };
  await pc.setRemoteDescription({ type: 'offer', sdp }); await pc.setLocalDescription(await pc.createAnswer());
  await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, 2500); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }); });
  const body = { t: 'answer', sdp: pc.localDescription.sdp }; if (V.lan) lanSend(body); else V.meet?.send({ ...body, to: 'host' });
  setTimeout(() => { if (V.via === 'connecting' && !V.ended) setVia('relay'); }, 12000);
}

// ---------- 0.9.9.249 Fit: just the page (default) or the whole Display — the picture is placed so the chosen part fills the window
V.fit = (() => { try { return localStorage.getItem('vp-fit') || 'page'; } catch { return 'page'; } })();
function region() { return V.fit === 'page' && V.crop && !V.mode?.video ? V.crop : { x: 0, y: 0, w: 1, h: 1 }; }
function layout() {
  const st = $('stage'), pic = $('pic'), vidOn = !!V.mode?.video, el = vidOn ? $('vid') : $('img');
  const nw = vidOn ? el.videoWidth : el.naturalWidth, nh = vidOn ? el.videoHeight : el.naturalHeight; if (!nw || !nh) return;
  const r = region(), W = st.clientWidth, H = st.clientHeight, rw = r.w * nw, rh = r.h * nh, k = Math.min(W / rw, H / rh);
  pic.style.width = Math.round(rw * k) + 'px'; pic.style.height = Math.round(rh * k) + 'px';
  for (const e of [$('img'), $('vid')]) { e.style.width = Math.round(nw * k) + 'px'; e.style.height = Math.round(nh * k) + 'px'; e.style.left = Math.round(-r.x * nw * k) + 'px'; e.style.top = Math.round(-r.y * nh * k) + 'px'; }
  for (const b of $('fitSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.fit === V.fit);
}
window.addEventListener('resize', layout); $('vid').addEventListener('loadedmetadata', layout); $('vid').addEventListener('resize', layout);
$('fitSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; V.fit = b.dataset.fit; try { localStorage.setItem('vp-fit', V.fit); } catch {} layout(); });
$('hiBtn').addEventListener('click', () => { if (V.via !== 'direct') { note('HI-RES needs a direct connection.', 4000); return; } send({ t: 'hires', on: !V.hires }); });

// ---------- what shows: the picture, live video during a clip, or "Waiting for the next document…"
function waitState() {
  const s = V.st || {}; const w = $('wait');
  if (V.ended) return;
  const art = !!(s.presenting && s.idleArt && V.hasPic); // 0.9.9.248 the presenter's own clear screen (logo, name) shows, with a small "waiting" tag
  const empty = (!s.presenting || s.empty) && !art;
  $('waitPill').classList.toggle('hide', !art);
  w.classList.toggle('hide', !!(V.hasPic && !empty) || !!(V.mode?.video && !empty));
  if (empty || !V.hasPic) { w.querySelector('b').textContent = !s.presenting ? 'Waiting for the presentation' : 'Waiting for the next document…'; $('waitT').textContent = 'It shows here the moment the presenter puts it on the Display.'; }
  if (empty) $('img').style.visibility = 'hidden'; else $('img').style.visibility = '';
}
function showMode() {
  const m = V.mode || {}; const vid = $('vid');
  vid.classList.toggle('hide', !m.video); $('img').classList.toggle('hide', !!m.video); setTimeout(layout, 50);
  $('snd').classList.toggle('hide', !(m.video || m.audio));
  if (m.video || m.audio) vid.play().catch(() => {});
  if (m.relay) note('Video and sound play only on a direct connection — you see still pictures.', 7000);
  waitState();
}
$('sndGo').addEventListener('click', () => { const v = $('vid'); v.muted = false; v.volume = +$('sndVol').value; v.play().catch(() => {}); $('sndGo').classList.add('hide'); $('sndMute').classList.remove('hide'); $('sndVol').classList.remove('hide'); $('sndMute').textContent = '🔊'; });
$('sndMute').addEventListener('click', () => { const v = $('vid'); v.muted = !v.muted; $('sndMute').textContent = v.muted ? '🔇' : '🔊'; });
$('sndVol').addEventListener('input', () => { const v = $('vid'); v.volume = +$('sndVol').value; if (v.muted && v.volume > 0) { v.muted = false; $('sndMute').textContent = '🔊'; } });
$('roleTop').addEventListener('change', () => { V.role = $('roleTop').value; try { localStorage.setItem('vp-watch', JSON.stringify({ name: V.name, role: V.role })); } catch {} send({ t: 'role', role: V.role }); drawTools(); note('Your role is updated for everyone.'); });
$('reqBtn').addEventListener('click', () => { if (V.asked || V.control) return; V.asked = true; send({ t: 'reqctl' }); drawTools(); note('Asked — waiting for the presenter.', 4000); });
$('giveBack').addEventListener('click', () => { send({ t: 'giveback' }); });
$('gotoF').addEventListener('submit', (e) => { e.preventDefault(); const n = parseInt($('gotoN').value, 10); if (n > 0) send({ t: 'input', k: 'goto', page: n }); });

// ---------- top bar
$('pplBtn').addEventListener('click', () => $('people').classList.toggle('hide'));
$('leave').addEventListener('click', () => { send({ t: 'bye' }); end('You left the session.'); });
window.addEventListener('pagehide', () => { if (V.joined && !V.ended) send({ t: 'bye' }); });

// ---------- control: pages and drawing (only when the presenter allows it)
function drawTools() {
  const wit = WITNESS.test(V.role || ''); const r = $('reqBtn'); r.classList.toggle('hide', !wit || V.control || V.ended); r.disabled = !!V.asked; r.textContent = V.asked ? '✋ Asked…' : '✋ Request control';
  $('markTools').classList.toggle('hide', !V.mark);
  $('tools').classList.toggle('hide', !V.control); for (const b of $('tools').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === V.tool); $('stage').style.cursor = V.control && V.tool !== 'none' ? 'crosshair' : ''; }
$('tools').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a) { send({ t: 'input', k: 'action', id: b.dataset.a }); return; } if (b.dataset.tool) { V.tool = b.dataset.tool; drawTools(); } });
const at = (e) => { const r = (V.mode?.video ? $('vid') : $('img')).getBoundingClientRect(); if (!r.width) return null; return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }; // the whole picture, even when only the page shows
let down = false, lastMove = 0;
$('stage').addEventListener('pointerdown', (e) => { if (!V.control || !V.mark || V.tool === 'none' || e.button !== 0) return; const p = at(e); if (!p || p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return; down = true; $('stage').setPointerCapture(e.pointerId); send({ t: 'input', k: 'down', tool: V.tool, ...p }); e.preventDefault(); });
$('stage').addEventListener('pointermove', (e) => { if (!down) return; const n = performance.now(); if (n - lastMove < 33) return; lastMove = n; const p = at(e); if (p) send({ t: 'input', k: 'move', tool: V.tool, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }); });
const up = (e) => { if (!down) return; down = false; const p = at(e) || { x: 0, y: 0 }; send({ t: 'input', k: 'up', tool: V.tool, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }); };
// 0.9.9.248 with control, the mouse wheel / trackpad scrolls the page on the Display (up / down, like the presenter's own wheel)
let wheelAcc = 0, wheelT = 0;
$('stage').addEventListener('wheel', (e) => { if (!V.control) return; e.preventDefault(); wheelAcc += e.deltaY; const n = performance.now(); if (n - wheelT < 60) return; wheelT = n; const p = at(e) || { x: 0.5, y: 0.5 }; send({ t: 'input', k: 'wheel', dy: Math.max(-600, Math.min(600, wheelAcc)), x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }); wheelAcc = 0; }, { passive: false });
$('stage').addEventListener('pointerup', up); $('stage').addEventListener('pointercancel', up);
