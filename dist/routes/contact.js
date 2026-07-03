"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const sendEmail_1 = require("../utils/sendEmail");
exports.router = (0, express_1.Router)();
exports.router.post('/', async (req, res) => {
    const { name, email, phone, type, message } = req.body;
    if (!name || !message)
        return res.status(400).json({ message: 'Name and message required' });
    try {
        await (0, sendEmail_1.sendEmail)(process.env.GMAIL_USER || 'saber.mekki6@gmail.com', `📬 ${type || 'Contact'} - Transit TN`, `<h2>Nouveau message - Transit TN</h2>
       <p><b>Type:</b> ${type || 'Contact'}</p>
       <p><b>Nom:</b> ${name}</p>
       <p><b>Email:</b> ${email || 'Non fourni'}</p>
       <p><b>Téléphone:</b> ${phone || 'Non fourni'}</p>
       <hr/>
       <p><b>Message:</b></p>
       <p>${message}</p>`);
        return res.json({ message: 'Sent' });
    }
    catch (e) {
        return res.status(500).json({ message: 'Failed to send' });
    }
});
