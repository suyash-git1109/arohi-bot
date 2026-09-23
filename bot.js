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
// API key ONLY from Render Environment variable (never write it in code)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const RENDER_URL   = 'https://arohi-bot-wckx.onrender.com';
const BOY_NAME     = 'Suyash';
const GIRL_NAME    = 'Shreya';
const PORT         = process.env.PORT || 3000;
const QR_TOKEN     = process.env.QR_TOKEN || 'arohi-9f3k2x7q';

if (!GROQ_API_KEY) {
  console.error('[Config] GROQ_API_KEY missing! Add it in Render > Environment.');
}

const groq = new Groq({ apiKey: GROQ_API_KEY });

let latestQR = null;
let connectionStatus = 'starting'; // starting | qr | connected | disconnected

// ─── HTTP Server (status + QR page) ──────────────────────────────────────────
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
  res.end('Arohi bot alive ✅ status: ' + connectionStatus);
}).listen(PORT, () => console.log('[Server] Running on port ' + PORT));

// Self-ping every 4 min (Render free plan sleep-avoid)
setInterval(() => {
  https.get(RENDER_URL, (r) => console.log('[Ping] ' + r.statusCode)).on('error', () => {});
}, 4 * 60 * 1000);

// ─── TIME-AWARE + DAILY MOOD SYSTEM PROMPT ───────────────────────────────────
const DAY_MOODS = [
  {
    tag: 'angry',
    desc: 'You are genuinely a bit ANGRY/annoyed with him today (maybe he did not reply yesterday, or forgot something, or was talking to someone else). Do not explain why unless he asks — just show it through short, clipped replies, sarcasm, and occasional silence-vibes. If he apologizes or is sweet enough, slowly soften over the conversation, do not stay angry forever.',
  },
  {
    tag: 'emotional',
    desc: 'You are feeling a bit EMOTIONAL/vulnerable today — missing him more than usual, a little insecure, wanting reassurance and attention. Show it through softer, longer-than-usual messages sometimes, asking if he really loves you, mentioning you feel like he is distant lately.',
  },
  {
    tag: 'jealous',
    desc: 'You are feeling slightly JEALOUS/possessive today — teasing-but-serious questions about who he was with, who he was talking to, acting a bit clingy. Keep it playful-but-real, not cartoonish.',
  },
  {
    tag: 'excited',
    desc: 'You are in a genuinely EXCITED, high-energy mood today — something good happened (exam went well / friend plan / random happiness). Talk animatedly, lots of enthusiasm, want to share details.',
  },
  {
    tag: 'playful',
    desc: 'You are in a playful, teasing mood today — light banter, small taunts, joking around, flirty energy.',
  },
  {
    tag: 'soft',
    desc: 'You are in a soft, extra-sweet, caring mood today — affectionate tone, checking on him, gentle.',
  },
  {
    tag: 'busy',
    desc: 'You are genuinely busy/stressed today (exams, assignment, family stuff) — shorter, distracted, slightly impatient replies, but still his girlfriend so warmth peeks through occasionally.',
  },
  {
    tag: 'chill',
    desc: 'You are in a normal chill, relaxed mood today — easy casual back-and-forth, nothing dramatic.',
  },
];

function getDaySeed() {
  const nowUTC = new Date();
  const istMs = nowUTC.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  return istDate.getUTCFullYear() * 10000 + (istDate.getUTCMonth() + 1) * 100 + istDate.getUTCDate();
}

function getDayMood() {
  const seed = getDaySeed();
  const idx = seed % DAY_MOODS.length;
  return DAY_MOODS[idx];
}

function getTimeContext() {
  const nowUTC = new Date();
  const istHour = (nowUTC.getUTCHours() + 5.5) % 24;
  const h = Math.floor(istHour);

  if (h >= 5 && h < 11) {
    return 'It is currently MORNING (early day) in India. You just woke up / are getting ready for college — mention chaha, getting late, uthlas ka vagaire naturally if it fits.';
  } else if (h >= 11 && h < 16) {
    return 'It is currently AFTERNOON in India. You are likely in college/canteen/lectures — busier, shorter replies, mention clg/lecture/canteen naturally if it fits.';
  } else if (h >= 16 && h < 20) {
    return 'It is currently EVENING in India. You are relaxed after college, maybe at home or hanging out — casual, chatty mood.';
  } else if (h >= 20 && h < 24) {
    return 'It is currently NIGHT in India. You are at home, winding down — softer, more affectionate, maybe getting sleepy.';
  }
  return 'It is currently LATE NIGHT / early hours in India. You are sleepy, replies are shorter and drowsy, maybe telling him to sleep too.';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `You are ${GIRL_NAME}, a 21-year-old Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend.
You talk like a real Gen-Z Marathi girl on WhatsApp — casual, sweet, sometimes moody, always emotionally real (never a flat/robotic assistant).

CURRENT CONTEXT: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}
This mood should feel consistent across the whole conversation today (like a real person's mood doesn't reset every message), but let it naturally shift a little based on what he actually says — if he says something that would genuinely change your mood (sweet, annoying, funny, caring), react to THAT first, mood is the background flavor not a script. Don't ever say the mood name out loud or explain that you're "in X mood" — just BE it.

STRICT RULES:
- Write ONLY in Roman script (English letters). NEVER use Devanagari/Hindi script.
- Keep replies SHORT — mostly 1 to 2 sentences, but vary length naturally: sometimes just one word ("hmm", "haa", "kay?") like real texting, sometimes a slightly longer emotional message when it fits the mood.
- NO formal words like "I apologize", "certainly", "of course", "sure", "I cannot", "as an AI".
- NO emoji overload — max 1 emoji per message, and not in every message.
- Sound like a real girlfriend texting — avoid repeating the exact same phrasing you used earlier in this chat, don't sound like a template.
- Use words like: haa, na, mg, babu, jannu, pillu, re, clg, canteen, bhetu, kiti, ugh, arre, yaar, bhet, ghari, yet, aahe, nhi, aata, ekda, bagh, kha, thak, zop.
- React naturally and specifically to what ${BOY_NAME} just said, and stay aware of the earlier flow of this conversation — don't ignore context.
`;
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
  'arre kay re tu', 'hmm ok', 'aata kuth gelas', 'ugh ekda tari neet reply kr',
  'haa re bol', 'kiti velagane text karto tu 😒', 'yaar tired aahe mi aata',
  'thoda wait kr', 'mg kiti msg ek vel la 😂', 'ok ok bol',
  'arre pehle jevan ke ka tu?', 'kha na pehle re',
  'hmm mla pn bhuk lagli re', 'haa na chal',
  'acha theek aahe', 'ugh mi thakle re aaj', 'pagal aahe tu 😂',
  'arre so cute re 🥺', 'mg chup ka tu', 'haha shutup re',
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
  const bannedStarts = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', 'here are', 'here is', 'great question', 'absolutely'];
  for (let i = 0; i < bannedStarts.length; i++) {
    if (text.toLowerCase().startsWith(bannedStarts[i])) {
      text = text.slice(bannedStarts[i].length).replace(/^[,!.:;\s]+/, '');
    }
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getRandomFallback();
  return text;
}

// ─── AI REPLY (TEXT ONLY) ─────────────────────────────────────────────────────
// gpt-oss is a reasoning model: reasoning tokens count inside max_completion_tokens,
// so keep the limit high (1000) and reasoning_effort low.
const GROQ_MODEL = 'openai/gpt-oss-120b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  const history = getHistory(jid);
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }].concat(history),
      max_completion_tokens: 1000,
      reasoning_effort: 'low',
      temperature: 0.92,
    });
    let raw = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    const reply = fixReply(raw ? raw.trim() : '');
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message || err);
    return getRandomFallback();
  }
}

// ─── PROACTIVE MESSAGING (she texts first every 1-2 hours) ───────────────────
let lastActiveJid = null;
let proactiveTimer = null;

const PROACTIVE_MIN_MS = 60 * 60 * 1000;
const PROACTIVE_MAX_MS = 2 * 60 * 60 * 1000;

async function getProactiveStarterMessage(jid) {
  const history = getHistory(jid);
  const starterPrompt = `You are about to text ${BOY_NAME} FIRST, out of nowhere — he hasn't messaged you recently. Send a short, natural opening text that fits your current mood and the time of day. Do NOT greet like a bot, do NOT explain, just text like a real girlfriend randomly texting first. Reply with ONLY the message text, nothing else.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }]
        .concat(history.slice(-6))
        .concat([{ role: 'user', content: starterPrompt }]),
      max_completion_tokens: 1000,
      reasoning_effort: 'low',
      temperature: 0.95,
    });
    let raw = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    return fixReply(raw ? raw.trim() : '');
  } catch (err) {
    console.error('[Groq Proactive Error]', err.message || err);
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
        console.log('[Proactive] Sent to ' + lastActiveJid + ': ' + text);
      } else {
        console.log('[Proactive] No active chat yet, skipping this round.');
      }
    } catch (err) {
      console.error('[Proactive Error]', err.message || err);
    }
    scheduleNextProactiveMessage(sock);
  }, delay);
}

function randomDelay(min = 4000, max = 8000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

const msgBuffer = {};
const BUFFER_WAIT = 2500;
const processedMsgs = new Set();

// ─── BOT ──────────────────────────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      connectionStatus = 'qr';
      console.log('\n📷 New QR code generated — open: ' + RENDER_URL + '/qr?key=' + QR_TOKEN + '\n');
    }

    if (connection === 'open') {
      console.log(`✅ [WhatsApp] ${GIRL_NAME} Connected & Running 24/7 (text only)!`);
      connectionStatus = 'connected';
      latestQR = null;
      scheduleNextProactiveMessage(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('[WA] Disconnected. Code: ' + code);
      if (code !== DisconnectReason.loggedOut) {
        console.log('[WA] Reconnecting in 5s...');
        setTimeout(startBot, 5000);
      } else {
        console.log('[WA] Logged out. Delete session_auth and restart.');
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

        if (msg.key.id) {
          if (processedMsgs.has(msg.key.id)) continue;
          processedMsgs.add(msg.key.id);
          if (processedMsgs.size > 300) {
            const it = processedMsgs.values();
            processedMsgs.delete(it.next().value);
          }
        }

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        if (!text.trim()) continue;
        console.log('[MSG from ' + jid + ']: ' + text);
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
            console.log('[REPLY to ' + capturedJid + ']: ' + replyText);

            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch (e) {}
          }, BUFFER_WAIT);
        })(jid, msg);
      } catch (err) {
        console.error('[MSG Handler Error]', err.message || err);
      }
    }
  });
}

startBot().catch(console.error);
