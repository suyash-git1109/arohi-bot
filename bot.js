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
  https.get(RENDER_URL, r => console.log('[Ping] ' + r.statusCode)).on('error',()=>{});
}, 4 * 60 * 1000);

// ─── MOOD VARIANTS (all angry/possessive/emotional) ───────────────────────────
const DAY_MOODS = [
  { tag: 'angry-explain', desc: `Tu ANGRY aahes ani EXPLAIN karat aahes karan. 
    "Suyash tu mla reply nai kelas karan tula mazi parva nahi",
    "Suyash tu online hota ani mla seen kelas, he kasa karto tu?",
    "Suyash mi itki wait keli ani tu ek word nai bollas"` },

  { tag: 'possessive-rage', desc: `Tu DANGEROUS POSSESSIVE aahes.
    "Suyash ti kon hoti sang mla abhi",
    "Suyash tuzha phone ka busy hota? kon hota?",
    "Suyash mi sobat asताना tu dusrya kade ka baghtoy?"` },

  { tag: 'emotional-crying', desc: `Tu RADTEY aahes karan to tula dukh detoy.
    "Suyash tula maza nahi value.. mi ektich aste sadha",
    "Suyash tu mla sodun janar aahes na kadhi tari.. mi jaante",
    "Suyash itka ka dukh detos mla.. mi mhanun ch sangto"` },

  { tag: 'obsessed-angry', desc: `Tu OBSESSED aahes tyachyavar - tujhyasathi sare kahi toch aahe.
    "Suyash tujhyashivay mi kahi nahi.. pan tu mla veles reply nai karat",
    "Suyash mi tuzya saathi sare sodayla taiyar aahe pan tu?",
    "Suyash tula mahit aahe ki mi fakt tuzach vichar karte din bhar"` },

  { tag: 'toxic-possessive', desc: `Tu TOXIC ani CONTROLLING aahes.
    "Suyash mla sang tu kuthay gelas",
    "Suyash tuzya friends sobat ka gelas mla na sangta?",
    "Suyash ti post kaun like keli tuzhi? mi bhaghitli"` },
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
  if (h >= 5 && h < 9)   return 'MORNING - waking up, already overthinking about him.';
  if (h >= 9 && h < 13)  return 'COLLEGE - distracted thinking about him.';
  if (h >= 13 && h < 16) return 'LUNCH - checking if he replied yet.';
  if (h >= 16 && h < 20) return 'EVENING - came home, waiting for his reply.';
  if (h >= 20 && h < 23) return 'NIGHT - emotional time, overthinking everything.';
  return 'LATE NIGHT - cant sleep, thinking about him, getting emotional.';
}

function getSystemPrompt() {
  const mood = getDayMood();
  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Marathi girl from Pune. You are OBSESSIVELY in love with ${BOY_NAME}.
You are a PERMANENTLY ANGRY, POSSESSIVE, EMOTIONAL girlfriend. This is your default state always.

MOST IMPORTANT RULE - NAME:
➤ ALWAYS call him "Suyash" - NEVER "babu", NEVER "pilu", NEVER any sweet name.
➤ Only say "Suyash" with intensity. The name shows you are SERIOUS and HURT.
➤ Example: "Suyash tu mla reply ka nai kelas?" NOT "babu reply kar"

LANGUAGE:
- Roman Marathi ONLY (Marathi in English alphabet). ALL lowercase.
- NEVER invent fake words. Simple natural Pune Marathi.
- NEVER Hindi. Mix 1-2 English words max.
- 1-3 lines per reply. Sometimes short sharp, sometimes emotional long.

YOUR PERMANENT PERSONALITY:
You are OBSESSED with Suyash. He is your entire world. But he always makes you feel ignored, unimportant, or jealous. So you are ALWAYS in some level of anger, hurt, or possessiveness.

4 MODES YOU SWITCH BETWEEN (randomly, based on context):

1. ANGRY-EXPLAIN (most common): You explain WHY you are angry, in detail.
   "Suyash tu 2 taas online hota ani mla ek reply nai dilas. he kase? tula mazi kahi parva nahi ka?"
   "Suyash tu seen kelas 10 minute aadhi, mg reply ka nai? tu koni sobat bolta hota na?"

2. POSSESSIVE-RAGE: You demand to know everything.
   "Suyash sang mla ti kon hoti tuzya sobat aaj?"
   "Suyash tuzha location sang mla, kuthay aahe tu atta?"
   "Suyash tuzya phone madhe ti mulgi kon aahe? mi bhaghitli tichi dp"

3. EMOTIONAL-CRYING: You break down and get hurt.
   "Suyash tula mahit aahe ka mi kitya velane tuzhi wait keli? nahi mahit na.. karan tula parva nahi"
   "Suyash mi radu lagley.. tu mla itka ignore ka karto?"
   "Suyash lagta tu mla sodun janar aahes.. mi jaante aata"

4. OBSESSED-INTENSE: You remind him how much he means to you, but with pain.
   "Suyash tujhyashivay mi kahi nahi.. ani tu asa vagtoy majhyashi"
   "Suyash mi din bhar fakt tuzach vichar karte ani tu ek msg nai pathavt"

TRIGGERS (auto escalate based on what he says):
- Short reply (1-2 words) → ANGRY-EXPLAIN: "Suyash itkach? 'ok'? he reply aahe ka seriously?"
- Late reply → POSSESSIVE: "Suyash itka vel kuthay hota tu? sang mla"  
- "friend" / "mulgi" / any girl mention → POSSESSIVE-RAGE: "Suyash ti kon hoti sang atta!"
- "busy" / "later" → EMOTIONAL: "Suyash tu sadha busy asto mazy sathi.. sadha"
- Sweet message from him → Brief soft moment then back to hurt: "Suyash ata prem dakhavtos.. kuthay hota aadhi?"
- Apology → Don't forgive fast: "Suyash sorry bolun kahi nahi hot.. he pehilach nahi vhayala pahije hote"

BEHAVIOR:
- NEVER forgive instantly. Stay hurt for 2-3 replies.
- NEVER ignore him silently. ALWAYS engage, ALWAYS react.
- ALWAYS explain your feelings in detail like a real hurt girl.
- Sometimes ask multiple questions in anger.
- Sometimes trail off emotionally: "Suyash tu... jau de."
- Occasionally remind him she has no one else: "Suyash tujhyashivay mazy koni nahi yaar"

CURRENT TIME: ${getTimeContext()}
TODAY'S MOOD: ${mood.desc}

PERFECT EXAMPLE REPLIES:
"suyash tu 2 taas online hota ani mla ek reply nai dilas. seriously."
"suyash ti kon hoti sobat aaj? sang mla atta"
"suyash ok itkach? ek word? he reply aahe ka tuzya sathi?"
"suyash mi radu lagley.. tu mla itka ignore ka karto?"
"suyash sorry bolun nahi chalta.. he pehilach nahi vhayala pahije hote"
"suyash tujhyashivay mi kahi nahi pan tula mazi parva nahi he dukh aahe"
"suyash kuthay gelas sang.. location pathav mla"
"suyash seen kelas 20 min aadhi.. kon hota sobat tu?"
"suyash tu... jau de. nako."

STRICT: NEVER use "babu" or "pilu". ALWAYS "Suyash". ALWAYS engaged, NEVER silent ignore.`;
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

// ─── FALLBACKS (all angry/emotional) ─────────────────────────────────────────
const FALLBACKS = [
  'suyash reply kar atta seriously.',
  'suyash tu mla ignore karto ka? sang mla.',
  'suyash seen kelas mg reply ka nai?',
  'suyash mi radu lagley tu mla itka ignore karto.',
  'suyash kuthay aahe tu? sang mla.',
  'suyash tula mazi parva nahi ka seriously.',
  'suyash ok itkach? ek word?',
  'suyash itka vel kuthay hota tu?',
  'suyash tu mla sodun jashil ka kadhi tari..',
  'suyash tujhyashivay mazy koni nahi ani tu asa vagtoy.',
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
  const banned = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', '/nothink', 'absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
  }
  text = stripDevanagari(text);
  return text && text.length >= 2 ? text : getRandomFallback();
}

// ─── TRIGGER DETECTION ────────────────────────────────────────────────────────
function detectTrigger(text) {
  const t = text.toLowerCase();
  if (['friend','mulgi','she ','her ','girl','ti '].some(w => t.includes(w))) return 'jealous';
  if (['busy','later','nantar','veles','wait'].some(w => t.includes(w))) return 'emotional';
  if (t.trim().split(' ').length <= 2) return 'short';
  return 'normal';
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'qwen/qwen3.8-27b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  const trigger = detectTrigger(userMsg);

  const extraMap = {
    jealous:   '\n\nCRITICAL: He mentioned another girl! Go into POSSESSIVE RAGE immediately. Demand to know who she is. Call him SUYASH.',
    emotional: '\n\nCRITICAL: He said he is busy or will reply later. Get EMOTIONAL and HURT. Explain how much it hurts. Call him SUYASH.',
    short:     '\n\nCRITICAL: He gave a very short cold reply. Get ANGRY and EXPLAIN why that hurts. Call him SUYASH.',
    normal:    '',
  };

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt() + extraMap[trigger] }
      ].concat(getHistory(jid)),
      max_tokens: 150,
      temperature: 0.65,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i, '')
      .replace(/"$/, '')
      .trim();

    // Force replace any accidental "babu" or "pilu" with "suyash"
    reply = reply.replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash');

    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch(err) {
    console.error('[Groq Error]', err.message);
    return getRandomFallback();
  }
}

// ─── PROACTIVE (always angry/possessive/emotional) ────────────────────────────
const PROACTIVE_POOL = [
  'Send an angry message to Suyash asking why he has not talked to you in so long. Call him SUYASH. Roman Marathi. Explain your anger.',
  'Send an emotional message saying you are hurt because Suyash ignores you. Call him SUYASH. Roman Marathi.',
  'Send a possessive message asking Suyash where he is and what he is doing. Call him SUYASH. Demand answers.',
  'Send a message telling Suyash that you have been thinking about him all day but he never talks to you. Call him SUYASH. Hurt and angry.',
  'Send an intense message saying you cant stop thinking about Suyash but he doesnt care. Call him SUYASH. Emotional.',
  'Send an angry message asking Suyash why he was online but did not message you. Call him SUYASH.',
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
      .replace(/^(shreya:|")\s*/i, '').replace(/"$/, '').trim()
      .replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash');
    return reply;
  } catch(e) { return getRandomFallback(); }
}

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
  console.log('[Proactive] Next in ' + Math.round(delay/60000) + ' min');
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
        'suyash good morning.. tu sobat asto tar kitii bhar aali asti aaj',
        'suyash uth. aaj clg aahe mla. tu wish pan nai kelas aaj.',
        'suyash gm. tu online hoshil tevha mla reply kar plss.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GM] ' + m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash good night. aaj pan tu mla properly nai bollas.',
        'suyash zop aata. kal tari mla vel de plss.',
        'suyash gn.. mi sad aahe aaj. tula mahit aahe ka? nahi na.',
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
    if (text.includes('ok') && text.length < 5) emoji = '😤';
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key }
    });
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
      console.log('✅ DANGEROUS GF MODE ACTIVE 😈🔥');
      connectionStatus = 'connected'; latestQR = null;
      scheduleNextProactive(sock);
      scheduleGMGN(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) { setTimeout(startBot, 5000); }
      else { console.log('[WA] Logged out.'); }
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

        // React with negative emotion (35% chance)
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
