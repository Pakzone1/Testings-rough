// Command Types
const COMMAND_TYPES = {
    ADMIN: 'admin',
    MODERATOR: 'moderator',
    USER: 'user'
};

// Command Descriptions
const COMMANDS = {
    admin: {
        title: '👑 Admin Commands',
        description: 'Commands available to administrators',
        commands: {
            'set-key': 'Update the assistant key for AI functionality',
            'add-mod': 'Add a new moderator to help manage the bot',
            'remove-mod': 'Remove an existing moderator',
            'list-mods': 'Display a list of all current moderators',
            'clear-threads': 'Clear all conversation threads',
            'show-menu': 'Display the admin command menu',
            'start': 'Start or resume the bot',
            'pause': 'Temporarily pause the bot',
            'no-assist': 'Disable AI assistance for a specific number',
            'ai-assist': 'Enable AI assistance for a specific number'
        }
    },
    moderator: {
        title: '🛡️ Moderator Commands',
        description: 'Commands available to moderators',
        commands: {
            'show-menu': 'Display the moderator command menu',
            'start': 'Start or resume the bot',
            'pause': 'Temporarily pause the bot',
            'no-assist': 'Disable AI assistance for a specific number',
            'ai-assist': 'Enable AI assistance for a specific number'
        }
    },
    user: {
        title: '👤 User Commands',
        description: 'Commands available to all users',
        commands: {
            'show-menu': 'Display the user command menu',
            'help': 'Show available commands and their descriptions'
        }
    }
};

// Message Status
const MESSAGE_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

// Order Status
const ORDER_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled'
};

// Error Messages
const ERROR_MESSAGES = {
    AUTH_FAILED: 'Authentication failed. Please reset the bot and scan the QR code again.',
    CONNECTION_LOST: 'WhatsApp connection lost. Please reset the bot and scan the QR code again.',
    INVALID_NUMBER: 'Invalid phone number format. Please provide only numbers without any special characters.',
    ORDER_NOT_FOUND: 'Order not found. Please check the order number and try again.',
    PERMISSION_DENIED: "You don't have permission to use this command.",
    SERVER_ERROR: 'An error occurred. Please try again later.',
};

// Success Messages
const SUCCESS_MESSAGES = {
    BOT_STARTED: 'Bot started successfully',
    BOT_STOPPED: 'Bot stopped successfully',
    ORDER_ADDED: 'Order added successfully',
    ORDER_UPDATED: 'Order updated successfully',
    ORDER_DELETED: 'Order deleted successfully'
};

module.exports = {
    COMMAND_TYPES,
    COMMANDS,
    MESSAGE_STATUS,
    ORDER_STATUS,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES
}; 