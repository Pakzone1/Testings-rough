const config = require('./config');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('./constants');
const { fileUtils } = require('./utils');
const delivery = require('./delivery');
const fs = require('fs');
const logger = require('./utils/logger');

class ThreadManager {
    constructor() {
        this.threads = this.loadThreads();
        this.activeRuns = new Map();
        this.startThreadsWatcher();
        this.assistantConfig = null;
        this.lastConfigCheck = 0;
        this.configCheckInterval = 5 * 60 * 1000; // 5 minutes
        this.maxThreadMessages = 20; // Limit thread size for better context management

        // Clean up existing thread data on startup
        this.cleanupThreadData();
    }

    // New method to clean up nested thread data
    cleanupThreadData() {
        let hasChanges = false;
        for (const [userNumber, threadData] of Object.entries(this.threads)) {
            const cleanData = this.normalizeThreadData(threadData);
            if (JSON.stringify(cleanData) !== JSON.stringify(threadData)) {
                this.threads[userNumber] = cleanData;
                hasChanges = true;
            }
        }
        if (hasChanges) {
            this.saveThreads();
            logger.thread('Thread data structure has been cleaned up');
        }
    }

    // New method to normalize thread data structure
    normalizeThreadData(threadData) {
        if (!threadData) return null;

        // If it's just a string (thread ID), convert to proper structure
        if (typeof threadData === 'string') {
            return {
                id: threadData,
                outdated: false,
                lastActive: Date.now()
            };
        }

        // If it's already an object, extract the deepest thread ID
        let currentObj = threadData;
        while (currentObj.id && typeof currentObj.id === 'object') {
            currentObj = currentObj.id;
        }

        // Return normalized structure
        return {
            id: currentObj.id || null,
            outdated: Boolean(threadData.outdated),
            lastActive: threadData.lastActive || Date.now()
        };
    }

    startThreadsWatcher() {
        if (this.threadsWatcher) {
            this.threadsWatcher.close();
        }

        try {
            this.threadsWatcher = fs.watch(config.paths.threads, (eventType, filename) => {
                if (eventType === 'change' || eventType === 'rename') {
                    logger.thread('Threads file changed, reloading...');
                    this.threads = this.loadThreads();
                }
            });

            this.threadsWatcher.on('error', (error) => {
                logger.error('Error watching threads file:', error);
                // Try to restart watcher after a delay
                setTimeout(() => this.startThreadsWatcher(), 5000);
            });
        } catch (error) {
            logger.error('Failed to start threads watcher:', error);
        }
    }

    loadThreads() {
        try {
            if (!fs.existsSync(config.paths.threads)) {
                logger.thread('Threads file not found, creating new one');
                const emptyThreads = {};
                fileUtils.writeJsonFile(config.paths.threads, emptyThreads);
                return emptyThreads;
            }

            const threads = fileUtils.readJsonFile(config.paths.threads, {});
            // Normalize all thread data when loading
            for (const [userNumber, threadData] of Object.entries(threads)) {
                threads[userNumber] = this.normalizeThreadData(threadData);
            }
            logger.thread(`Loaded ${Object.keys(threads).length} threads`);
            return threads;
        } catch (error) {
            logger.error('Error loading threads:', error);
            return {};
        }
    }

    saveThreads() {
        try {
            fileUtils.writeJsonFile(config.paths.threads, this.threads);
            // If file was deleted and recreated, restart the watcher
            if (!this.threadsWatcher) {
                this.startThreadsWatcher();
            }
            return true;
        } catch (error) {
            logger.error('Error saving threads:', error);
            return false;
        }
    }

    clearAllThreads() {
        this.threads = {};
        this.saveThreads();
        logger.thread('ThreadManager: All threads cleared');
    }

    getThread(userNumber) {
        return this.threads[userNumber];
    }

    setThread(userNumber, threadId) {
        this.threads[userNumber] = this.normalizeThreadData(threadId);
        this.saveThreads();
    }

    removeThread(userNumber) {
        delete this.threads[userNumber];
        this.saveThreads();
    }

    async handleRun(assistant, threadId, runId, retryCount = 0) {
        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                this.activeRuns.delete(runId);
                reject(new Error('Run timed out'));
            }, config.threads.maxRunTime);

            try {
                this.activeRuns.set(runId, true);

                while (true) {
                    if (!this.activeRuns.get(runId)) {
                        throw new Error('Run was cancelled');
                    }

                    const run = await assistant.beta.threads.runs.retrieve(threadId, runId);
                    logger.thread(`Run status for ${runId}: ${run.status}`);

                    if (run.status === 'completed') {
                        clearTimeout(timeout);
                        this.activeRuns.delete(runId);
                        resolve(run);
                        break;
                    }
                    else if (run.status === 'requires_action') {
                        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
                        const toolOutputs = [];

                        // Get the user's number from thread context
                        const userNumber = Object.entries(this.threads).find(([number, thread]) => {
                            const threadData = typeof thread === 'object' ? thread : { id: thread };
                            return threadData.id === threadId;
                        })?.[0];

                        logger.thread(`Processing tool calls for user: ${userNumber}`);

                        for (const toolCall of toolCalls) {
                            const functionName = toolCall.function.name;
                            const args = JSON.parse(toolCall.function.arguments);
                            logger.thread(`Processing tool call: ${functionName}`, args);

                            let output;
                            if (functionName === 'handle_human_request') {
                                if (args.intent_confirmed) {
                                    if (!userNumber) {
                                        logger.error('No user number found for thread:', threadId);
                                        output = "I'm sorry, but I cannot process your request at this time. Please try again later.";
                                    } else {
                                        output = await this.handleHumanRequest(args.user_query, userNumber);
                                    }
                                } else {
                                    output = "I'll continue assisting you.";
                                }
                            }
                            else if (functionName === 'check_order_status') {
                                if (args.intent_confirmed && args.order_number) {
                                    output = await this.checkOrderStatus(args.order_number);
                                } else {
                                    output = "Please provide your order number to check the status.";
                                }
                            }

                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: output || "Sorry, I couldn't process that request."
                            });
                        }

                        await assistant.beta.threads.runs.submitToolOutputs(
                            threadId,
                            runId,
                            { tool_outputs: toolOutputs }
                        );
                    }
                    else if (['failed', 'cancelled', 'expired'].includes(run.status)) {
                        if (retryCount < config.threads.maxRetries) {
                            logger.thread(`Retrying run for thread ${threadId}, attempt ${retryCount + 1}`);
                            try {
                                await assistant.beta.threads.runs.cancel(threadId, runId);
                            } catch (error) {
                                logger.error('Error cancelling run:', error);
                            }
                            this.activeRuns.delete(runId);
                            const newRun = await assistant.beta.threads.runs.create(threadId, {
                                assistant_id: run.assistant_id
                            });
                            resolve(this.handleRun(assistant, threadId, newRun.id, retryCount + 1));
                            break;
                        } else {
                            clearTimeout(timeout);
                            this.activeRuns.delete(runId);
                            reject(new Error(`Run failed after ${config.threads.maxRetries} retries`));
                            break;
                        }
                    }

                    await new Promise(resolve => setTimeout(resolve, config.threads.pollingInterval));
                }
            } catch (error) {
                clearTimeout(timeout);
                this.activeRuns.delete(runId);
                logger.error('Error in handleRun:', error);
                reject(error);
            }
        });
    }

    async handleHumanRequest(query, senderNumber) {
        try {
            // Early validation of sender number
            if (!senderNumber ||
                typeof senderNumber !== 'string' ||
                senderNumber === 'status' ||
                senderNumber === 'status@broadcast') {
                logger.error('Invalid or system sender number:', senderNumber);
                throw new Error('Invalid sender number provided');
            }

            // Extract senderNumber from global context if not provided
            if (global.currentSenderNumber) {
                senderNumber = global.currentSenderNumber;
            }

            const adminNumbers = global.ADMIN_NUMBERS;
            if (!adminNumbers || !Array.isArray(adminNumbers) || adminNumbers.length === 0) {
                logger.error('No admin numbers available:', adminNumbers);
                throw new Error('Customer service team not available');
            }

            // Clean and format the sender number
            let cleanSenderNumber = senderNumber.replace(/[^\d+]/g, '');
            // If number starts with '+', remove it temporarily
            if (cleanSenderNumber.startsWith('+')) {
                cleanSenderNumber = cleanSenderNumber.substring(1);
            }
            // If number doesn't start with country code, assume it's incomplete
            if (cleanSenderNumber.length < 8) {
                logger.error('Sender number invalid length:', cleanSenderNumber);
                throw new Error('Invalid phone number format');
            }

            // Add user to ignore list
            const { addToIgnoreList } = require('./functions');
            addToIgnoreList(cleanSenderNumber);
            logger.bot(`Added ${cleanSenderNumber} to ignore list after human request`);

            const timestamp = new Date().toLocaleString();
            // Sanitize query text
            const sanitizedQuery = (query || '').replace(/[<>]/g, '').trim() || 'No reason provided';

            const notificationMessage = `
🔔 *Human Representative Request*
---------------------------
From: ${cleanSenderNumber} (wa.me/+${cleanSenderNumber})
Time: ${timestamp}
Reason: ${sanitizedQuery}
Status: Awaiting response
---------------------------
To respond, use: !!respond "${cleanSenderNumber}" "your message"`;

            logger.bot('Sending notification to admins:', {
                cleanSenderNumber,
                timestamp,
                sanitizedQuery,
                adminNumbers
            });

            let notifiedAdmins = 0;
            for (const adminNumber of adminNumbers) {
                try {
                    if (!global.whatsappClient) {
                        logger.error('WhatsApp client not available');
                        continue;
                    }

                    // Format admin number for WhatsApp
                    let formattedAdminNumber = adminNumber.replace(/[^\d+]/g, '');
                    if (formattedAdminNumber.startsWith('+')) {
                        formattedAdminNumber = formattedAdminNumber.substring(1);
                    }
                    formattedAdminNumber = formattedAdminNumber + '@c.us';

                    logger.bot(`Attempting to notify admin: ${formattedAdminNumber}`);

                    await global.whatsappClient.sendMessage(formattedAdminNumber, notificationMessage);
                    notifiedAdmins++;
                    logger.bot(`Successfully notified admin ${adminNumber}`);
                } catch (error) {
                    logger.error(`Failed to notify admin ${adminNumber}:`, error.message);
                }
            }

            if (notifiedAdmins === 0) {
                logger.error('No admins were notified successfully');
                throw new Error('Failed to reach customer service team');
            }

            logger.bot(`Successfully notified ${notifiedAdmins} admins`);
            return `I've forwarded your request to our customer service team. A human representative will contact you shortly. Your request has been logged at ${timestamp}. Thank you for your patience.`;
        } catch (error) {
            logger.error('Error in handleHumanRequest:', error);
            return ERROR_MESSAGES.SERVER_ERROR;
        }
    }

    async checkOrderStatus(orderNumber) {
        try {
            const orders = delivery.getAllOrders();
            const order = orders.find(o => o.trackingNumber === orderNumber);

            if (!order) {
                return ERROR_MESSAGES.ORDER_NOT_FOUND;
            }

            // Get fresh formatted status from delivery module
            return delivery.formatOrderStatus(order);

        } catch (error) {
            logger.error('Error checking order status:', error);
            return ERROR_MESSAGES.SERVER_ERROR;
        }
    }

    async createNewThread(assistant, userNumber) {
        try {
            logger.thread(`Creating new thread for user ${userNumber}`);
            const thread = await assistant.beta.threads.create();
            this.setThread(userNumber, thread.id);
            return thread.id;
        } catch (error) {
            logger.error('Error creating new thread:', error);
            throw error;
        }
    }

    async loadAssistantConfig(assistant) {
        try {
            const now = Date.now();
            if (now - this.lastConfigCheck < this.configCheckInterval) {
                return this.assistantConfig;
            }

            this.lastConfigCheck = now;
            const assistantDetails = await assistant.beta.assistants.retrieve(config.openai.assistantId);

            const newConfig = {
                instructions: assistantDetails.instructions,
                model: assistantDetails.model,
                tools: assistantDetails.tools,
                fileIds: assistantDetails.file_ids,
                metadata: assistantDetails.metadata,
                configHash: JSON.stringify({
                    instructions: assistantDetails.instructions,
                    model: assistantDetails.model,
                    tools: assistantDetails.tools,
                    fileIds: assistantDetails.file_ids
                })
            };

            if (!this.assistantConfig || newConfig.configHash !== this.assistantConfig.configHash) {
                logger.thread('Assistant configuration changed, updating threads...');
                this.assistantConfig = newConfig;
                await this.handleConfigUpdate(assistant);
            }

            return this.assistantConfig;
        } catch (error) {
            logger.error('Error loading assistant config:', error);
            return this.assistantConfig;
        }
    }

    async handleConfigUpdate(assistant) {
        try {
            const threadIds = Object.values(this.threads).map(thread =>
                typeof thread === 'object' ? thread.id : thread
            );

            // Update thread data with proper structure
            for (const [userNumber, threadData] of Object.entries(this.threads)) {
                const normalizedData = this.normalizeThreadData(threadData);
                this.threads[userNumber] = {
                    ...normalizedData,
                    outdated: true,
                    lastActive: Date.now()
                };
            }

            this.saveThreads();
            logger.thread('Marked existing threads for update on next interaction');

            // Clean up old threads from OpenAI
            for (const threadId of threadIds) {
                try {
                    const actualThreadId = typeof threadId === 'object' ? threadId.id : threadId;
                    if (actualThreadId) {
                        try {
                            await assistant.beta.threads.del(actualThreadId);
                        } catch (error) {
                            if (error.status === 404) {
                                logger.thread(`Thread ${actualThreadId} already deleted or not found`);
                            } else {
                                logger.error(`Error deleting thread ${actualThreadId}:`, error);
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`Error processing thread deletion for ${threadId}:`, error);
                }
            }
        } catch (error) {
            logger.error('Error handling config update:', error);
        }
    }

    async summarizeThread(assistant, threadId) {
        try {
            // Get the last few messages
            const messages = await assistant.beta.threads.messages.list(threadId);
            const lastMessages = messages.data.slice(0, 5); // Get last 5 messages

            // Create a summary request
            const summaryThread = await assistant.beta.threads.create();
            await assistant.beta.threads.messages.create(summaryThread.id, {
                role: 'user',
                content: 'Please create a brief summary of this conversation context: ' +
                    lastMessages.map(m => `${m.role}: ${m.content[0].text.value}`).join('\n')
            });

            // Run the summarization
            const run = await assistant.beta.threads.runs.create(summaryThread.id, {
                assistant_id: config.openai.assistantId
            });

            // Wait for completion
            while (true) {
                const status = await assistant.beta.threads.runs.retrieve(summaryThread.id, run.id);
                if (status.status === 'completed') {
                    const summaryMessages = await assistant.beta.threads.messages.list(summaryThread.id);
                    const summary = summaryMessages.data[0].content[0].text.value;

                    // Cleanup
                    await assistant.beta.threads.del(summaryThread.id);
                    return summary;
                }
                if (status.status === 'failed' || status.status === 'cancelled') {
                    await assistant.beta.threads.del(summaryThread.id);
                    throw new Error('Failed to create summary');
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            logger.error('Error summarizing thread:', error);
            return null;
        }
    }

    async ensureValidThread(assistant, userNumber) {
        try {
            // Load latest assistant configuration
            await this.loadAssistantConfig(assistant);

            const threadData = this.threads[userNumber];
            let threadId = threadData?.id || null;

            logger.thread(`Checking thread for user ${userNumber}: ${threadId}`);

            // Create new thread if none exists
            if (!threadId) {
                logger.thread(`No thread found for user ${userNumber}, creating new one`);
                const thread = await assistant.beta.threads.create();
                this.threads[userNumber] = {
                    id: thread.id,
                    outdated: false,
                    lastActive: Date.now()
                };
                this.saveThreads();
                return thread.id;
            }

            // Verify existing thread
            try {
                await assistant.beta.threads.retrieve(threadId);

                // Update last active timestamp if thread is valid
                this.threads[userNumber].lastActive = Date.now();
                this.saveThreads();
                return threadId;
            } catch (error) {
                // Handle invalid or missing thread
                if (error.status === 404) {
                    logger.thread(`Thread ${threadId} not found, creating new one`);

                    // Create new thread
                    const newThread = await assistant.beta.threads.create();

                    // Update thread record
                    this.threads[userNumber] = {
                        id: newThread.id,
                        outdated: false,
                        lastActive: Date.now()
                    };
                    this.saveThreads();

                    return newThread.id;
                }

                // Handle other errors
                logger.error('Error verifying thread:', error);
                throw error;
            }
        } catch (error) {
            logger.error('Error ensuring valid thread:', error);

            // Fallback: Create new thread if anything goes wrong
            try {
                const thread = await assistant.beta.threads.create();
                this.threads[userNumber] = {
                    id: thread.id,
                    outdated: false,
                    lastActive: Date.now()
                };
                this.saveThreads();
                return thread.id;
            } catch (fallbackError) {
                logger.error('Failed to create fallback thread:', fallbackError);
                throw fallbackError;
            }
        }
    }

    cancelRun(runId) {
        this.activeRuns.delete(runId);
    }
}

// Initialize WhatsApp client reference
let whatsappClient = null;
global.whatsappClient = whatsappClient;

module.exports = new ThreadManager(); 