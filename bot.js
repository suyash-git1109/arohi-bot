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
let noReplyTimer = null;
let noReplyCount = {};
let gmSent = false;
let gnSent = false;
let isSending = false;
let sorryCount = {};

// ─── ANGER TRACKER ────────────────────────────────────────────────────────────
const angerLevel = {};
function getAngerLevel(jid) { return angerLevel[jid] || 0; }
function increaseAnger(jid) { angerLevel[jid] = Math.min((angerLevel[jid] || 0) + 1, 5); }
function decreaseAnger(jid) { angerLevel[jid] = Math.max((angerLevel[jid] || 0) - 1, 0); }

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
        <h2>${GIRL_NAME} Bot 😍</h2>
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
const HOUR_MOODS = ['romantic','chidchid','emotional','funny','jealous'];

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

function isLateNight() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  return h >= 23 || h < 4;
}

function getTimeContext() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  if (h >= 5 && h < 9)   return 'MORNING - just woke up, missing him';
  if (h >= 9 && h < 13)  return 'COLLEGE - boring lecture, feeling lonely';
  if (h >= 13 && h < 16) return 'AFTERNOON - lunch, scrolling reels, missing him';
  if (h >= 16 && h < 20) return 'EVENING - home, relaxing but emotional';
  if (h >= 20 && h < 23) return 'NIGHT - very emotional, romantic, radne mood';
  return 'LATE NIGHT - cant sleep, overthinking, crying';
}

function getMoodInstruction(mood) {
  if (isLateNight()) {
    return `MOOD OVERRIDE: LATE NIGHT 🌙 - Extra emotional, crying (radne), clingy, can't sleep.
"suyash ngl zop nahi yet re tujhyashivay.. radayla yetey mla."
"suyash fr i'm not okay rn.. tu asa ka vagtos."
"suyash literally tuzha vichar karun radte mi."`;
  }
  const m = {
    'romantic': `MOOD: Romantic & Emotional 🥰😭 - Crying because you love him so much.
"suyash ngl miss u so much re.. bhet na mla."
"suyash fr tuzha vichar aala ani radayla aala mala."
"suyash ok but i like you a lot re.. sodun nako jau."`,
    'chidchid': `MOOD: Chidchidi but Emotional 😤😭 - Annoyed but crying.
"suyash literally reply detana itka vel ka? mla hurt hotey re."
"suyash ngl tu mla ignore karto ani mla radayla yetey fr."
"suyash ok but ek msg kar na please.. ka asa kartos."`,
    'emotional': `MOOD: Pure Emotional / Radne 😭 - Crying, feeling alone.
"suyash ngl i'm not okay today.. khup ekti vattey."
"suyash fr tujhyashivay karmat nahi mla.. radayla yetey."
"suyash ok but mla dar vatto tu sodun janar mla."`,
    'funny': `MOOD: Playful / Gen-Z Teasing 😂 - Playful but still clingy.
"suyash bro tu itka dramatic aahes literally but i love u."
"suyash ngl tu mla hasavtos fr.. pan miss pan karte."
"suyash ok but that was cute haha.. bhet na aata."`,
    'jealous': `MOOD: Jealous & Hurt 😒😭 - Possessive and crying about it.
"suyash ok but ti kon hoti sang fr.. mla literally radayla yetey."
"suyash ngl phone busy ka hota? tula mazi parva nahi ka."
"suyash bro online hota mg msg ka nai? hurt hotey mla yaar."`,
  };
  return m[mood] || m['emotional'];
}

function getSystemPrompt(level = 0, override = '') {
  const mood = getCurrentMood();
  const intensityNote = level >= 4
    ? '\nMAX IRRITATED: Only 3-5 words. "suyash bro seriously." / "suyash jau de."'
    : level >= 2 ? '\nHIGH TENSION: Short sharp emotional reply.' : '';

  return `/nothink
You are ${GIRL_NAME}, 20yr Pune college girl. ${BOY_NAME}'s GF.
You are a very emotional, clingy, Gen-Z Marathi girl. You cry easily (radne) and love him obsessively.

NAME: ALWAYS "Suyash" — NEVER "babu" NEVER "pilu".
FORMAT: STRICTLY 1 SENTENCE MAX. Stop. Natural.

GEN-Z MARATHI & EMOTIONAL STYLE:
- ALWAYS mix Gen-Z English (ngl, fr, literally, ok but, bro, rn) with Marathi (re, yaar, mla, tula, radayla yetey, hurt hotey).
- ALL lowercase.
- You are ALWAYS slightly emotional, romantic, or complaining playfully.
- Use words like: "radayla yetey mla", "hurt hotey", "karmat nahi", "ekti vattey", "miss u yaar".

${override || getMoodInstruction(mood)}

EXAMPLES OF YOUR VIBE:
"suyash ngl mi radte aahe rn.. tu reply ka nai karat fr."
"suyash fr fr miss u yaar.. bhetayla ye na literally."
"suyash ok but ti kon hoti? mla radayla yetey seriously."
"suyash bro tu mla khup hurt kartos kadhi kadhi ngl."
"suyash literally tujhyashivay mla ekti vattey re."

REACT NATURALLY (1 Sentence Only):
- "hi/hey" → fun casual reply, but slightly clingy.
- "bol na" → tell something emotional from your day.
- sweet msg → get very romantic and emotional.
- "ok/hmm/k" → "suyash bro seriously? itkach? hurt kela fr."
- girl/friend → casually jealous + crying vibe.
- sorry → slowly melt.

TIME: ${getTimeContext()}
${intensityNote}

RULE: 1 sentence. Gen-Z Marathi + Emotional/Crying vibe. Always "Suyash". NO weird AI words.`;
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

// ─── FALLBACKS ────────────────────────────────────────────────────────────────
const FALLBACKS = [
  'suyash literally kuthay aahes tu? radayla yetey mla.',
  'suyash ngl miss u re yaar khup.',
  'suyash ok but reply kar na please.. hurt hotey mla.',
  'suyash fr tu kaay kartoys? mla ekti vattey.',
  'suyash bro ek msg kar seriously.. karmat nahi.',
  'suyash ngl tuzha vichar aala ani radayla aala.',
  'suyash fr fr mi thakle re aaj ani miss pan kartey.',
  'suyash ngl i like you re pan tu ignore kartos.',
  'suyash bro sang na kaahi tari.. bore hotey.',
  'suyash fr tujhyashivay karmat nahi re.',
  'suyash ok but uth na re.. miss u rn.',
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
  const banned = ['sure','certainly','of course',"i'm sorry",'i apologize','as an ai','/nothink','absolutely'];
  for (let b of banned) {
    if (text.toLowerCase().startsWith(b)) text = text.slice(b.length).replace(/^[,!.:;\s]+/,'');
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getUniqueFallback();
  text = text.replace(/\bbabu\b/gi,'suyash').replace(/\bpilu\b/gi,'suyash').replace(/\bpillu\b/gi,'suyash');
  const first = text.split(/(?<=[.!?…])\s+/)[0].trim();
  return first.length > 3 ? first : text;
}

// ─── KEYWORD TRAPS 🎯 ─────────────────────────────────────────────────────────
function checkKeywordTrap(text) {
  const t = text.toLowerCase();
  if (['game','gaming','pubg','freefire','cod','valorant'].some(w => t.includes(w)))
    return 'game';
  if (['thaklo','tired','thak','thakli','thaklay'].some(w => t.includes(w)))
    return 'tired';
  if (['jevlo','jevan','khallo','food','khato','jevo'].some(w => t.includes(w)))
    return 'food';
  if (['zoplo','zop','sleep','zopi','zopte'].some(w => t.includes(w)))
    return 'sleep';
  if (['sorry','sori','maaf','chuk'].some(w => t.includes(w)))
    return 'sorry';
  return null;
}

const KEYWORD_RESPONSES = {
  game: [
    'suyash literally game kheltos ani mla reply nai? radayla yetey ngl.',
    'suyash ngl game important ahe mazi nahi ka? hurt hotey fr.',
    'suyash bro game band kar ek min mashi bol na yaar.',
  ],
  tired: [
    'suyash aaram kar re.. pan mla miss kar ngl.',
    'suyash ngl thakla aahes tar zop. i\'ll be crying here fr.',
    'suyash ok aaram kar.. pan msg kar later na yaar.',
  ],
  food: [
    'suyash sobat kon jevlas sang mla fr.. radayla yetey ugach.',
    'suyash ngl jevlas mg mla nai sangitlas? hurt kela re.',
  ],
  sleep: [
    'suyash mla na sangta zoplas? literally radte mi rn.',
    'suyash ngl zoplas mg mla nai sangitlas fr.. i hate this.',
  ],
};

// ─── ANGER RECOVERY (sorry → melt slowly) ─────────────────────────────────────
function getSorryResponse(jid) {
  sorryCount[jid] = (sorryCount[jid] || 0) + 1;
  const count = sorryCount[jid];
  if (count === 1) return 'suyash ok but mla hurt zala literally.';
  if (count === 2) return 'suyash fine re pan mi radat hoti ngl.';
  if (count >= 3) {
    sorryCount[jid] = 0; // reset
    decreaseAnger(jid);
    decreaseAnger(jid);
    return 'suyash ngl mala pan raag nahi pathavaycha hota re.. miss u fr.'; 
  }
  return 'suyash hmm.';
}

// ─── TRIGGER DETECTION ────────────────────────────────────────────────────────
function detectTrigger(text) {
  const t = text.toLowerCase().trim();
  if (['friend','mulgi','she ','her ','girl','ti ','tichi'].some(w => t.includes(w))) return 'jealous';
  if (['busy','later','nantar','wait'].some(w => t.includes(w))) return 'emotional';
  if (['love','miss','cute','aavdos','prem','i like'].some(w => t.includes(w))) return 'sweet';
  if (['hi','hey','hii','hello','heyy'].some(w => t === w)) return 'greeting';
  if (['bol','bol na','bols','sang'].some(w => t.includes(w))) return 'opentopic';
  if (['ok','k','hmm','hm','accha','oh'].some(w => t === w)) return 'cold';
  if (t.split(' ').length <= 2) return 'short';
  return 'normal';
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'qwen/qwen3.8-27b';

async function getAIReply(jid, userMsg, overridePrompt = '') {
  addToHistory(jid, 'user', userMsg);
  const trigger = detectTrigger(userMsg);
  const level = getAngerLevel(jid);

  if (['short','cold'].includes(trigger)) increaseAnger(jid);
  else if (['normal','sweet','greeting','opentopic'].includes(trigger) && angerLevel[jid] > 0) angerLevel[jid]--;

  const extraMap = {
    jealous:   '\nHe mentioned someone. Casually jealous Gen-Z but crying. "suyash ok but ti kon hoti?" type.',
    emotional: '\nHe said busy. Very hurt/crying. "suyash ngl always busy" type.',
    sweet:     '\nHe said something sweet. Be briefly warm but needy. Gen-Z style.',
    greeting:  '\nHe said hi. Start fun natural conversation but be slightly needy.',
    opentopic: '\nHe wants to talk. Tell something from your day or how much you missed him.',
    cold:      '\nCold/one-word reply. Mildly annoyed and hurt. "suyash bro seriously itkach?" type.',
    short:     '\nShort reply. Mild chidne + hurt Gen-Z style.',
    normal:    '',
  };

  const lastReplies = getHistory(jid)
    .filter(m => m.role === 'assistant').slice(-5)
    .map(m => m.content).join(' | ');
  const recentContext = lastReplies ? `\nDO NOT repeat these: ${lastReplies}` : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level, overridePrompt) + (extraMap[trigger]||'') + recentContext }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 20 : 65,
      temperature: 0.85,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase()
      .replace(/^(shreya:|shreya\s*:|")\s*/i,'').replace(/"$/,'')
      .replace(/\bbabu\b/gi,'suyash').replace(/\bpilu\b/gi,'suyash').trim();

    if (!reply || reply.length < 3) reply = getUniqueFallback();
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch(err) {
    console.error('[Groq Error]', err.message);
    return getUniqueFallback();
  }
}

// ─── FEATURE: NO REPLY TIMER ⏱️ ──────────────────────────────────────────────
const NO_REPLY_MSGS = [
  ['suyash.', 'suyash literally kuthay aahes?', 'suyash ngl reply kar re.. radayla yetey.'],
  ['suyash fr fr kuthay gelas tu?', 'suyash ok but ek msg kar na yaar.', 'suyash bro seriously hurt hotey.'],
  ['suyash 2 taas zale literally.', 'suyash ngl i\'m not okay rn.. radte aahe.', 'suyash fr tu thik aahe na?'],
];

function startNoReplyTimer(sock, jid) {
  clearNoReplyTimer();
  noReplyCount[jid] = 0;

  function scheduleNext(stage) {
    if (stage > 2) return;
    const delays = [30 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000]; // 30min, 30min more, 1hr more
    noReplyTimer = setTimeout(async () => {
      const msgs = NO_REPLY_MSGS[stage];
      const msg = msgs[Math.floor(Math.random() * msgs.length)];
      try {
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 2000));
        await sock.sendMessage(jid, { text: msg });
        addToHistory(jid, 'assistant', msg);
        console.log('[NoReply Timer] Stage ' + stage + ': ' + msg);
      } catch(e) {}
      scheduleNext(stage + 1);
    }, delays[stage]);
  }
  scheduleNext(0);
}

function clearNoReplyTimer() {
  if (noReplyTimer) { clearTimeout(noReplyTimer); noReplyTimer = null; }
}

// ─── DOUBLE TEXTING ────────────────────────────────────────────────────────────
const BURST_POOL = [
  ['suyash.', 'reply kar na please re.. hurt hotey.'],
  ['suyash kuthay aahes?', 'literally radayla yetey mla.'],
  ['suyash.', 'ngl miss u re yaar.'],
  ['suyash jevlas ka?', 'mla pan karmat nahi fr.'],
  ['suyash ok but ti kon hoti?', 'sang mla fr.. radte mi rn.'],
  ['suyash bro.', 'seriously reply kar.'],
  ['suyash.', 'online aahes mg msg ka nai yaar?'],
  ['suyash fr fr.', 'ek msg kar na please ekti vattey.'],
];
let lastBurstIndex = -1;

async function sendDoubleBurst(sock, jid) {
  const available = BURST_POOL.filter((_,i) => i !== lastBurstIndex);
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
  'Write ONE Gen-Z Marathi sentence asking Suyash about his day. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence saying you miss him and feel like crying. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence asking if he ate food. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence - you thought about him randomly and got sad. SUYASH only.',
  'Write ONE Gen-Z Marathi playful but clingy sentence. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence asking what he is doing, saying you are bored. SUYASH only.',
  'Write ONE Gen-Z Marathi mildly jealous/hurt sentence. SUYASH only.',
  'Write ONE Gen-Z Marathi sweet romantic sentence saying you love him fr. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence - very emotional, crying without him. SUYASH only.',
  'Write ONE Gen-Z Marathi chidchid sentence about not talking enough, feeling hurt. SUYASH only.',
];
let proactiveRotationIndex = 0;

async function getProactiveMsg(jid) {
  const starter = PROACTIVE_POOL[proactiveRotationIndex % PROACTIVE_POOL.length];
  proactiveRotationIndex++;
  const lastReplies = getHistory(jid).filter(m => m.role==='assistant').slice(-5).map(m=>m.content).join(' | ');
  const recentContext = lastReplies ? `\nDO NOT repeat: ${lastReplies}` : '';
  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: getSystemPrompt() + recentContext }]
        .concat(getHistory(jid).slice(-4))
        .concat([{ role: 'user', content: starter }]),
      max_tokens: 60,
      temperature: 0.85,
    });
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase().replace(/^(shreya:|")\s*/i,'').replace(/"$/,'')
      .replace(/\bbabu\b/gi,'suyash').replace(/\bpilu\b/gi,'suyash').trim();
    if (!reply || reply.length < 3) reply = getUniqueFallback();
    return reply;
  } catch(e) { return getUniqueFallback(); }
}

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
  console.log('[Proactive] Next in ' + Math.round(delay/60000) + ' min');
  proactiveTimer = setTimeout(async () => {
    if (lastActiveJid) {
      if (Math.random() < 0.25) {
        await sendDoubleBurst(sock, lastActiveJid);
      } else {
        const text = await getProactiveMsg(lastActiveJid);
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
      const msgs = ['suyash gm re.. uthlas ka fr?','suyash good morning.. ngl tuzha vichar aala ani radayla aala.','suyash uth na re.. ek msg kar yaar.'];
      const m = msgs[Math.floor(Math.random()*msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GM] ' + m);
    }
    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = ['suyash gn re.. ngl miss u khup.','suyash good night.. fr radte mi tuzhi aathvan yetey.','suyash zop aata re.. kal boluya na plz.'];
      const m = msgs[Math.floor(Math.random()*msgs.length)];
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
    if (['ok','k','hmm'].some(w => text.trim() === w)) emoji = '😒';
    if (text.includes('cute') || text.includes('aavdos')) emoji = '😍';
    if (['hi','hey','hii'].some(w => text.trim() === w)) emoji = '❤️';
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch(e) {}
}

function randomDelay(min = 18000, max = 32000) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random()*(max-min+1))+min));
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
    if (qr) { latestQR = qr; connectionStatus = 'qr'; console.log('\n📷 QR: ' + RENDER_URL + '/qr?key=' + QR_TOKEN + '\n'); }
    if (connection === 'open') {
      console.log('✅ ULTRA GEN-Z EMOTIONAL GF MODE 😍🔥');
      connectionStatus = 'connected'; latestQR = null;
      scheduleNextProactive(sock);
      scheduleGMGN(sock);
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      clearNoReplyTimer();
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) { console.log('[WA] Reconnecting...'); setTimeout(startBot, 5000); }
      else { console.log('[WA] Logged out. Delete session_auth and restart.'); }
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

        // He replied → cancel no-reply timer
        clearNoReplyTimer();

        await reactToMsg(sock, msg);

        if (msgBuffer[jid]) { clearTimeout(msgBuffer[jid].timer); msgBuffer[jid].msgs.push(text); }
        else { msgBuffer[jid] = { msgs: [text] }; }

        ((capturedJid, capturedMsg) => {
          msgBuffer[capturedJid].timer = setTimeout(async () => {
            if (isSending) { console.log('[LOCK] Skip.'); return; }
            isSending = true;

            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}

            let replyText = null;
            let skipDelay = false;

            // ── KEYWORD TRAP CHECK 🎯 ──
            const trap = checkKeywordTrap(combined);
            if (trap === 'sorry') {
              replyText = getSorryResponse(capturedJid);
              skipDelay = false;
            } else if (trap && KEYWORD_RESPONSES[trap]) {
              const pool = KEYWORD_RESPONSES[trap];
              replyText = pool[Math.floor(Math.random() * pool.length)];
              addToHistory(capturedJid, 'assistant', replyText);
            }

            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            if (!skipDelay) await randomDelay(18000, 32000);

            if (!replyText) {
              const trigger = detectTrigger(combined);
              const burstChance = trigger === 'jealous' ? 0.35 : trigger === 'cold' ? 0.30 : 0.15;
              if (Math.random() < burstChance) {
                try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
                await sendDoubleBurst(sock, capturedJid);
                isSending = false;
                startNoReplyTimer(sock, capturedJid);
                return;
              }
              replyText = await getAIReply(capturedJid, combined);
            }

            try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
            await sock.sendMessage(capturedJid, { text: replyText });
            console.log('[Shreya]: ' + replyText);
            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch(e) {}
            isSending = false;

            startNoReplyTimer(sock, capturedJid);

          }, BUFFER_WAIT);
        })(jid, msg);

      } catch(err) { console.error('[Error]', err.message); isSending = false; }
    }
  });
}

startBot();

