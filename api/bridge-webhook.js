/**
 * Vercel Serverless Function - Bridge Webhook Proxy
 *
 * 1. Creates/updates contact via createOrUpdateContact (по имени)
 * 2. Sets start_param via setContactVariable (по contact_id из ответа)
 * 3. Triggers inner_webhook (по telegram_id)
 */

const LEADTEH_API_KEY = process.env.LEADTEH_API_KEY || 'riKRYyE9YFlWSUpC9E7EHigLTl0dyexB5cGxKHYUdzJu6bZrUb30k2vKZoBh';
const LEADTEH_BOT_ID = process.env.LEADTEH_BOT_ID || '257034';
const LEADTEH_WEBHOOK_URL = process.env.LEADTEH_WEBHOOK_URL
    || 'https://rb257034.leadteh.ru/inner_webhook/deb210d6-ced0-43b2-a865-4afe92e32d8d';
const LEADTEH_API_BASE = 'https://app.leadteh.ru/api/v1';

async function leadtehApiPost(endpoint, payload) {
    const url = `${LEADTEH_API_BASE}/${endpoint}?api_token=${LEADTEH_API_KEY}`;
    return await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(payload)
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    try {
        const body = req.body;
        if (!body || !body.telegram_id) {
            return res.status(400).json({ success: false, error: 'telegram_id is required' });
        }

        const telegramId = body.telegram_id.toString();
        const startParam = body.start_param || '';
        const firstName = body.user_data?.first_name || '';
        const lastName = body.user_data?.last_name || '';
        const userName = [firstName, lastName].filter(Boolean).join(' ') || 'User';
        const username = body.user_data?.username || null;

        console.log('[Bridge] ===== START =====');
        console.log('[Bridge] telegram_id:', telegramId);
        console.log('[Bridge] start_param:', startParam);
        console.log('[Bridge] userName:', userName);

        // ─── Step 1: createOrUpdateContact ──────────────────────────────
        // Matches contact by name within bot_id
        console.log('[Bridge] Step 1: createOrUpdateContact...');

        const createPayload = {
            bot_id: parseInt(LEADTEH_BOT_ID),
            messenger: 'telegram',
            name: userName
        };
        // Don't send empty optional fields — may cause 500
        if (telegramId) createPayload.telegram_id = telegramId;
        if (username) createPayload.telegram_username = username;

        console.log('[Bridge] createPayload:', JSON.stringify(createPayload));

        const createRes = await leadtehApiPost('createOrUpdateContact', createPayload);
        const createText = await createRes.text();
        console.log('[Bridge] createOrUpdateContact status:', createRes.status);
        console.log('[Bridge] createOrUpdateContact response:', createText);

        let contactId = null;
        try {
            const createJson = JSON.parse(createText);
            contactId = createJson?.data?.id || createJson?.id || null;
            console.log('[Bridge] Parsed contact_id:', contactId);
        } catch (e) {
            console.log('[Bridge] Failed to parse response as JSON');
        }

        // ─── Step 2: setContactVariable (start_param) ──────────────────
        let variableSet = false;
        if (contactId && startParam) {
            console.log('[Bridge] Step 2: setContactVariable...');
            const setVarRes = await leadtehApiPost('setContactVariable', {
                contact_id: contactId,
                name: 'start_param',
                value: startParam
            });
            const setVarText = await setVarRes.text();
            console.log('[Bridge] setContactVariable status:', setVarRes.status);
            console.log('[Bridge] setContactVariable response:', setVarText);
            variableSet = setVarRes.ok;
        } else {
            console.log('[Bridge] Skipping setContactVariable — contactId:', contactId, 'startParam:', startParam);
        }

        // ─── Step 3: inner_webhook (trigger chatbot flow by telegram_id) ─
        console.log('[Bridge] Step 3: inner_webhook...');
        const webhookRes = await fetch(LEADTEH_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_by: 'telegram_id',
                search: telegramId,
                start_param: startParam,
                source: 'telegram_ads_bridge'
            })
        });
        const webhookText = await webhookRes.text();
        console.log('[Bridge] inner_webhook status:', webhookRes.status);
        console.log('[Bridge] inner_webhook response:', webhookText);

        console.log('[Bridge] ===== END =====');

        return res.status(200).json({
            success: true,
            contact_id: contactId,
            variable_set: variableSet,
            webhook_triggered: webhookRes.ok,
            start_param: startParam
        });

    } catch (error) {
        console.error('[Bridge] ERROR:', error.message);
        console.error('[Bridge] Stack:', error.stack);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
