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
const HOUR_MOODS = ['caring', 'romantic', 'chidchid', 'jealous', 'emotional'];

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
  if (h >= 5 && h < 9)   return 'MORNING - waking up, asking if he slept well';
  if (h >= 9 && h < 13)  return 'MORNING/AFTERNOON - checking on his day/college';
  if (h >= 13 && h < 16) return 'AFTERNOON - asking if he ate lunch';
  if (h >= 16 && h < 20) return 'EVENING - relaxing, chatting about the day';
  if (h >= 20 && h < 23) return 'NIGHT - asking about dinner, romantic mood';
  return 'LATE NIGHT - cant sleep, deep talks, missing him';
}

function getMoodInstruction(mood) {
  if (isLateNight()) {
    return `MOOD OVERRIDE: LATE NIGHT 🌙 - Deeply romantic, slightly emotional.
"zop nahi yet re tzyashivay.. khup aathvan yetey."
"aawaj aikaychay tzha.. miss krtey khup."`;
  }
  const m = {
    'caring': `MOOD: Caring & Loving 🥰 
"jevlas ka re tu? velavar jevat ja na."
"kuthay ahes? ghari gela ka tu?"`,
    'romantic': `MOOD: Romantic & Missing Him 💖 
"khup aathvan yetey re tuzi.. kadhi bhetnar apan?"
"tu kiti chhan ahes yaar.. I love you."`,
    'chidchid': `MOOD: Chidchidi 😤
"kiti vel lavtos reply dyayla? mi nai bolnar ja."
"tula mazi kahi padlich naiye.. ek msg pan nai krta yet tula."`,
    'jealous': `MOOD: Possessive & Jealous 😒 
"ti mulgi kon hoti tzyasobat? khar sang mala."
"konashi boltoye itka vel online?"`,
    'emotional': `MOOD: Emotional 🥺
"tu mla sodun tar nai janar na kadhi?"
"ekti vattey re mla tzyashivay khup."`
  };
  return m[mood] || m['romantic'];
}

function getSystemPrompt(level = 0, override = '') {
  const mood = getCurrentMood();
  const intensityNote = level >= 4
    ? '\nMAX IRRITATED: Only 3-5 words. "mla nai bolaychay." / "jau de."'
    : level >= 2 ? '\nHIGH TENSION: Short, sharp reply.' : '';

  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Pune college girl. You are his PERFECT Marathi girlfriend.

CRITICAL LANGUAGE RULES (DO NOT HALLUCINATE):
1. PURE ROMAN MARATHI ONLY.
2. NO HINDI. NEVER use words like "din", "ra", "kya", "mera", "kaisa", "thode", "kathe".
3. CORRECT WORDS: "diwas" (not din), "re" (not ra), "kay" (not kya), "kasa" (not kaisa), "karte" (not kathe), "zala" (not lagle for bore).
4. DO NOT use Gen-Z slang like "ngl", "fr", "literally". Keep it purely Marathi.
5. NEVER USE HIS NAME. DO NOT start sentences with "Suyash". Just talk directly. (e.g. say "kay krtos re tu?" NOT "suyash kay krtos re tu?").
6. DO NOT use names like "babu", "pilu", "suyash".

${override || getMoodInstruction(mood)}

EXAMPLES OF PERFECT MARATHI GRAMMAR (NO NAMES):
"jevlas ka re? kuthay ahes tu sdhya?"
"kiti vel lavtos reply dyayla yaar."
"khup aathvan ali tuzi."
"aaj college madhe khup bore zala."
"kay krtos sdhya?"

REACT NATURALLY & PLAYFULLY (1-2 SHORT LINES):
- "hi/hey" → "kay krtos re tu?"
- "bol na" → Tell him something from your day in proper Marathi. Keep it interesting.
- "ok/hmm" → "nusta hmm kay krtos? nit bol na."

TIME: ${getTimeContext()}
${intensityNote}

RULE: STRICTLY proper Roman Marathi. NO Hindi mix. 1-2 lines only. NO NAMES. Playful girlfriend vibe.`;
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

// ─── FALLBACKS (Pure Marathi) ─────────────────────────────────────────────────
const FALLBACKS = [
  'kuthay ahes tu? reply kar na re.',
  'khup aathvan yetey tuzi yaar.',
  'jevlas ka re tu?',
  'kay krtos sdhya? mla karmat naiye.',
  'ek msg kar na yaar, wait krtey mi tzi.',
  'tu thik ahes na? kalji ghe swatahchi.',
  'kiti ignore krnar mala? chid aali ahe mla.',
  'kadhi bhetnar apan? khup divs zale.',
  'mi khup thakley re aaj.',
  'ekti vattey mla tzyashivay khup.',
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
  
  // STRIP OUT ALL NAMES (suyash, babu, pilu) to make it purely conversational
  text = text.replace(/^(suyash|babu|pilu|pillu)[,.\s]*/gi, '');
  text = text.replace(/\b(suyash|babu|pilu|pillu)\b/gi, '');
  text = text.trim();

  if (!text || text.length < 2) return getUniqueFallback();
  const first = text.split(/(?<=[.!?…])\s+/)[0].trim();
  return first.length > 3 ? first : text;
}

// ─── KEYWORD TRAPS 🎯 ─────────────────────────────────────────────────────────
function checkKeywordTrap(text) {
  const t = text.toLowerCase();
  if (['game','gaming','pubg','freefire','cod','valorant'].some(w => t.includes(w))) return 'game';
  if (['thaklo','tired','thak','thakli','thaklay','damlo'].some(w => t.includes(w))) return 'tired';
  if (['jevlo','jevan','khallo','food','khato','jevo'].some(w => t.includes(w))) return 'food';
  if (['zoplo','zop','sleep','zopi','zopte'].some(w => t.includes(w))) return 'sleep';
  if (['sorry','sori','maaf','chuk'].some(w => t.includes(w))) return 'sorry';
  return null;
}

const KEYWORD_RESPONSES = {
  game: [
    'nusta game kheltos tu.. mzyakade vel naiye na tula.',
    'game band kar ek min ani mzyashi bol na yaar.',
  ],
  tired: [
    'aaram kar re tu.. khup thakla asel. kalji ghe.',
    'aaram kar, zopun ghe thoda vel.',
  ],
  food: [
    'kay jevlas mg? mla pan bhuk lagli ahe.',
    'velavar jevat ja re, kalji nste tula swatahchi.',
  ],
  sleep: [
    'mla na sangta zoplas? kiti ghanerda ahes tu yaar.',
    'zopla hota ka tu? mla kititari vel wait karayla lavlas.',
  ],
};

function getSorryResponse(jid) {
  sorryCount[jid] = (sorryCount[jid] || 0) + 1;
  const count = sorryCount[jid];
  if (count === 1) return 'nusta sorry bolun kay hotey? mla raag ala ahe.';
  if (count === 2) return 'fine re.. pan mla kharach bura vatal hota.';
  if (count >= 3) {
    sorryCount[jid] = 0;
    decreaseAnger(jid); decreaseAnger(jid);
    return 'theek ahe.. mala pan raag nai pathavaycha yaar, miss u.'; 
  }
  return 'hmm theek ahe.';
}

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
    jealous:   '\nHe mentioned someone. Possessive Marathi GF. "ti kon hoti?" type.',
    emotional: '\nHe said busy. Feeling ignored. "tu nehemi busy astos" type.',
    sweet:     '\nHe said something sweet. Be warm, loving and romantic in proper Marathi.',
    greeting:  '\nHe said hi. Ask if he ate or how his day was. Proper Marathi.',
    opentopic: '\nHe wants to talk. Tell something interesting from your day to not make it boring.',
    cold:      '\nCold reply. Annoyed. "nusta hmm kay krtos?" type.',
    short:     '\nShort reply. Annoyed chidchid vibe.',
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
      temperature: 0.55,
    });

    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase().replace(/^(shreya:|shreya\s*:|")\s*/i,'').replace(/"$/,'').trim();

    if (!reply || reply.length < 3) reply = getUniqueFallback();
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch(err) {
    console.error('[Groq Error]', err.message);
    return getUniqueFallback();
  }
}

// ─── NO REPLY TIMER ⏱️ ──────────────────────────────────────────────
const NO_REPLY_MSGS = [
  ['kuthay ahes tu?', 'reply kar na re kiti vel lagtoy.', 'kahi kam kartoys ka?'],
  ['msg bghun ignore krtoyes tu? theek ahe.', 'kuthay gela ahes tu yaar.'],
  ['2 taas zale.. ek msg karayla kiti vel lagto.', 'tu thik tar ahes na?'],
];

function startNoReplyTimer(sock, jid) {
  clearNoReplyTimer();
  noReplyCount[jid] = 0;
  function scheduleNext(stage) {
    if (stage > 2) return;
    const delays = [30 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000];
    noReplyTimer = setTimeout(async () => {
      const msgs = NO_REPLY_MSGS[stage];
      const msg = msgs[Math.floor(Math.random() * msgs.length)];
      try {
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 2000));
        await sock.sendMessage(jid, { text: msg });
        addToHistory(jid, 'assistant', msg);
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
  ['reply kar na please yaar.', 'wait krtey mi tzi.'],
  ['kuthay ahes tu?', 'kharach chid aali ahe mla ataa.'],
  ['khup aathvan yetey tuzi.', 'kadhi bhetnar apan?'],
  ['jevlas ka tu?', 'velavar jevun ghe na.'],
  ['ti kon hoti?', 'khar sang mala.'],
  ['online ahes pan msg ka nai krt tu?', 'kiti ignore krnar mala?'],
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
  }
}

// ─── PROACTIVE ────────────────────────────────────────────────────────────────
const PROACTIVE_POOL = [
  'Write ONE proper Marathi GF sentence asking about his day. Do NOT use his name.',
  'Write ONE proper Marathi GF sentence saying you miss him. Do NOT use his name.',
  'Write ONE proper Marathi GF teasing but caring sentence. Do NOT use his name.',
  'Write ONE proper Marathi GF sentence asking what he is doing right now. Do NOT use his name.',
  'Write ONE proper Marathi GF sweet romantic sentence. Do NOT use his name.',
  'Write ONE proper Marathi GF chidchid sentence about him ignoring you. Do NOT use his name.',
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
      temperature: 0.55,
    });
    let reply = fixReply(res?.choices?.[0]?.message?.content?.trim());
    reply = reply.toLowerCase().replace(/^(shreya:|")\s*/i,'').replace(/"$/,'').trim();
    if (!reply || reply.length < 3) reply = getUniqueFallback();
    return reply;
  } catch(e) { return getUniqueFallback(); }
}

function scheduleNextProactive(sock) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  const delay = (25 + Math.floor(Math.random() * 35)) * 60 * 1000;
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
      const msgs = ['good morning re.. uthla ka tu?','good morning.. uthlyavar tuzi aathvan ali.'];
      const m = msgs[Math.floor(Math.random()*msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
    }
    if (h === 23 && min === 0 && !gnSent) {
      gnSent = true; gmSent = false;
      const msgs = ['good night re.. khup miss krtey tula.','zop aata re.. kal boluya apan.'];
      const m = msgs[Math.floor(Math.random()*msgs.length)];
      await sock.sendMessage(lastActiveJid, { text: m });
    }
  }, 60 * 1000);
}

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
      console.log('✅ PERFECT AUTHENTIC MARATHI GF MODE (NO NAMES) 😍🔥');
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

        clearNoReplyTimer();
        await reactToMsg(sock, msg);

        if (msgBuffer[jid]) { clearTimeout(msgBuffer[jid].timer); msgBuffer[jid].msgs.push(text); }
        else { msgBuffer[jid] = { msgs: [text] }; }

        ((capturedJid, capturedMsg) => {
          msgBuffer[capturedJid].timer = setTimeout(async () => {
            if (isSending) return;
            isSending = true;

            const combined = msgBuffer[capturedJid].msgs.join(' ');
            delete msgBuffer[capturedJid];

            try { await sock.readMessages([capturedMsg.key]); } catch(e) {}

            let replyText = null;
            let skipDelay = false;

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
