/**
 * Vercel Serverless Function - Bridge Webhook Proxy
 *
 * 1. createOrUpdateContact — создаёт контакт, возвращает contact_id
 * 2. inner_webhook — передаёт start_param, Leadteh сохраняет через маппинг переменных
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

        // ─── Step 1: createOrUpdateContact ────────────────────────────────
        console.log('[Bridge] Step 1: createOrUpdateContact...');
        const createPayload = {
            bot_id: parseInt(LEADTEH_BOT_ID),
            messenger: 'telegram',
            name: userName
        };
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
            console.log('[Bridge] Failed to parse response');
        }

        // ─── Step 2: inner_webhook (сохраняет start_param через маппинг) ──
        // contact_by=id если есть contact_id из Step 1, иначе telegram_id
        const contactBy = contactId ? 'id' : 'telegram_id';
        const search = contactId ? contactId.toString() : telegramId;
        console.log('[Bridge] Step 2: inner_webhook (contact_by=' + contactBy + ', search=' + search + ')...');

        const webhookRes = await fetch(LEADTEH_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_by: contactBy,
                search: search,
                start_param: startParam
            })
        });
        const webhookText = await webhookRes.text();
        console.log('[Bridge] inner_webhook status:', webhookRes.status);
        console.log('[Bridge] inner_webhook response:', webhookText);

        console.log('[Bridge] ===== END =====');

        return res.status(200).json({
            success: true,
            contact_id: contactId,
            webhook_status: webhookRes.status,
            start_param: startParam
        });

    } catch (error) {
        console.error('[Bridge] ERROR:', error.message);
        return res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
    }
}
