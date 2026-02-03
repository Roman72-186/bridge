/**
 * Vercel Serverless Function - Bridge Webhook Proxy
 *
 * 1. Creates/updates contact in Leadteh via createOrUpdateContact
 * 2. Sets start_param variable via setContactVariable
 * 3. Triggers inner_webhook for chatbot flow
 */

const LEADTEH_API_KEY = process.env.LEADTEH_API_KEY || 'riKRYyE9YFlWSUpC9E7EHigLTl0dyexB5cGxKHYUdzJu6bZrUb30k2vKZoBh';
const LEADTEH_BOT_ID = process.env.LEADTEH_BOT_ID || '257034';
const LEADTEH_WEBHOOK_URL = process.env.LEADTEH_WEBHOOK_URL
    || 'https://rb257034.leadteh.ru/inner_webhook/deb210d6-ced0-43b2-a865-4afe92e32d8d';
const LEADTEH_API_BASE = 'https://app.leadteh.ru/api/v1';

// Authenticated POST to Leadteh API — tries Bearer first, then X-Api-Key on 401
async function leadtehApiPost(endpoint, payload) {
    const url = `${LEADTEH_API_BASE}/${endpoint}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${LEADTEH_API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    // If Bearer failed with 401, retry with X-Api-Key
    if (response.status === 401) {
        console.log(`[Bridge] Bearer failed for ${endpoint}, trying X-Api-Key...`);
        const retry = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Api-Key': LEADTEH_API_KEY
            },
            body: JSON.stringify(payload)
        });
        return retry;
    }

    return response;
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.body;

        if (!body || !body.telegram_id) {
            return res.status(400).json({ success: false, error: 'telegram_id is required' });
        }

        const telegramId = body.telegram_id.toString();
        const telegramIdInt = parseInt(body.telegram_id);
        const startParam = body.start_param || '';
        const userName = [
            body.user_data?.first_name || '',
            body.user_data?.last_name || ''
        ].filter(Boolean).join(' ') || 'User';

        console.log('[Bridge] ===== START =====');
        console.log('[Bridge] telegram_id:', telegramId);
        console.log('[Bridge] start_param:', startParam);

        // ─── Step 1: createOrUpdateContact ────────────────────────────
        console.log('[Bridge] Step 1: createOrUpdateContact...');
        const createRes = await leadtehApiPost('createOrUpdateContact', {
            bot_id: parseInt(LEADTEH_BOT_ID),
            messenger: 'telegram',
            telegram_id: telegramIdInt,
            name: userName,
            telegram_username: body.user_data?.username || ''
        });

        const createText = await createRes.text();
        console.log('[Bridge] createOrUpdateContact status:', createRes.status);
        console.log('[Bridge] createOrUpdateContact response:', createText);

        // Parse contact_id from response
        let contactId = null;
        try {
            const createJson = JSON.parse(createText);
            // response may be { data: { id: 123 } } or { id: 123 } — cover both
            contactId = createJson?.data?.id || createJson?.id || null;
            console.log('[Bridge] Parsed contact_id:', contactId);
        } catch (e) {
            console.log('[Bridge] Failed to parse createOrUpdateContact response');
        }

        // ─── Step 2: setContactVariable ───────────────────────────────
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
            console.log('[Bridge] Skipping setContactVariable: contactId=' + contactId + ', startParam=' + startParam);
        }

        // ─── Step 3: inner_webhook (trigger chatbot flow) ─────────────
        console.log('[Bridge] Step 3: inner_webhook...');
        const webhookRes = await fetch(LEADTEH_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: telegramId,
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
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}
