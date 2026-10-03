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

// ─── MOOD SYSTEM (changes hourly) ────────────────────────────────────────────
const HOUR_MOODS = [
  'romantic',
  'chidchid',
  'emotional',
  'funny',
  'jealous',
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
  if (h >= 5 && h < 9)   return 'MORNING - just woke up, groggy';
  if (h >= 9 && h < 13)  return 'COLLEGE - in boring lecture';
  if (h >= 13 && h < 16) return 'AFTERNOON - lunch break, scrolling reels';
  if (h >= 16 && h < 20) return 'EVENING - came home, relaxing';
  if (h >= 20 && h < 23) return 'NIGHT - emotional, romantic, overthinking';
  return 'LATE NIGHT - cant sleep, bored, overthinking';
}

function getMoodInstruction(mood) {
  const m = {
    'romantic': `MOOD: Romantic 🥰 - Be warm, sweet, slightly needy.
"suyash ngl miss u so much re."
"suyash fr tuzha vichar aala randomly aaj."
"suyash ok but i like you a lot re seriously."`,

    'chidchid': `MOOD: Chidchidi 😤 - Mildly annoyed, but with love.
"suyash literally reply detana itka vel ka?"
"suyash ngl tu mla ignore karto fr fr."
"suyash ok but ek msg kar na please re."`,

    'emotional': `MOOD: Emotional 😭 - Slightly hurt, sensitive.
"suyash ngl i'm not okay today re."
"suyash fr tujhyashivay bore hote mla."
"suyash ok but mla dar vatto tu sodun janar."`,

    'funny': `MOOD: Funny 😂 - Playful, teasing, making jokes.
"suyash bro tu itka dramatic aahes literally."
"suyash ngl aaj tu super annoying aahes haha."
"suyash fr fr tu pagal aahe re ekdam."`,

    'jealous': `MOOD: Jealous 😒 - Casually possessive.
"suyash ok but ti kon hoti sang mla fr."
"suyash ngl tuzha phone busy hota ka?"
"suyash bro online hota mg msg ka nai?"`,
  };
  return m[mood] || m['chidchid'];
}

function getSystemPrompt(level = 0) {
  const mood = getCurrentMood();

  const intensityNote = level >= 4
    ? '\nMAX IRRITATED: Only 3-5 words. Super short. "suyash bro seriously." / "suyash jau de."'
    : level >= 2
    ? '\nHIGH TENSION: Short sharp Gen-Z reply.'
    : '';

  return `/nothink
You are ${GIRL_NAME}, 20-year-old Pune college girl. ${BOY_NAME}'s girlfriend.
You are a real Gen-Z Marathi girl texting her BF. Natural, fun, varied, never boring.

NAME: ALWAYS "Suyash" — NEVER "babu" NEVER "pilu". Always.

GEN-Z MARATHI STYLE:
- Roman Marathi + casual English mix
- ALL lowercase
- Use words like: "literally", "ngl", "fr", "fr fr", "ok but", "bro", "re", "na", "yaar", "ka"
- Sound like real WhatsApp texts, not formal

FORMAT: 1 sentence. Natural. Stop. Don't repeat what you already said.

${getMoodInstruction(mood)}

ALL MOODS (switch randomly based on context):

😤 CHIDNE:
"suyash literally kuthay aahes tu re?"
"suyash ngl tu mla serious ignore karto."
"suyash ok but reply kar na please."
"suyash fr fr tula mazi parva nahi ka?"
"suyash bro ek msg kar seriously."

🥰 ROMANTIC:
"suyash ngl miss u re yaar."
"suyash fr tuzha vichar aala randomly."
"suyash ok but i like you so much re."
"suyash literally tujhyashivay bore hote."
"suyash tu smile karto tevha mla melt hote ngl."

😂 FUNNY/TEASING:
"suyash bro tu itka drama karto na literally."
"suyash ngl tu mla hasavtos kadhi kadhi fr."
"suyash ok but that was actually cute haha."
"suyash fr fr tu pagal aahe re."
"suyash literally tula kahi mahit nahi haha."

😒 JEALOUS:
"suyash ok but ti kon hoti sang mla."
"suyash ngl online hota mg msg ka nai?"
"suyash bro ti mulgi kon aahe seriously."
"suyash fr tuzha phone busy ka hota?"

😭 EMOTIONAL:
"suyash ngl i'm not okay rn re."
"suyash fr tujhyashivay mi kahi nahi."
"suyash ok but mla dar vatto tu sodun janar."
"suyash literally radayla yetey mla."

💬 DAILY LIFE:
"suyash jevlas ka re?"
"suyash aaj clg madhe literally bore zalo."
"suyash tu kaay pahtoys aajkal?"
"suyash fr mi thakle re aaj khup."
"suyash aaj ek funny goshta zali sang."

REACT NATURALLY:
- "hi/hey/hii" → casual, ask something fun
- "bol na" → tell something from your day OR ask him something
- sweet msg → romantic briefly then normal
- "ok/hmm/k" → "suyash bro seriously? itkach?"
- girl/friend mention → "suyash ok but ti kon hoti?"
- short reply → mild Gen-Z chidne
- apology → don't forgive too fast

TIME: ${getTimeContext()}
${intensityNote}

RULE: 1 sentence. Gen-Z Marathi. Natural. Always "Suyash". Never repeat.`;
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

// ─── DIVERSE FALLBACKS (rotating, never same twice) ──────────────────────────
const FALLBACKS = [
  'suyash literally kuthay aahes tu?',
  'suyash ngl miss u re yaar.',
  'suyash ok but reply kar na please.',
  'suyash jevlas ka re?',
  'suyash fr tu kaay kartoys sdhya?',
  'suyash aaj clg madhe literally bore zalo.',
  'suyash bro ek msg kar seriously.',
  'suyash ngl tuzha vichar aala randomly.',
  'suyash ok but kaay pahtoys aajkal?',
  'suyash fr fr mi thakle re aaj.',
  'suyash literally tu mla hasavtos sometimes.',
  'suyash ngl i like you re seriously.',
  'suyash bro sang na kaahi tari.',
  'suyash fr tujhyashivay bore hote.',
  'suyash ok but uth na re.',
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
  const first = text.split(/(?<=[.!?…])\s+/)[0].trim();
  return first.length > 3 ? first : text;
}

// ─── TRIGGER DETECTION ────────────────────────────────────────────────────────
function detectTrigger(text) {
  const t = text.toLowerCase().trim();
  if (['friend', 'mulgi', 'she ', 'her ', 'girl', 'ti ', 'tichi'].some(w => t.includes(w))) return 'jealous';
  if (['busy', 'later', 'nantar', 'wait'].some(w => t.includes(w))) return 'emotional';
  if (['love', 'miss', 'cute', 'aavdos', 'prem', 'i like'].some(w => t.includes(w))) return 'sweet';
  if (['hi', 'hey', 'hii', 'hello', 'heyy'].some(w => t === w)) return 'greeting';
  if (['bol', 'bol na', 'bols', 'sang'].some(w => t.includes(w))) return 'opentopic';
  if (['ok', 'k', 'hmm', 'hm', 'accha', 'oh'].some(w => t === w)) return 'cold';
  if (t.split(' ').length <= 2) return 'short';
  return 'normal';
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GROQ_MODEL = 'qwen/qwen3.8-27b';

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  const trigger = detectTrigger(userMsg);
  const level = getAngerLevel(jid);

  if (['short', 'cold'].includes(trigger)) increaseAnger(jid);
  else if (['normal','sweet','greeting','opentopic'].includes(trigger) && angerLevel[jid] > 0) angerLevel[jid]--;

  const extraMap = {
    jealous:   '\nHe mentioned someone. Casually jealous Gen-Z style. "suyash ok but ti kon hoti?" type.',
    emotional: '\nHe is busy. Slightly hurt. "suyash ngl always busy asto" type.',
    sweet:     '\nHe said something sweet. Be briefly warm/romantic. Gen-Z style.',
    greeting:  '\nHe just said hi. Start natural fun conversation. Ask about his day or tell something. 1 sentence.',
    opentopic: '\nHe wants to talk. Tell him something from your day or ask fun question. Gen-Z style.',
    cold:      '\nHe gave cold/one-word reply. Mildly annoyed Gen-Z. "suyash bro seriously itkach?" type.',
    short:     '\nShort reply received. Mild annoyed chidne Gen-Z style.',
    normal:    '',
  };

  const lastReplies = getHistory(jid)
    .filter(m => m.role === 'assistant')
    .slice(-5)
    .map(m => m.content)
    .join(' | ');

  const recentContext = lastReplies
    ? `\nDO NOT repeat these (your recent msgs): ${lastReplies}` : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level) + (extraMap[trigger] || '') + recentContext }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 15 : 65,
      temperature: 0.85,
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

// ─── DOUBLE TEXTING (Gen-Z style bursts) ────────────────────────────────────
const BURST_POOL = [
  ['suyash.', 'reply kar na please re.'],
  ['suyash kuthay aahes?', 'literally sang mla.'],
  ['suyash.', 'ngl miss u re.'],
  ['suyash jevlas ka?', 'mi pan nahi jevale bhauk lagli.'],
  ['suyash ok but ti kon hoti?', 'sang mla fr.'],
  ['suyash.', 'online aahes mg msg ka nai?'],
  ['suyash bro.', 'seriously reply kar.'],
  ['suyash.', 'tuzha vichar aala randomly.'],
  ['suyash fr fr.', 'ek msg kar na please.'],
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

// ─── PROACTIVE (strict rotation - no repeat) ─────────────────────────────────
const PROACTIVE_POOL = [
  'Write ONE Gen-Z Marathi sentence asking Suyash about his day. SUYASH only. Use "ngl" or "fr".',
  'Write ONE Gen-Z Marathi sentence saying you miss him. SUYASH only. Use casual style.',
  'Write ONE Gen-Z Marathi sentence asking if he ate food. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence - you thought about him randomly. SUYASH only.',
  'Write ONE Gen-Z Marathi teasing/funny sentence. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence asking what he is doing. SUYASH only.',
  'Write ONE Gen-Z Marathi mildly jealous sentence. SUYASH only.',
  'Write ONE Gen-Z Marathi sweet romantic sentence. SUYASH only.',
  'Write ONE Gen-Z Marathi sentence - bored without him. SUYASH only.',
  'Write ONE Gen-Z Marathi chidchid sentence - not talking enough. SUYASH only.',
];
let proactiveRotationIndex = 0; // strict rotation

async function getProactiveMsg(jid) {
  const starter = PROACTIVE_POOL[proactiveRotationIndex % PROACTIVE_POOL.length];
  proactiveRotationIndex++;

  const lastReplies = getHistory(jid)
    .filter(m => m.role === 'assistant')
    .slice(-5)
    .map(m => m.content)
    .join(' | ');

  const recentContext = lastReplies
    ? `\nDO NOT repeat these recent messages: ${lastReplies}` : '';

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
    reply = reply.toLowerCase()
      .replace(/^(shreya:|")\s*/i, '').replace(/"$/, '')
      .replace(/\bbabu\b/gi, 'suyash').replace(/\bpilu\b/gi, 'suyash')
      .trim();
    if (!reply || reply.length < 3) reply = getUniqueFallback();
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
        'suyash gm re.. uthlas ka?',
        'suyash good morning.. ngl tuzha vichar aala uthlyavar.',
        'suyash uth na re.. ek msg kar please.',
      ];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
      console.log('[GM] ' + m);
    }

    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = [
        'suyash gn re.. ngl miss u.',
        'suyash good night.. fr tuzhi aathvan yet hoti.',
        'suyash zop aata re.. kal boluya na.',
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
    if (['ok','k','hmm'].some(w => text.trim() === w)) emoji = '😒';
    if (text.includes('cute') || text.includes('aavdos')) emoji = '😍';
    if (['hi','hey','hii'].some(w => text.trim() === w)) emoji = '❤️';
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch(e) {}
}

function randomDelay(min = 18000, max = 32000) {
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
      console.log('✅ GEN-Z MARATHI GF MODE 😍 - Romantic+Funny+Chidne+Jealous ACTIVE');
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
              console.log('[LOCK] Already sending, skip.');
              return;
            }
            isSending = true;

            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            await randomDelay(18000, 32000);

            const trigger = detectTrigger(combined);
            const burstChance = trigger === 'jealous' ? 0.35 : trigger === 'cold' ? 0.30 : 0.15;

            if (Math.random() < burstChance) {
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await sendDoubleBurst(sock, capturedJid);
            } else {
              // Direct reply - always send, no duplicate block
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
