/**
 * Vercel Serverless Function - Bridge Webhook Proxy
 *
 * Proxies requests from the Bridge Mini App to Leadteh webhook.
 * Converts data to Leadteh's expected format and handles CORS.
 *
 * Leadteh expects:
 * {
 *   "contact_by": "telegram_id",
 *   "search": "123456789",
 *   "variables": { ... }
 * }
 */

export default async function handler(req, res) {
    // CORS Headers - allow requests from any origin (Mini Apps run in Telegram's context)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }

    // Get webhook URL from environment variable or use default
    const LEADTEH_WEBHOOK_URL = process.env.LEADTEH_WEBHOOK_URL
        || 'https://rb257034.leadteh.ru/inner_webhook/deb210d6-ced0-43b2-a865-4afe92e32d8d';

    try {
        const body = req.body;

        // Validate required fields
        if (!body) {
            return res.status(400).json({
                success: false,
                error: 'Request body is required'
            });
        }

        // Validate telegram_id - critical for Leadteh to find the contact
        if (!body.telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'telegram_id is required'
            });
        }

        // Log incoming request (for debugging)
        console.log('[Bridge Webhook] Received request:', {
            telegram_id: body.telegram_id,
            start_param: body.start_param,
            timestamp: body.timestamp
        });

        // Build the payload in LEADTEH's expected format
        // Reference: LEADTEX_INTEGRATION.md and app.js sendBookingToServer()
        const leadtehPayload = {
            // How to find the contact in Leadteh
            contact_by: 'telegram_id',
            search: body.telegram_id.toString(),

            // Variables to set on the contact
            variables: {
                // Campaign/Attribution data
                start_param: body.start_param || '',
                utm_source: body.start_param || '',
                campaign_tag: body.start_param || '',

                // Source identification
                source: 'telegram_ads_bridge',

                // User data for enrichment
                telegram_user_id: body.telegram_id.toString(),
                telegram_first_name: body.user_data?.first_name || '',
                telegram_last_name: body.user_data?.last_name || '',
                telegram_username: body.user_data?.username || '',
                telegram_language: body.user_data?.language_code || '',
                telegram_is_premium: body.user_data?.is_premium ? 'true' : 'false',

                // Full name combined
                telegram_user_name: [
                    body.user_data?.first_name || '',
                    body.user_data?.last_name || ''
                ].filter(Boolean).join(' ') || '',

                // Metadata
                bridge_timestamp: body.timestamp || new Date().toISOString(),
                bridge_platform: body.platform || 'unknown',

                // Raw initData for server-side validation if needed
                init_data: body.init_data || ''
            }
        };

        console.log('[Bridge Webhook] Sending to Leadteh:', {
            contact_by: leadtehPayload.contact_by,
            search: leadtehPayload.search,
            start_param: leadtehPayload.variables.start_param
        });

        // Send request to Leadteh
        const response = await fetch(LEADTEH_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(leadtehPayload)
        });

        // Get response data
        let responseData;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        console.log('[Bridge Webhook] Leadteh response:', {
            status: response.status,
            ok: response.ok,
            data: responseData
        });

        // Return response to client
        if (response.ok) {
            return res.status(200).json({
                success: true,
                message: 'Data forwarded successfully',
                data: responseData
            });
        } else {
            // Forward the error status
            return res.status(response.status).json({
                success: false,
                error: `Leadteh returned status ${response.status}`,
                data: responseData
            });
        }

    } catch (error) {
        console.error('[Bridge Webhook] Error:', error.message);

        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}
