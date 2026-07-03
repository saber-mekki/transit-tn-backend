"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = sendPushNotification;
async function sendPushNotification(pushToken, title, body, data) {
    if (!pushToken || !pushToken.startsWith('ExponentPushToken'))
        return;
    try {
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                to: pushToken,
                title,
                body,
                data: data || {},
                sound: 'default',
                priority: 'high',
            }),
        });
    }
    catch (e) {
        console.error('Push notification error:', e);
    }
}
