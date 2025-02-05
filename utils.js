const fs = require('fs');
const path = require('path');
const config = require('./config');

// File Operations
const fileUtils = {
    ensureDirectoryExists: (dirPath) => {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    },

    readJsonFile: (filePath, defaultValue = {}) => {
        try {
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
                return defaultValue;
            }
            const data = fs.readFileSync(filePath, 'utf8');
            return data.trim() === '' ? defaultValue : JSON.parse(data);
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            return defaultValue;
        }
    },

    writeJsonFile: (filePath, data) => {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error(`Error writing file ${filePath}:`, error);
            return false;
        }
    },

    removeFile: (filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return true;
        } catch (error) {
            console.error(`Error removing file ${filePath}:`, error);
            return false;
        }
    }
};

// Phone Number Formatting
const phoneUtils = {
    formatMexicanNumber: (number) => {
        if (number.startsWith('52') && number.length === 12 && !number.startsWith('521')) {
            return `521${number.slice(2)}`;
        }
        return number;
    },

    formatWhatsAppId: (number) => {
        const formattedNumber = phoneUtils.formatMexicanNumber(number);
        return `${formattedNumber}@c.us`;
    },

    isValidPhoneNumber: (number) => {
        return /^\d+$/.test(number);
    }
};

// Time and Date Utils
const timeUtils = {
    parseTimeString: (timeString) => {
        try {
            const [days, hours, minutes, seconds] = timeString.split(':').map(Number);
            if (isNaN(days) || isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
                throw new Error('Invalid time format.');
            }
            return (days * 24 * 60 * 60 * 1000) +
                (hours * 60 * 60 * 1000) +
                (minutes * 60 * 1000) +
                (seconds * 1000);
        } catch (error) {
            console.error(`Error in parseTimeString: ${error.message}`);
            return 0;
        }
    },

    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// String Utils
const stringUtils = {
    extractQuotedString: (text) => {
        try {
            const match = text.match(/"([^"]+)"/);
            return match ? match[1] : null;
        } catch (error) {
            console.error(`Error in extractQuotedString: ${error.message}`);
            return null;
        }
    },

    extractMultipleQuotedStrings: (text) => {
        try {
            const matches = [...text.matchAll(/"([^"]+)"/g)];
            return matches.map(match => match[1]);
        } catch (error) {
            console.error(`Error in extractMultipleQuotedStrings: ${error.message}`);
            return [];
        }
    }
};

// Permission Utils
const permissionUtils = {
    hasPermission: (senderNumber, command, isAdmin, isModerator) => {
        const unrestrictedCommands = ['!!un-sub', '!!live-chat', '!!sub', '!!bot'];
        if (unrestrictedCommands.includes(command)) {
            return true;
        }
        return isAdmin || isModerator;
    },

    isAdmin: (number) => {
        return config.admin.numbers.includes(number);
    }
};

module.exports = {
    fileUtils,
    phoneUtils,
    timeUtils,
    stringUtils,
    permissionUtils
}; 