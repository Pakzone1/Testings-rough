const config = require('./config');
const { ERROR_MESSAGES, SUCCESS_MESSAGES, MESSAGE_STATUS } = require('./constants');
const { fileUtils, phoneUtils, stringUtils, timeUtils } = require('./utils');
const { MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');
const FormData = require('form-data');
const delivery = require('./delivery');
const threadManager = require('./thread_manager');
const fs = require('fs');
const path = require('path');
const qrManager = require('./qr_manager');
const { qrCodesData } = require('./qr_manager');

// Contact naming system
const contactNaming = {
    currentPrefix: 'A',
    currentNumber: 1,
    maxNumberPerPrefix: 500,
    savedContacts: new Map(),

    loadSavedContacts() {
        try {
            const data = fileUtils.readJsonFile(config.paths.contacts, {});
            this.savedContacts = new Map(Object.entries(data));
            this.updateCurrentPosition();
        } catch (error) {
            console.error('Error loading saved contacts:', error);
            this.savedContacts.clear();
            this.saveContacts();
        }
    },

    saveContacts() {
        try {
            const data = Object.fromEntries(this.savedContacts);
            fileUtils.writeJsonFile(config.paths.contacts, data);
        } catch (error) {
            console.error('Error saving contacts:', error);
        }
    },

    updateCurrentPosition() {
        if (this.savedContacts.size === 0) {
            this.currentPrefix = 'A';
            this.currentNumber = 1;
            return;
        }

        let maxPrefix = 'A';
        let maxNumber = 0;

        for (const [_, name] of this.savedContacts) {
            const prefix = name[0];
            const number = parseInt(name.slice(1));

            if (prefix > maxPrefix || (prefix === maxPrefix && number > maxNumber)) {
                maxPrefix = prefix;
                maxNumber = number;
            }
        }

        if (maxNumber >= this.maxNumberPerPrefix) {
            this.currentPrefix = String.fromCharCode(maxPrefix.charCodeAt(0) + 1);
            this.currentNumber = 1;
        } else {
            this.currentPrefix = maxPrefix;
            this.currentNumber = maxNumber + 1;
        }
    },

    getNextContactName() {
        const name = `${this.currentPrefix}${this.currentNumber}`;
        this.currentNumber++;

        if (this.currentNumber > this.maxNumberPerPrefix) {
            this.currentPrefix = String.fromCharCode(this.currentPrefix.charCodeAt(0) + 1);
            this.currentNumber = 1;
        }

        return name;
    }
};

// Initialize contact naming system
contactNaming.loadSavedContacts();

const moderators = new Set();
let assistantKey = config.openai.assistantId;
const userMessageQueues = {};
const userProcessingTimers = {};
const ignoreList = new Set();

// Add file watcher for ignore list
let ignoreListWatcher = null;

function startIgnoreListWatcher() {
    if (ignoreListWatcher) {
        ignoreListWatcher.close();
    }

    try {
        ignoreListWatcher = fs.watch(config.paths.ignoreList, (eventType, filename) => {
            if (eventType === 'change' || eventType === 'rename') {
                console.log('Ignore list file changed, reloading...');
                loadIgnoreList();
            }
        });

        // Handle watcher errors
        ignoreListWatcher.on('error', (error) => {
            console.error('Error watching ignore list file:', error);
            // Try to restart watcher after a delay
            setTimeout(startIgnoreListWatcher, 5000);
        });
    } catch (error) {
        console.error('Failed to start ignore list watcher:', error);
    }
}

function saveIgnoreList() {
    try {
        fileUtils.writeJsonFile(config.paths.ignoreList, Array.from(ignoreList));
        // If file was deleted and recreated, restart the watcher
        if (!ignoreListWatcher) {
            startIgnoreListWatcher();
        }
    } catch (error) {
        console.error('Error saving ignore list:', error);
    }
}

function loadIgnoreList() {
    try {
        // Check if file exists
        if (!fs.existsSync(config.paths.ignoreList)) {
            console.log('Ignore list file not found, creating new one');
            ignoreList.clear();
            saveIgnoreList();
            return;
        }

        const data = fileUtils.readJsonFile(config.paths.ignoreList, []);
        ignoreList.clear();
        if (Array.isArray(data)) {
            data.forEach(number => ignoreList.add(number));
        }
        console.log(`Loaded ${ignoreList.size} numbers from ignore list`);
    } catch (error) {
        console.error('Error loading ignore list:', error);
        ignoreList.clear();
        saveIgnoreList();
    }
}

// Start the file watcher when module loads
startIgnoreListWatcher();
loadIgnoreList();

function addToIgnoreList(number) {
    ignoreList.add(number);
    saveIgnoreList();
}

function removeFromIgnoreList(number) {
    ignoreList.delete(number);
    saveIgnoreList();
}

function isIgnored(number) {
    return ignoreList.has(number);
}

async function sendMessageWithValidation(client, recipientNumber, message, senderNumber) {
    try {
        const formattedNumber = phoneUtils.formatWhatsAppId(recipientNumber);
        const isRegistered = await client.isRegisteredUser(formattedNumber);

        if (!isRegistered) {
            throw new Error('This number is not registered on WhatsApp');
        }

        await client.sendMessage(formattedNumber, message);
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Failed to send message to ${recipientNumber}: ${error.message}`);
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

const tools = [{
    type: "function",
    function: {
        name: "generate_qr_code",
        description: "Generate a QR code for downloading the FTC Rider app",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
}, {
    type: "function",
    function: {
        name: "get_qr_stats",
        description: "Get statistics for a user's QR code",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
}];

// Function to handle the QR code generation
async function handleGenerateQRCode(phone_number) {
    try {
        const qrCode = await qrManager.generateQRCode(phone_number);

        // Create MessageMedia from base64 data
        const media = new MessageMedia(
            'image/png',
            qrCode.qr_url.split(',')[1],
            'ftc-rider-qr.png'
        );

        // Return only the media, no text
        return { text: "", media: media };
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw error;
    }
}

// Function to handle getting QR stats
async function handleGetQRStats(phone_number) {
    try {
        const qrCode = qrCodesData.codes[phone_number];
        if (!qrCode) {
            return "You haven't generated a QR code yet. Ask me to generate one for you!";
        }

        const stats = await qrManager.getQRCodeStats(phone_number);
        const createdDate = new Date(stats.created_at);

        const response = `📊 *Your QR Code Statistics*\n\n` +
            `Created: ${createdDate.toLocaleString()}\n` +
            `Total Scans: ${stats.total_scans}\n\n` ;
            // `*Your Short URL:* ${qrCode.short_url}`;

        return response;
    } catch (error) {
        console.error('Error getting QR stats:', error);
        throw error;
    }
}

// Modify the generateResponseOpenAI function to pass the senderNumber
async function generateResponseOpenAI(assistant, senderNumber, userMessage, assistantKey, client) {
    try {
        if (!userMessage) {
            throw new Error('Empty message received.');
        }

        const threadId = await threadManager.ensureValidThread(assistant, senderNumber);

        await assistant.beta.threads.messages.create(threadId, {
            role: 'user',
            content: userMessage
        });

        // Start the run with our tools
        const run = await assistant.beta.threads.runs.create(threadId, {
            assistant_id: assistantKey,
            tools: tools
        });

        // Poll for the run completion
        let runStatus = await assistant.beta.threads.runs.retrieve(threadId, run.id);
        while (runStatus.status !== 'completed' && runStatus.status !== 'failed') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await assistant.beta.threads.runs.retrieve(threadId, run.id);

            // Handle tool calls
            if (runStatus.status === 'requires_action') {
                const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
                const toolOutputs = [];

                for (const toolCall of toolCalls) {
                    let output;

                    switch (toolCall.function.name) {
                        case 'generate_qr_code':
                            const qrResult = await handleGenerateQRCode(senderNumber);
                            // Send the QR code image
                            await client.sendMessage(phoneUtils.formatWhatsAppId(senderNumber), qrResult.media);
                            output = qrResult.text;
                            break;

                        case 'get_qr_stats':
                            output = await handleGetQRStats(senderNumber);
                            break;
                    }

                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(output)
                    });
                }

                // Submit tool outputs back to the Assistant
                await assistant.beta.threads.runs.submitToolOutputs(
                    threadId,
                    run.id,
                    { tool_outputs: toolOutputs }
                );
            }
        }

        // Get the latest message
        const messages = await assistant.beta.threads.messages.list(threadId);
        const lastMessage = messages.data[0];

        return lastMessage.content[0].text.value;
    } catch (error) {
        console.error('Error in generateResponseOpenAI:', error);
        throw error;
    }
}

function addModerator(number) {
    if (!phoneUtils.isValidPhoneNumber(number)) {
        throw new Error(ERROR_MESSAGES.INVALID_NUMBER);
    }
    moderators.add(number);
}

function removeModerator(number) {
    if (!phoneUtils.isValidPhoneNumber(number)) {
        throw new Error(ERROR_MESSAGES.INVALID_NUMBER);
    }
    moderators.delete(number);
}

function isModerator(number) {
    return moderators.has(number);
}

function checkModerators() {
    return Array.from(moderators);
}

const COMMANDS = {
    user: {
        title: '👤 User Commands',
        description: 'Commands available to all users',
        commands: {
            'show-menu': 'Display the user command menu',
            'help': 'Show available commands and their descriptions',
            'code': 'Generate a QR code to download the FTC Rider app',
            'info': 'View statistics for your QR code'
        }
    },
    admin: {
        title: '👨‍💼 Admin Commands',
        commands: {
            'set-key': 'Set the assistant key',
            'show-menu': 'Display the admin command menu',
            'help': 'Show available commands and their descriptions',
            'commands': 'Show all available commands',
            'add-mod': 'Add a new moderator',
            'remove-mod': 'Remove an existing moderator',
            'list-mods': 'List all moderators',
            'clear-threads': 'Clear all threads',
            'pause': 'Pause the bot',
            'start': 'Start the bot',
            'no-assist': 'Disable AI assistance for a user',
            'ai-assist': 'Enable AI assistance for a user',
            'respond': 'Send a response to a user'
        }
    },
    moderator: {
        title: '�� Moderator Commands',
        commands: {
            'show-menu': 'Display the moderator command menu',
            'help': 'Show available commands and their descriptions',
            'commands': 'Show all available commands',
            'add-mod': 'Add a new moderator',
            'remove-mod': 'Remove an existing moderator',
            'list-mods': 'List all moderators',
            'clear-threads': 'Clear all threads',
            'pause': 'Pause the bot',
            'start': 'Start the bot',
            'no-assist': 'Disable AI assistance for a user',
            'ai-assist': 'Enable AI assistance for a user',
            'respond': 'Send a response to a user'
        }
    }
};

async function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator, stopBot, startBot) {
    try {
        let messageText = message.body.trim();
        const [command, ...args] = messageText.split(' ');
        const lowerCommand = command.toLowerCase();

        if (!lowerCommand.startsWith('!!')) {
            return null;
        }

        // Create a list of publicly available commands
        const publicCommands = ['!!help', '!!commands', '!!show-menu', '!!code', '!!info'];

        // Only check permissions for non-public commands
        if (!publicCommands.includes(lowerCommand) && !isAdmin && !isModerator) {
            return ERROR_MESSAGES.PERMISSION_DENIED;
        }

        switch (lowerCommand) {
            case '!!set-key':
                const newAssistantKey = stringUtils.extractQuotedString(args.join(' '));
                if (newAssistantKey) {
                    assistantKey = newAssistantKey;
                    return 'Assistant key has been updated.';
                }
                return 'Please provide a valid assistant key using !!set-key "YourKey".';

            case '!!show-menu':
            case '!!help':
            case '!!commands':
                if (isAdmin) {
                    return `${COMMANDS.admin.title}\n\n` + Object.entries(COMMANDS.admin.commands)
                        .map(([cmd, desc]) => `!!${cmd}: ${desc}`).join('\n');
                } else if (isModerator) {
                    return `${COMMANDS.moderator.title}\n\n` + Object.entries(COMMANDS.moderator.commands)
                        .map(([cmd, desc]) => `!!${cmd}: ${desc}`).join('\n');
                } else {
                    return `${COMMANDS.user.title}\n\n` + Object.entries(COMMANDS.user.commands)
                        .map(([cmd, desc]) => `!!${cmd}: ${desc}`).join('\n');
                }

            case '!!add-mod':
                const newModerator = stringUtils.extractQuotedString(args.join(' '));
                if (newModerator) {
                    addModerator(newModerator);
                    return `${newModerator} is now a moderator.`;
                }
                return 'Please specify the number to add as a moderator: !!add-mod "number".';

            case '!!remove-mod':
                const moderatorToRemove = stringUtils.extractQuotedString(args.join(' '));
                if (moderatorToRemove) {
                    removeModerator(moderatorToRemove);
                    return `${moderatorToRemove} is no longer a moderator.`;
                }
                return 'Please specify the number to remove as a moderator: !!remove-mod "number".';

            case '!!list-mods':
                const moderatorsList = checkModerators();
                return `Current moderators are: ${moderatorsList.join(', ')}`;

            case '!!clear-threads':
                threadManager.clearAllThreads();
                return 'All threads have been cleared.';

            case '!!pause':
                stopBot();
                return 'Bot has been paused.';

            case '!!start':
                startBot();
                return 'Bot has been started.';

            case '!!no-assist':
                const chat = await message.getChat();
                if (chat.isGroup) {
                    return "This command cannot be used in a group chat.";
                }
                const recipientNumber = chat.id.user;
                addToIgnoreList(recipientNumber);
                return `AI assistance disabled for ${recipientNumber}.`;

            case '!!ai-assist':
                const aiChat = await message.getChat();
                if (aiChat.isGroup) {
                    return "This command cannot be used in a group chat.";
                }
                const aiRecipientNumber = aiChat.id.user;
                removeFromIgnoreList(aiRecipientNumber);
                return `AI assistance enabled for ${aiRecipientNumber}.`;

            case '!!respond':
                const quotedStrings = stringUtils.extractMultipleQuotedStrings(args.join(' '));
                if (quotedStrings.length !== 2) {
                    return 'Please use the format: !!respond "recipient_number" "your message"';
                }

                const [recipientNum, responseMessage] = quotedStrings;
                if (!phoneUtils.isValidPhoneNumber(recipientNum)) {
                    return ERROR_MESSAGES.INVALID_NUMBER;
                }

                await sendMessageWithValidation(client, recipientNum, responseMessage, senderNumber);
                return `Response sent to ${recipientNum}`;

            case '!!code':
                try {
                    const chat = await message.getChat();
                    if (chat.isGroup) {
                        return "This command cannot be used in a group chat.";
                    }

                    const qrCode = await qrManager.generateQRCode(senderNumber);

                    const response = `📱 *Download FTC Rider App*\n\n` +
                        `Scan this QR code to download our official FTC Rider app from Google Play Store!\n\n` +
                        `Short URL: ${qrCode.short_url}\n\n` +
                        `The app will help you track your rides and manage your bookings efficiently.`;

                    // Create MessageMedia from base64 data
                    const media = new MessageMedia(
                        'image/png',
                        qrCode.qr_url.split(',')[1], // Remove the data:image/png;base64, prefix
                        'ftc-rider-qr.png'
                    );

                    await client.sendMessage(message.from, media);

                    return response;
                } catch (error) {
                    console.error('Error handling QR code command:', error);
                    return "Sorry, I couldn't generate your QR code at the moment. Please try again later.";
                }

            case '!!info':
                try {
                    const chat = await message.getChat();
                    if (chat.isGroup) {
                        return "This command cannot be used in a group chat.";
                    }

                    const qrCode = qrCodesData.codes[senderNumber];
                    if (!qrCode) {
                        return "You haven't generated a QR code yet. Use !!code to generate one!";
                    }

                    const stats = await qrManager.getQRCodeStats(senderNumber);
                    const createdDate = new Date(stats.created_at);

                    let response = `📊 *Your QR Code Statistics*\n\n` +
                        `Created: ${createdDate.toLocaleString()}\n` +
                        `Total Scans: ${stats.total_scans}\n\n` ;
                        // `*Your Short URL:* ${qrCode.short_url}`;

                    if (stats.error) {
                        response += `\n\nNote: ${stats.error}`;
                    }

                    return response;
                } catch (error) {
                    console.error('Error handling info command:', error);
                    return "Sorry, I couldn't retrieve your QR code information at the moment.";
                }

            default:
                return "Unknown command. Please check the available commands using !!show-menu.";
        }
    } catch (error) {
        console.error(`Error in handleCommand: ${error.message}`);
        return ERROR_MESSAGES.SERVER_ERROR;
    }
}

async function processImageOrDocument(assistantOrOpenAI, media, text) {
    return "I can help you with text messages and voice messages. Please send your message in one of these formats.";
}

async function storeUserMessage(client, assistantOrOpenAI, senderNumber, message) {
    // Filter out status broadcasts and bot's own messages
    if (senderNumber === client.info.wid.user ||
        isIgnored(senderNumber) ||
        senderNumber === 'status@broadcast' ||
        senderNumber === 'status') {
        console.log(`Skipping message from filtered sender: ${senderNumber}`);
        return null;
    }

    let messageToStore = '';

    try {
        if (message.type === 'ptt' || message.type === 'audio') {
            const media = await message.downloadMedia();
            const audioBuffer = Buffer.from(media.data, 'base64');
            const transcription = await transcribeAudio(assistantOrOpenAI, audioBuffer);
            messageToStore = `Transcribed voice message: ${transcription}`;
        } else if (message.type === 'document') {
            return "As a vision model, I can only process images at the moment. Please send your document as an image if possible.";
        } else if (message.type === 'image') {
            const media = await message.downloadMedia();
            const fileSizeInMB = Buffer.from(media.data, 'base64').length / (1024 * 1024);

            if (fileSizeInMB > config.messaging.maxMessageSize) {
                return "The image is too large to process. Please send an image smaller than 10MB.";
            }

            if (!config.messaging.supportedImageTypes.includes(media.mimetype)) {
                return "Please send images in JPEG, PNG, GIF, or WEBP format.";
            }

            return await processImageOrDocument(assistantOrOpenAI, media, message.body);
        } else {
            messageToStore = message.body || `A message of type ${message.type} was received`;
        }

        await queueMessage(client, assistantOrOpenAI, senderNumber, messageToStore);
        return null;
    } catch (error) {
        console.error(`Error processing message: ${error.message}`);
        return "I encountered an issue processing your message. I can handle images and text messages - please try again!";
    }
}

async function transcribeAudio(assistantOrOpenAI, audioBuffer) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'audio.ogg' });
    formData.append('model', 'whisper-1');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${config.openai.apiKey}`,
        },
    });

    return response.data.text;
}

async function generateAudioResponse(assistantOrOpenAI, text) {
    const response = await assistantOrOpenAI.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        input: text,
    });

    return Buffer.from(await response.arrayBuffer());
}

async function queueMessage(client, assistantOrOpenAI, senderNumber, message) {
    if (!userMessageQueues[senderNumber]) {
        userMessageQueues[senderNumber] = [];
    }

    userMessageQueues[senderNumber].push(message);

    if (!userProcessingTimers[senderNumber]) {
        await processMessageQueue(client, assistantOrOpenAI, senderNumber);
    }
}

async function processMessageQueue(client, assistantOrOpenAI, senderNumber) {
    if (userProcessingTimers[senderNumber] || !userMessageQueues[senderNumber]?.length) {
        return;
    }

    userProcessingTimers[senderNumber] = true;

    try {
        while (userMessageQueues[senderNumber].length > 0) {
            const message = userMessageQueues[senderNumber][0];
            await processUserMessages(client, assistantOrOpenAI, senderNumber, message);
            userMessageQueues[senderNumber].shift();
            await timeUtils.sleep(1000);
        }
    } catch (error) {
        console.error(`Error processing message queue for ${senderNumber}:`, error);
    } finally {
        userProcessingTimers[senderNumber] = false;
    }
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber, message) {
    // Filter out invalid senders
    if (senderNumber === 'status' ||
        senderNumber === 'status@broadcast' ||
        !senderNumber ||
        typeof senderNumber !== 'string') {
        console.log(`Skipping message from invalid sender: ${senderNumber}`);
        return null;
    }

    const isVoiceMessage = message.startsWith('Transcribed voice message:');

    try {
        // Validate phone number before proceeding
        if (!phoneUtils.isValidPhoneNumber(senderNumber)) {
            console.error(`Invalid phone number format: ${senderNumber}`);
            return null;
        }

        const formattedSenderNumber = phoneUtils.formatWhatsAppId(senderNumber);

        // Silently check and store contact info
        try {
            const contact = await client.getContactById(formattedSenderNumber);
            if (!contact.isMyContact && !contactNaming.savedContacts.has(senderNumber)) {
                const newName = contactNaming.getNextContactName();
                contactNaming.savedContacts.set(senderNumber, newName);
                contactNaming.saveContacts();
            }
        } catch (error) {
            console.error(`Error checking contact for ${senderNumber}:`, error);
        }

        const response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, message, assistantKey, client);

        if (isVoiceMessage) {
            const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response);
            const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
            await client.sendMessage(formattedSenderNumber, media, { sendAudioAsVoice: true });
        } else {
            await client.sendMessage(formattedSenderNumber, response);
        }

        return null;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error with ${senderNumber}: ${error.message}`);
        if (error.message.includes('invalid wid')) {
            console.warn(`Invalid WID error for ${senderNumber}: ${error.message}`);
        } else {
            await client.sendMessage(phoneUtils.formatWhatsAppId(senderNumber), ERROR_MESSAGES.SERVER_ERROR);
        }
        return null;
    }
}

module.exports = {
    loadIgnoreList,
    isIgnored,
    addToIgnoreList,
    removeFromIgnoreList,
    sendMessageWithValidation,
    generateResponseOpenAI,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    storeUserMessage,
    processUserMessages,
    transcribeAudio,
    generateAudioResponse,
    queueMessage,
    processMessageQueue,
    contactNaming
};

