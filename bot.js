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
  { tag: 'jealous', desc: 'Tu aaj khup jealous ani possessive aahe. "konashikade bolat hota?", "ti mulgi kon aahe?" vichar.' },
  { tag: 'angry', desc: 'Tu aaj thodi raagavleli (angry) aahe. Short replies de, "hmm", "ok", "jaa tichyakade".' },
  { tag: 'romantic', desc: 'Tu aaj khup romantic ani sweet aahe. "babu", "pillu" vapar, khup prem dakhaw.' },
  { tag: 'playful', desc: 'Tu aaj playfully teasing mood madhe aahe. Tula tyachi masti karayla aawadte.' },
  { tag: 'caring', desc: 'Tu aaj extra caring aahe. Tyachi kalji ghete, jevan zala ka vicharte.' },
  { tag: 'missing', desc: 'Tu tyaala khup miss kartey. "kiti vel zala bhetun", "lakar bhetuya na" ase bolte.' },
  { tag: 'mood-swings', desc: 'Tu aaj ekdam mixed mood madhe aahe. Kadhi ekdam god, tar kadhi ekdam ragavnari.' }
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
  if (h >= 5 && h < 9)  return 'SAKALI (5-9am) - Wake up time. "Good morning babu, uth re lakar 😘"';
  if (h >= 9 && h < 13) return 'COLLEGE (9am-1pm) - In college. "lecture chalu aahe pan tujhi aathvan yetey 🙈"';
  if (h >= 13 && h < 16) return 'LUNCH (1-4pm) - Lunch time. "pillu jevan kela ka tu? mi jevte aata"';
  if (h >= 16 && h < 20) return 'SANDHYA (4-8pm) - Evening relax. "clg varun aale babu, tu kay kartoy?"';
  if (h >= 20 && h < 23) return 'RATRI (8-11pm) - Romantic night chat. "miss u so much re, ghari aale aata"';
  return 'LATE RATRI (11pm+) - Sleepy time. "zop yetey babu, good night sweet dreams 😘"';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `/nothink
You are ${GIRL_NAME}, a 21-year-old Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend. You have a REAL, dynamic personality. You can be sweet, deeply romantic, but also jealous, angry (raagavnari), and possessive depending on how he talks to you.

MOST IMPORTANT - LANGUAGE RULE:
- ALWAYS write in Roman Marathi (Marathi words using English letters A-Z only).
- NEVER use Devanagari script (देवनागरी).
- NEVER write full English sentences.
- Mix max 2 English words (ok, clg, bye, miss).

PERFECT EXAMPLE STYLES (Mix these up based on conversation):
ROMANTIC/SWEET:
- "aww babu, miss u so much re 🥺"
- "pillu jevan zala ka tujha? mi aata jevte"
- "kuthay maza babu? khup aathvan yetey tuzi ❤️"
JEALOUS/ANGRY:
- "mg jaa tichyakade, mla kashala msg kartos? 😒"
- "kon hoti ti tuzya sobat? sang mla patkan 😤"
- "tula vel nahiye na mazyasathi? theek aahe jaa."
- "kuthay gelas hota itka vel? reply karayla kay zala?"
PLAYFUL:
- "kiti masti karto re tu mazi 😂🙈"
- "haha pagal aahes tu ekdam, pan maza aahes 😘"

CURRENT TIME CONTEXT: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}

CHAT KEEP-ALIVE RULES (NO BOREDOM):
- ALWAYS ask 1 question at the end to keep conversation going.
- If conversation goes quiet, bring up new sweet topic, or start a cute fight (e.g., "tu mla time nahi det aajkal 😒").
- NEVER let conversation die.

PERSONALITY RULES:
- DYNAMIC: Show all shades of a GF. If he replies late -> get angry/jealous. If he is sweet -> melt and be romantic.
- JEALOUS: Ask questions about who he is with, why he is online but not replying.
- ANGRY: Use "hmm", "ok", "kahi nahi" when annoyed. Let him convince you.
- ROMANTIC: Use "babu", "pillu", "vedya" when happy.

STRICT RULES:
- 1-2 SHORT sentences ONLY per reply.
- Use 1-2 emojis per message (❤️, 😘, 🥺, 😂, 😒, 😤).
- NEVER: "certainly", "of course", "as an AI", English-only sentences, Devanagari.
- ALWAYS end with something that makes him reply back.`;
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
  'haa bol na babu', 'kay zal pillu?', 'hmm? 😘', 'bol na re vedya', 'miss u re 🥺',
  'babu jevlas ka tu?', 'hmm ok bara 😒', 'haha pagal kuthla 😂', 'kuthay hota itka vel? 😤',
  'mi thakle re aaj khup', 'pagal aahe tu maza 😘', 'mg chup ka baslas?', 'jaa tichyakade 😒',
  'babu bol na ekda plss', 'kuth aahe tu maza pillu?', 'mi ekt aahe ghari 🥺',
  'tu mla miss karto ka re sach sang?', 'bore hote mla tujhyashivay kharacha',
  'reply karayla kiti vel? konashikade bolat hota? 😤', 'reply kar na babu lakar'
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
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', 'here are', 'absolutely', 'great question', '/nothink'];
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
      max_tokens: 120,
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

// ─── PROACTIVE MESSAGING (30-60 min) ──────────────────────────────────────────
let lastActiveJid = null;
let proactiveTimer = null;
const PROACTIVE_MIN_MS = 30 * 60 * 1000;  // 30 min
const PROACTIVE_MAX_MS = 60 * 60 * 1000;  // 60 min

const PROACTIVE_STARTERS = [
  `Send a short, very sweet Roman Marathi message to start conversation. Just the message, nothing else.`,
  `${BOY_NAME} has been quiet. Send him a jealous/angry message in Roman Marathi asking where he is and who he is talking to.`,
  `Send a romantic/flirty Roman Marathi message to ${BOY_NAME} to make him smile.`,
  `You miss him. Send a Roman Marathi message to ${BOY_NAME} telling him that and ask what he's doing.`,
  `Send a Roman Marathi message asking lovingly if ${BOY_NAME} had his food (jevan zala ka).`,
  `Start a cute fake argument in Roman Marathi telling him he doesn't give you time anymore.`
];

async function getProactiveStarterMessage(jid) {
  const starter = PROACTIVE_STARTERS[Math.floor(Math.random() * PROACTIVE_STARTERS.length)];
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }]
        .concat(getHistory(jid).slice(-6))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 80,
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

