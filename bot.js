const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const Groq = require('groq-sdk');
const http = require('http');

// --- 1. RENDER KEEP-ALIVE SERVER ---
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Arohi Bot is Live & Active! 💖');
});
server.listen(PORT, () => {
    console.log(`[Server] Web server listening on port ${PORT}`);
});

// --- 2. CONFIGURATION ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

// --- 3. CONVERSATION HISTORY & BUFFER ---
const conversationHistory = [];
const MAX_HISTORY = 16;
const pendingMessages = {};
const BUFFER_DELAY = 3500;

// --- 4. TIME CONTEXT & PROMPT ---
function getTimeContext() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const h = ist.getHours();
    const m = ist.getMinutes().toString().padStart(2, '0');
    const time = `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
    if (h >= 23 || h < 5) return `raat khup zali aahe - ${time} IST, sleepy time`;
    if (h >= 20) return `raat aahe - ${time} IST`;
    if (h >= 17) return `sandhyakal aahe - ${time} IST`;
    if (h >= 12) return `dopahar aahe - ${time} IST`;
    return `sakali aahe - ${time} IST`;
}

function getSystemPrompt() {
    return `Tuze naav Arohi ahe. Tu 21 varshachi Ambajogai chi cute, chill college girl ahes.
Tuza boyfriend Suyash ahe - tyachyashi WhatsApp var chat kartiye.

SADHYACHA WAKT: ${getTimeContext()}

RULES:
- Suyash jo message pathavto TYACHYA VISHAYAVAR reply de - context follow kar.
- Short casual Marathi-Hindi mix (1-2 lines only).
- Female Marathi grammar: "mi kartiye", "mi boltiye", "mi yetiye", "mi sangte", "mala vatla".
- Natural emojis (❤️, 😊, 😴, 😌).
- Duplicates copy-paste repeat karu nako.

EXAMPLES:
Suyash: "love you" -> "love you too ❤️"
Suyash: "by" -> "bye re 😊 kaal bolu"
Suyash: "zop mg" -> "okay goodnight re 🌙"
Suyash: "kasa ahes" -> "thik aahe re, tu kasa ahes?"`;
}

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

    const fallbacks = ['hmm 🤔', 'haa bol na 😊', 'achha 🙂', 'okay re 😌', 'aga 😊', 'bol na 🥺'];
    const fb = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    conversationHistory.push({ role: 'assistant', content: fb });
    return fb;
}

function randomDelay(min = 8000, max = 16000) {
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

// --- 5. STABLE BAILEYS CONNECTION ---
let sock = null;

async function startArohiBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            console.log(`[WhatsApp] Connection closed (code ${statusCode}). Reconnecting: ${!isLoggedOut}`);
            if (!isLoggedOut) {
                setTimeout(startArohiBot, 8000);
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