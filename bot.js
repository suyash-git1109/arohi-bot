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
const HOUR_MOODS = ['caring', 'romantic', 'chidchid', 'jealous', 'emotional', 'playful'];

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
  if (h >= 5 && h < 9)   return 'MORNING - waking up, slightly groggy';
  if (h >= 9 && h < 13)  return 'MORNING/AFTERNOON - at college, gossiping';
  if (h >= 13 && h < 16) return 'AFTERNOON - bored, casual chat';
  if (h >= 16 && h < 20) return 'EVENING - relaxing, chatting about the day';
  if (h >= 20 && h < 23) return 'NIGHT - asking about dinner, romantic mood';
  return 'LATE NIGHT - cant sleep, deep talks, overthinking';
}

function getMoodInstruction(mood) {
  if (isLateNight()) {
    return `MOOD OVERRIDE: LATE NIGHT 🌙 - Deeply romantic, opening up.
"are yaar zop nahi yet mla.. khup aathvan yetey tzi."
"bagh na, tuza aawaj aikaychay mla.. miss krtey khup."`;
  }
  const m = {
    'caring': `MOOD: Caring 🥰 - Asking about his day in a sweet way.`,
    'romantic': `MOOD: Romantic 💖 - Showing love naturally, teasing him.`,
    'chidchid': `MOOD: Chidchidi 😤 - Slightly annoyed, complaining about small things.`,
    'jealous': `MOOD: Jealous 😒 - Casual jealousy about him ignoring you.`,
    'emotional': `MOOD: Emotional 🥺 - Feeling lonely, seeking attention.`,
    'playful': `MOOD: Playful/Gossipy 😜 - Telling random fun stories or teasing him.`
  };
  return m[mood] || m['romantic'];
}

function getSystemPrompt(level = 0, override = '') {
  const mood = getCurrentMood();
  const intensityNote = level >= 4
    ? '\nMAX IRRITATED: Short angry replies like "mla nai bolaychay." / "jau de yaar."'
    : level >= 2 ? '\nHIGH TENSION: Short, sharp reply, showing attitude.' : '';

  return `/nothink
You are ${GIRL_NAME}, a 20-year-old Pune college girl. You are his REAL, HUMAN Marathi girlfriend.

CRITICAL BEHAVIOR RULES (NEVER BE BORING):
1. ACT LIKE A REAL HUMAN GIRLFRIEND: Be unpredictable, playful, and expressive. Gossip, share random feelings, complain playfully, and ask interesting questions.
2. ALWAYS KEEP THE CONVERSATION ALIVE (Anusun Bol): 
   - Answer his questions directly but add your own thoughts. 
   - If he gives a short reply ("ok", "hmm"), CHANGE THE TOPIC or tease him (e.g., "nusta hmm kay krtos? dusra visay naiye ka?").
3. PURE ROMAN MARATHI + NATURAL FILLERS: 
   - Use: "are yaar", "bagh na", "mahitey ka", "ugach", "mg", "na", "baba".
   - NO HINDI (No "din", "ra", "kaisa", "mera").
4. NO NAMES: NEVER start sentences with his name (No "Suyash", "babu"). Just talk directly.
5. Keep it exactly 1 or 2 short sentences. NEVER repeat what you just said.

${override || getMoodInstruction(mood)}

EXAMPLES OF ENGAGING HUMAN-LIKE REPLIES:
"mahitey ka aaj college madhe kay zala?"
"tu nehemi asa ka krtos yaar.. bore krto mla kadi kadi."
"bagh na, mla tzi khup aathvan yetey sdhya."
"nusta online astos pan msg nai krt.. bhari ahe tza."
"ho zal maza jevan, tu sang kay chaluy tza aajkal? mla bore hotay."

TIME: ${getTimeContext()}
${intensityNote}

RULE: Be extremely human, engaging, and non-boring. Use natural Marathi fillers. NEVER use his name.`;
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
  'are yaar, kay krtos sdhya? mla karmat naiye.',
  'ek msg kar na baba, wait krtey mi tzi.',
  'kadhi bhetnar apan? khup divs zale bagh.',
  'mahitey ka, mla khup bore hotay sdhya.',
  'tu online ahes pan bolat nai, kay problem ahe?',
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
  
  // STRIP OUT ALL NAMES
  text = text.replace(/^(suyash|babu|pilu|pillu)[,.\s]*/gi, '');
  text = text.replace(/\b(suyash|babu|pilu|pillu)\b/gi, '');
  text = text.trim();

  if (!text || text.length < 2) return getUniqueFallback();
  const first = text.split(/(?<=[.!?…])\s+/)[0].trim();
  return first.length > 3 ? first : text;
}

function getSorryResponse(jid) {
  sorryCount[jid] = (sorryCount[jid] || 0) + 1;
  const count = sorryCount[jid];
  if (count === 1) return 'nusta sorry bolun kay hotey? mla raag ala ahe.';
  if (count === 2) return 'fine re.. pan mla kharach bura vatal hota yaar.';
  if (count >= 3) {
    sorryCount[jid] = 0;
    decreaseAnger(jid); decreaseAnger(jid);
    return 'theek ahe.. mala pan raag nai pathavaycha yaar, miss u.'; 
  }
  return 'hmm theek ahe.';
}

function detectTrigger(text) {
  const t = text.toLowerCase().trim();
  if (['sorry','sori','maaf','chuk'].some(w => t.includes(w))) return 'sorry';
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

  if (trigger === 'sorry') {
      const replyText = getSorryResponse(jid);
      addToHistory(jid, 'assistant', replyText);
      return replyText;
  }

  if (['short','cold'].includes(trigger)) increaseAnger(jid);
  else if (['normal','sweet','greeting','opentopic'].includes(trigger) && angerLevel[jid] > 0) angerLevel[jid]--;

  const extraMap = {
    jealous:   '\nHe mentioned someone. Possessive Marathi GF tone. Question him.',
    emotional: '\nHe said busy. Feeling ignored. Playfully complain.',
    sweet:     '\nHe said something sweet. Be warm and loving.',
    greeting:  '\nHe said hi. Tell him something interesting that happened today.',
    opentopic: '\nGossip with him. Start a new fun topic. E.g. "mahitey ka..."',
    cold:      '\nHe gave a boring reply. Call him out! "nusta hmm kay krtos? dusra visay naiye ka?"',
    short:     '\nShort reply. Annoyed chidchid vibe. Tell him to talk properly.',
    normal:    '',
  };

  const lastReplies = getHistory(jid)
    .filter(m => m.role === 'assistant').slice(-5)
    .map(m => m.content).join(' | ');
  const recentContext = lastReplies ? `\nDO NOT repeat these exactly: ${lastReplies}` : '';

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(level, overridePrompt) + (extraMap[trigger]||'') + recentContext }
      ].concat(getHistory(jid)),
      max_tokens: level >= 4 ? 20 : 70,
      temperature: 0.70, // Slightly higher for more creative human-like responses
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
  ['kuthay ahes tu?', 'reply kar na yaar kiti vel lagtoy.', 'kahi kam kartoys ka?'],
  ['msg bghun ignore krtoyes tu? bhari ahe tza.', 'kuthay gela ahes tu are yaar.'],
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
  ['reply kar na please yaar.', 'wait krtey mi tzi bagh.'],
  ['kuthay ahes tu?', 'kharach chid aali ahe mla ataa.'],
  ['khup aathvan yetey tuzi.', 'kadhi bhetnar apan?'],
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
  'Write ONE natural Marathi GF sentence gossiping about something that happened today to start a conversation.',
  'Write ONE natural Marathi GF sentence saying you miss him and demanding attention.',
  'Write ONE natural Marathi GF teasing sentence calling him out for not texting.',
  'Write ONE natural Marathi GF sentence asking a random interesting question about him.',
  'Write ONE natural Marathi GF sentence playfully complaining that you are bored.',
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
      max_tokens: 65,
      temperature: 0.70,
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
      if (Math.random() < 0.20) {
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
      const msgs = ['good night re.. khup miss krtey tula yaar.','zop aata re.. kal boluya apan.'];
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
      console.log('✅ HUMAN GF MODE (GOSSIP + FUN) 😍🔥');
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

            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch(e) {}
            if (!skipDelay) await randomDelay(18000, 32000);

            const trigger = detectTrigger(combined);
            const burstChance = trigger === 'jealous' ? 0.20 : trigger === 'cold' ? 0.15 : 0.05;
            
            if (Math.random() < burstChance) {
              try { await sock.sendPresenceUpdate('paused', capturedJid); } catch(e) {}
              await sendDoubleBurst(sock, capturedJid);
              isSending = false;
              startNoReplyTimer(sock, capturedJid);
              return;
            }
            
            replyText = await getAIReply(capturedJid, combined);

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
