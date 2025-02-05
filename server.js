require('dotenv').config();  // Load environment variables first
const { Client } = require('./index');

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { fileUtils } = require('./utils');

const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: config.server.secretKey,
    resave: false,
    saveUninitialized: true,
    cookie: config.server.sessionCookie
}));

// Template engine setup
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, 'templates'));

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes
app.get('/download_contacts', requireAuth, (req, res) => {
    try {
        // Read contacts.json
        const contactsData = fileUtils.readJsonFile(config.paths.contacts, {});

        // Convert to CSV format
        let csvContent = 'Phone Number,Contact Name\n';
        for (const [number, name] of Object.entries(contactsData)) {
            csvContent += `${number},${name}\n`;
        }

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');

        // Send the CSV file
        res.send(csvContent);
    } catch (error) {
        console.error('Error generating contacts CSV:', error);
        res.status(500).send('Error generating contacts CSV file');
    }
});

// Start the WhatsApp bot
const client = new Client();
client.initialize();

// ... rest of your existing routes and server code ... 