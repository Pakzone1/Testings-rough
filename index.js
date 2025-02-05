require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const OpenAI = require('openai');
const functions = require('./functions');
const config = require('./config');
const { COMMANDS, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('./constants');
const { fileUtils, phoneUtils, timeUtils } = require('./utils');
const threadManager = require('./thread_manager');
const fetch = require('node-fetch');
const path = require('path');
const logger = require('./utils/logger');

// Get instance directory
const INSTANCE_DIR = process.cwd();
const INSTANCE_QR_PATH = path.join(INSTANCE_DIR, 'qr_code.png');
const INSTANCE_AUTH_PATH = path.join(INSTANCE_DIR, '.wwebjs_auth');
const INSTANCE_CACHE_PATH = path.join(INSTANCE_DIR, '.wwebjs_cache');

// Initialize admin numbers from config
const ADMIN_NUMBERS = config.admin.numbers;
global.ADMIN_NUMBERS = ADMIN_NUMBERS;

const assistant = new OpenAI({
    apiKey: config.openai.apiKey,
});

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: config.whatsapp.clientId,
        dataPath: INSTANCE_AUTH_PATH
    }),
    puppeteer: config.whatsapp.puppeteerOptions,
    restartOnAuthFail: config.whatsapp.restartOnAuthFail,
    takeoverOnConflict: config.whatsapp.takeoverOnConflict,
    takeoverTimeoutMs: config.whatsapp.takeoverTimeoutMs
});

// Set the global WhatsApp client reference
global.whatsappClient = client;

let isBotActive = true;
let botNumber = '';
let lastProcessedMessageTime = 0;
const processedMessageIds = new Set();

// Ensure required directories exist
fileUtils.ensureDirectoryExists(INSTANCE_AUTH_PATH);
fileUtils.ensureDirectoryExists(INSTANCE_CACHE_PATH);

let isInitialized = false;
let isCheckingMessages = false;

async function updateDashboardStatus(status, error = null) {
    try {
        const endpoint = status === 'connected' ? 'set_bot_connected' : 'set_bot_disconnected';
        await fetch(`http://${config.server.host}:${config.server.port}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error })
        });
    } catch (err) {
        logger.error('Failed to update dashboard status:', err);
    }
}

function stopBot() {
    isBotActive = false;
    logger.system('Bot stopped');
}

function startBot() {
    isBotActive = true;
    logger.system('Bot started');
}

client.on('qr', async (qr) => {
    logger.whatsapp('QR Code received');
    try {
        await qrcode.toFile(INSTANCE_QR_PATH, qr, {
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        logger.whatsapp('QR code generated successfully');
        await updateDashboardStatus('disconnected');
    } catch (err) {
        logger.error('Error generating QR code:', err);
    }
});

client.on('ready', async () => {
    logger.startup('WhatsApp client is ready!');
    botNumber = client.info.wid.user;
    isBotActive = true;

    if (!ADMIN_NUMBERS.includes(botNumber)) {
        ADMIN_NUMBERS.push(botNumber);
        global.ADMIN_NUMBERS = ADMIN_NUMBERS;
    }

    functions.loadIgnoreList();

    if (!isCheckingMessages) {
        setInterval(checkForNewMessages, config.messaging.pollingInterval);
        isCheckingMessages = true;
    }

    await updateDashboardStatus('connected');
});

async function checkForNewMessages() {
    try {
        const chat = await client.getChatById(phoneUtils.formatWhatsAppId(botNumber));
        const messages = await chat.fetchMessages({ limit: 1 });

        if (messages.length > 0) {
            const latestMessage = messages[0];
            if (latestMessage.from === phoneUtils.formatWhatsAppId(botNumber)) {
                if (latestMessage.timestamp > lastProcessedMessageTime && !processedMessageIds.has(latestMessage.id._serialized)) {
                    lastProcessedMessageTime = latestMessage.timestamp;
                    await processMessage(latestMessage);
                }
            }
        }
    } catch (error) {
        logger.error('Error checking for new messages:', error);
    }
}

async function processMessage(message) {
    const ignoredTypes = [
        'e2e_notification',
        'security_notification',
        'call_log',
        'protocol',
        'gp2',
        'notification_template'
    ];

    if (ignoredTypes.includes(message.type)) {
        return;
    }

    if (processedMessageIds.has(message.id._serialized)) {
        return;
    }

    processedMessageIds.add(message.id._serialized);

    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];
    const messageText = message.body || '';

    logger.whatsapp(`Processing message from: ${senderId}`);

    const isAdmin = ADMIN_NUMBERS.includes(senderNumber);
    const isModerator = functions.isModerator(senderNumber);
    const isBot = senderNumber === botNumber;

    try {
        // Always process commands, even when bot is paused
        if (messageText.toLowerCase().startsWith('!!')) {
            const response = await functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator, stopBot, startBot);
            if (response && !isBot) {
                await client.sendMessage(senderId, response);
            }
        }
        // Only process regular messages if bot is active
        else if (isBotActive && !isBot && !functions.isIgnored(senderNumber)) {
            const response = await functions.storeUserMessage(client, assistant, senderNumber, message);
            if (response) {
                await client.sendMessage(senderId, response);
            }
        }
    } catch (error) {
        logger.error('Error processing message:', error);
        if (!isBot) {
            await client.sendMessage(senderId, ERROR_MESSAGES.SERVER_ERROR);
        }
    }
}

client.on('message_create', async (message) => {
    await processMessage(message);
});

client.on('error', (error) => {
    logger.error('WhatsApp client error:', error);
});

client.on('disconnected', async (reason) => {
    logger.whatsapp(`Client was disconnected: ${reason}`);
    isBotActive = false;

    let errorMessage = ERROR_MESSAGES.CONNECTION_LOST;
    if (reason === 'NAVIGATION') {
        errorMessage = "WhatsApp Web was closed or refreshed. Please reset the bot and scan the QR code again.";
    } else if (reason === 'CONFLICT') {
        errorMessage = "WhatsApp Web was opened in another window. Please close other sessions and reset the bot.";
    } else if (reason === 'LOGOUT') {
        errorMessage = ERROR_MESSAGES.AUTH_FAILED;
    }

    // Give time for files to be released on Windows
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        await client.destroy();  // Properly close the browser
        await new Promise(resolve => setTimeout(resolve, 1000));  // Wait for cleanup
        fileUtils.removeFile(INSTANCE_AUTH_PATH);
    } catch (err) {
        logger.error('Error during cleanup:', err);
    }

    await updateDashboardStatus('disconnected', errorMessage);
});

client.on('authenticated', () => {
    logger.whatsapp('Client authenticated');
    fileUtils.ensureDirectoryExists(INSTANCE_AUTH_PATH);
    fileUtils.ensureDirectoryExists(INSTANCE_CACHE_PATH);
});

client.on('auth_failure', async (msg) => {
    logger.error('Authentication failed:', msg);
    isBotActive = false;
    fileUtils.removeFile(INSTANCE_AUTH_PATH);
    await updateDashboardStatus('disconnected', ERROR_MESSAGES.AUTH_FAILED);
});

client.on('loading_screen', (percent, message) => {
    logger.whatsapp(`Loading: ${percent}% ${message}`);
});

if (!isInitialized) {
    client.initialize();
    isInitialized = true;
    logger.startup('Bot initialization started');
}
