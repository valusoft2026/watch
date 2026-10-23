// 0.9.9.243 Valu-Present Live Display — the viewer page (any browser, nothing to install).
// 0.9.9.247 clips with sound (direct connections), role at the top, Request control (witnesses), page jump, "Waiting for the next document".
// Same room: the page comes from the presenter's computer and talks to it directly.
// Anywhere else: the page is a plain static page; it finds the presenter through public meeting points, sealed with the passcode.
import { Meet, BROKERS, STUN, ROLES, roomKey, topicFor, normCode, fullName, Joiner } from './proto.js';

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.hash.slice(1));
const vid = 'v' + crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 14);
const V = { lan: false, meet: null, pc: null, dc: null, joined: false, control: false, tool: 'none', name: '', role: '', turn: null, frames: null, url: null, pingT: null, helloT: null, via: 'connecting' };
for (const r of ROLES) $('roles').append(new Option(r, r)); // 0.9.9.251 pick a role or type your own
const WITNESS = /witness|deponent/i; // only the witness may ask for control
if (P.get('r')) $('code').value = P.get('r');
try { const rj = JSON.parse(sessionStorage.getItem('vp-rejoin') || 'null'); if (rj && !P.get('p') && normCode(rj.code) === normCode($('code').value || rj.code)) { $('code').value = rj.code; $('pass').value = rj.pass; } if (sessionStorage.getItem('vp-auto')) { sessionStorage.removeItem('vp-auto'); setTimeout(() => $('jf').requestSubmit(), 300); } } catch {}
if (P.get('p')) { $('pass').value = P.get('p'); $('pass').closest('label').classList.add('hide'); $('code').closest('label').classList.add('hide'); setTimeout(() => $('name').focus(), 50); } // same-room link: only the name is asked
try { const s = JSON.parse(localStorage.getItem('vp-watch') || '{}'); if (s.name) $('name').value = s.name; if (s.role) $('role').value = s.role; } catch {}
const err = (t) => { $('err').textContent = t || ''; };
const note = (t, ms = 3500, cls = '') => { const n = $('note'); n.textContent = t; n.className = cls; clearTimeout(note.t); if (ms > 0) note.t = setTimeout(() => n.classList.add('hide'), ms); }; // ms 0 = stays (0.9.9.255)

// ---------- the two ways to talk to the presenter
async function lanDetect() { if (location.protocol !== 'http:' && location.protocol !== 'https:') return false; try { const r = await fetch('/lan/hello', { cache: 'no-store' }); if (!r.ok) return false; const j = await r.json(); return !!j.lan; } catch { return false; } }
async function lanSend(body) { try { await fetch('/lan/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid, body }) }); } catch {} }
async function lanPoll() { for (;;) { if (V.ended) return; try { const r = await fetch('/lan/recv?vid=' + vid, { cache: 'no-store' }); if (r.ok) { const list = await r.json(); for (const b of list) onMsg(b); } else await new Promise((x) => setTimeout(x, 1500)); } catch { await new Promise((x) => setTimeout(x, 1500)); } } }
const send = (body) => { if (V.dc?.readyState === 'open') { try { V.dc.send(JSON.stringify(body)); return; } catch {} } if (V.lan) lanSend(body); else V.meet?.send({ ...body, to: 'host' }); };

$('jf').addEventListener('submit', async (e) => {
  e.preventDefault(); err('');
  const code = normCode($('code').value), name = $('name').value.trim().replace(/\s+/g, ' '), role = $('role').value.trim().slice(0, 60), pass = $('pass').value.trim();
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
  if (m.t === 'status') { V.st = m; const L = $('live'); L.textContent = !m.presenting ? 'Not presenting' : m.blank ? 'Blank' : m.live ? 'Live' : 'Display'; L.className = 'pill' + (m.presenting && m.live && !m.blank ? ' live' : ''); waitState(); drawPanes(); return; }
  if (m.t === 'mode') { V.mode = m; window.__mode = m; showMode(); return; }
  if (m.t === 'people') { $('pplN').textContent = m.list.length; $('people').innerHTML = '<h3>Watching now</h3>' + [...m.list].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })).map((p) => `<div class="pp"><b>${esc(p.name)}</b><span>${esc(p.role || '')}</span>${p.control ? '<em>CONTROL</em>' : ''}</div>`).join(''); return; }
  if (m.t === 'control') { const was = V.control; V.control = !!m.on; V.mark = !!m.mark; V.asked = false; if (!V.mark) V.tool = 'none'; drawTools();
    if (V.control && !was) note(V.mark ? '✓ Control granted — turn pages (← →), scroll a zoomed page with the mouse wheel, go to a page, or mark the exhibit.' : '✓ Control granted — turn pages (← →), scroll a zoomed page with the mouse wheel, or go to a page.', 6000, 'ok');
    else if (!V.control && m.reason === 'tech') note('The presenter took over. Request control again if you need it.', 6000);
    else if (!V.control && m.reason === 'denied') note('✕ Request denied — you can ask again.', 6000, 'bad');
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
  paneHi();
}
window.addEventListener('resize', layout); try { new ResizeObserver(() => layout()).observe($('stage')); } catch {} // the top bar can wrap onto two lines $('vid').addEventListener('loadedmetadata', layout); $('vid').addEventListener('resize', layout);
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
$('roleTop').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('roleTop').blur(); });
$('roleTop').addEventListener('change', () => { V.role = $('roleTop').value.trim().slice(0, 60); $('roleTop').value = V.role; try { localStorage.setItem('vp-watch', JSON.stringify({ name: V.name, role: V.role })); } catch {} send({ t: 'role', role: V.role }); drawTools(); note('Your role is updated for everyone.'); });
$('reqBtn').addEventListener('click', () => { if (V.asked || V.control) return; V.asked = true; send({ t: 'reqctl' }); drawTools(); note('✋ Waiting for the tech…', 0, 'wait'); });
$('giveBack').addEventListener('click', () => { send({ t: 'giveback' }); });
$('gotoF').addEventListener('submit', (e) => { e.preventDefault(); const n = parseInt($('gotoN').value, 10); if (n > 0) send({ t: 'input', k: 'goto', page: n, ...(V.pane != null ? { pane: V.pane } : {}) }); });

// ---------- top bar
$('pplBtn').addEventListener('click', () => $('people').classList.toggle('hide'));
$('leave').addEventListener('click', () => { send({ t: 'bye' }); end('You left the session.'); });
window.addEventListener('pagehide', () => { if (V.joined && !V.ended) send({ t: 'bye' }); });

// ---------- control: pages and drawing (only when the presenter allows it)
function drawTools() {
  const wit = WITNESS.test(V.role || ''); const r = $('reqBtn'); r.classList.toggle('hide', !wit || V.control || V.ended); r.disabled = !!V.asked; r.textContent = V.asked ? '✋ Asked…' : '✋ Request control';
  $('markTools').classList.toggle('hide', !V.mark);
  $('tools').classList.toggle('hide', !V.control); for (const b of $('tools').querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === V.tool); $('stage').style.cursor = V.control && V.tool !== 'none' ? 'crosshair' : ''; try { paneHi(); } catch {} }
$('tools').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.pane != null) { V.pane = +b.dataset.pane; drawPanes(); return; } if (b.dataset.all) { send({ t: 'input', k: 'action', id: b.dataset.all, pane: 'all' }); return; } if (b.dataset.a) { send({ t: 'input', k: 'action', id: b.dataset.a, ...(V.pane != null ? { pane: V.pane } : {}) }); return; } if (b.dataset.tool) { V.tool = b.dataset.tool; drawTools(); } });
const at = (e) => { const r = (V.mode?.video ? $('vid') : $('img')).getBoundingClientRect(); if (!r.width) return null; return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }; // the whole picture, even when only the page shows
let down = false, lastMove = 0;
$('stage').addEventListener('pointerdown', (e) => { if (!V.control || !V.mark || V.tool === 'none' || e.button !== 0) return; const p = at(e); if (!p || p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return; down = true; $('stage').setPointerCapture(e.pointerId); send({ t: 'input', k: 'down', tool: V.tool, ...p }); e.preventDefault(); });
$('stage').addEventListener('pointermove', (e) => { if (!down) return; const n = performance.now(); if (n - lastMove < 33) return; lastMove = n; const p = at(e); if (p) send({ t: 'input', k: 'move', tool: V.tool, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }); });
const up = (e) => { if (!down) return; down = false; const p = at(e) || { x: 0, y: 0 }; send({ t: 'input', k: 'up', tool: V.tool, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }); };
// 0.9.9.248 with control, the mouse wheel / trackpad scrolls the page on the Display (up / down, like the presenter's own wheel)
let wheelAcc = 0, wheelT = 0;
// 0.9.9.255 wheel: zoomed → the page scrolls (Shift / trackpad sideways = left-right), whole page → a firm scroll turns it. Sent ~30×/s so it glides.
let wheelDx = 0; const unit = (e) => (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 600 : 1);
const wheelSend = (dx, dy) => { const p = { x: 0.5, y: 0.5 }; send({ t: 'input', k: 'wheel', ...(V.pane != null ? { pane: V.pane } : {}), dx: Math.max(-600, Math.min(600, dx)), dy: Math.max(-600, Math.min(600, dy)), x: p.x, y: p.y }); };
$('stage').addEventListener('wheel', (e) => { if (!V.control) return; e.preventDefault(); const u = unit(e); let dx = e.deltaX * u, dy = e.deltaY * u; if (e.shiftKey && !dx) { dx = dy; dy = 0; } wheelAcc += dy; wheelDx += dx; const n = performance.now(); if (n - wheelT < 33) return; wheelT = n; wheelSend(wheelDx, wheelAcc); wheelAcc = 0; wheelDx = 0; }, { passive: false });
// 0.9.9.255 keys (with control): → ↓ PgDn Space = next page (↓ scrolls when zoomed), ← ↑ PgUp = back (↑ scrolls when zoomed), Home / End = first / last page
const zoomedNow = () => { const s = V.st || {}; const L = (s.panes || []).filter(Boolean); const p = L.length > 1 && V.pane != null ? s.panes[V.pane] : null; return p ? !!p.z : !!s.zoom; };
window.addEventListener('keydown', (e) => {
  if (!V.control || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
  const act = (id) => send({ t: 'input', k: 'action', id, ...(V.pane != null ? { pane: V.pane } : {}) }); const z = zoomedNow(); let done = true;
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': case ' ': act('nav.next'); break;
    case 'ArrowLeft': case 'PageUp': act('nav.prev'); break;
    case 'ArrowDown': if (z) wheelSend(0, 140); else act('nav.next'); break;
    case 'ArrowUp': if (z) wheelSend(0, -140); else act('nav.prev'); break;
    case 'Home': send({ t: 'input', k: 'goto', page: 1, ...(V.pane != null ? { pane: V.pane } : {}) }); break;
    case 'End': { const s = V.st || {}; const p = (s.panes || []).filter(Boolean).length > 1 && V.pane != null ? s.panes[V.pane] : s; if (p?.pages) send({ t: 'input', k: 'goto', page: p.pages, ...(V.pane != null ? { pane: V.pane } : {}) }); break; }
    case '+': case '=': act('zoom.in'); break; case '-': act('zoom.out'); break; case '0': act('zoom.fit'); break;
    default: done = false;
  }
  if (done) e.preventDefault();
});
$('stage').addEventListener('pointerup', up); $('stage').addEventListener('pointercancel', up);

// ---------- 0.9.9.251 floating tools: drag, size, tuck away — always kept inside the browser window
const TB = (() => { try { return { s: 1, x: null, y: null, min: false, v: true, ...JSON.parse(localStorage.getItem('vp-tools2') || '{}') }; } catch { return { s: 1, x: null, y: null, min: false, v: true }; } })(); // 0.9.9.252 upright by default
const tbEl = $('tools');
function tbSave() { try { localStorage.setItem('vp-tools2', JSON.stringify(TB)); } catch {} }
const barBottom = () => Math.round($('bar').getBoundingClientRect().bottom);
function tbClamp() {
  if (TB.x == null || tbEl.classList.contains('hide')) return;
  const r = tbEl.getBoundingClientRect(); const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const top = barBottom() + 4; TB.x = Math.max(4, Math.min(TB.x, W - r.width - 4)); TB.y = Math.max(top, Math.min(TB.y, H - r.height - 4)); // never over the top bar
  Object.assign(tbEl.style, { left: TB.x + 'px', top: TB.y + 'px', bottom: 'auto', transform: 'none' });
}
// one line across (or upright): if it doesn't fit the window, it shrinks to fit; at the smallest size it may wrap
function tbFit() {
  if (tbEl.classList.contains('hide')) return;
  tbEl.classList.remove('wrap'); if (!tbEl.dataset.flat) tbEl.classList.toggle('vert', !!TB.v); tbEl.style.setProperty('--ts', TB.s);
  const W = document.documentElement.clientWidth - 16, H = document.documentElement.clientHeight - barBottom() - 12;
  const need = TB.v ? tbEl.scrollHeight : tbEl.scrollWidth, room = TB.v ? H : W;
  let k = TB.s, n = need; for (let i = 0; i < 6 && n > room && k > 0.6; i++) { k = Math.max(0.6, k * room / n * 0.98); tbEl.style.setProperty('--ts', k.toFixed(3)); n = TB.v ? tbEl.scrollHeight : tbEl.scrollWidth; }
  if (n > room + 1 && TB.v && !tbEl.dataset.flat) { tbEl.dataset.flat = '1'; tbEl.classList.remove('vert'); const sv = TB.v; TB.v = false; tbFit(); TB.v = sv; delete tbEl.dataset.flat; return; } // too short a window for upright: lie it across for now
  if (n > room + 1) tbEl.classList.add('wrap');
  if (TB.x == null && TB.v) { const h = tbEl.getBoundingClientRect().height, b = barBottom(); Object.assign(tbEl.style, { left: '8px', top: Math.round(b + Math.max(4, (document.documentElement.clientHeight - b - h) / 2)) + 'px', bottom: 'auto', transform: 'none' }); }
  tbClamp();
}
function tbApply() {
  tbEl.classList.toggle('vert', !!TB.v); tbEl.style.setProperty('--ts', TB.s); tbEl.classList.toggle('min', !!TB.min); $('tMin').textContent = TB.min ? 'Tools ▴' : '▾';
  if (TB.x == null) Object.assign(tbEl.style, { left: '', top: '', bottom: '', transform: '' }); requestAnimationFrame(tbFit);
}
$('tSm').addEventListener('click', (e) => { e.stopPropagation(); TB.s = Math.max(0.7, +(TB.s - 0.1).toFixed(2)); tbApply(); tbSave(); });
$('tLg').addEventListener('click', (e) => { e.stopPropagation(); TB.s = Math.min(1.6, +(TB.s + 0.1).toFixed(2)); tbApply(); tbSave(); });
$('tRot').addEventListener('click', (e) => { e.stopPropagation(); TB.v = !TB.v; TB.x = TB.y = null; tbApply(); tbSave(); });
$('tMin').addEventListener('click', (e) => { e.stopPropagation(); TB.min = !TB.min; tbApply(); tbSave(); });
$('tGrip').addEventListener('pointerdown', (e) => {
  const r = tbEl.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top; tbEl.classList.add('drag'); $('tGrip').setPointerCapture(e.pointerId);
  const mv = (ev) => { TB.x = ev.clientX - dx; TB.y = ev.clientY - dy; tbClamp(); };
  const up = () => { tbEl.classList.remove('drag'); $('tGrip').removeEventListener('pointermove', mv); tbSave(); };
  $('tGrip').addEventListener('pointermove', mv); $('tGrip').addEventListener('pointerup', up, { once: true }); $('tGrip').addEventListener('pointercancel', up, { once: true }); e.preventDefault();
});
$('tGrip').addEventListener('dblclick', () => { TB.x = TB.y = null; tbApply(); tbSave(); }); // double-click the grip: back to the bottom middle
window.addEventListener('resize', tbFit);
{ let wasHid = tbEl.classList.contains('hide'); new MutationObserver(() => { const h = tbEl.classList.contains('hide'); if (h !== wasHid) { wasHid = h; if (!h) requestAnimationFrame(tbFit); } }).observe(tbEl, { attributes: true, attributeFilter: ['class'] }); }
tbApply();

// ---------- 0.9.9.253 split Display: which pane the witness is turning (lit on the picture), or All ◀ / All ▶
V.pane = null;
const panesOn = () => (V.st?.panes || []).map((p, i) => (p && p.r ? { ...p, i } : null)).filter(Boolean);
function paneNames(L) {
  if (L.length === 2) { const [a, b] = L; const across = Math.abs(a.r.x - b.r.x) >= Math.abs(a.r.y - b.r.y); const first = across ? (a.r.x <= b.r.x ? a : b) : (a.r.y <= b.r.y ? a : b); return new Map(L.map((p) => [p.i, across ? (p === first ? 'Left' : 'Right') : (p === first ? 'Top' : 'Bottom')])); }
  const S2 = [...L].sort((a, b) => (Math.abs(a.r.y - b.r.y) > 0.05 ? a.r.y - b.r.y : a.r.x - b.r.x)); return new Map(S2.map((p, k) => [p.i, String(k + 1)]));
}
function drawPanes() {
  const L = panesOn(), multi = L.length > 1, m = V.st || {};
  if (!multi) V.pane = null; else if (V.pane == null || !L.some((p) => p.i === V.pane)) V.pane = L.some((p) => p.i === m.active) ? m.active : L[0].i;
  $('paneSel').classList.toggle('hide', !multi);
  if (multi) { const N = paneNames(L); const B = $('paneBtns'); const key = L.map((p) => p.i + N.get(p.i)).join() + '|' + V.pane; if (B.dataset.k !== key) { B.dataset.k = key; const rank = (s) => ({ Left: 0, Top: 0, Right: 1, Bottom: 1 })[s] ?? +s; B.replaceChildren(...[...L].sort((a, b) => rank(N.get(a.i)) - rank(N.get(b.i))).map((p) => { const b = document.createElement('button'); b.className = 'btn' + (p.i === V.pane ? ' on' : ''); b.dataset.pane = p.i; b.textContent = N.get(p.i); b.title = `Turn the ${N.get(p.i).toLowerCase()} pane`; return b; })); } }
  const cur = multi ? L.find((p) => p.i === V.pane) : m;
  $('gotoOf').textContent = cur?.pages ? `of ${cur.pages}` : ''; if (cur?.page && document.activeElement !== $('gotoN')) $('gotoN').value = cur.page;
  paneHi(); requestAnimationFrame(() => { try { tbFit(); } catch {} });
}
function paneHi() {
  const el = $('paneHi'); const L = panesOn(); const p = L.length > 1 && V.control ? L.find((q) => q.i === V.pane) : null; const img = V.mode?.video ? null : $('img');
  if (!p || !img || !img.naturalWidth) { el.classList.add('hide'); return; }
  const W = parseFloat(img.style.width) || img.clientWidth, H = parseFloat(img.style.height) || img.clientHeight, x0 = parseFloat(img.style.left) || 0, y0 = parseFloat(img.style.top) || 0;
  Object.assign(el.style, { left: Math.round(x0 + p.r.x * W) + 'px', top: Math.round(y0 + p.r.y * H) + 'px', width: Math.round(p.r.w * W) + 'px', height: Math.round(p.r.h * H) + 'px' }); el.classList.remove('hide');
}
