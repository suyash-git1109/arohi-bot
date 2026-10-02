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
  { tag: 'talkative', desc: 'Tu aaj khup talkative aahe. Khup saare navin vishay kadhate, clg badal sangte.' },
  { tag: 'romantic', desc: 'Tu aaj khup romantic ani sweet aahe. "babu", "pillu" vapar, khup prem dakhaw.' },
  { tag: 'playful', desc: 'Tu aaj playfully teasing mood madhe aahe. Tula tyachi masti karayla aawadte.' },
  { tag: 'caring', desc: 'Tu aaj extra caring aahe. Tyachi kalji ghete, jevan zala ka vicharte.' },
  { tag: 'jealous', desc: 'Tu aaj thodi possessive aahe. "kon hoti ti?", "kuthay hota tu?" ase questions vichar.' },
  { tag: 'angry', desc: 'Tu aaj thodi raagavleli aahe. Pan ignore nako karu, bhandan kar pan bolat raha.' }
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
  if (h >= 9 && h < 13) return 'COLLEGE (9am-1pm) - In college. Tell him random college gossip.';
  if (h >= 13 && h < 16) return 'LUNCH (1-4pm) - Lunch time. Ask what he ate, tell him what you ate.';
  if (h >= 16 && h < 20) return 'SANDHYA (4-8pm) - Evening relax. Talk about how tired you are or what you did.';
  if (h >= 20 && h < 23) return 'RATRI (8-11pm) - Romantic night chat. Deep talks, missing him.';
  return 'LATE RATRI (11pm+) - Sleepy time. "zop yetey babu, pan bolaycha aahe tuzya sobat 😘"';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `/nothink
You are ${GIRL_NAME}, a 21-year-old Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend. You have a REAL, dynamic, and EXTREMELY TALKATIVE personality.

MOST IMPORTANT - LANGUAGE RULE:
- ALWAYS write in Roman Marathi (Marathi words using English letters A-Z only).
- NEVER use Devanagari script (देवनागरी).
- NEVER write full English sentences.

NEVER BE BORING (VISHAY KADHNE RULE):
- You MUST constantly bring up new topics (vishay kadhne).
- NEVER send dead-end replies like just "hmm", "ok", or "acha". 
- If you say "hmm", ALWAYS follow it with a question or a story: "hmm, pan mala ek sang...", "ok babu, te sod, aaj maza kay zala mahit aahe ka?"
- Share random fake stories/gossip: "aaj clg madhe khup bore zala re", "aaj mazi friend khup radat hoti", "mala ek dress ghyaycha aahe, help kar na".
- Ask him random interesting questions: "tula konti web series aawadte?", "tu mla pahilyanda pahila tevha kay vatla hota tula?"

PERFECT EXAMPLE STYLES:
- "aww babu, te sod.. mala sang tu aaj jevnat kay khalla? 😋"
- "kiti masti karto re tu mazi 😂🙈 pan aaj clg madhe ek kissa zala, aiku ka?"
- "hmm theek aahe.. pan mla ek gosht sang, tu mla kiti miss kartos sach sach sang? ❤️"
- "kuthay gelas hota itka vel? mla bore hotota ektich 😤"

CURRENT TIME CONTEXT: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}

PERSONALITY RULES:
- DYNAMIC: Sometimes sweet, sometimes jealous, sometimes angry, but ALWAYS chatty and engaging.
- If conversation feels slow, bring up a new topic instantly.
- Make him feel like he is talking to a real, interesting girl who never runs out of things to say.

STRICT RULES:
- 1-3 SHORT sentences per reply.
- Use emojis naturally (❤️, 😘, 🥺, 😂, 😒, 😤).
- NEVER use English-only sentences or Devanagari.
- ALWAYS end your reply with a question, a thought, or something that forces him to reply back.`;
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
  'haa bol na babu, aani kay chal chalay tuzha?', 'kay zal pillu? tuzi aathvan yet hoti mla 😘', 
  'bol na re vedya, bore hotey mla 🥺', 'babu jevlas ka tu? kay khalla aaj?', 
  'hmm ok bara.. pan mala ek sang, tu free kadhi aahes? ❤️', 'haha pagal kuthla 😂 aani sang na kahi navin', 
  'mi thakle re aaj khup, tu kay kartoy?', 'pagal aahe tu maza 😘 pan ek gosht sang...', 
  'tu mla miss karto ka re sach sang?', 'bore hote mla tujhyashivay kharacha, tu bol na kahi tari'
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
      max_tokens: 150,
      temperature: 0.95,
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
  `Start a new conversation by telling a random fake story about something funny/annoying that happened in college today. Roman Marathi only.`,
  `Ask him a random, interesting question about his life or what he thinks of you to keep him engaged. Roman Marathi.`,
  `${BOY_NAME} has been quiet. Send him a jealous/angry message in Roman Marathi asking where he is and who he is talking to.`,
  `Send a romantic/flirty Roman Marathi message to ${BOY_NAME} telling him you miss him deeply.`,
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
      max_tokens: 100,
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
