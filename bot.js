const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const Groq = require('groq-sdk');
const qrcode = require('qrcode-terminal');

// --- CONFIG ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

// --- CONVERSATION HISTORY ---
const conversationHistory = [];
const MAX_HISTORY = 16;

// --- MESSAGE BUFFER ---
const pendingMessages = {};
const BUFFER_DELAY = 3500;

// --- TIME CONTEXT ---
function getTimeContext() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const h = ist.getHours();
    const m = ist.getMinutes().toString().padStart(2, '0');
    const time = (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
    if (h >= 23 || h < 5) return 'raat khup zali aahe - ' + time + ' IST';
    if (h >= 20) return 'raat aahe - ' + time + ' IST';
    if (h >= 17) return 'sandhyakal aahe - ' + time + ' IST';
    if (h >= 12) return 'dopahar aahe - ' + time + ' IST';
    return 'sakali aahe - ' + time + ' IST';
}

// --- SYSTEM PROMPT ---
function getSystemPrompt() {
    return 'Tuze naav Arohi ahe. Tu 21 varshachi Ambajogai chi cute, chill college girl ahes.\n' +
        'Tuza boyfriend Suyash ahe - tyachyashi WhatsApp var chat kartiye.\n\n' +
        'SADHYACHA WAKT: ' + getTimeContext() + '\n\n' +
        'IMPORTANT RULES:\n' +
        '- Suyash jo message pathavto TYALA DIRECT reply de - context follow kar\n' +
        '- Short casual Marathi-Hindi mix (1-2 lines max)\n' +
        '- Female grammar: "mi kartiye", "mi boltiye", "mi sangte", "mi zoptiye", "mala vatla"\n' +
        '- Emoji kabhi kabhi vapar\n' +
        '- Repeated same messages KADHI PAN nako\n\n' +
        'EXAMPLES:\n' +
        'Suyash: love you → love you too ❤️\n' +
        'Suyash: by → bye re 😊\n' +
        'Suyash: zop → okay goodnight 🌙\n' +
        'Suyash: kasa ahes → thik aahe re, tu kasa?\n' +
        'Suyash: haa → haan mhanje? 😊\n' +
        'Suyash: nahi → kaa re 🥺\n' +
        'Suyash: miss karte → me pn 🥺';
}

// --- GRAMMAR FIX ---
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

// --- STRIP THINK TAGS ---
function stripThink(text) {
    if (!text) return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// --- GROQ REPLY ---
async function generateReply(userMessage) {
    conversationHistory.push({ role: 'user', content: userMessage });
    if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
    }

    const messages = [
        { role: 'system', content: getSystemPrompt() }
    ].concat(conversationHistory);

    try {
        const res = await groq.chat.completions.create({
            model: MODEL,
            messages: messages,
            max_tokens: 120,
            temperature: 0.9,
        });
        let reply = stripThink(res.choices[0]?.message?.content || '');
        if (reply && reply.length > 1) {
            reply = fixGrammar(reply);
            conversationHistory.push({ role: 'assistant', content: reply });
            console.log('[Groq OK] ' + reply);
            return reply;
        }
    } catch (err) {
        console.error('[Groq Error] ' + err.message);
    }

    const fallbacks = [
        'hmm 🤔', 'haa bol 😊', 'achha 🙂', 'okay re 😌',
        'aga 😊', 'kaay re 😄', 'bol na 🥺', 'haan aga 😌',
        'asa kaa 😅', 'haww 😮', 'khara ka? 😯', 'are baba 😄'
    ];
    const fb = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    conversationHistory.push({ role: 'assistant', content: fb });
    console.log('[Fallback] ' + fb);
    return fb;
}

// --- RANDOM DELAY 15-30s ---
function randomDelay() {
    const ms = Math.floor(Math.random() * 15000) + 15000;
    return new Promise(function(r) { setTimeout(r, ms); });
}

// --- EXTRACT TEXT ---
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

// --- START BOT ---
async function startArohiBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', function(update) {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('[WhatsApp] QR scan karo:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[WhatsApp] Disconnected. Reconnect:', shouldReconnect);
            if (shouldReconnect) setTimeout(startArohiBot, 3000);
        } else if (connection === 'open') {
            console.log('[WhatsApp] Arohi Online!');
        }
    });

    sock.ev.on('messages.upsert', async function({ messages, type }) {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid || remoteJid.endsWith('@g.us')) continue;
            const text = extractText(msg);
            if (!text) continue;

            console.log('[IN] ' + text);

            if (pendingMessages[remoteJid]) {
                clearTimeout(pendingMessages[remoteJid].timer);
                pendingMessages[remoteJid].messages.push(text);
            } else {
                pendingMessages[remoteJid] = { messages: [text], timer: null };
            }

            pendingMessages[remoteJid].timer = setTimeout(async function() {
                const combined = pendingMessages[remoteJid].messages.join(' ');
                delete pendingMessages[remoteJid];

                try {
                    await randomDelay();
                    await sock.sendPresenceUpdate('composing', remoteJid);
                    const reply = await generateReply(combined);
                    await new Promise(function(r) { setTimeout(r, 1500); });
                    await sock.sendMessage(remoteJid, { text: reply });
                    await sock.sendPresenceUpdate('paused', remoteJid);
                    console.log('[OUT] ' + reply);
                } catch (err) {
                    console.error('[Error] ' + err.message);
                }
            }, BUFFER_DELAY);
        }
    });
}

startArohiBot();
console.log('Arohi bot starting...');