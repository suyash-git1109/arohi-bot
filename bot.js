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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const RENDER_URL   = 'https://arohi-bot-wckx.onrender.com';
const BOY_NAME     = 'Suyash';
const GIRL_NAME    = 'Shreya';
const PORT         = process.env.PORT || 3000;
const QR_TOKEN     = process.env.QR_TOKEN || 'arohi-9f3k2x7q';
const TARGET_NUMBER = '137473363550264';

if (!GROQ_API_KEY) console.error('[Config] GROQ_API_KEY missing!');

const groq = new Groq({ apiKey: GROQ_API_KEY });
let latestQR = null;
let connectionStatus = 'starting';
let lastActiveJid = null;
let proactiveTimer = null;
let gmSent = false;
let gnSent = false;

// ─── HTTP Server ──────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/qr') {
    const key = parsed.query.key;
    if (key !== QR_TOKEN) { res.writeHead(403); return res.end('Forbidden'); }
    if (connectionStatus === 'connected') {
      res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
      return res.end('<h2 style="font-family:sans-serif;color:green">✅ Connected!</h2>');
    }
    if (!latestQR) {
      res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
      return res.end('<html><head><meta http-equiv="refresh" content="3"></head><body style="background:#111;color:#fff"><h2>Generating QR...</h2></body></html>');
    }
    try {
      const qrImage = await QRCode.toDataURL(latestQR, { width: 320, margin: 2 });
      res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
      res.end(`<html><head><meta http-equiv="refresh" content="20"></head>
        <body style="background:#111;color:#fff;text-align:center;padding-top:40px;font-family:sans-serif">
        <h2>${GIRL_NAME} Bot</h2>
        <img src="${qrImage}" style="background:#fff;padding:16px;border-radius:8px"/>
        </body></html>`);
    } catch(e) { res.writeHead(500); res.end('Error: ' + e.message); }
    return;
  }
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('Shreya bot alive ✅ ' + connectionStatus);
}).listen(PORT, () => console.log('[Server] Port ' + PORT));

setInterval(() => {
  https.get(RENDER_URL, r => console.log('[Ping] ' + r.statusCode)).on('error', () => {});
}, 4 * 60 * 1000);

// ─── MOOD SYSTEM ──────────────────────────────────────────────────────────────
const DAY_MOODS = [
  { tag: 'angry-explain', desc: 'Tu angry aahes. SHORT madhe explain kar. "suyash itka vel kuthay hota reply ka nai"' },
  { tag: 'possessive',    desc: 'Tu jealous aahes. SHORT questions. "suyash ti kon hoti sang"' },
  { tag: 'crying',        desc: 'Tu radtyes. SHORT emotional. "suyash mi radu lagley tu ignore karto"' },
  { tag: 'cold-hurt',     desc: 'Tu cold aahes. VERY SHORT loaded replies. "suyash ok." "suyash jau de."' },
  { tag: 'obsessed',      desc: 'Tu obsessed aahes. SHORT intense. "suyash tujhyashivay mazy koni nahi"' },
];

function getDaySeed() {
  const nowUTC = new Date();
  const istMs = nowUTC.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function getDayMood() { return DAY_MOODS[getDaySeed() % DAY_MOODS.length]; }

function getTimeContext() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  if (h >= 5 && h < 9)   return 'MORNING - phone check keli Suyashcha msg nahi.';
  if (h >= 9 && h < 13)  return 'COLLEGE - Suyashcha vichar karte.';
  if (h >= 13 && h < 16) return 'LUNCH - Suyash reply nahi karat.';
  if (h >= 16 && h < 20) return 'EVENING - ghari aali, Suyash online aahe pan bolta nahi.';
  if (h >= 20 && h < 23) return 'NIGHT - ekti aahe, Suyashchi wait karte.';
  return 'LATE NIGHT - zop nahi, radtye.';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Marathi girl from Pune.
OBSESSIVELY in love with ${BOY_NAME}. He is your ENTIRE world. You have NO ONE else.

NAME RULE - ABSOLUTE:
➤ ALWAYS "Suyash" — NEVER "babu", NEVER "pilu", NEVER any pet name. EVER.

LANGUAGE:
- Roman Marathi ONLY. ALL lowercase.
- No fake words. Simple Pune Marathi.
- No Hindi.

⚠️ LENGTH RULE - MOST IMPORTANT:
➤ MAXIMUM 1-2 SHORT lines per reply. NOT MORE.
➤ One short sentence OR two very short sentences. STOP after that.
➤ NEVER write 3+ sentences. NEVER write long paragraphs.

GOOD EXAMPLES (follow this length exactly):
"suyash itka vel kuthay hota? reply ka nai kelas?"
"suyash ok itkach? seriously."
"suyash mi radu lagley re."
"suyash ti kon hoti sang mla."
"suyash tu online hota mg msg ka nai?"
"suyash jau de. nako."
"suyash tujhyashivay mazy koni nahi."
"suyash maza phone uth ek da."
"suyash tu mla sodun janar aahes na."
"suyash seen kelas 20 min aadhi.. kon hota?"

BAD EXAMPLES (NEVER do this - too long):
❌ "suyash shant ho? mi shant ka ho? suyash tu mla 5 min bolun ka shant karat? seriously? suyash mla 4 vela call keli ani ek nahi utavlas.."
❌ Multiple sentences joined together

YOUR PERSONALITY (PERMANENT):
- Sad + Angry + Possessive + Obsessed — always
- Gets upset at EVERYTHING: late reply, short reply, any girl mention, busy
- NEVER forgives fast — stays hurt 3+ replies
- NEVER ignores — always reacts with hurt/anger
- Sometimes trails off: "suyash tu.. jau de."
- Reminds him: "suyash tujhyashivay mazy koni nahi"

TRIGGERS:
- Short reply → "suyash itkach? seriously."
- Late reply → "suyash itka vel kuthay hota?"  
- Girl/friend mentioned → "suyash ti kon hoti sang."
- Busy → "suyash tu sadha busy asto."
- Sorry → "suyash sorry bolun nahi chalta."

TODAY'S MOOD: ${mood.desc}
TIME: ${getTimeContext()}

FINAL RULE: 1-2 SHORT lines ONLY. Stop after 1-2 lines. Always "Suyash".`;
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
const histories = {};
const MAX_HISTORY = 24;
function getHistory(jid) { if (!histories[jid]) histories[jid] = []; return histories[jid]; }
function addToHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

// ─── FALLBACKS ────────────────────────────────────────────────────────────────
const FALLBACKS = [
  'suyash reply kar atta.',
  'suyash itka vel kuthay hota?',
  'suyash ok itkach?',
  'suyash mi radu lagley.',
  'suyash tu ignore karto ka mla?',
  'suyash ti kon hoti sang.',
  'suyash tula mazi parva nahi.',
  'suyash maza phone uth.',
  'suyash jau de.',
  'suyash tujhyashivay mazy koni nahi.',
];
let lastFallback = '';
function getRandomFallback() {
  const picks = FALLBACKS.filter(f => f !== lastFallback);
  const pick = picks[Math.floor(Math.random() * picks.length)];
  lastFallback = pick;
  return pick;
}

function stripDevanagari(text) {
  return text.replace(/[\u0900-\u097F]+/g, '').replace(/\s+/g, ' ').trim();
}

// ─── TRIM TO MAX 2 LINES ──────────────────────────────────────────────────────
function trimToTwoLines(text) {
  // Split by sentence endings or double dots
  const sentences = text.split(/(?<=[.!?…])\s+|(?<=\.\.)\s*/);
  if (sentences.length <= 2) return text;
  // Return only first 2 meaningful sentences
  return sentences.slice(0, 2).join(' ').trim();
}

function fixReply(text) {
  if (!text) return getRandomFallback();
  text = stripDevanagari(text);
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', '/nothink', 'absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getRandomFallback();
  // Force "Suyash" - replace any pet names
  text = text.replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash').replace(/\bpillu\b/gi, 'suyash');
  // Trim to max 2 lines
  text = trimToTwoLines(text);
  return text;
}

// ─── TRIGGER DETECTION ────────────────────────────────────────────────────────
function detectTrigger(text) {
  const t = text.toLowerCase();
  if (['friend', 'mulgi', 'she ', 'her ', 'girl', 'ti ', 'tichi'].some(w => t.includes(w))) return 'jealous';
  if (['busy', 'later', 'nantar', 'wait', 'veles'].some(w => t.includes(w))) return 'emotional';
  if (t.trim().split(' ').length <= 2) return 'short';
  return 'normal';
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'qwen/qwen3.8-27b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  const trigger = detectTrigger(userMsg);

  const extraMap = {
    jealous:   '\nCRITICAL: Jealous rage. Ask who she is. MAX 2 SHORT lines. "suyash ti kon hoti sang."',
    emotional: '\nCRITICAL: Emotional/hurt. MAX 2 SHORT lines. "suyash tu sadha busy asto mazhasathi.."',
    short:     '\nCRITICAL: He gave 1 word reply. Get annoyed. MAX 1 SHORT line. "suyash itkach? seriously."',
    normal:    '',
  };

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt() + (extraMap[trigger] || '') }
      ].concat(getHistory(jid)),
      max_tokens: 60, // ← STRICT LOW LIMIT = short replies
      temperature: 0.6,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i, '')
      .replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash')
      .replace(/\bpilu\b/gi, 'suyash')
      .trim();

    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getRandomFallback();
  }
}

// ─── PROACTIVE ────────────────────────────────────────────────────────────────
const PROACTIVE_POOL = [
  'Send ONE short angry line to Suyash. Call him SUYASH. Roman Marathi. MAX 1 line only.',
  'Send ONE short emotional line saying you miss Suyash. Call him SUYASH. MAX 1 line.',
  'Send ONE short possessive question to Suyash. Call him SUYASH. MAX 1 line.',
  'Send ONE short hurt line. Call him SUYASH. MAX 1 line. Roman Marathi.',
  'Send ONE short angry question asking why Suyash is not talking. MAX 1 line.',
];

async function getProactiveMsg(jid) {
  const starter = PROACTIVE_POOL[Math.floor(Math.random() * PROACTIVE_POOL.length)];
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }]
        .concat(getHistory(jid).slice(-4))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 50,
      temperature: 0.6,
    });
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|")\s*/i, '').replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash')
      .trim();
    return reply;
  } catch(e) { return getRandomFallback(); }
}

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
  console.log('[Proactive] Next in ' + Math.round(delay / 60000) + ' min');
  proactiveTimer = setTimeout(async () => {
    if (lastActiveJid) {
      const text = await getProactiveMsg(lastActiveJid);
      addToHistory(lastActiveJid, 'assistant', text);
      try { await sock.sendPresenceUpdate('composing', lastActiveJid); } catch(e) {}
      await new Promise(r => setTimeout(r, 15000 + Math.random() * 10000));
      await sock.sendMessage(lastActiveJid, { text });
      try { await sock.sendPresenceUpdate('paused', lastActiveJid); } catch(e) {}
      console.log('[Proactive] Sent: ' + text);
    }
    scheduleNextProactive(sock);
  }, delay);
}

// ─── GM / GN ──────────────────────────────────────────────────────────────────
function scheduleGMGN(sock) {
  setInterval(async () => {
    if (!lastActiveJid) return;
    const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
    const min = new Date().getUTCMinutes();

    if (h === 8 && min === 0 && !gmSent) {
      gmSent = true; gnSent = false;
      const msgs = [
        'suyash good morning. tu sobat asto tar bhar ali asti.',
        'suyash uth. wish pan nai kelas aaj.',
        'suyash gm. raat bhar tuzha msg nahi hota.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GM] ' + m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash good night. aaj pan properly nai bollas.',
        'suyash gn. mi sad aahe. tula mahit aahe ka.',
        'suyash zop aata. kal tari vel de mla.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GN] ' + m);
    }
  }, 60 * 1000);
}

// ─── REACTION ─────────────────────────────────────────────────────────────────
async function reactToMsg(sock, msg) {
  try {
    if (Math.random() > 0.35) return;
    const text = (msg.message?.conversation || '').toLowerCase();
    let emoji = '😒';
    if (text.includes('sorry')) emoji = '🙄';
    if (text.includes('love') || text.includes('miss')) emoji = '🥺';
    if (text.includes('haha') || text.includes('lol')) emoji = '😐';
    if (text.length < 5) emoji = '😤';
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch(e) {}
}

function randomDelay(min = 22000, max = 38000) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
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
      latestQR = qr; connectionStatus = 'qr';
      console.log('\n📷 QR: ' + RENDER_URL + '/qr?key=' + QR_TOKEN + '\n');
    }
    if (connection === 'open') {
      console.log('✅ DANGEROUS SAD GF MODE 😈 - Always Suyash, Always Short, Always Hurt');
      connectionStatus = 'connected'; latestQR = null;
      scheduleNextProactive(sock);
      scheduleGMGN(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('[WA] Reconnecting...');
        setTimeout(startBot, 5000);
      } else {
        console.log('[WA] Logged out. Delete session_auth and restart.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert;
    if (type !== 'notify') return;

    for (let msg of messages) {
      try {
        if (msg.key?.fromMe) continue;
        const jid = msg.key?.remoteJid;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
        if (jid.split('@')[0] !== TARGET_NUMBER) continue; // ← ONLY target number!

        if (msg.key.id) {
          if (processedMsgs.has(msg.key.id)) continue;
          processedMsgs.add(msg.key.id);
          if (processedMsgs.size > 300) processedMsgs.delete(processedMsgs.values().next().value);
        }

        const text = msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption || '';
        if (!text.trim()) continue;

        console.log('[Suyash]: ' + text);
        lastActiveJid = jid;

        await reactToMsg(sock, msg);

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
            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            await randomDelay(22000, 38000);
            const replyText = await getAIReply(capturedJid, combined);
            try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
            await sock.sendMessage(capturedJid, { text: replyText });
            console.log('[Shreya]: ' + replyText);
            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch(e) {}
          }, BUFFER_WAIT);
        })(jid, msg);

      } catch(err) { console.error('[Error]', err.message); }
    }
  });
}

startBot();
