/**
 * Vercel Serverless Function - Bridge Webhook Proxy
 *
 * 1. Creates/updates contact in Leadteh via API (for new users)
 * 2. Sends variables via inner_webhook
 */

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

    // Configuration
    const LEADTEH_API_KEY = process.env.LEADTEH_API_KEY || 'riKRYyE9YFlWSUpC9E7EHigLTl0dyexB5cGxKHYUdzJu6bZrUb30k2vKZoBh';
    const LEADTEH_BOT_ID = process.env.LEADTEH_BOT_ID || '257034';
    const LEADTEH_WEBHOOK_URL = process.env.LEADTEH_WEBHOOK_URL
        || 'https://rb257034.leadteh.ru/inner_webhook/deb210d6-ced0-43b2-a865-4afe92e32d8d';

    try {
        const body = req.body;

        if (!body || !body.telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'telegram_id is required'
            });
        }

        const telegramId = body.telegram_id.toString();
        const telegramIdInt = parseInt(body.telegram_id);
        const userName = [
            body.user_data?.first_name || '',
            body.user_data?.last_name || ''
        ].filter(Boolean).join(' ') || 'User';
        const startParam = body.start_param || '';

        console.log('[Bridge] ===== START =====');
        console.log('[Bridge] telegram_id:', telegramId);
        console.log('[Bridge] start_param:', startParam);
        console.log('[Bridge] user_name:', userName);

        // Step 1: Create or update contact via Leadteh API
        const createContactPayload = {
            bot_id: parseInt(LEADTEH_BOT_ID),
            messenger: 'telegram',
            telegram_id: telegramIdInt, // as integer
            name: userName,
            telegram_username: body.user_data?.username || ''
        };

        console.log('[Bridge] Step 1: Creating contact...');
        console.log('[Bridge] Payload:', JSON.stringify(createContactPayload));

        // Try with Authorization: Bearer header
        const createResponse = await fetch('https://app.leadteh.ru/api/v1/createOrUpdateContact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${LEADTEH_API_KEY}`
            },
            body: JSON.stringify(createContactPayload)
        });

        const createResult = await createResponse.text();
        console.log('[Bridge] Create contact status:', createResponse.status);
        console.log('[Bridge] Create contact response:', createResult);

        let contactCreated = createResponse.ok;

        // If Bearer didn't work, try X-Api-Key
        if (!createResponse.ok && createResponse.status === 401) {
            console.log('[Bridge] Trying X-Api-Key header...');
            const retryResponse = await fetch('https://app.leadteh.ru/api/v1/createOrUpdateContact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Api-Key': LEADTEH_API_KEY
                },
                body: JSON.stringify(createContactPayload)
            });
            const retryResult = await retryResponse.text();
            console.log('[Bridge] Retry status:', retryResponse.status);
            console.log('[Bridge] Retry response:', retryResult);
            contactCreated = retryResponse.ok;
        }

        // Step 2: Send variables via inner_webhook
        // Format A: flat structure — variables at top level
        const webhookPayloadFlat = {
            telegram_id: telegramId,
            start_param: startParam,
            utm_source: startParam,
            campaign_tag: startParam,
            source: 'telegram_ads_bridge',
            telegram_user_id: telegramId,
            telegram_first_name: body.user_data?.first_name || '',
            telegram_last_name: body.user_data?.last_name || '',
            telegram_username: body.user_data?.username || '',
            telegram_language: body.user_data?.language_code || '',
            telegram_is_premium: body.user_data?.is_premium ? 'true' : 'false',
            telegram_user_name: userName,
            bridge_timestamp: body.timestamp || new Date().toISOString(),
            bridge_platform: body.platform || 'unknown'
        };

        // Format B: nested structure with contact_by + variables wrapper
        const webhookPayloadNested = {
            contact_by: 'telegram_id',
            search: telegramId,
            variables: webhookPayloadFlat
        };

        console.log('[Bridge] Step 2: Sending variables (flat format)...');
        console.log('[Bridge] Flat payload:', JSON.stringify(webhookPayloadFlat));

        const webhookResponse = await fetch(LEADTEH_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(webhookPayloadFlat)
        });

        const webhookResult = await webhookResponse.text();
        console.log('[Bridge] Webhook (flat) status:', webhookResponse.status);
        console.log('[Bridge] Webhook (flat) response:', webhookResult);

        // If flat format failed, try nested format as fallback
        let webhookNestedResult = null;
        if (!webhookResponse.ok) {
            console.log('[Bridge] Trying nested format...');
            const webhookResponse2 = await fetch(LEADTEH_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(webhookPayloadNested)
            });
            webhookNestedResult = await webhookResponse2.text();
            console.log('[Bridge] Webhook (nested) status:', webhookResponse2.status);
            console.log('[Bridge] Webhook (nested) response:', webhookNestedResult);
        }

        console.log('[Bridge] ===== END =====');

        // Return success
        return res.status(200).json({
            success: true,
            message: 'Contact processed',
            contact_created: contactCreated,
            variables_sent: webhookResponse.ok,
            details: {
                create_status: createResponse.status,
                webhook_status: webhookResponse.status,
                start_param: startParam
            }
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
