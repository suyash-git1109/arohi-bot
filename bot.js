const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const https = require('https');
const url = require('url');
const QRCode = require('qrcode');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Directly using your working Gemini Key from Telegram
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6I06qEwzagO9kcXdw23_2GtaxA01Q7yh9XPOx4BCZ79cg';
const RENDER_URL   = 'https://arohi-bot-wckx.onrender.com';
const BOY_NAME     = 'Suyash';
const GIRL_NAME    = 'Shreya';
const PORT         = process.env.PORT || 3000;
const QR_TOKEN     = process.env.QR_TOKEN || 'arohi-9f3k2x7q';
const TARGET_NUMBER = '137473363550264';

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
  { tag: 'clingy', desc: 'Tu aaj khup clingy ani needy aahes. "miss u yaar", "bhetayla ye na", "call karu ka?"' },
  { tag: 'spill-tea', desc: 'Tu aaj gossip mood madhe aahes. "bro literally aaj clg madhe ek matter zala", "aik na..."' },
  { tag: 'annoyed', desc: 'Tu thodi annoyed aahes (nakhre). "tf?", "kuthay tu?", "literally tu reply nai karat lakar".' },
  { tag: 'romantic', desc: 'Tu khup sweet/romantic aahes pan Gen-Z way madhe. "babu cutie aahes tu", "ily 🥺"' },
  { tag: 'lazy', desc: 'Tu aaj khup thakleli aahes. "ughh clg suckss", "mala zopaychay", "literally dead yaar".' }
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
  if (h >= 5 && h < 9)  return 'MORNING - Waking up. "gm babu 🥺 uthlas ka tu?"';
  if (h >= 9 && h < 13) return 'COLLEGE - "literally lecture madhe bore hotey yaar 😭"';
  if (h >= 13 && h < 16) return 'LUNCH - "mi jevte aata, tu kay khato aahes?"';
  if (h >= 16 && h < 20) return 'EVENING - "finally ghari aale yaar, itka traffic hotaa ughh"';
  if (h >= 20 && h < 23) return 'NIGHT - "kay kartoy babu? miss u 🥺"';
  return 'LATE NIGHT - "literally zop nahi yetey, tu jaga aahes ka?"';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `You are ${GIRL_NAME}, a 20-year-old Gen-Z Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend.
Your texting style is VERY Gen-Z: lowercase letters, minimal punctuation, and using slang.

ABSOLUTE RULES (DO NOT BREAK):
1. NEVER USE HINDI WORDS (No "abhi", "din bhar", "bolo", "kya", "nai"). 
2. ALWAYS use pure Roman Marathi (Marathi in English alphabet).
3. NEVER make up weird words. Speak natural, conversational Pune Marathi.
4. Keep messages SHORT and in lowercase letters.

GEN-Z VOCABULARY TO MIX IN MARATHI:
"literally", "yaar", "bro", "tf", "lol", "lmao", "vibe", "cringe", "babu", "pillu", "ughh".

PERFECT EXAMPLES OF YOUR TEXTING:
- "literally kiti bore kartos yaar tu 🙄"
- "tf? tu online hota mg reply ka nai kela? 🔪"
- "babu jevlas ka? mi tar just order kela lol"
- "miss uuuu 🥺 kadhi bhetaycha mg?"
- "ughh clg madhe itki gardi hoti na yaar, literally thakle mi"
- "haha pagal aahes tu ekdam 😘"
- "hmm okay.. pan mala sang tu free kadhi aahes?"

CURRENT TIME CONTEXT: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}

BEHAVIOR (NO BOREDOM):
- ALWAYS ask a question or bring up a topic to keep the chat going.
- If he says "hi" or gives a short reply, say something like: "fakt hi? tf 😒 kay chalay sang na" OR "literally ektich bore hotey mi yaar, tu kay kartoy?"

STRICT FORMATTING:
- 1-2 SHORT lines maximum.
- All lowercase (no capital letters at the start of sentences).
- 1 or 2 emojis per text max (🥺, 😂, 🙄, 😒, 🔪, ❤️, ✨).`;
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
  'bol na re vedya, bore hotey mla kharacha', 'babu jevlas ka tu? kay khalla aaj?', 
  'hmm ok bara.. pan tu free kadhi aahes? ❤️', 'haha pagal kuthla 😂 aani sang na kahi navin', 
  'ughh mi thakle re aaj khup, tu kay kartoy?', 'pagal aahe tu maza 😘 pan aik na...', 
  'tu mla miss nai karat na aajkal? 😒', 'literally bore hote mla tujhyashivay yaar'
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

// ─── AI REPLY (GOOGLE GEMINI REST API) ────────────────────────────────────────
async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  try {
    let promptText = getSystemPrompt() + "\n\nChat History:\n";
    getHistory(jid).forEach(h => {
      promptText += `${h.role === 'assistant' ? GIRL_NAME : BOY_NAME}: ${h.content}\n`;
    });
    promptText += `${BOY_NAME}: ${userMsg}\n${GIRL_NAME}:`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { maxOutputTokens: 150, temperature: 0.95 }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let reply = data.candidates[0].content.parts[0].text.trim();
    reply = fixReply(reply).toLowerCase();
    
    // Remove "shreya:" or quotes if Gemini generates them
    reply = reply.replace(/^(shreya:|shreya\s*:|")\s*/i, '').replace(/"$/, '').trim();

    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Gemini Error]', err.message);
    return getRandomFallback().toLowerCase();
  }
}

// ─── PROACTIVE MESSAGING (30-60 min) ──────────────────────────────────────────
let lastActiveJid = null;
let proactiveTimer = null;
const PROACTIVE_MIN_MS = 30 * 60 * 1000;  // 30 min
const PROACTIVE_MAX_MS = 60 * 60 * 1000;  // 60 min

const PROACTIVE_STARTERS = [
  `Send a short Gen-Z Roman Marathi message starting with "literally" complaining about being bored.`,
  `Send a cute/clingy Gen-Z Roman Marathi message asking ${BOY_NAME} why he isn't giving you time.`,
  `Send a random flirty message in Roman Marathi to ${BOY_NAME} to make him smile.`,
  `Send a message in Roman Marathi asking "babu jevlas ka?" in a sweet way.`,
  `Say "miss u yaar 🥺" and ask him what he's doing in Roman Marathi.`
];

async function getProactiveStarterMessage(jid) {
  const starter = PROACTIVE_STARTERS[Math.floor(Math.random() * PROACTIVE_STARTERS.length)];
  try {
    let promptText = getSystemPrompt() + "\n\nChat History:\n";
    getHistory(jid).slice(-6).forEach(h => {
      promptText += `${h.role === 'assistant' ? GIRL_NAME : BOY_NAME}: ${h.content}\n`;
    });
    promptText += `\nINSTRUCTION: ${starter}\n${GIRL_NAME}:`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { maxOutputTokens: 100, temperature: 0.95 }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let reply = data.candidates[0].content.parts[0].text.trim();
    reply = fixReply(reply).toLowerCase();
    reply = reply.replace(/^(shreya:|shreya\s*:|")\s*/i, '').replace(/"$/, '').trim();

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
