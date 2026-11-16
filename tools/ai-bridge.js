// Мост для ИИ-бота Gemini: слушает ntfy и отвечает в чат класса.
// Запуск: GEMINI_API_KEY=... CHAT_CODE=... node tools/ai-bridge.js
// На GitHub Actions секреты задаются в настройках репозитория.
const crypto = require('crypto');

const SCHED_KEY = Buffer.from('YD5ijw9LbAdrCqqz3XTj3ox9I6Sp6tmfewNK0+s/YNg=', 'base64');
const AI_TOPIC = 'dnevnikAiHsPJjwoQ5z';
const CHAT_SALT_K = Buffer.from('1Dl+G/fnUz7kNueMLfIvfg==', 'base64');
const CHAT_TOPIC_SALT = 'dnevnik-chat-2026d';
const CHAT_ITER = 120000;
const HOST = 'https://ntfy.sh';
const MODEL_DEFAULT = 'gemini-2.5-flash-lite';
const SYSTEM_DEFAULT = 'Ты помощник школьного чата. Отвечай коротко, по-русски, помогай с домашкой. Код оформляй тройными обратными кавычками с языком.';

const KEY = process.env.GEMINI_API_KEY || '';
const CODE = process.env.CHAT_CODE || '';

if (!KEY || !CODE) {
  console.error('нужны GEMINI_API_KEY и CHAT_CODE');
  process.exit(2);
}

const chatKey = crypto.pbkdf2Sync(CODE, CHAT_SALT_K, CHAT_ITER, 32, 'sha256');
const chatTopic = 'dnevnik' + crypto.createHash('sha256').update(CODE + CHAT_TOPIC_SALT).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 24);

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function dec(str, key) {
  const i = str.indexOf('.');
  if (i < 0) return null;
  const iv = Buffer.from(str.slice(0, i), 'base64');
  const raw = Buffer.from(str.slice(i + 1), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0, -16)), d.final()]).toString('utf8'));
}
function enc(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return b64(iv) + '.' + b64(ct);
}

const cool = new Map();
let since = process.env.AI_SINCE || '15m';
let alive = true;
let ws = null;

async function gemini(q, model, prompt) {
  const m = (model || MODEL_DEFAULT).trim();
  const sys = (prompt || SYSTEM_DEFAULT).trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: 'user', parts: [{ text: String(q) }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 }
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('gemini http ' + r.status);
  const j = await r.json();
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const text = parts.map(p => p.text || '').join('').trim();
  if (!text) throw new Error('пустой ответ');
  return { text, model: m };
}

async function answer(req) {
  if (!req || req.op !== 'aiq' || !req.id || !req.q) return;
  const now = Date.now();
  if (cool.has(req.dev) && now - cool.get(req.dev) < 20000) return;
  cool.set(req.dev, now);
  try {
    const res = await gemini(req.q, req.model, req.prompt);
    await fetch(HOST + '/' + chatTopic, {
      method: 'POST',
      body: enc({ u: req.id, d: 'ai', n: 'Gemini', t: res.text.slice(0, 3500), model: res.model, ts: Date.now() }, chatKey)
    });
    console.log('ответ', req.id, res.model, res.text.length + ' симв.');
  } catch (e) {
    await fetch(HOST + '/' + chatTopic, {
      method: 'POST',
      body: enc({ u: req.id, d: 'ai', n: 'Gemini', t: 'Не получилось ответить: ' + e.message, ts: Date.now() }, chatKey)
    }).catch(() => {});
    console.log('ошибка', e.message);
  }
}

function connect() {
  if (!alive) return;
  try {
    ws = new WebSocket('wss://ntfy.sh/' + AI_TOPIC + '/ws?since=' + encodeURIComponent(since));
  } catch (e) {
    return setTimeout(connect, 5000);
  }
  ws.onmessage = ev => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.event === 'keepalive' || !m.message) return;
    if (m.id) since = m.id;
    const req = dec(m.message, SCHED_KEY);
    if (req) answer(req);
  };
  ws.onclose = () => setTimeout(connect, 3000);
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

console.log('мост ИИ запущен, тема ' + chatTopic);
connect();
setTimeout(() => { alive = false; try { ws && ws.close(); } catch (e) {} process.exit(0); }, 280000);
