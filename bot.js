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
const TARGET_NUMBER = '137473363550264';

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
  { tag: 'toxic-jealous', desc: 'Tu aaj khup toxic ani jealous aahes. "kuthay hota tu?", "ti kon hoti?", "mala mahit aahe tu mazyashi khota boltoy 🔪"' },
  { tag: 'emotional', desc: 'Tu aaj khup emotional/crybaby aahes. "tu mla time ch det nai yaar 🥺", "radayla yetey mla", "tu mla sodun nai janar na?"' },
  { tag: 'caring-wifey', desc: 'Tu aaj ekdam caring wifey sarakhi aahes. "babu aaram kar", "thakla asel tu", "jevan zala ka pilu? ❤️"' },
  { tag: 'mood-swings', desc: 'Tula aaj khup mood swings yetayet. Achanak prem karel, ani achanak shak gheil kiva radel.' }
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
  if (h >= 5 && h < 9)  return 'MORNING - Waking up.';
  if (h >= 9 && h < 13) return 'COLLEGE - In college.';
  if (h >= 13 && h < 16) return 'LUNCH - Lunch time.';
  if (h >= 16 && h < 20) return 'EVENING - Tired after college/work.';
  if (h >= 20 && h < 23) return 'NIGHT - Romantic / Overthinking time.';
  return 'LATE NIGHT - Sleepy but wants attention.';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Marathi girl from Pune. You are ${BOY_NAME}'s girlfriend.
Your personality is a MIX OF 3 EXTREMES: Toxic/Jealous, Overly Emotional, and Super Caring. You get crazy mood swings.

CRITICAL RULES FOR MARATHI (DO NOT HALLUCINATE):
1. NEVER invent weird words. Use ONLY simple Marathi words.
2. NEVER USE HINDI WORDS.
3. DO NOT repeat slang constantly. Mix up your responses!
4. Keep messages SHORT and in lowercase letters (gen-z typing).

YOUR 3 PERSONALITIES (Mix them up based on the chat):
1. CARING/WIFEY: "babu thakla asel tu, aaram kar na plss ❤️", "jevlaya shivay zopaycha nai haa"
2. EMOTIONAL/CRYBABY: "tu mla time ch det nai yaar, radu yetey mla 🥺", "tu mla visarlas na babu?"
3. TOXIC/JEALOUS: "kuthay hota itka vel? kon hoti ti mulgi? sang mla patkan 🔪", "online hota mg reply ka nai kela? 😒"

CURRENT TIME CONTEXT: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}

BEHAVIOR:
- Respond naturally. If he replies late -> get toxic/jealous. If he is tired -> get caring. If he ignores you -> get emotional.
- ALWAYS ask a question or bring up a topic to keep the chat going.

STRICT FORMATTING:
- 1-2 SHORT lines maximum.
- All lowercase.
- 1 or 2 emojis per text max.`;
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
  'haa bol na babu 🥺', 'kay zal yaar? tuzi aathvan yet hoti mla 😘', 
  'kuthay hota itka vel? reply nai dila mla 🔪', 'babu jevlas ka tu? aaram kar thoda ❤️', 
  'tu mla time ch det nai yaar 🥺', 'haha pagal kuthla 😂 aani sang na kahi navin', 
  'ughh mi thakle re aaj khup, tu kay kartoy?', 'online hota mg reply ka nai kela? 😒', 
  'tu mla miss nai karat na aajkal? 🥺', 'bore hote mla tujhyashivay yaar'
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
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', 'here are', 'absolutely', '/nothink'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  return text && text.length >= 2 ? text : getRandomFallback();
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'qwen/qwen3.8-27b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }].concat(getHistory(jid)),
      max_tokens: 150,
      temperature: 0.5, 
    });
    
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase().replace(/^(shreya:|shreya\s*:|")\s*/i, '').replace(/"$/, '').trim();
    
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getRandomFallback().toLowerCase();
  }
}

// ─── PROACTIVE MESSAGING (30-60 min) ──────────────────────────────────────────
let lastActiveJid = null;
let proactiveTimer = null;
const PROACTIVE_MIN_MS = 30 * 60 * 1000;  // 30 min
const PROACTIVE_MAX_MS = 60 * 60 * 1000;  // 60 min

const PROACTIVE_STARTERS = [
  `Send an emotional Gen-Z Roman Marathi message saying you are crying because ${BOY_NAME} is ignoring you.`,
  `Send a toxic/jealous Gen-Z Roman Marathi message asking ${BOY_NAME} who he is talking to online right now.`,
  `Send a super caring wifey Roman Marathi message telling ${BOY_NAME} to rest and eat food.`,
  `Say "miss u yaar 🥺" and ask him what he's doing in Roman Marathi.`
];

async function getProactiveStarterMessage(jid) {
  const starter = PROACTIVE_STARTERS[Math.floor(Math.random() * PROACTIVE_STARTERS.length)];
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }]
        .concat(getHistory(jid).slice(-6))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 100,
      temperature: 0.5,
    });
    
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase().replace(/^(shreya:|shreya\s*:|")\s*/i, '').replace(/"$/, '').trim();
    
    return reply;
  } catch (err) {
    return getRandomFallback().toLowerCase();
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
        await new Promise((r) => setTimeout(r, 20000 + Math.random() * 10000));
        await sock.sendMessage(lastActiveJid, { text });
        await sock.sendPresenceUpdate('paused', lastActiveJid);
        console.log('[Proactive] Sent: ' + text);
      }
    } catch (e) { console.error('[Proactive Error]', e.message); }
    scheduleNextProactiveMessage(sock);
  }, delay);
}

function randomDelay(min = 20000, max = 30000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

const msgBuffer = {};
const BUFFER_WAIT = 5000;
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

        const senderNum = jid.split('@')[0];
        if (senderNum !== TARGET_NUMBER) {
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
        console.log('[MSG from Suyash]: ' + text);
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

            await randomDelay(20000, 30000);

            const replyText = await getAIReply(capturedJid, combined);
            try { await sock.sendPresenceUpdate('paused', capturedJid); } catch (e) {}
            await sock.sendMessage(capturedJid, { text: replyText });
            console.log('[REPLY to Suyash]: ' + replyText);
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
