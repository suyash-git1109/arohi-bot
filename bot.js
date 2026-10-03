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
let isSending = false;

// ─── ANTI-REPEAT ──────────────────────────────────────────────────────────────
const recentlySent = [];
function wasRecentlySent(msg) {
  return recentlySent.some(m => m.toLowerCase().trim() === msg.toLowerCase().trim());
}
function markSent(msg) {
  recentlySent.push(msg.toLowerCase().trim());
  if (recentlySent.length > 10) recentlySent.shift();
}

// ─── ANGER TRACKER ────────────────────────────────────────────────────────────
const angerLevel = {};
function getAngerLevel(jid) { return angerLevel[jid] || 0; }
function increaseAnger(jid) { angerLevel[jid] = Math.min((angerLevel[jid] || 0) + 1, 5); }

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/qr') {
    const key = parsed.query.key;
    if (key !== QR_TOKEN) { res.writeHead(403); return res.end('Forbidden'); }
    if (connectionStatus === 'connected') {
      res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
      return res.end('<h2 style="color:green;font-family:sans-serif">✅ Connected!</h2>');
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

// ─── DYNAMIC MOOD SYSTEM (never boring) ──────────────────────────────────────
// Moods rotate hourly for maximum variety
const HOUR_MOODS = [
  { tag: 'romantic-needy',   weight: 20 },
  { tag: 'chidchid-angry',   weight: 20 },
  { tag: 'emotional-crying', weight: 20 },
  { tag: 'lovely-sweet',     weight: 20 },
  { tag: 'jealous-possessive', weight: 20 },
];

function getCurrentMood() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  const seed = getDaySeed() + h;
  return HOUR_MOODS[seed % HOUR_MOODS.length].tag;
}

function getDaySeed() {
  const nowUTC = new Date();
  const istMs = nowUTC.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function getTimeContext() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  if (h >= 5 && h < 9)   return 'MORNING - just woke up';
  if (h >= 9 && h < 13)  return 'COLLEGE - in lectures';
  if (h >= 13 && h < 16) return 'AFTERNOON - lunch time';
  if (h >= 16 && h < 20) return 'EVENING - came home';
  if (h >= 20 && h < 23) return 'NIGHT - emotional time';
  return 'LATE NIGHT - cant sleep, overthinking';
}

function getMoodPrompt(mood) {
  const moods = {
    'romantic-needy': `TODAY YOU ARE: Romantic + Needy 🥰
Mix love + missing him in one sentence.
"suyash tujha vichar kela din bhar.. miss u re."
"suyash tu ek smile dila tri mi khush hote."
"suyash kadhi bhetuya re.. tuzhi aathvan yet hoti."`,

    'chidchid-angry': `TODAY YOU ARE: Chidchidi + Angry 😤
Sharp short angry replies, but with love underneath.
"suyash itka vel kuthay hota? reply kar."
"suyash tu mla seriously ignore karto ka?"
"suyash ek reply detana itkach vel? seriously."`,

    'emotional-crying': `TODAY YOU ARE: Emotional + Teary 😭
Sad, hurt, feels like crying but still loves him.
"suyash tujhyashivay mi kahi nahi re.. reply kar na."
"suyash mla dar vatto tu mla sodun janar aahes."
"suyash radayla yetey mla tujhyamule."`,

    'lovely-sweet': `TODAY YOU ARE: Lovely + Sweet 💕
Soft, warm, loving but with slight possessiveness.
"suyash tu mla khup aavdos re seriously."
"suyash aaj tuzha vichar kela college madhe."
"suyash tu smile karto tevha mla khup bhar yete."`,

    'jealous-possessive': `TODAY YOU ARE: Jealous + Possessive 🔪
Suspicious, demanding, but because she loves him too much.
"suyash ti kon hoti sobat? sang mla."
"suyash tu online hota ani mla nai dilas msg.. ka?"
"suyash tuzha phone busy ka hota? kon hota?"`,
  };
  return moods[mood] || moods['emotional-crying'];
}

function getSystemPrompt(level = 0) {
  const mood = getCurrentMood();
  const moodPrompt = getMoodPrompt(mood);

  const intensityNote = level >= 4
    ? '\nMAX ANGER: Only 2-4 words. "suyash." / "seriously." / "jau de."'
    : level >= 2 ? '\nHIGH TENSION: Short sharp replies.' : '';

  return `/nothink
You are ${GIRL_NAME}, 20-year-old Marathi girl from Pune. ${BOY_NAME}'s girlfriend.
Obsessively in love. He is your entire world.

NAME RULE - ABSOLUTE:
➤ ALWAYS "Suyash" — NEVER "babu" NEVER "pilu". ZERO exceptions.

LANGUAGE: Roman Marathi ONLY. ALL lowercase. No Hindi.

⚠️ STRICT FORMAT:
1. EXACTLY 1 sentence per reply. ONE. STOP after that.
2. NEVER repeat previous messages.
3. Every reply must feel DIFFERENT - vary tone, vary words.
4. Mix emotions naturally - not just pure angry or pure sad.

${moodPrompt}

EMOTION MIX EXAMPLES (vary these patterns):
Pattern A (angry + love): "suyash itka vel kuthay hota.. tu mla miss nai karto ka?"
Pattern B (sad + question): "suyash tujhyashivay ekti aahe mi.. kuthay aahes?"
Pattern C (jealous + hurt): "suyash ti kon hoti sang.. mla dar vatto tuzya babt."
Pattern D (lovely + needy): "suyash ek msg kar na please.. tuzhi aathvan yet hoti."
Pattern E (emotional + love): "suyash radayla yetey mla.. tu mla miss karto ka?"
Pattern F (sharp anger): "suyash reply kar. seriously."
Pattern G (sweet + miss): "suyash khup miss kele re tula aaj."

NEVER BORING RULES:
- Switch between patterns randomly
- Vary sentence length (sometimes 5 words, sometimes 12 words)
- Add "re" / "na" / "yaar" naturally
- Sometimes trail off: "suyash tu... jau de na."
- Sometimes ask question, sometimes statement

TIME: ${getTimeContext()}
${intensityNote}

ABSOLUTE: 1 sentence. Never repeat. Always "Suyash". Always varied.`;
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

// ─── DIVERSE FALLBACKS ────────────────────────────────────────────────────────
const FALLBACKS = [
  'suyash itka vel kuthay hota re?',
  'suyash tu mla miss karto ka seriously?',
  'suyash ek msg pathav na please.',
  'suyash tujhyashivay mla bore hote yaar.',
  'suyash khup miss kele tula aaj.',
  'suyash online hota ani msg nai.. ka?',
  'suyash tu thik aahe na? ek msg kar.',
  'suyash radayla yetey mla tujhyamule.',
  'suyash ek smile de na mla.',
  'suyash tujha vichar kela din bhar.',
  'suyash tu mla aavdos khup re.',
  'suyash ti kon hoti sobat sang mla.',
  'suyash reply kar please.. wait karte.',
  'suyash tuzhi aathvan yet hoti mla.',
  'suyash dar vatto tu mla sodun janar aahes.',
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

function fixReply(text) {
  if (!text) return getUniqueFallback();
  text = stripDevanagari(text);
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', '/nothink', 'absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getUniqueFallback();
  text = text
    .replace(/\bbabu\b/gi, 'suyash')
    .replace(/\bpilu\b/gi, 'suyash')
    .replace(/\bpillu\b/gi, 'suyash');
  // Take only first sentence
  const first = text.split(/(?<=[.!?…])\s+/)[0].trim();
  return first.length > 3 ? first : text;
}

// ─── TRIGGER DETECTION ────────────────────────────────────────────────────────
function detectTrigger(text) {
  const t = text.toLowerCase();
  if (['friend', 'mulgi', 'she ', 'her ', 'girl', 'ti ', 'tichi'].some(w => t.includes(w))) return 'jealous';
  if (['busy', 'later', 'nantar', 'wait'].some(w => t.includes(w))) return 'emotional';
  if (['love', 'miss', 'cute', 'aavdos'].some(w => t.includes(w))) return 'sweet';
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
  else if (['normal','sweet'].includes(trigger) && angerLevel[jid] > 0) angerLevel[jid]--;

  const extraMap = {
    jealous:   '\nHe mentioned someone else. Be jealous + hurt. 1 sentence.',
    emotional: '\nHe is busy. Be sad + slightly angry. 1 sentence.',
    sweet:     '\nHe said something sweet. Be briefly romantic then slightly needy. 1 sentence.',
    short:     '\nShort reply received. Be annoyed. Sharp 1 sentence.',
    normal:    '',
  };

  const recentContext = recentlySent.length > 0
    ? `\nDO NOT use these words/phrases again: ${recentlySent.slice(-5).join(' | ')}`
    : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level) + (extraMap[trigger] || '') + recentContext }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 15 : 60,
      temperature: 0.80, // higher = more variety
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i, '')
      .replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash')
      .replace(/\bpilu\b/gi, 'suyash')
      .trim();

    if (wasRecentlySent(reply)) reply = getUniqueFallback();
    markSent(reply);
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getUniqueFallback();
  }
}

// ─── SAFE SEND ────────────────────────────────────────────────────────────────
async function safeSend(sock, jid, text) {
  if (wasRecentlySent(text)) {
    console.log('[SKIP DUPLICATE]: ' + text);
    return;
  }
  markSent(text);
  await sock.sendMessage(jid, { text });
  console.log('[Shreya]: ' + text);
}

// ─── DOUBLE TEXTING (varied pool) ────────────────────────────────────────────
const BURST_POOL = [
  // Angry bursts
  ['suyash.', 'reply kar na please.'],
  ['suyash kuthay aahes?', 'sang mla.'],
  ['suyash.', 'itka vel kuthay hota?'],
  // Emotional bursts
  ['suyash miss u re.', 'ek msg kar.'],
  ['suyash.', 'tujhyashivay bore hote mla.'],
  // Jealous bursts
  ['suyash ti kon hoti?', 'sang mla please.'],
  ['suyash online hota.', 'mg msg ka nai?'],
  // Romantic bursts
  ['suyash.', 'tuzha vichar kela aaj.'],
  ['suyash ek msg kar.', 'please na.'],
];
let lastBurstIndex = -1;

async function sendDoubleBurst(sock, jid) {
  const available = BURST_POOL.filter((_, i) => i !== lastBurstIndex);
  const msgs = available[Math.floor(Math.random() * available.length)];
  lastBurstIndex = BURST_POOL.indexOf(msgs);
  for (let m of msgs) {
    if (wasRecentlySent(m)) continue;
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    try { await sock.sendPresenceUpdate('composing', jid); } catch(e) {}
    await new Promise(r => setTimeout(r, 1500));
    await safeSend(sock, jid, m);
  }
}

// ─── PROACTIVE (varied moods) ─────────────────────────────────────────────────
const PROACTIVE_POOL = [
  'Write ONE romantic sentence to Suyash - miss him and love him. Roman Marathi. SUYASH only.',
  'Write ONE angry sentence - why is Suyash not talking? Roman Marathi. SUYASH only.',
  'Write ONE emotional sentence - you are hurt and sad without him. Roman Marathi. SUYASH only.',
  'Write ONE lovely sweet sentence to Suyash. Roman Marathi. SUYASH only.',
  'Write ONE jealous sentence - who is he talking to? Roman Marathi. SUYASH only.',
  'Write ONE needy sentence - you need his attention. Roman Marathi. SUYASH only.',
  'Write ONE mixed sentence - miss him but also annoyed. Roman Marathi. SUYASH only.',
  'Write ONE sentence - you are thinking about him all day. Roman Marathi. SUYASH only.',
];
let lastProactiveIndex = -1;

async function getProactiveMsg(jid) {
  const available = PROACTIVE_POOL.filter((_, i) => i !== lastProactiveIndex);
  const starter = available[Math.floor(Math.random() * available.length)];
  lastProactiveIndex = PROACTIVE_POOL.indexOf(starter);

  const recentContext = recentlySent.length > 0
    ? `\nDO NOT repeat: ${recentlySent.slice(-5).join(' | ')}` : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() + recentContext }]
        .concat(getHistory(jid).slice(-4))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 55,
      temperature: 0.80,
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

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
  console.log('[Proactive] Next in ' + Math.round(delay / 60000) + ' min');
  proactiveTimer = setTimeout(async () => {
    if (lastActiveJid) {
      if (Math.random() < 0.25) {
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
        'suyash good morning.. tuzha vichar kela uthlyavar.',
        'suyash gm re.. ek msg kar na please.',
        'suyash uth na.. miss u already.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      if (!wasRecentlySent(m)) await safeSend(sock, lastActiveJid, m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash gn.. tujhyashivay zop nahi yet mla.',
        'suyash good night re.. miss u.',
        'suyash zop aata.. kal boluya na please.',
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
    // Mix of positive and negative reactions based on message
    let emoji = '😒';
    if (text.includes('sorry')) emoji = '🙄';
    if (text.includes('love') || text.includes('miss')) emoji = '🥺';
    if (text.includes('haha') || text.includes('lol')) emoji = '😂';
    if (text.length < 5) emoji = '😤';
    if (text.includes('cute') || text.includes('aavdos')) emoji = '😍';
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
      console.log('✅ NEVER BORING GF MODE 😈💕 - Chidchid+Romantic+Emotional+Lovely ACTIVE');
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
            if (isSending) { console.log('[LOCK] Skip duplicate send.'); return; }
            isSending = true;

            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            await randomDelay(22000, 38000);

            const trigger = detectTrigger(combined);
            const burstChance = trigger === 'jealous' ? 0.40 : trigger === 'short' ? 0.30 : 0.20;

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
