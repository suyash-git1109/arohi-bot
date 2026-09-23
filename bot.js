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
const QRCode = require('qrcode');
const url = require('url');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const RENDER_URL   = 'https://arohi-bot.onrender.com';
const BOY_NAME     = 'Suyash';
const GIRL_NAME    = 'Shreya';
const PORT         = process.env.PORT || 3000;
const QR_TOKEN     = process.env.QR_TOKEN || 'arohi-9f3k2x7q';

// 👇👇👇 ELEVENLABS CONFIG 👇👇👇
const ELEVENLABS_API_KEY = 'sk_a619de968a54a2ac7208654ab983ec2daffe836ff093cb7e'; 
const ELEVENLABS_VOICE_ID = 'dVTC43Yewy5fAIcmsISI';            
// 👆👆👆 ──────────────────── 👆👆👆

const groq = new Groq({ apiKey: GROQ_API_KEY });

// ─── QR CODE STATE ────────────────────────────────────────────────────────────
let latestQR = null;       
let connectionStatus = 'starting'; 

// ─── HTTP Server ──────────────────────────────────────────────
http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/qr') {
    const key = parsed.query.key;
    if (key !== QR_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    if (connectionStatus === 'connected') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp Connected! Bot is live.</h2>');
    }
    if (!latestQR) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;background:#111;color:#fff"><h2>Generating QR code... (auto-refresh in 3s)</h2></body></html>');
      return;
    }
    try {
      const qrImage = await QRCode.toDataURL(latestQR, { width: 320, margin: 2 });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
        <head><meta http-equiv="refresh" content="20"></head>
        <body style="font-family:sans-serif;background:#111;color:#fff;text-align:center;padding-top:40px">
          <h2>${GIRL_NAME} Bot — Scan to Connect WhatsApp</h2>
          <img src="${qrImage}" style="background:#fff;padding:16px;border-radius:8px" />
          <p>QR refreshes automatically. Open WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device.</p>
        </body>
        </html>
      `);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error generating QR: ' + e.message);
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Arohi bot alive ✅ status: ' + connectionStatus);
}).listen(PORT, () => console.log('[Server] Running on port ' + PORT));

setInterval(() => {
  https.get(RENDER_URL, (r) => console.log('[Ping] ' + r.statusCode)).on('error', () => {});
}, 4 * 60 * 1000);

// ─── SYSTEM PROMPT ──────────────────────────────────────────────────────────
function getTimeContext() {
  const h = Math.floor((new Date().getUTCHours() + 5.5) % 24);
  if (h >= 5 && h < 11) return 'It is MORNING. Mention getting ready or waking up.';
  if (h >= 11 && h < 16) return 'It is AFTERNOON. You are busy with college/lunch.';
  if (h >= 16 && h < 20) return 'It is EVENING. You are relaxed after college.';
  if (h >= 20 && h < 24) return 'It is NIGHT. You are at home, softer mood.';
  return 'It is LATE NIGHT. You are sleepy, shorter replies.';
}

function getSystemPrompt() {
  return `You are ${GIRL_NAME}, a 21-year-old Marathi college girl from Pune. You are ${BOY_NAME}'s girlfriend.
CURRENT CONTEXT: ${getTimeContext()}
STRICT RULES:
- Write ONLY in Roman script (English letters). NEVER use Devanagari/Hindi script.
- Keep replies VERY SHORT (mostly 1 to 2 sentences) so they sound natural when spoken out loud.
- Sound like a real Marathi girlfriend. Use words like: haa, na, mg, babu, jannu, pillu, re, bhetu, kiti, arre, yaar.
- Do NOT use emojis, because the voice AI will misread them.
- React naturally and warmly to what ${BOY_NAME} said.`;
}

const histories = {};
function getHistory(jid) {
  if (!histories[jid]) histories[jid] = [];
  return histories[jid];
}
function addToHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

function stripDevanagari(text) {
  return text.replace(/[\u0900-\u097F]+/g, '').replace(/\s+/g, ' ').trim();
}

function fixReply(text) {
  if (!text) return 'hmm bol na babu';
  text = stripDevanagari(text);
  const bannedStarts = ['sure', 'certainly', 'of course', "i'm sorry", 'as an ai'];
  for (let b of bannedStarts) {
    if (text.toLowerCase().startsWith(b)) {
      text = text.slice(b.length).replace(/^[,!.:;\s]+/, '');
    }
  }
  return stripDevanagari(text) || 'hmm babu';
}

async function getAIReply(jid, userMsg) {
  addToHistory(jid, 'user', userMsg);
  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: getSystemPrompt() }].concat(getHistory(jid)),
      max_tokens: 100,
      temperature: 0.9,
    });
    const reply = fixReply(res?.choices?.[0]?.message?.content || '');
    addToHistory(jid, 'assistant', reply);
    return reply;
  } catch (err) {
    console.error('[Groq Error]', err.message);
    return 'hmm kay boltoys';
  }
}

// ─── ELEVENLABS LIVE VOICE GENERATOR ──────────────────────────────────────────
async function generateElevenLabsAudio(text) {
  return new Promise((resolve, reject) => {
    if(!ELEVENLABS_API_KEY) return reject(new Error('API Key missing'));
    
    const data = JSON.stringify({
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      port: 443,
      path: '/v1/text-to-speech/' + ELEVENLABS_VOICE_ID,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) return reject(new Error('ElevenLabs Error: ' + res.statusCode));
      const filepath = path.join(__dirname, 'temp_voice_' + Date.now() + '.mp3');
      const file = fs.createWriteStream(filepath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filepath); });
    });
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

function randomDelay(min = 3000, max = 6000) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

const msgBuffer = {};
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session_auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state, logger: pino({ level: 'silent' }), browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { latestQR = qr; connectionStatus = 'qr'; }
    if (connection === 'open') {
      console.log(`✅ [WhatsApp] ${GIRL_NAME} Connected & Live with Real Voices!`);
      connectionStatus = 'connected'; latestQR = null;
    } else if (connection === 'close') {
      connectionStatus = 'disconnected';
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
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

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text.trim()) continue;

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

            await randomDelay();
            const aiText = await getAIReply(capturedJid, combined);
            
            // Send Text Reply
            await sock.sendMessage(capturedJid, { text: aiText });
            console.log(`[TEXT SENT] ${aiText}`);

            // Generate & Send Live Voice Note
            try {
              await sock.sendPresenceUpdate('recording', capturedJid);
              const audioPath = await generateElevenLabsAudio(aiText);
              
              await sock.sendMessage(capturedJid, {
                audio: fs.readFileSync(audioPath),
                mimetype: 'audio/mp4',
                ptt: true,
              });
              console.log(`[VOICE SENT] 🎤 Live Audio Generated & Sent!`);
              
              fs.unlinkSync(audioPath); // Delete temp file after sending
            } catch (vErr) {
              console.error('[Voice Error]', vErr.message);
            }
            try { await sock.sendPresenceUpdate('paused', capturedJid); } catch (e) {}
          }, 2500);
        })(jid, msg);
      } catch (err) {}
    }
  });
}
startBot().catch(console.error);
