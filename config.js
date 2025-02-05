// Load environment variables from .env file
const path = require('path');
const dotenv = require('dotenv');

// Load .env file from project root
const result = dotenv.config({ path: path.resolve(__dirname, '.env') });

if (result.error) {
    console.warn('Warning: .env file not found or has errors. Using default values.');
}

// Base paths
const BASE_DIR = __dirname;

const config = {
    // API Keys and Authentication
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        assistantId: process.env.OPENAI_ASSISTANT_ID,
    },

    // Admin Configuration
    admin: {
        numbers: process.env.ADMIN_NUMBERS ? process.env.ADMIN_NUMBERS.split(',') : ['923499490427'],
        defaultUsername: process.env.DASHBOARD_USERNAME,
        defaultPassword: process.env.DASHBOARD_PASSWORD
    },

    // File Paths
    paths: {
        auth: path.join(BASE_DIR, '.wwebjs_auth'),
        cache: path.join(BASE_DIR, '.wwebjs_cache'),
        qrCode: path.join(BASE_DIR, 'qr_code.png'),
        threads: path.join(BASE_DIR, 'user_threads.json'),
        ignoreList: path.join(BASE_DIR, 'ignore_list.json'),
        delivery: path.join(BASE_DIR, 'delivery_data.json'),
        contacts: path.join(BASE_DIR, 'contacts.json'),
    },

    // WhatsApp Client Configuration
    whatsapp: {
        clientId: 'whatsapp-bot',
        puppeteerOptions: {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only',
                '--mute-audio',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-component-extensions-with-background-pages',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--js-flags="--max_old_space_size=512"',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--memory-pressure-off',
                '--use-gl=swiftshader',
                '--ignore-certificate-errors',
                '--window-position=0,0'
            ],
            defaultViewport: {
                width: 1280,
                height: 720,
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false,
                isLandscape: true
            },
            ignoreHTTPSErrors: true,
            timeout: 45000,
            protocolTimeout: 45000,
        },
        restartOnAuthFail: true,
        takeoverOnConflict: true,
        takeoverTimeoutMs: 15000
    },

    // Thread Management
    threads: {
        maxRunTime: 30000,
        maxRetries: 3,
        pollingInterval: 1000
    },

    // Server Configuration
    server: {
        port: parseInt(process.env.PORT) || 8080,
        host: process.env.HOST || '0.0.0.0',
        secretKey: process.env.SECRET_KEY,
        sessionCookie: {
            name: 'whatsapp_bot_session',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true
        },
        cors: {
            enabled: true,
            origins: [`http://0.0.0.0:${process.env.PORT || 8080}`],
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            credentials: true
        }
    },

    // Message Processing
    messaging: {
        maxMessageSize: 10 * 1024 * 1024, // 10MB
        supportedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        pollingInterval: 1000,
        maxRetries: 3,
        retryDelay: 1000
    },

    // Dub Configuration
    dub: {
        apiKey: process.env.DUB_API_KEY,
        workspaceId: process.env.DUB_WORKSPACE_ID
    }
};

module.exports = config;