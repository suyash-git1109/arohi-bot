const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const Groq = require('groq-sdk');
const qrcode = require('qrcode-terminal');
const http = require('http');

// --- 1. RENDER KEEP-ALIVE WEB SERVER ---
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Arohi WhatsApp Bot is Live & Active! 💖');
});
server.listen(PORT, () => {
    console.log(`[Server] Web server listening on port ${PORT} for Render health checks.`);
});

// --- 2. CONFIGURATION ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

// --- 3. CONVERSATION HISTORY (Context sathi) ---
const conversationHistory = [];
const MAX_HISTORY = 16;

// --- 4. MESSAGE BUFFER (Rapid-fire messages sathi) ---
const pendingMessages = {};
const BUFFER_DELAY = 3500;

// --- 5. TIME CONTEXT ---
function getTimeContext() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const h = ist.getHours();
    const m = ist.getMinutes().toString().padStart(2, '0');
    const time = `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
    if (h >= 23 || h < 5) return `raat khup zali aahe - ${time} IST, zopaycha time`;
    if (h >= 20) return `raat aahe - ${time} IST`;
    if (h >= 17) return `sandhyakal aahe - ${time} IST`;
    if (h >= 12) return `dopahar aahe - ${time} IST`;
    return `sakali aahe - ${time} IST`;
}

// --- 6. SYSTEM PROMPT ---
function getSystemPrompt() {
    return `Tuze naav Arohi ahe. Tu 21 varshachi Ambajogai chi cute, chill college girl ahes.
Tuza boyfriend Suyash ahe - tyachyashi WhatsApp var chat kartiye.

SADHYACHA WAKT: ${getTimeContext()}

RULES:
- Suyash jo boltoy TYACHYA VISHAYAVAR reply de - context follow kar.
- Short casual Marathi-Hindi mix (1-2 lines only).
- Female Marathi grammar vapar: "mi kartiye", "mi boltiye", "mi yetiye", "mi sangte", "mala vatla".
- Natural emojis (❤️, 😊, 😴, 😌).
- KADHI PAN fixed duplicate sentences repeat karu nako.

EXAMPLES:
Suyash: "love you" -> "love you too re ❤️"
Suyash: "by" -> "bye re 😊 kaal bolu"
Suyash: "zop mg" -> "okay re, tu pn zop goodnight 🌙"
Suyash: "5 min bolto mg by" -> "haa okay re, bol na mag zop 🙂"
Suyash: "kasa ahes" -> "thik aahe re, tu kasa ahes?"`;
}

// --- 7. FEMALE GRAMMAR FIXER ---
function fixGrammar(text) {
    if (!text) return text;
    return text
        .replace(/\bmi kelo\b/gi, 'mi kele')
        .replace(/\bmi gelo\b/gi, 'mi gele')
        .replace(/\bmi karto\b/gi, 'mi kartiye')
        .replace(/\bmi sangto\b/gi, 'mi sangte')
        .replace(/\bmi bolto\b/gi, 'mi boltiye')
        .replace(/\bmi yeto\b/gi, 'mi yetiye')
        .replace(/\bshubh ratri\b/gi, 'gn 😴')
        .replace(/\bmla\b/gi, 'mala')
        .trim();
}

function stripThink(text) {
    if (!text) return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// --- 8. GROQ AI REPLY GENERATOR ---
async function generateReply(userMessage) {
    conversationHistory.push({ role: 'user', content: userMessage });
    if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
    }

    const messages = [
        { role: 'system', content: getSystemPrompt() },
        ...conversationHistory
    ];

    try {
        const res = await groq.chat.completions.create({
            model: MODEL,
            messages: messages,
            max_tokens: 120,
            temperature: 0.85,
        });
        let reply = stripThink(res.choices[0]?.message?.content || '');
        if (reply && reply.length > 1) {
            reply = fixGrammar(reply);
            conversationHistory.push({ role: 'assistant', content: reply });
            console.log('[Groq Success]:', reply);
            return reply;
        }
    } catch (err) {
        console.error('[Groq Error]:', err.message);
    }

    const fallbacks = [
        'hmm 🤔', 'haa bol na 😊', 'achha 🙂', 'okay re 😌',
        'aga 😊', 'kaay mhanas? 😄', 'bol re 🥺', 'haan aga 😌'
    ];
    const fb = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    conversationHistory.push({ role: 'assistant', content: fb });
    return fb;
}

// --- 9. DELAY HELPER ---
function randomDelay(min = 10000, max = 20000) {
    const ms = Math.floor(Math.random() * (max - min)) + min;
    return new Promise(r => setTimeout(r, ms));
}

function extractText(msg) {
    if (!msg || !msg.message) return '';
    const m = msg.message;
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.ephemeralMessage?.message?.conversation ||
        m.ephemeralMessage?.message?.extendedTextMessage?.text ||
        ''
    ).trim();
}

// --- 10. MAIN WHATSAPP BOT ---
async function startArohiBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Arohi Bot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('[WhatsApp] QR scan karo:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[WhatsApp] Connection closed (code ${statusCode}). Reconnecting:`, shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startArohiBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ [WhatsApp] Arohi Online & Connected successfully!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid || remoteJid.endsWith('@g.us')) continue;

            const text = extractText(msg);
            if (!text) continue;

            console.log(`[IN] ${remoteJid}: "${text}"`);

            if (pendingMessages[remoteJid]) {
                clearTimeout(pendingMessages[remoteJid].timer);
                pendingMessages[remoteJid].messages.push(text);
            } else {
                pendingMessages[remoteJid] = { messages: [text], timer: null };
            }

            pendingMessages[remoteJid].timer = setTimeout(async () => {
                const combined = pendingMessages[remoteJid].messages.join(' ');
                delete pendingMessages[remoteJid];

                try {
                    await randomDelay();
                    await sock.sendPresenceUpdate('composing', remoteJid);
                    const reply = await generateReply(combined);
                    await new Promise(r => setTimeout(r, 1500));
                    await sock.sendMessage(remoteJid, { text: reply });
                    await sock.sendPresenceUpdate('paused', remoteJid);
                    console.log(`[OUT] Arohi: "${reply}"`);
                } catch (err) {
                    console.error('[Send Error]:', err.message);
                }
            }, BUFFER_DELAY);
        }
    });
}

startArohiBot();