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
        const userName = [
            body.user_data?.first_name || '',
            body.user_data?.last_name || ''
        ].filter(Boolean).join(' ') || 'User';

        console.log('[Bridge] Processing request for telegram_id:', telegramId);

        // Step 1: Create or update contact via Leadteh API
        const createContactPayload = {
            bot_id: parseInt(LEADTEH_BOT_ID),
            messenger: 'telegram',
            telegram_id: telegramId,
            name: userName,
            telegram_username: body.user_data?.username || ''
        };

        console.log('[Bridge] Creating/updating contact:', createContactPayload);

        const createResponse = await fetch('https://app.leadteh.ru/api/v1/createOrUpdateContact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Api-Key': LEADTEH_API_KEY
            },
            body: JSON.stringify(createContactPayload)
        });

        const createResult = await createResponse.text();
        console.log('[Bridge] Create contact response:', createResponse.status, createResult);

        if (!createResponse.ok) {
            console.error('[Bridge] Failed to create contact:', createResult);
            // Continue anyway - maybe contact already exists
        }

        // Step 2: Send variables via inner_webhook
        const webhookPayload = {
            contact_by: 'telegram_id',
            search: telegramId,
            variables: {
                start_param: body.start_param || '',
                utm_source: body.start_param || '',
                campaign_tag: body.start_param || '',
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
            }
        };

        console.log('[Bridge] Sending variables to webhook:', {
            search: webhookPayload.search,
            start_param: webhookPayload.variables.start_param
        });

        const webhookResponse = await fetch(LEADTEH_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(webhookPayload)
        });

        const webhookResult = await webhookResponse.text();
        console.log('[Bridge] Webhook response:', webhookResponse.status, webhookResult);

        // Return success if either step worked
        return res.status(200).json({
            success: true,
            message: 'Contact processed',
            contact_created: createResponse.ok,
            variables_sent: webhookResponse.ok,
            details: {
                create_status: createResponse.status,
                webhook_status: webhookResponse.status
            }
        });

    } catch (error) {
        console.error('[Bridge] Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}
