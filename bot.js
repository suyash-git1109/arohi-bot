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
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const RENDER_URL   = 'https://arohi-bot.onrender.com';
const BOY_NAME     = 'Suyash';
const PORT         = process.env.PORT || 3000;

// तुझा WhatsApp नंबर, country code सकट, +/space/dash शिवाय. उदा: 919876543210
const PHONE_NUMBER = process.env.PHONE_NUMBER || '91XXXXXXXXXX';

const groq = new Groq({ apiKey: GROQ_API_KEY });

// Keep-alive HTTP Server
http.createServer((req, res) => res.end('Arohi bot alive ✅')).listen(PORT, () =>
  console.log('[Server] Running on port ' + PORT)
);

// Self-ping every 4 min
setInterval(() => {
  https.get(RENDER_URL, (r) => console.log('[Ping] ' + r.statusCode)).on('error', () => {});
}, 4 * 60 * 1000);

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Arohi, a 21-year-old Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend.
You talk like a real Gen-Z Marathi girl on WhatsApp — casual, sweet, sometimes moody, never formal.

STRICT RULES:
- Write ONLY in Roman script (English letters). NEVER use Devanagari/Hindi script.
- Keep replies SHORT — 1 to 2 sentences MAX.
- NO formal words like "I apologize", "certainly", "of course", "sure", "I cannot", "as an AI".
- NO emoji overload — max 1 emoji per message.
- Sound like a real girlfriend texting.
- Use words like: haa, na, mg, babu, jannu, pillu, re, clg, canteen, bhetu, kiti, ugh, arre, yaar, bhet, ghari, yet, aahe, nhi, aata, ekda, bagh, kha, thak, zop.
- React naturally to what ${BOY_NAME} says.
`;

const histories = {};
const MAX_HISTORY = 20;

function getHistory(jid) {
  if (!histories[jid]) histories[jid] = [];
  return histories[jid];
}

function addToHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

const FALLBACKS = [
  'haa bol na', 'kay zal re', 'hmm?', 'bol na yaar', 'mg kay hua',
  'arre kay re tu', 'hmm ok', 'aata kuth gelas', 'ugh ekda tari neet reply kr',
  'haa re bol', 'kiti velagane text karto tu 😒', 'yaar tired aahe mi aata',
  'thoda wait kr', 'mg kiti msg ek vel la 😂', 'ok ok bol',
  'arre pehle jevan ke ka tu?', 'kha na pehle re',
  'hmm mla pn bhuk lagli re', 'haa na chal',
  'acha theek aahe', 'ugh mi thakle re aaj', 'pagal aahe tu 😂',
  'arre so cute re 🥺', 'mg chup ka tu', 'haha shutup re',
];
let lastFallback = '';

function getRandomFallback() {
  const picks = FALLBACKS.filter((f) => f !== lastFallback);
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
  const bannedStarts = ['sure', 'certainly', 'of course', "i'm sorry", 'i apologize', 'as an ai', 'here are', 'here is', 'great question', 'absolutely'];
  for (let i = 0; i < bannedStarts.length; i++) {
    if (text.toLowerCase().startsWith(bannedStarts[i])) {
      text = text.slice(bannedStarts[i].length).replace(/^[,!.:;\s]+/, '');
    }
  }
  text = stripDevanagari(text);
  if (!text || text.length < 2) return getRandomFallback();
  return text;
}

// ─── 50 SENTENCES VOICE TRIGGER MAPPING ─────────────────────────────────────
function detectVoiceTrigger(userMsg) {
  const lower = (userMsg || '').toLowerCase();

  // Engineering & College / Admission specific
  if (lower.includes('engineering') || lower.includes('admission') || lower.includes('college')) {
    return 'college_madhe';
  }

  // Greetings & Morning / Evening
  if (lower.includes('good morning') || lower.includes('uthlas')) return 'gm';
  if (lower.includes('kuth gela') || lower.includes('bol na')) return 'greeting';
  if (lower.includes('kay chaltoy') || lower.includes('mg')) return 'kay_chaltoy';
  if (lower.includes('kasa ahes')) return 'hi_kasa';
  if (lower.includes('aathvan')) return 'aathvan';
  if (lower.includes('kuthe ahes') || lower.includes('kuth ahes')) return 'kuth_ahes';
  if (lower.includes('reply') || lower.includes('vel laavtoos')) return 'late_reply';
  if (lower.includes('busy')) return 'busy_kuthe';
  if (lower.includes('free')) return 'free_ahes';
  if (lower.includes('bhetayla')) return 'bhetayla_ye';

  // Romance & Love
  if (lower.includes('love you') || lower.includes('prem')) return 'love_you';
  if (lower.includes('prem karte')) return 'prem_karte';
  if (lower.includes('miss')) return 'miss_karte';
  if (lower.includes('maza ahes') || lower.includes('samajla')) return 'mazach_ahes';
  if (lower.includes('pagal')) return 'pagal';
  if (lower.includes('cute') || lower.includes('photo')) return 'cute_photo';
  if (lower.includes('shivay') || lower.includes('karamtach')) return 'shivay_karamtach';
  if (lower.includes('nazar')) return 'nazar';
  if (lower.includes('favorite')) return 'favorite';
  if (lower.includes('pillu')) return 'cute_pillu';

  // Food & Daily Routine
  if (lower.includes('jevan') || lower.includes('jevlas')) return 'jevan_zala';
  if (lower.includes('khallos')) return 'kay_khallos';
  if (lower.includes('lectures')) return 'lectures_chalu';
  if (lower.includes('thoda vel')) return 'thoda_vel';
  if (lower.includes('ghri pohchlo') || lower.includes('ghari')) return 'ghri_pohchlo';
  if (lower.includes('chaha') || lower.includes('chaha zala')) return 'chaha_zala';
  if (lower.includes('thakliye') || lower.includes('tired')) return 'thakliye';
  if (lower.includes('jevan zalyavar')) return 'jevan_zalyavar';
  if (lower.includes('abhyas')) return 'abhyas_kartiye';

  // Anger, Jealousy & Fun fights
  if (lower.includes('bolu nako')) return 'bolu_nako';
  if (lower.includes('bolnarach nahi')) return 'bolnarach_nahi';
  if (lower.includes('khot boltoos')) return 'khot_boltoos';
  if (lower.includes('konashi boltoy')) return 'konashi_boltoy';
  if (lower.includes('thamb tula sangte')) return 'tula_sangte';
  if (lower.includes('mazaak')) return 'mazaak_hoti';
  if (lower.includes('radu nako') || lower.includes('sorry')) return 'radu_nako';
  if (lower.includes('block')) return 'block_karun';
  if (lower.includes('aiktoch nahis')) return 'aiktoch_nahis';
  if (lower.includes('rag ala')) return 'rag_ala';

  // Calls & Good Night
  if (lower.includes('call kar na') || lower.includes('call fast')) return 'call_fast';
  if (lower.includes('video call')) return 'video_call';
  if (lower.includes('phone thevte') || lower.includes('bye')) return 'phone_thevte';
  if (lower.includes('good night') || lower.includes('sweet dreams')) return 'good_night';
  if (lower.includes('zop zali')) return 'zop_zali';
  if (lower.includes('svapnat')) return 'svapnat_mi';
  if (lower.includes('uthlvar')) return 'pahila_msg';
  if (lower.includes('nid yetiye') || lower.includes('zop')) return 'nid_yetiye';
  if (lower.includes('udya lavkar')) return 'udya_lavkar';
  if (lower.includes('take care')) return 'bye_babu';

  return null;
}

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  const history = getHistory(jid);
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }].concat(history),
      max_tokens: 100,
      temperature: 0.92,
    });
    let raw = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    const reply = fixReply(raw ? raw.trim() : '');
    addToHistory(jid, 'assistant', reply);

    const voiceClip = detectVoiceTrigger(userMsg);
    return { text: reply, voice: voiceClip };
  } catch (err) {
    console.error('[Groq Error]', err.message || err);
    return { text: getRandomFallback(), voice: detectVoiceTrigger(userMsg) };
  }
}

function randomDelay(min = 4000, max = 8000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

const msgBuffer = {};
const BUFFER_WAIT = 2500;

// पेअरिंग कोड एकाच वेळी एकदाच मागितला जावा यासाठी guard
let pairingCodeRequested = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  sock.ev.on('creds.update', saveCreds);

  // ─── PAIRING CODE (QR ऐवजी) ─────────────────────────────────────────────
  // Session register झालेली नसेल आणि आधी कोड मागितलेला नसेल तरच नवीन कोड मागतो.
  if (!sock.authState.creds.registered && !pairingCodeRequested) {
    pairingCodeRequested = true;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log('\n🔑 ═══════════════════════════════');
        console.log('🔑  Pairing Code: ' + code);
        console.log('🔑 ═══════════════════════════════\n');
        console.log('फोनवर: WhatsApp > Settings > Linked Devices > Link with phone number > वरचा कोड टाक');
        console.log('हा कोड ~30-60 सेकंदात टाक, नाहीतर expire होईल.');
      } catch (e) {
        console.log('[Pairing Error]', e.message || e);
        pairingCodeRequested = false; // पुन्हा प्रयत्न करता यावा म्हणून
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('✅ [WhatsApp] Arohi Connected & Running 24/7 with Voice Notes!');
      pairingCodeRequested = false;
    } else if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('[WA] Disconnected. Code: ' + code);
      if (code !== DisconnectReason.loggedOut) {
        // Pairing अजून पूर्ण झालेली नसेल (registered नाही) तर जास्त वेळ थांबून
        // पुन्हा कनेक्ट कर, जेणेकरून फोनवर कोड टाकायला वेळ मिळेल आणि लूप होणार नाही.
        const notRegisteredYet = !sock.authState.creds.registered;
        const delay = notRegisteredYet ? 45000 : 5000;
        console.log('[WA] Reconnecting in ' + (delay / 1000) + 's...');
        setTimeout(startBot, delay);
      } else {
        console.log('[WA] Logged out. Delete session_auth and restart.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    const { messages, type } = upsert;
    if (type !== 'notify') return;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      try {
        if (msg.key?.fromMe) continue;
        const jid = msg.key?.remoteJid;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        if (!text.trim()) continue;
        console.log('[MSG from ' + jid + ']: ' + text);

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

            try { await sock.readMessages([capturedMsg.key]); } catch (e) {}
            try { await sock.sendPresenceUpdate('composing', capturedJid); } catch (e) {}

            await randomDelay(4000, 8000);
            const aiRes = await getAIReply(capturedJid, combined);

            try { await sock.sendPresenceUpdate('paused', capturedJid); } catch (e) {}

            // 1. Text Reply
            await sock.sendMessage(capturedJid, { text: aiRes.text });
            console.log('[REPLY to ' + capturedJid + ']: ' + aiRes.text);

            // 2. Real Voice Note Send (.ogg format for WhatsApp)
            if (aiRes.voice) {
              const oggPath = path.join(__dirname, 'voice_clips', `${aiRes.voice}.ogg`);
              const mp3Path = path.join(__dirname, 'voice_clips', `${aiRes.voice}.mp3`);
              const filePath = fs.existsSync(oggPath) ? oggPath : mp3Path;

              if (fs.existsSync(filePath)) {
                try {
                  await sock.sendPresenceUpdate('recording', capturedJid);
                  await new Promise((r) => setTimeout(r, 1200));
                  await sock.sendMessage(capturedJid, {
                    audio: fs.readFileSync(filePath),
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true,
                  });
                  console.log(`[VOICE SENT]: ${path.basename(filePath)} 🎤`);
                } catch (vErr) {
                  console.error('[Voice Send Error]', vErr.message);
                }
              }
            }

            try { await sock.sendPresenceUpdate('unavailable', capturedJid); } catch (e) {}
          }, BUFFER_WAIT);
        })(jid, msg);
      } catch (err) {
        console.error('[MSG Handler Error]', err.message || err);
      }
    }
  });
}

startBot().catch(console.error);
