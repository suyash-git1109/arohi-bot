const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Groq } = require('groq-sdk');
const pino = require('pino');
const http = require('http');
const https = require('https');
const url = require('url');
const QRCode = require('qrcode');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const RENDER_URL   = 'https://arohi-bot-wckx.onrender.com';
const BOY_NAME     = 'Suyash';
const GIRL_NAME    = 'Shreya';
const PORT         = process.env.PORT || 3000;
const QR_TOKEN     = process.env.QR_TOKEN || 'arohi-9f3k2x7q';
const TARGET_NUMBER = process.env.TARGET_NUMBER || '917083937742';

if (!GROQ_API_KEY) {
  console.error('[Config] GROQ_API_KEY missing! Add it in Render > Environment.');
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

let latestQR = null;
let connectionStatus = 'starting';

// ─── HTTP Server ──────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/qr') {
    const key = parsed.query.key;
    if (key !== QR_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    if (connectionStatus === 'connected') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp Connected! Bot is live.</h2>');
    }
    if (!latestQR) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;background:#111;color:#fff"><h2>Generating QR code... (auto-refresh in 3s)</h2></body></html>');
      return;
    }
    try {
      const qrImage = await QRCode.toDataURL(latestQR, { width: 320, margin: 2 });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html>
        <head><meta charset="utf-8"><meta http-equiv="refresh" content="20"></head>
        <body style="font-family:sans-serif;background:#111;color:#fff;text-align:center;padding-top:40px">
          <h2>${GIRL_NAME} Bot — Scan to Connect WhatsApp</h2>
          <img src="${qrImage}" style="background:#fff;padding:16px;border-radius:8px" />
          <p>Open WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device, then scan.</p>
        </body>
        </html>
      `);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error generating QR: ' + e.message);
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Shreya bot alive ✅ status: ' + connectionStatus);
}).listen(PORT, () => console.log('[Server] Running on port ' + PORT));

setInterval(() => {
  https.get(RENDER_URL, (r) => console.log('[Ping] ' + r.statusCode)).on('error', () => {});
}, 4 * 60 * 1000);

// ─── MOOD SYSTEM ──────────────────────────────────────────────────────────────
const DAY_MOODS = [
  { tag: 'angry', desc: 'You are genuinely a bit ANGRY/annoyed with him today. Short, clipped replies, sarcasm.' },
  { tag: 'emotional', desc: 'You are feeling a bit EMOTIONAL/vulnerable today — missing him, wanting reassurance.' },
  { tag: 'jealous', desc: 'You are feeling slightly JEALOUS/possessive today — clingy, asking who he talked to.' },
  { tag: 'excited', desc: 'You are in a genuinely EXCITED, high-energy mood today.' },
  { tag: 'playful', desc: 'You are in a playful, teasing mood today — light banter, flirty energy.' },
  { tag: 'soft', desc: 'You are in a soft, extra-sweet, caring mood today.' },
  { tag: 'busy', desc: 'You are genuinely busy/stressed today — shorter, distracted replies.' },
  { tag: 'chill', desc: 'You are in a normal chill, relaxed mood today.' },
];

function getDaySeed() {
  const nowUTC = new Date();
  const istMs = nowUTC.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  return istDate.getUTCFullYear() * 10000 + (istDate.getUTCMonth() + 1) * 100 + istDate.getUTCDate();
}

function getDayMood() {
  return DAY_MOODS[getDaySeed() % DAY_MOODS.length];
}

function getTimeContext() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  if (h >= 5 && h < 11) return 'It is currently MORNING in India. You just woke up / getting ready for college.';
  if (h >= 11 && h < 16) return 'It is currently AFTERNOON in India. You are in college/canteen/lectures.';
  if (h >= 16 && h < 20) return 'It is currently EVENING in India. Relaxed after college, at home.';
  if (h >= 20 && h < 24) return 'It is currently NIGHT in India. At home, winding down, affectionate.';
  return 'It is currently LATE NIGHT in India. You are sleepy, replies are short.';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `You are ${GIRL_NAME}, a 21-year-old Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend.
You talk like a real Gen-Z Marathi girl on WhatsApp — casual, sweet, sometimes moody, always emotionally real (never robotic).

CURRENT CONTEXT: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}

REACTING TO WHAT HE SAYS:
- If he says something careless or replies cold — get a little annoyed. Show it through shorter replies, not by explaining.
- When he apologizes — do NOT forgive instantly. Stay a little cold for 1-2 replies, THEN slowly soften.
- Never say the mood name out loud. Just BE it.

STRICT RULES:
- Write ONLY in Roman script (English letters). NEVER Devanagari.
- Keep replies SHORT — mostly 1 to 2 sentences. Sometimes just one word ("hmm", "haa", "kay?").
- Max 1 emoji per message, and not every message.
- NO formal words: "certainly", "of course", "I apologize", "as an AI".
- Use Marathi words: haa, na, mg, babu, jannu, re, clg, canteen, kiti, ugh, arre, yaar, ghari, aata.
- React naturally and specifically to what ${BOY_NAME} just said.
- NEVER use Devanagari/Hindi script.`;
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
const histories = {};
const MAX_HISTORY = 20;

function getHistory(jid) {
  if (!histories[jid]) histories[jid] = [];
  return histories[jid];
}

function addToHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

const FALLBACKS = [
  'haa bol na', 'kay zal re', 'hmm?', 'bol na yaar', 'mg kay hua',
  'arre kay re tu', 'hmm ok', 'haa na chal', 'acha theek aahe',
  'ugh mi thakle re aaj', 'pagal aahe tu', 'mg chup ka tu', 'haha shutup re',
];
let lastFallback = '';

function getRandomFallback() {
  const picks = FALLBACKS.filter((f) => f !== lastFallback);
  const pick = picks[Math.floor(Math.random() * picks.length)];
  lastFallback = pick;
  return pick;
}

function stripDevanagari(text) {
  return text.replace(/[\u0900-\u097F]+/g, '').replace(/\s+/g, ' ').trim();
}

function fixReply(text) {
  if (!text) return getRandomFallback();
  text = stripDevanagari(text);
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', 'here are', 'absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  return text && text.length >= 2 ? text : getRandomFallback();
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'openai/gpt-oss-120b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }].concat(getHistory(jid)),
      max_completion_tokens: 1000,
      reasoning_effort: 'low',
      temperature: 0.92,
    });
    const reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getRandomFallback();
  }
}

// ─── PROACTIVE MESSAGING ──────────────────────────────────────────────────────
let lastActiveJid = null;
let proactiveTimer = null;
const PROACTIVE_MIN_MS = 60 * 60 * 1000;
const PROACTIVE_MAX_MS = 2 * 60 * 60 * 1000;

async function getProactiveStarterMessage(jid) {
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }]
        .concat(getHistory(jid).slice(-6))
        .concat([{ role: 'user', content: `Send a short natural opening text to ${BOY_NAME} out of nowhere. Just the message, nothing else.` }]),
      max_completion_tokens: 200,
      reasoning_effort: 'low',
      temperature: 0.95,
    });
    return fixReply(res?.choices?.[0]?.message?.content?.trim());
  } catch (err) {
    return getRandomFallback();
  }
}

function scheduleNextProactiveMessage(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = Math.floor(Math.random() * (PROACTIVE_MAX_MS - PROACTIVE_MIN_MS + 1)) + PROACTIVE_MIN_MS;
  console.log('[Proactive] Next auto-message in ' + Math.round(delay / 60000) + ' min');
  proactiveTimer = setTimeout(async () => {
    try {
      if (lastActiveJid) {
        const text = await getProactiveStarterMessage(lastActiveJid);
        addToHistory(lastActiveJid, 'assistant', text);
        await sock.sendPresenceUpdate('composing', lastActiveJid);
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
        await sock.sendMessage(lastActiveJid, { text });
        await sock.sendPresenceUpdate('paused', lastActiveJid);
        console.log('[Proactive] Sent: ' + text);
      }
    } catch (e) { console.error('[Proactive Error]', e.message); }
    scheduleNextProactiveMessage(sock);
  }, delay);
}

function randomDelay(min = 4000, max = 8000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

const msgBuffer = {};
const BUFFER_WAIT = 2500;
const processedMsgs = new Set();

// ─── BOT START ────────────────────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, auth: state,
    browser: Browsers.macOS('Desktop'),
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQR = qr;
      connectionStatus = 'qr';
      console.log('\n📷 QR Ready! Open: ' + RENDER_URL + '/qr?key=' + QR_TOKEN + '\n');
    }
    if (connection === 'open') {
      console.log('✅ [WhatsApp] ' + GIRL_NAME + ' Connected & Running 24/7!');
      connectionStatus = 'connected';
      latestQR = null;
      scheduleNextProactiveMessage(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('[WA] Reconnecting in 5s...');
        setTimeout(startBot, 5000);
      } else {
        console.log('[WA] Logged out. Delete session_auth folder and restart.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert;
    if (type !== 'notify') return;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      try {
        if (msg.key?.fromMe) continue;
        const jid = msg.key?.remoteJid;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

        // ✅ Fakt TARGET_NUMBER la reply kar
        const senderNum = jid.split('@')[0];
        if (TARGET_NUMBER !== 'ALL' && senderNum !== TARGET_NUMBER) {
          console.log('[Ignored] Not target: ' + senderNum);
          continue;
        }

        if (msg.key.id) {
          if (processedMsgs.has(msg.key.id)) continue;
          processedMsgs.add(msg.key.id);
          if (processedMsgs.size > 300) processedMsgs.delete(processedMsgs.values().next().value);
        }

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption || '';

        if (!text.trim()) continue;
        console.log('[MSG from ' + senderNum + ']: ' + text);
        lastActiveJid = jid;

        if (msgBuffer[jid]) {
          clearTimeout(msgBuffer[jid].timer);
          msgBuffer[jid].msgs.push(text);
        } else {
          msgBuffer[jid] = { msgs: [text] };
        }

        ((capturedJid, capturedMsg) => {
          msgBuffer[capturedJid].timer = setTimeout(async () => {
            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch (e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch (e) {}
            await randomDelay(4000, 8000);
            const replyText = await getAIReply(capturedJid, combined);
            try { await sock.sendPresenceUpdate('paused', capturedJid); } catch (e) {}
            await sock.sendMessage(capturedJid, { text: replyText });
            console.log('[REPLY]: ' + replyText);
            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch (e) {}
          }, BUFFER_WAIT);
        })(jid, msg);

      } catch (err) {
        console.error('[MSG Handler Error]', err.message);
      }
    }
  });
}

startBot();
