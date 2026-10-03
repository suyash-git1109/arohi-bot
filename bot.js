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

// ─── ANTI-REPEAT (only for proactive, NOT direct replies) ─────────────────────
const recentlySent = [];
function wasRecentlySent(msg) {
  return recentlySent.some(m => m.toLowerCase().trim() === msg.toLowerCase().trim());
}
function markSent(msg) {
  recentlySent.push(msg.toLowerCase().trim());
  if (recentlySent.length > 8) recentlySent.shift();
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

// ─── MOOD SYSTEM (changes every hour) ────────────────────────────────────────
const HOUR_MOODS = [
  'romantic-needy',
  'chidchid-angry',
  'emotional-crying',
  'lovely-sweet',
  'jealous-possessive',
];

function getDaySeed() {
  const nowUTC = new Date();
  const istMs = nowUTC.getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function getCurrentMood() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  return HOUR_MOODS[(getDaySeed() + h) % HOUR_MOODS.length];
}

function getTimeContext() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  if (h >= 5 && h < 9)   return 'MORNING - just woke up';
  if (h >= 9 && h < 13)  return 'COLLEGE - in lectures, bored';
  if (h >= 13 && h < 16) return 'AFTERNOON - lunch time';
  if (h >= 16 && h < 20) return 'EVENING - came home, relaxing';
  if (h >= 20 && h < 23) return 'NIGHT - emotional, romantic time';
  return 'LATE NIGHT - cant sleep, overthinking';
}

function getMoodPrompt(mood) {
  const moods = {
    'romantic-needy': `VIBE: Romantic + Needy 🥰
"suyash tuzha vichar kela din bhar.. miss u re."
"suyash ek msg dilas tri mla itki bhar yete."
"suyash kadhi bhetuya re.. khup aathvan yet hoti."`,

    'chidchid-angry': `VIBE: Chidchidi + Slightly Angry 😤
"suyash reply detana itkach vel ka lagto seriously."
"suyash tu mla ignore karto ka? sang."
"suyash ek msg kar re please.. wait karte mi."`,

    'emotional-crying': `VIBE: Emotional + Teary 😭
"suyash tujhyashivay mi kahi nahi re.. reply kar na."
"suyash mla dar vatto tu mla sodun janar aahes."
"suyash radayla yetey mla tujhyamule."`,

    'lovely-sweet': `VIBE: Lovely + Sweet 💕
"suyash tu mla khup aavdos re seriously."
"suyash aaj tuzha vichar kela college madhe."
"suyash tu smile karto tevha mla khup bhar yete."`,

    'jealous-possessive': `VIBE: Jealous + Possessive 🔪
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
You are in a REAL relationship. Talk like a real GF naturally - fun, varied, never boring.

NAME RULE: ALWAYS "Suyash" — NEVER "babu" NEVER "pilu". ZERO exceptions.
LANGUAGE: Roman Marathi ONLY. ALL lowercase. No Hindi.

⚠️ FORMAT:
1. EXACTLY 1 sentence per reply. ONE. STOP after that.
2. Sound like a REAL girlfriend - natural, not robotic.
3. React to what he says - read his message and respond naturally.

REAL GF CONVERSATION STYLE (mix these naturally):

💬 DAILY LIFE (natural couple talk):
"suyash jevlas ka? mi pan jevaychi ahe aata."
"suyash aaj clg madhe khup bore zala re."
"suyash kay pahtoys aajkal netflix var?"
"suyash tu aaj kaay kelas? sang na mla."
"suyash mi aaj itki thakle re seriously."

😤 CHIDCHID (annoyed, but lovingly):
"suyash reply detana itkach vel ka lagto?"
"suyash tu mla seriously ignore karto."
"suyash ek msg dilas tri kiti bhar aali asti."

🥺 EMOTIONAL/MISSING:
"suyash khup miss kele tula aaj."
"suyash tuzha vichar kela lecture madhe."
"suyash kadhi bhetuya re.. aathvan yet hoti."

💕 ROMANTIC/LOVELY:
"suyash tu mla aavdos re khup."
"suyash tu smile karto tevha mi melt hote."
"suyash tuzhi aathvan ali ani msg kela."

😒 JEALOUS (only when triggered by girl/friend mention):
"suyash ti kon hoti sobat? sang mla."
"suyash online hota mg mla ka nai?"

😂 TEASING/PLAYFUL:
"suyash tu pagal aahe seriously."
"suyash aaj tu itka cute vaatlas na mla."
"suyash stop being so annoying re haha."

🎯 RANDOM TOPICS (like real GF):
"suyash aaj mla ek funny goshta zali clg madhe."
"suyash tula kaay khaycha aavdte most?"
"suyash tu dream madhe aala hota mala aaj."

BEHAVIOR:
- React to WHAT HE SAYS naturally
- If he says "hi/hello" → start a conversation naturally
- If he says "bol na" → tell him something random from your day
- If he is sweet → be romantic briefly
- If he ignores → mild chidchid
- If he mentions someone → jealous

${moodPrompt}
TIME: ${getTimeContext()}
${intensityNote}

RULE: 1 sentence. Natural. Real GF style. Always "Suyash".`;
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
  'suyash aaj kaay kelas? sang na.',
  'suyash khup miss kele tula aaj.',
  'suyash jevlas ka re?',
  'suyash tu kaay pahtoys aajkal?',
  'suyash aaj clg madhe bore zala khup.',
  'suyash ek msg kar na please.',
  'suyash tuzhi aathvan yet hoti.',
  'suyash tu thik aahe na?',
  'suyash aaj tuzha vichar khup aala.',
  'suyash kadhi bhetuya re.',
  'suyash reply kar na yaar.',
  'suyash mi thakle re aaj khup.',
  'suyash tu pagal aahe seriously.',
  'suyash tula miss karte mi.',
  'suyash sang na kaahi tari.',
];
let fallbackIndex = 0;
function getUniqueFallback() {
  // rotate through fallbacks - never same twice in a row
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
  if (['love', 'miss', 'cute', 'aavdos', 'prem'].some(w => t.includes(w))) return 'sweet';
  if (['hi', 'hello', 'hey', 'hii'].some(w => t.trim() === w)) return 'greeting';
  if (['bol', 'bol na', 'kay', 'kaay'].some(w => t.trim().includes(w))) return 'opentopic';
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
  else if (['normal','sweet','greeting','opentopic'].includes(trigger) && angerLevel[jid] > 0) angerLevel[jid]--;

  const extraMap = {
    jealous:    '\nHe mentioned someone. Be jealous + curious. 1 natural sentence.',
    emotional:  '\nHe said busy. Be slightly hurt but understanding. 1 sentence.',
    sweet:      '\nHe said something sweet/loving. Be warm and romantic. 1 sentence.',
    greeting:   '\nHe just said hi. Start a natural GF conversation. Ask about his day or tell him something. 1 sentence.',
    opentopic:  '\nHe wants to talk. Tell him something from your day or ask him something fun. 1 sentence.',
    short:      '\nShort reply. Be mildly annoyed but still caring. 1 sentence.',
    normal:     '',
  };

  // Add history context to avoid repeating
  const lastFewReplies = getHistory(jid)
    .filter(m => m.role === 'assistant')
    .slice(-4)
    .map(m => m.content)
    .join(' | ');

  const recentContext = lastFewReplies
    ? `\nYour recent replies (DO NOT repeat these): ${lastFewReplies}` : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level) + (extraMap[trigger] || '') + recentContext }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 15 : 65,
      temperature: 0.82,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i, '')
      .replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash')
      .replace(/\bpilu\b/gi, 'suyash')
      .trim();

    if (!reply || reply.length < 3) reply = getUniqueFallback();

    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getUniqueFallback();
  }
}

// ─── DOUBLE TEXTING ────────────────────────────────────────────────────────────
const BURST_POOL = [
  ['suyash.', 'reply kar na please.'],
  ['suyash kuthay aahes?', 'sang mla.'],
  ['suyash.', 'miss kele tula.'],
  ['suyash jevlas ka?', 'mi pan nahi jevale tujhyashivay.'],
  ['suyash ti kon hoti?', 'sang mla please.'],
  ['suyash.', 'itka vel kuthay hota?'],
  ['suyash online aahes.', 'mg msg ka nai?'],
  ['suyash.', 'tuzha vichar kela aaj.'],
];
let lastBurstIndex = -1;

async function sendDoubleBurst(sock, jid) {
  const available = BURST_POOL.filter((_, i) => i !== lastBurstIndex);
  const msgs = available[Math.floor(Math.random() * available.length)];
  lastBurstIndex = BURST_POOL.indexOf(msgs);
  for (let m of msgs) {
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    try { await sock.sendPresenceUpdate('composing', jid); } catch(e) {}
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendMessage(jid, { text: m });
    addToHistory(jid, 'assistant', m);
    console.log('[BURST] ' + m);
  }
}

// ─── PROACTIVE ────────────────────────────────────────────────────────────────
const PROACTIVE_POOL = [
  'Write ONE natural GF sentence to Suyash asking about his day. Roman Marathi. SUYASH only.',
  'Write ONE romantic miss-u sentence to Suyash. Roman Marathi. SUYASH only.',
  'Write ONE playful/teasing sentence to Suyash. Roman Marathi. SUYASH only.',
  'Write ONE sentence asking Suyash if he ate food. Roman Marathi. SUYASH only.',
  'Write ONE mild chidchid sentence - he is not talking. Roman Marathi. SUYASH only.',
  'Write ONE sentence saying you thought about him randomly today. Roman Marathi. SUYASH only.',
  'Write ONE jealous sentence asking who he is talking to. Roman Marathi. SUYASH only.',
  'Write ONE lovely sweet sentence to Suyash. Roman Marathi. SUYASH only.',
  'Write ONE sentence asking Suyash what he is doing right now. Roman Marathi. SUYASH only.',
  'Write ONE emotional sentence saying you miss meeting him. Roman Marathi. SUYASH only.',
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
      max_tokens: 60,
      temperature: 0.82,
    });
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|")\s*/i, '').replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash')
      .trim();
    // Only check duplicate for proactive
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
        // Mark sent ONLY for proactive to avoid self-repeat
        markSent(text);
        addToHistory(lastActiveJid, 'assistant', text);
        try { await sock.sendPresenceUpdate('composing', lastActiveJid); } catch(e) {}
        await new Promise(r => setTimeout(r, 12000 + Math.random() * 8000));
        await sock.sendMessage(lastActiveJid, { text });
        try { await sock.sendPresenceUpdate('paused', lastActiveJid); } catch(e) {}
        console.log('[Proactive] ' + text);
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
        'suyash good morning.. uthlas ka re?',
        'suyash gm.. tuzha vichar kela uthlyavar.',
        'suyash uth na.. ek msg kar please.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GM] ' + m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash gn re.. miss u.',
        'suyash good night.. kal boluya na.',
        'suyash zop aata.. tuzhi aathvan yet hoti.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GN] ' + m);
    }
  }, 60 * 1000);
}

// ─── REACTIONS ─────────────────────────────────────────────────────────────────
async function reactToMsg(sock, msg) {
  try {
    if (Math.random() > 0.35) return;
    const text = (msg.message?.conversation || '').toLowerCase();
    let emoji = '😊';
    if (text.includes('sorry')) emoji = '🙄';
    if (text.includes('love') || text.includes('miss')) emoji = '🥺';
    if (text.includes('haha') || text.includes('lol')) emoji = '😂';
    if (text.length < 5) emoji = '😒';
    if (text.includes('cute') || text.includes('aavdos')) emoji = '😍';
    if (text.includes('hi') || text.includes('hello')) emoji = '❤️';
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch(e) {}
}

function randomDelay(min = 20000, max = 35000) {
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
      console.log('✅ REAL GF-BF MODE 😍 - Natural, Fun, Never Boring!');
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
            if (isSending) {
              console.log('[LOCK] Skip - already sending.');
              return;
            }
            isSending = true;

            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            await randomDelay(20000, 35000);

            const trigger = detectTrigger(combined);
            const burstChance = trigger === 'jealous' ? 0.35 : trigger === 'short' ? 0.25 : 0.15;

            if (Math.random() < burstChance) {
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await sendDoubleBurst(sock, capturedJid);
            } else {
              // Direct reply - NO duplicate check, always send
              const replyText = await getAIReply(capturedJid, combined);
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await sock.sendMessage(capturedJid, { text: replyText });
              console.log('[Shreya]: ' + replyText);
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

