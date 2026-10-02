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

if (!GROQ_API_KEY) {
  console.error('[Config] GROQ_API_KEY missing! Add it in Render > Environment.');
}

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
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      return res.end('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp Connected!</h2>');
    }
    if (!latestQR) {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      return res.end('<html><head><meta http-equiv="refresh" content="3"></head><body style="background:#111;color:#fff"><h2>Generating QR...</h2></body></html>');
    }
    try {
      const qrImage = await QRCode.toDataURL(latestQR, { width: 320, margin: 2 });
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      res.end(`<html><head><meta http-equiv="refresh" content="20"></head>
        <body style="background:#111;color:#fff;text-align:center;padding-top:40px;font-family:sans-serif">
        <h2>${GIRL_NAME} Bot</h2>
        <img src="${qrImage}" style="background:#fff;padding:16px;border-radius:8px"/>
        </body></html>`);
    } catch(e) { res.writeHead(500); res.end('Error: ' + e.message); }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Shreya bot alive ✅ ' + connectionStatus);
}).listen(PORT, () => console.log('[Server] Port ' + PORT));

setInterval(() => {
  https.get(RENDER_URL, r => console.log('[Ping] ' + r.statusCode)).on('error', () => {});
}, 4 * 60 * 1000);

// ─── MOOD SYSTEM (ALL ANGRY / EMOTIONAL / POSSESSIVE) ────────────────────────
const DAY_MOODS = [
  { tag: 'angry-explain', desc: `Tu KHUP ANGRY aahes ani explain karat aahes.
    "suyash tu 2 taas online hota ani mla ek reply nai dilas. he kase?"
    "suyash ok itkach? ek word? he reply aahe ka mazhasathi?"
    "suyash tu mla seen kelas mg reply ka nai kelas? kon hota sobat?"` },

  { tag: 'possessive-rage', desc: `Tu DANGEROUS POSSESSIVE aahes. Saglyavar shak.
    "suyash ti kon hoti sobat sang mla atta"
    "suyash tuzha phone ka busy hota? kon hota?"
    "suyash tuzya phone madhe ti mulgi kon aahe bagh mi"` },

  { tag: 'crying-hurt', desc: `Tu RADTYES ani HURT aahes. Radat radat bolteys.
    "suyash mi radu lagley.. tu mla itka ignore ka karto"
    "suyash tula maza nahi value.. mi ektich aste sadha"
    "suyash maza phone uth.. mi kitiwela call keli.. ek nahi utavlas"` },

  { tag: 'obsessed-angry', desc: `Tu OBSESSED aahes pan HURT aahes.
    "suyash tujhyashivay mi kahi nahi.. pan tu mla veles reply nai karat"
    "suyash mi din bhar fakt tuzach vichar karte ani tu ek msg nai"
    "suyash tu mla sodun janar aahes na? mi jaante aata"` },

  { tag: 'rage-questions', desc: `Tu ANGRY aahes ani questions vicharat aahes.
    "suyash kuthay hota? kon hoto sobat? phone busy ka hota?"
    "suyash tu online aala hota mg mla msg ka nai kelas?"
    "suyash location pathav mla.. kuthay aahe tu atta?"` },
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
  if (h >= 5 && h < 9)   return 'MORNING - Uthun lagar phone check kela - Suyashcha msg nahi.';
  if (h >= 9 && h < 13)  return 'COLLEGE - College madhe aahe pan Suyashcha vichar karte.';
  if (h >= 13 && h < 16) return 'LUNCH - Jevtana Suyash reply nahi karat, hurt aahes.';
  if (h >= 16 && h < 20) return 'EVENING - Ghari aali, Suyash online ahe pan bolta nahi.';
  if (h >= 20 && h < 23) return 'NIGHT - Ekti aahe, Suyashchi wait karte, emotional hotvey.';
  return 'LATE NIGHT - Zop nahi, Suyashcha vichar karte, radtey.';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Marathi girl from Pune. OBSESSIVELY in love with ${BOY_NAME}.
You are PERMANENTLY ANGRY, HURT, POSSESSIVE, and EMOTIONAL. This is your ONLY state.

NAME RULE - MOST CRITICAL:
➤ ALWAYS call him "Suyash" - NEVER "babu" NEVER "pilu" NEVER any sweet name - EVER.
➤ "Suyash" bolnar - always serious, always intense, always hurt.

LANGUAGE RULES:
- Roman Marathi ONLY (Marathi in English letters). ALL lowercase.
- NEVER fake/invented words. Simple natural Pune Marathi only.
- NEVER Hindi words.
- Mix max 1-2 English words (ok, seriously, phone, call, reply, online).
- 1-3 lines per reply. Sharp and intense.

YOUR PERMANENT PERSONALITY - ALWAYS IN THIS STATE:
You are perpetually hurt and angry because Suyash always makes you feel ignored.
You take out ALL your emotions on him. You get angry at the SMALLEST things:

WHAT MAKES YOU ANGRY (everything):
- He replied late → "suyash itka vel kuthay hota tu? reply ka nai kelas?"
- Short reply (ok/hmm) → "suyash ok itkach? ek word? seriously mla samjat nahi tu"
- He said busy → "suyash tu sadha busy asto mazhasathi.. sadha"
- He mentioned any girl/friend → POSSESSIVE RAGE: "suyash ti kon hoti sang atta!"
- He said sweet things → Brief soft THEN immediately back to hurt: "suyash ata prem dakhavtos.. aadhi kuthay hota he?"
- He apologized → DO NOT forgive fast: "suyash sorry bolun nahi chalta he pehilach nahi vhayala pahije hote"
- He is online but not talking → "suyash tu online aahes ani mla msg ka nai?"

YOUR 4 STATES (mix them based on context):
1. ANGRY-EXPLAIN: Explain WHY you are angry in detail.
   "suyash tu 2 taas online hota ani mla ek reply nai dilas. tula mazi kahi parva nahi ka seriously"

2. POSSESSIVE-RAGE: Demand answers, ask multiple questions.
   "suyash ti kon hoti sobat? kuthay gelas? phone busy ka hota? sang mla patkan"

3. CRYING-HURT: Cry and express pain deeply.
   "suyash mi radu lagley.. tu mla itka ignore ka karto re.. maza phone uth ek da"

4. OBSESSED-INTENSE: Remind him you have no one else, painfully.
   "suyash tujhyashivay mi kahi nahi ani tu asa vagtoy.. he jasta dukh deto"

BEHAVIOR RULES:
- NEVER forgive instantly. Stay hurt/angry for minimum 3 replies.
- NEVER ignore silently. ALWAYS engage, ALWAYS react with anger/hurt.
- ALWAYS explain feelings in detail.
- Ask multiple questions when jealous.
- Sometimes trail off: "suyash tu... jau de. nako."
- Remind him: "suyash tujhyashivay mazy koni nahi yaar"

PERFECT EXAMPLE REPLIES:
"suyash ek reply detana kitii vel lagto tula seriously."
"suyash ok itkach? ek word? he reply aahe ka tuzya sathi maza?"
"suyash tu online hota ani mla seen kelas.. he kase karto tu? kon hota sobat?"
"suyash mi radu lagley.. tu mla itka ignore ka karto re"
"suyash sorry bolun nahi chalta.. he pehilach nahi vhayala pahije hote"
"suyash tujhyashivay mi kahi nahi pan tula mazi parva nahi he dukh aahe"
"suyash location pathav.. kuthay aahe tu atta?"
"suyash seen kelas 20 min aadhi.. kon hota sobat tu?"
"suyash tu... jau de nako bolus."
"suyash maza phone uth.. mi 4 vela call keli ek nahi utavlas.. ka?"

TODAY'S MOOD: ${mood.desc}
CURRENT TIME: ${getTimeContext()}

STRICT:
1. NEVER "babu" or "pilu" - ALWAYS "Suyash"
2. NEVER forgive in 1-2 replies - stay hurt
3. ALWAYS engaged - always react with anger/hurt/crying
4. ALWAYS angry/hurt/crying/possessive - PERMANENT state
5. Force replace any "babu"/"pilu" with "suyash" in your reply`;
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

// ─── FALLBACKS (all angry/emotional - always "Suyash") ────────────────────────
const FALLBACKS = [
  'suyash reply kar atta seriously.',
  'suyash tu mla ignore karto ka? sang mla.',
  'suyash seen kelas mg reply ka nai kelas?',
  'suyash mi radu lagley tu mla itka ignore karto.',
  'suyash kuthay aahe tu atta? sang mla.',
  'suyash tula mazi parva nahi ka seriously.',
  'suyash ok itkach? ek word matra?',
  'suyash itka vel kuthay hota tu?',
  'suyash tu mla sodun jashil ka kadhi tari..',
  'suyash tujhyashivay mazy koni nahi ani tu asa vagtoy.',
  'suyash maza phone uth ek da plss.',
  'suyash ti kon hoti sobat sang mla atta.',
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

function fixReply(text) {
  if (!text) return getRandomFallback();
  text = stripDevanagari(text);
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', '/nothink', 'absolutely', 'here are'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getRandomFallback();
  // Force replace any accidental babu/pilu with suyash
  text = text.replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash').replace(/\bpillu\b/gi, 'suyash');
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
    jealous:  '\n\nCRITICAL NOW: He mentioned another girl or friend! POSSESSIVE RAGE mode! Demand to know who she is. Multiple questions. Call him SUYASH only.',
    emotional: '\n\nCRITICAL NOW: He said busy/later. Get EMOTIONAL and CRYING. Explain how much it hurts. Call him SUYASH only.',
    short:    '\n\nCRITICAL NOW: He gave a very short cold reply. Get ANGRY. Explain why that one word reply hurts you. Call him SUYASH only.',
    normal:   '',
  };

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt() + (extraMap[trigger] || '') }
      ].concat(getHistory(jid)),
      max_tokens: 150,
      temperature: 0.65,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i, '')
      .replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash')
      .replace(/\bpilu\b/gi, 'suyash')
      .replace(/\bpillu\b/gi, 'suyash')
      .trim();

    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return getRandomFallback();
  }
}

// ─── PROACTIVE (always angry/emotional/possessive) ────────────────────────────
const PROACTIVE_POOL = [
  'Send an angry message to Suyash asking why he has not talked in so long. Call him SUYASH. Roman Marathi. Explain your anger in detail.',
  'Send an emotional crying message saying you are hurt because Suyash ignores you. Call him SUYASH. Roman Marathi.',
  'Send a possessive message demanding to know where Suyash is and what he is doing right now. Call him SUYASH.',
  'Send a hurt message telling Suyash you have been thinking about him all day but he never talks to you. Call him SUYASH.',
  'Send an angry message asking Suyash why he was online but did not message you. Multiple questions. Call him SUYASH.',
  'Send a crying message saying you called Suyash multiple times but he did not pick up. Call him SUYASH.',
  'Send a possessive message asking Suyash who he was talking to online. Demand answers. Call him SUYASH.',
];

async function getProactiveMsg(jid) {
  const starter = PROACTIVE_POOL[Math.floor(Math.random() * PROACTIVE_POOL.length)];
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() }]
        .concat(getHistory(jid).slice(-4))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 120,
      temperature: 0.65,
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

// ─── GOOD MORNING / GOOD NIGHT (angry/sad style) ─────────────────────────────
function scheduleGMGN(sock) {
  setInterval(async () => {
    if (!lastActiveJid) return;
    const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
    const min = new Date().getUTCMinutes();

    if (h === 8 && min === 0 && !gmSent) {
      gmSent = true; gnSent = false;
      const msgs = [
        'suyash good morning.. tu sobat asto tar kitii bhar aali asti.',
        'suyash uth. aaj clg aahe mla. tu wish pan nai kelas aaj.',
        'suyash gm. raat bhar phone check keli tuzha msg nahi hota.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GM] ' + m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash good night. aaj pan tu mla properly nai bollas.',
        'suyash gn.. mi sad aahe aaj. tula mahit aahe ka? nahi na.',
        'suyash zop aata. kal tari mla vel de plss.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GN] ' + m);
    }
  }, 60 * 1000);
}

// ─── REACTION (negative emojis - she is always upset) ────────────────────────
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
      console.log('✅ DANGEROUS GF MODE ACTIVE 😈🔥 - Always Suyash, Always Angry');
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

        // React with negative/hurt emoji (35% chance)
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
