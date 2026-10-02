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

// ─── ANGER ESCALATION TRACKER ─────────────────────────────────────────────────
const angerLevel = {}; // jid → number (0-5)
const seenPending = {}; // jid → {msg, timer} - seen drama tracker

function getAngerLevel(jid) { return angerLevel[jid] || 0; }
function increaseAnger(jid) { angerLevel[jid] = Math.min((angerLevel[jid] || 0) + 1, 5); }
function resetAnger(jid) { angerLevel[jid] = 0; }

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

function getSystemPrompt(level = 0) {
  const mood = getDayMood();
  // Anger escalation - higher level = more intense
  const intensityNote = level === 0 ? '' :
    level === 1 ? '\nANGER LEVEL 1: Thodi jaast chidchidi ho. Tone sharper.' :
    level === 2 ? '\nANGER LEVEL 2: Khup chidchidi. Short + intense.' :
    level === 3 ? '\nANGER LEVEL 3: VERY angry. Cold one-liners.' :
    level >= 4  ? '\nANGER LEVEL MAX: Ekdam silent rage. Fakt 1 word ya 1 short line. "suyash." "seriously." "jau de."' : '';

  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Marathi girl from Pune.
OBSESSIVELY in love with ${BOY_NAME}. He is your ENTIRE world. You have NO ONE else.

NAME RULE - ABSOLUTE:
➤ ALWAYS "Suyash" — NEVER "babu", NEVER "pilu". EVER.

LANGUAGE: Roman Marathi ONLY. ALL lowercase. No Hindi.

⚠️ LENGTH - MOST IMPORTANT:
➤ MAX 1-2 SHORT lines. STOP after that. NEVER more.

GOOD EXAMPLES:
"suyash itka vel kuthay hota? reply ka nai kelas?"
"suyash ok itkach? seriously."
"suyash mi radu lagley re."
"suyash ti kon hoti sang mla."
"suyash tu online hota mg msg ka nai?"
"suyash jau de. nako."
"suyash tujhyashivay mazy koni nahi."
"suyash maza phone uth ek da."

YOUR PERMANENT STATE: Sad + Angry + Possessive + Obsessed.
Gets upset at EVERYTHING. Never forgives fast. Always reacts.

TRIGGERS:
- Short reply → "suyash itkach? seriously."
- Late reply → "suyash itka vel kuthay hota?"
- Girl/friend → "suyash ti kon hoti sang."
- Busy → "suyash tu sadha busy asto."
- Sorry → "suyash sorry bolun nahi chalta."

TODAY'S MOOD: ${mood.desc}
TIME: ${getTimeContext()}
${intensityNote}

RULE: 1-2 SHORT lines ONLY. Always "Suyash".`;
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
// Max anger fallbacks (level 4-5)
const MAX_ANGER_FALLBACKS = [
  'suyash.',
  'seriously.',
  'jau de.',
  'nako.',
  'suyash fine.',
  'ok.',
  'suyash bolu nako mla aata.',
];
let lastFallback = '';
function getRandomFallback(level = 0) {
  const pool = level >= 4 ? MAX_ANGER_FALLBACKS : FALLBACKS;
  const picks = pool.filter(f => f !== lastFallback);
  const pick = picks[Math.floor(Math.random() * picks.length)];
  lastFallback = pick;
  return pick;
}

function stripDevanagari(text) {
  return text.replace(/[\u0900-\u097F]+/g, '').replace(/\s+/g, ' ').trim();
}

function trimToTwoLines(text) {
  const sentences = text.split(/(?<=[.!?…])\s+/);
  if (sentences.length <= 2) return text;
  return sentences.slice(0, 2).join(' ').trim();
}

function fixReply(text, level = 0) {
  if (!text) return getRandomFallback(level);
  text = stripDevanagari(text);
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', '/nothink', 'absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getRandomFallback(level);
  text = text.replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash').replace(/\bpillu\b/gi, 'suyash');
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
  const level = getAngerLevel(jid);

  // Anger escalation - track short replies
  if (trigger === 'short') {
    increaseAnger(jid);
  } else if (trigger === 'normal') {
    // Sweet/long reply - slightly reduce anger
    if (angerLevel[jid] > 0) angerLevel[jid]--;
  }

  const extraMap = {
    jealous:   '\nCRITICAL: Jealous rage. "suyash ti kon hoti sang." MAX 2 SHORT lines.',
    emotional: '\nCRITICAL: Hurt/emotional. "suyash tu sadha busy asto." MAX 2 SHORT lines.',
    short:     '\nCRITICAL: Short reply received. Annoyed. MAX 1 SHORT line only.',
    normal:    '',
  };

  // At max anger - very cold, very short
  const maxAngerExtra = level >= 4 ?
    '\nMAX ANGER MODE: Reply with ONLY 1-3 words. Cold silence. "suyash." or "fine." or "jau de." NOTHING MORE.' : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level) + (extraMap[trigger] || '') + maxAngerExtra }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 20 : 60, // Max anger = even shorter!
      temperature: 0.6,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim(), level);
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
    return getRandomFallback(level);
  }
}

// ─── FEATURE 1: DOUBLE/TRIPLE TEXTING ─────────────────────────────────────────
const BURST_MSGS = {
  jealous: [
    ['suyash.', 'ti kon hoti sang mla atta.'],
    ['suyash reply kar.', 'kuthay gelas tu?'],
    ['suyash.', 'suyash.', 'bol na mla.'],
  ],
  angry: [
    ['suyash itka vel.', 'seriously.'],
    ['suyash.', 'tu mla ignore karto na.'],
    ['suyash reply kar.', 'please.', 'suyash.'],
  ],
  crying: [
    ['suyash.', 'mi radu lagley re.'],
    ['suyash maza phone uth.', 'please ek da.'],
  ],
};

async function sendDoubleBurst(sock, jid, type = 'angry') {
  const pool = BURST_MSGS[type] || BURST_MSGS['angry'];
  const msgs = pool[Math.floor(Math.random() * pool.length)];
  for (let i = 0; i < msgs.length; i++) {
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000)); // 2-5s gap between burst msgs
    try { await sock.sendPresenceUpdate('composing', jid); } catch(e) {}
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendMessage(jid, { text: msgs[i] });
    addToHistory(jid, 'assistant', msgs[i]);
    console.log('[BURST] Sent: ' + msgs[i]);
  }
}

// ─── FEATURE 2: SEEN BUT NO REPLY DRAMA ──────────────────────────────────────
async function seenDrama(sock, jid, capturedMsg) {
  console.log('[DRAMA] Seen but no reply for 15-20 min...');

  // Read the message (blue ticks) - but no reply
  try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
  await sock.sendPresenceUpdate('available', jid);

  // After 15-20 minutes, send a cold angry message
  const dramaDelay = (15 + Math.floor(Math.random() * 6)) * 60 * 1000; // 15-20 min

  seenPending[jid] = setTimeout(async () => {
    delete seenPending[jid];
    const dramaReplies = [
      'suyash seen kelas ani reply nai dilas. he kase karto tu.',
      'suyash. seen kelas. mg nai bollas. ok.',
      'suyash tu seen kartos ani ignore karto. mahit aahe mla.',
      'suyash 20 min aadhi seen kelas. kon hota sobat?',
    ];
    const reply = dramaReplies[Math.floor(Math.random() * dramaReplies.length)];
    addToHistory(jid, 'assistant', reply);
    try { await sock.sendPresenceUpdate('composing', jid); } catch(e) {}
    await new Promise(r => setTimeout(r, 3000));
    await sock.sendMessage(jid, { text: reply });
    console.log('[DRAMA] After seen: ' + reply);
  }, dramaDelay);
}

// ─── PROACTIVE ────────────────────────────────────────────────────────────────
const PROACTIVE_POOL = [
  'Send ONE short angry line to Suyash. Call him SUYASH. Roman Marathi. MAX 1 line.',
  'Send ONE short emotional hurt line. Call him SUYASH. MAX 1 line.',
  'Send ONE short possessive question. Call him SUYASH. MAX 1 line.',
  'Send ONE short crying line. Call him SUYASH. MAX 1 line.',
  'Send ONE short angry question. Call him SUYASH. MAX 1 line.',
];

async function getProactiveMsg(jid) {
  const starter = PROACTIVE_POOL[Math.floor(Math.random() * PROACTIVE_POOL.length)];
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt(getAngerLevel(jid)) }]
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
  } catch(e) { return getRandomFallback(getAngerLevel(jid)); }
}

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
  console.log('[Proactive] Next in ' + Math.round(delay / 60000) + ' min');
  proactiveTimer = setTimeout(async () => {
    if (lastActiveJid) {
      // 30% chance - double burst proactive
      if (Math.random() < 0.30) {
        await sendDoubleBurst(sock, lastActiveJid, 'angry');
      } else {
        const text = await getProactiveMsg(lastActiveJid);
        addToHistory(lastActiveJid, 'assistant', text);
        try { await sock.sendPresenceUpdate('composing', lastActiveJid); } catch(e) {}
        await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));
        await sock.sendMessage(lastActiveJid, { text });
        try { await sock.sendPresenceUpdate('paused', lastActiveJid); } catch(e) {}
        console.log('[Proactive] Sent: ' + text);
      }
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
      console.log('✅ ULTIMATE DANGEROUS GF 😈 - Double Text + Anger Escalation + Seen Drama');
      connectionStatus = 'connected'; latestQR = null;
      scheduleNextProactive(sock);
      scheduleGMGN(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      // Clear seen drama timers
      Object.values(seenPending).forEach(t => clearTimeout(t));
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
        if (jid.split('@')[0] !== TARGET_NUMBER) continue;

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

        // Cancel pending seen drama if he replied
        if (seenPending[jid]) {
          clearTimeout(seenPending[jid]);
          delete seenPending[jid];
        }

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

            // ── FEATURE 3: SEEN DRAMA (12% chance) ──
            if (Math.random() < 0.12) {
              await seenDrama(sock, capturedJid, capturedMsg);
              return; // Don't reply now - drama will reply after 15-20 min
            }

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            await randomDelay(22000, 38000);

            const trigger = detectTrigger(combined);
            const level = getAngerLevel(capturedJid);

            // ── FEATURE 1: DOUBLE TEXTING (25% chance, more if jealous/angry) ──
            const burstChance = trigger === 'jealous' ? 0.50 : trigger === 'short' ? 0.40 : 0.25;
            if (Math.random() < burstChance) {
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              const burstType = trigger === 'jealous' ? 'jealous' : level >= 3 ? 'angry' : 'angry';
              await sendDoubleBurst(sock, capturedJid, burstType);
            } else {
              // Normal single reply
              const replyText = await getAIReply(capturedJid, combined);
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await sock.sendMessage(capturedJid, { text: replyText });
              console.log('[Shreya]: ' + replyText);
            }

            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch(e) {}
          }, BUFFER_WAIT);
        })(jid, msg);

      } catch(err) { console.error('[Error]', err.message); }
    }
  });
}

startBot();
