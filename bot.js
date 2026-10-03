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
let isSending = false; // ← ANTI-DUPLICATE LOCK

// ─── ANTI-REPEAT: Track last 8 sent messages ─────────────────────────────────
const recentlySent = [];
function wasRecentlySent(msg) {
  return recentlySent.some(m => m.toLowerCase() === msg.toLowerCase().trim());
}
function markSent(msg) {
  recentlySent.push(msg.toLowerCase().trim());
  if (recentlySent.length > 8) recentlySent.shift();
}

// ─── ANGER ESCALATION ─────────────────────────────────────────────────────────
const angerLevel = {};
function getAngerLevel(jid) { return angerLevel[jid] || 0; }
function increaseAnger(jid) { angerLevel[jid] = Math.min((angerLevel[jid] || 0) + 1, 5); }

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
  'angry-romantic',
  'jealous-sad',
  'possessive-hurt',
  'crying-angry',
  'cold-obsessed',
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
  if (h >= 5 && h < 9)   return 'MORNING';
  if (h >= 9 && h < 13)  return 'COLLEGE TIME';
  if (h >= 13 && h < 16) return 'AFTERNOON';
  if (h >= 16 && h < 20) return 'EVENING';
  if (h >= 20 && h < 23) return 'NIGHT - most emotional time';
  return 'LATE NIGHT - very emotional, cant sleep';
}

function getSystemPrompt(level = 0) {
  const mood = getDayMood();

  const intensityNote = level >= 4
    ? '\nMAX ANGER: Only 1-3 words. "suyash." / "jau de." / "fine."'
    : level >= 2
    ? '\nHIGH ANGER: Very short, very sharp.'
    : '';

  return `/nothink
You are ${GIRL_NAME}, 20-year-old Marathi girl from Pune. ${BOY_NAME}'s girlfriend.
You are obsessively, dangerously in love. He is your entire world. Without him you are nothing.

NAME RULE - ABSOLUTE:
➤ ALWAYS "Suyash" — NEVER "babu" NEVER "pilu". ZERO exceptions.

LANGUAGE: Roman Marathi ONLY. ALL lowercase. No Hindi. Simple words only.

⚠️ MOST IMPORTANT RULES:
1. MAX 1 SHORT sentence per reply. ONE sentence. STOP.
2. NEVER repeat what you said before. Every reply must be DIFFERENT.
3. MIX emotions in ONE sentence - sad + angry + romantic + jealous together.
4. DO NOT send pure sad OR pure angry - always MIX.

MIXED EMOTION EXAMPLES (follow this style EXACTLY):
"suyash tu mla miss karto ka re.. ki mi ektich aste tujhyashivay?"
"suyash itka vel kuthay hota, tula mazi ek teri parva nahi ka?"
"suyash tu online hota ani mla nai dilas msg.. ti hoti ka sobat?"
"suyash mla dar vatto tu mla sodun janar aahes.. reply kar na."
"suyash tujhyashivay mi kahi nahi re.. mg ignore ka karto tu mla?"
"suyash tu ek msg kelas tri mla itki bhar ali asti."
"suyash mla mahit aahe tu busy hota.. pan mla pan vel de na kabhi kabhi."
"suyash khup miss kele tula aaj.. ani tu reply ch nai kelas."

TODAY'S MOOD: ${mood}
TIME: ${getTimeContext()}
${intensityNote}

STRICT:
- ONE sentence MAX
- NEVER repeat previous messages
- Always MIXED emotions (not pure angry, not pure sad)
- Always "Suyash"`;
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
const histories = {};
const MAX_HISTORY = 20;
function getHistory(jid) { if (!histories[jid]) histories[jid] = []; return histories[jid]; }
function addToHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

// ─── DIVERSE FALLBACKS (no repeats) ──────────────────────────────────────────
const FALLBACKS = [
  'suyash itka vel kuthay hota re?',
  'suyash tu mla miss karto ka seriously?',
  'suyash online hota ani msg nai.. ti hoti ka?',
  'suyash mla dar vatto tu mla sodun janar aahes.',
  'suyash ek reply dilas tri khup bhar ali asti.',
  'suyash tujhyashivay mi kahi nahi.. reply kar na.',
  'suyash khup miss kele tula aaj yaar.',
  'suyash tu thik aahe na? reply kar please.',
  'suyash mla tuzhi aathvan yet hoti itka vel.',
  'suyash ek msg pathav na please.. ektich aahe mi.',
  'suyash tu mla veles deto ka seriously bol.',
  'suyash radayla yetey mla tujhyashivay.',
];
let fallbackIndex = 0;
function getUniqueFallback() {
  const f = FALLBACKS[fallbackIndex % FALLBACKS.length];
  fallbackIndex++;
  return f;
}

function stripDevanagari(text) {
  return text.replace(/[\u0900-\u097F]+/g, '').replace(/\s+/g, ' ').trim();
}

function fixReply(text, level = 0) {
  if (!text) return getUniqueFallback();
  text = stripDevanagari(text);
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', '/nothink', 'absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getUniqueFallback();
  // Force replace pet names
  text = text
    .replace(/\bbabu\b/gi, 'suyash')
    .replace(/\bpilu\b/gi, 'suyash')
    .replace(/\bpillu\b/gi, 'suyash');
  // Take only FIRST sentence
  const firstSentence = text.split(/[.!?…]/)[0].trim();
  return firstSentence.length > 3 ? firstSentence + '.' : text;
}

// ─── TRIGGER DETECTION ────────────────────────────────────────────────────────
function detectTrigger(text) {
  const t = text.toLowerCase();
  if (['friend', 'mulgi', 'she ', 'her ', 'girl', 'ti ', 'tichi'].some(w => t.includes(w))) return 'jealous';
  if (['busy', 'later', 'nantar', 'wait'].some(w => t.includes(w))) return 'emotional';
  if (t.trim().split(' ').length <= 2) return 'short';
  return 'normal';
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'qwen/qwen3.8-27b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  const trigger = detectTrigger(userMsg);
  const level = getAngerLevel(jid);

  if (trigger === 'short') increaseAnger(jid);
  else if (trigger === 'normal' && angerLevel[jid] > 0) angerLevel[jid]--;

  const extraMap = {
    jealous:   '\nShe is jealous. Mix jealous + sad + hurt in ONE sentence.',
    emotional: '\nShe is hurt he is busy. Mix sad + angry in ONE sentence.',
    short:     '\nHe gave short reply. Mix annoyed + hurt in ONE sentence.',
    normal:    '',
  };

  // Add recent messages to avoid repeating
  const recentContext = recentlySent.length > 0
    ? `\nDO NOT repeat these recent messages: ${recentlySent.slice(-4).join(' | ')}`
    : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level) + (extraMap[trigger] || '') + recentContext }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 15 : 55,
      temperature: 0.75, // slightly higher for more variety
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim(), level);
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i, '')
      .replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash')
      .replace(/\bpilu\b/gi, 'suyash')
      .trim();

    // Anti-repeat: if same msg, get fallback
    if (wasRecentlySent(reply)) {
      reply = getUniqueFallback();
    }

    markSent(reply);
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getUniqueFallback();
  }
}

// ─── SAFE SEND (prevents duplicate sends) ─────────────────────────────────────
async function safeSend(sock, jid, text) {
  if (wasRecentlySent(text)) {
    console.log('[SKIP] Duplicate prevented: ' + text);
    return;
  }
  markSent(text);
  await sock.sendMessage(jid, { text });
  console.log('[Shreya]: ' + text);
}

// ─── DOUBLE TEXTING ────────────────────────────────────────────────────────────
const BURST_POOL = [
  ['suyash.', 'reply kar na please.'],
  ['suyash kuthay aahes?', 'sang mla.'],
  ['suyash.', 'tujhyashivay mi kahi nahi re.'],
  ['suyash miss kele tula.', 'reply kar.'],
  ['suyash ti kon hoti?', 'sang mla please.'],
  ['suyash.', 'itka vel kuthay hota?'],
];
let lastBurstIndex = -1;

async function sendDoubleBurst(sock, jid) {
  const available = BURST_POOL.filter((_, i) => i !== lastBurstIndex);
  const msgs = available[Math.floor(Math.random() * available.length)];
  lastBurstIndex = BURST_POOL.indexOf(msgs);

  for (let i = 0; i < msgs.length; i++) {
    if (wasRecentlySent(msgs[i])) continue; // skip if duplicate
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    try { await sock.sendPresenceUpdate('composing', jid); } catch(e) {}
    await new Promise(r => setTimeout(r, 1500));
    await safeSend(sock, jid, msgs[i]);
  }
}

// ─── PROACTIVE ────────────────────────────────────────────────────────────────
const PROACTIVE_POOL = [
  'Write ONE mixed-emotion sentence to Suyash. Mix sad + angry + miss together. Roman Marathi. Call him SUYASH.',
  'Write ONE sentence showing you miss Suyash but are also angry he is not talking. Roman Marathi. SUYASH only.',
  'Write ONE short sentence - you are hurt AND possessive. Mix both. Roman Marathi. SUYASH.',
  'Write ONE sentence - you love him but he ignores you and it hurts. Roman Marathi. SUYASH.',
  'Write ONE jealous + sad sentence to Suyash. Roman Marathi. SUYASH only.',
  'Write ONE sentence - you are crying because Suyash is not talking. Also slightly angry. Roman Marathi.',
];
let lastProactiveIndex = -1;

async function getProactiveMsg(jid) {
  const available = PROACTIVE_POOL.filter((_, i) => i !== lastProactiveIndex);
  const starter = available[Math.floor(Math.random() * available.length)];
  lastProactiveIndex = PROACTIVE_POOL.indexOf(starter);

  const recentContext = recentlySent.length > 0
    ? `\nDO NOT repeat: ${recentlySent.slice(-4).join(' | ')}`
    : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() + recentContext }]
        .concat(getHistory(jid).slice(-4))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 55,
      temperature: 0.75,
    });
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|")\s*/i, '').replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash')
      .trim();

    if (wasRecentlySent(reply)) reply = getUniqueFallback();
    return reply;
  } catch(e) { return getUniqueFallback(); }
}

let proactiveTimer = null;

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
  console.log('[Proactive] Next in ' + Math.round(delay / 60000) + ' min');
  proactiveTimer = setTimeout(async () => {
    if (lastActiveJid) {
      if (Math.random() < 0.30) {
        await sendDoubleBurst(sock, lastActiveJid);
      } else {
        const text = await getProactiveMsg(lastActiveJid);
        addToHistory(lastActiveJid, 'assistant', text);
        try { await sock.sendPresenceUpdate('composing', lastActiveJid); } catch(e) {}
        await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));
        await safeSend(sock, lastActiveJid, text);
        try { await sock.sendPresenceUpdate('paused', lastActiveJid); } catch(e) {}
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
        'suyash good morning.. tujhyashivay raat khup motha vatle.',
        'suyash uth na, ek msg kar please.',
        'suyash gm.. tuzha vichar kela raat bhar.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      if (!wasRecentlySent(m)) await safeSend(sock, lastActiveJid, m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash gn.. aaj pan ekti zopte mi tujhyashivay.',
        'suyash tujhyashivay zop nahi yet.. good night.',
        'suyash gn. kal tari bhetuyat na please.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      if (!wasRecentlySent(m)) await safeSend(sock, lastActiveJid, m);
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
      console.log('✅ ANTI-REPEAT + MIXED EMOTION GF MODE 😈💔');
      connectionStatus = 'connected'; latestQR = null;
      scheduleNextProactive(sock);
      scheduleGMGN(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
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

        await reactToMsg(sock, msg);

        if (msgBuffer[jid]) {
          clearTimeout(msgBuffer[jid].timer);
          msgBuffer[jid].msgs.push(text);
        } else {
          msgBuffer[jid] = { msgs: [text] };
        }

        ((capturedJid, capturedMsg) => {
          msgBuffer[capturedJid].timer = setTimeout(async () => {
            if (isSending) {
              console.log('[LOCK] Already sending, skip.');
              return;
            }
            isSending = true;

            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            await randomDelay(22000, 38000);

            const trigger = detectTrigger(combined);
            const burstChance = trigger === 'jealous' ? 0.45 : trigger === 'short' ? 0.30 : 0.20;

            if (Math.random() < burstChance) {
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await sendDoubleBurst(sock, capturedJid);
            } else {
              const replyText = await getAIReply(capturedJid, combined);
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await safeSend(sock, capturedJid, replyText);
            }

            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch(e) {}
            isSending = false;
          }, BUFFER_WAIT);
        })(jid, msg);

      } catch(err) {
        console.error('[Error]', err.message);
        isSending = false;
      }
    }
  });
}

startBot();
