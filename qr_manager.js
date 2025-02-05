const axios = require('axios');
const config = require('./config');
const { fileUtils } = require('./utils');
const path = require('path');

const QR_CODES_FILE = path.join(__dirname, 'qr_codes.json');
const DUB_API_BASE = 'https://api.dub.co';

// Initialize QR codes data
let qrCodesData = { codes: {}, stats: {} };

// Load existing QR codes
function loadQRCodes() {
    try {
        const data = fileUtils.readJsonFile(QR_CODES_FILE, { codes: {}, stats: {} });
        qrCodesData = {
            codes: data.codes || {},
            stats: data.stats || {}
        };
    } catch (error) {
        console.error('Error loading QR codes:', error);
        qrCodesData = { codes: {}, stats: {} };
        saveQRCodes(); // Create the file if it doesn't exist
    }
}

// Save QR codes
function saveQRCodes() {
    try {
        fileUtils.writeJsonFile(QR_CODES_FILE, qrCodesData);
    } catch (error) {
        console.error('Error saving QR codes:', error);
    }
}

// Initialize stats for a phone number
function initializeStats(phoneNumber) {
    if (!qrCodesData.stats[phoneNumber]) {
        qrCodesData.stats[phoneNumber] = {
            total_scans: 0,
            unique_scans: 0,
            last_scan: null,
            created_at: new Date().toISOString()
        };
    }
}

// Get QR code directly from Dub.co
async function getQRCode(url, options = {}) {
    try {
        const params = new URLSearchParams({
            url: url,
            size: options.size || 600,
            level: options.level || 'Q',
            fgColor: options.fgColor || '#000000',
            bgColor: options.bgColor || '#FFFFFF',
            margin: options.margin || 1
        });

        const response = await axios.get(`${DUB_API_BASE}/qr?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${process.env.DUB_API_KEY}`
            },
            responseType: 'arraybuffer'
        });

        // Convert to base64 for storing/sending
        const base64Image = Buffer.from(response.data).toString('base64');
        return `data:image/png;base64,${base64Image}`;
    } catch (error) {
        console.error('Error getting QR code from Dub:', error);
        throw error;
    }
}

// Generate QR code using Dub API
async function generateQRCode(phoneNumber) {
    try {
        if (!phoneNumber) {
            throw new Error('Phone number is required');
        }

        // Check if QR code already exists for this number
        if (qrCodesData.codes[phoneNumber]) {
            return qrCodesData.codes[phoneNumber];
        }

        // Create a unique name for the short link
        const linkName = `ftc-rider-${phoneNumber}-${Date.now()}`;

        // Create a short link with Dub
        const linkResponse = await axios.post(
            `${DUB_API_BASE}/links`,
            {
                url: 'https://play.google.com/store/apps/details?id=com.ftcrider.riderapp',
                domain: 'ftcrider.link',
                key: linkName, // This will be the short URL slug
                name: `FTC Rider App - ${phoneNumber}`,
                description: `Download FTC Rider App`
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.DUB_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Get the short URL from the response
        const shortUrl = linkResponse.data.shortLink; // This includes the full URL with domain

        // Generate QR code for the short URL
        const qrCodeImage = await getQRCode(shortUrl, {
            size: 1000,
            level: 'Q',
            fgColor: '#25D366',
            margin: 2
        });

        // Store QR code data
        const qrCode = {
            shortId: linkResponse.data.id,
            qr_url: qrCodeImage,
            short_url: shortUrl,
            created_at: new Date().toISOString()
        };

        // Save to our data
        qrCodesData.codes[phoneNumber] = qrCode;
        initializeStats(phoneNumber);
        saveQRCodes();

        return qrCode;
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw error;
    }
}

// Get QR code stats
async function getQRCodeStats(phoneNumber) {
    try {
        if (!phoneNumber) {
            throw new Error('Phone number is required');
        }

        // Initialize local stats if needed
        initializeStats(phoneNumber);

        // Get the QR code from our local storage
        const qrCode = qrCodesData.codes[phoneNumber];
        if (!qrCode) {
            return {
                total_scans: 0,
                created_at: null,
                error: "QR code not found"
            };
        }

        // Get shortId from qr_codes.json
        const shortId = qrCode.shortId;

        // Get analytics from Dub API for clicks
        const response = await axios.get(
            `${DUB_API_BASE}/analytics`, {
            params: {
                event: 'clicks',
                groupBy: 'count',
                linkId: shortId,
                interval: '1y', // Get 1 year of data
                workspaceId: 'ws_e45c1382' // Add your workspace ID here
            },
            headers: {
                'Authorization': `Bearer dub_Qhx218nDDCUSABg6aK0mgl54` // Use the correct Dub.co API key
            }
        }
        );

        // Extract click data from response
        const clickData = response.data;
        console.log('Dub.co API Response:', clickData);

        // Update stats with the click count from the API
        const stats = {
            total_scans: clickData.clicks || 0,
            created_at: qrCode.created_at,
            short_url: qrCode.short_url
        };

        // Update local stats in qr_codes.json
        qrCodesData.stats[phoneNumber] = {
            ...qrCodesData.stats[phoneNumber],
            total_scans: stats.total_scans,
            last_updated: new Date().toISOString()
        };

        // Save the updated stats to file
        saveQRCodes();
        console.log('Updated stats:', stats);

        return stats;
    } catch (error) {
        console.error('Error getting QR code stats:', error);
        console.error('API Response:', error.response?.data);

        // Return local stats if API fails
        const localStats = qrCodesData.stats[phoneNumber] || {};
        return {
            total_scans: localStats.total_scans || 0,
            created_at: qrCodesData.codes[phoneNumber]?.created_at,
            short_url: qrCodesData.codes[phoneNumber]?.short_url,
            error: "Could not fetch live stats. Using local data."
        };
    }
}

// Initialize by loading existing QR codes
loadQRCodes();

module.exports = {
    generateQRCode,
    getQRCodeStats,
    qrCodesData
}; 