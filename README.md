# Telegram Ads Bridge Mini App

A minimal Telegram Mini App that captures advertising parameters from Telegram Ads and forwards them to Leadteh for 100% attribution tracking.

## Problem Solved

When running Telegram Ads with direct bot links (`t.me/bot?start=xyz`), platforms like Leadteh often lose the `start` parameter for **new users**. This bridge solves the problem by:

1. Opening as a Mini App (which preserves parameters)
2. Capturing `start_param` and `telegram_id`
3. Sending data to Leadteh webhook
4. Auto-closing to land the user in the bot chat

## Architecture

```
[Telegram Ad]
    ↓ (user clicks)
[Mini App Link: t.me/bot/bridge?startapp=campaign_123]
    ↓
[Bridge Mini App Opens]
    ↓ (captures: telegram_id, start_param, initData)
[POST to /api/bridge-webhook]
    ↓ (proxy)
[Leadteh Webhook receives full attribution data]
    ↓
[Mini App closes → tg.close()]
    ↓
[User lands in bot chat with correct flow triggered]
```

## File Structure

```
bridge/
├── index.html           # Main Mini App page
├── css/
│   └── bridge.css       # Minimal styles with Telegram theme support
├── js/
│   └── bridge.js        # Core bridge logic
├── api/
│   └── bridge-webhook.js  # Vercel serverless function (proxy to Leadteh)
├── vercel.json          # Vercel deployment config
├── .env.example         # Environment variables template
└── README.md            # This file
```

## Deployment

### Option 1: Deploy as Separate Vercel Project

1. **Create new Vercel project:**
   ```bash
   cd bridge
   vercel
   ```

2. **Set environment variable in Vercel Dashboard:**
   - Go to Project Settings → Environment Variables
   - Add `LEADTEH_WEBHOOK_URL` with your Leadteh webhook URL

3. **Get your deployment URL** (e.g., `https://your-bridge.vercel.app`)

### Option 2: Deploy as Part of Existing Project

If you want the bridge at `/bridge` on your existing domain:

1. **Copy files to your project root:**
   - Move `bridge/index.html` → `bridge.html` (or keep as `bridge/index.html`)
   - Move `bridge/api/bridge-webhook.js` → `api/bridge-webhook.js`

2. **Update your root `vercel.json`:**
   ```json
   {
     "rewrites": [
       {
         "source": "/bridge",
         "destination": "/bridge/index.html"
       }
     ]
   }
   ```

3. **Set environment variable** as above

## Telegram Ads Link Format

### For Mini App (Recommended)

Use this format in your Telegram Ads:

```
https://t.me/YOUR_BOT_USERNAME/bridge?startapp=CAMPAIGN_TAG
```

Where:
- `YOUR_BOT_USERNAME` - Your bot's username (without @)
- `bridge` - The Mini App short name (configure in BotFather)
- `CAMPAIGN_TAG` - Your marketing tag (e.g., `promo_jan2024`, `utm_source_fb`)

### Setup in BotFather

1. Open [@BotFather](https://t.me/BotFather)
2. Send `/mybots` → Select your bot → **Bot Settings** → **Menu Button**
3. Or use `/newapp` to create a new Mini App:
   - **Short name:** `bridge`
   - **URL:** `https://your-bridge-domain.vercel.app/` (your deployed bridge URL)

### Examples

| Campaign | Telegram Ads Link |
|----------|------------------|
| Facebook Retargeting | `t.me/mybot/bridge?startapp=fb_retarget_jan` |
| Instagram Story | `t.me/mybot/bridge?startapp=ig_story_promo` |
| Telegram Channel | `t.me/mybot/bridge?startapp=tg_channel_main` |
| General Promo | `t.me/mybot/bridge?startapp=promo_2024q1` |

## Data Sent to Leadteh

The bridge sends this payload to your Leadteh webhook:

```json
{
  "telegram_id": 123456789,
  "start_param": "your_campaign_tag",
  "init_data": "query_string_with_signature",
  "user_data": {
    "id": 123456789,
    "first_name": "John",
    "last_name": "Doe",
    "username": "johndoe",
    "language_code": "en",
    "is_premium": false
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "platform": "android",
  "source": "telegram_ads_bridge"
}
```

## Configuration

Edit `window.BRIDGE_CONFIG` in `index.html`:

```javascript
window.BRIDGE_CONFIG = {
    WEBHOOK_URL: '/api/bridge-webhook',  // Webhook endpoint
    TIMEOUT_MS: 10000,                   // Request timeout
    MAX_RETRIES: 2,                      // Auto-retry count
    RETRY_DELAY_MS: 1000,                // Delay between retries
    CLOSE_DELAY_MS: 500                  // Delay before auto-close
};
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network error | Auto-retry up to 2 times, then show error with retry button |
| Server error (5xx) | Auto-retry, then show error |
| Client error (4xx) | Show error immediately (no retry) |
| Timeout | Auto-retry, then show error |
| User clicks "Close" | Mini App closes, user goes to bot chat |

## Security Notes

1. **initData Validation:** The `init_data` field contains a signed hash that can be validated server-side using your bot token. Implement validation in your Leadteh workflow if needed.

2. **No Secrets in Frontend:** All sensitive URLs are proxied through the serverless function.

3. **CORS:** The serverless function handles CORS to allow requests from Telegram's Mini App context.

## Testing Locally

1. **Start a local server:**
   ```bash
   cd bridge
   npx serve .
   ```

2. **Open in browser:** The app will run but won't have real Telegram data. Check browser console for logs.

3. **Test with ngrok:** For testing with real Telegram:
   ```bash
   ngrok http 3000
   ```
   Then use the ngrok URL in BotFather temporarily.

## Troubleshooting

### Mini App doesn't open
- Verify the bot username is correct
- Ensure Mini App is configured in BotFather with correct URL
- Check that the URL uses HTTPS

### start_param is null
- Verify the link format: `t.me/bot/app?startapp=tag` (note: `startapp`, not `start`)
- Check that the tag doesn't contain special characters (use alphanumeric and underscores)

### Webhook returns error
- Check Vercel function logs in dashboard
- Verify `LEADTEH_WEBHOOK_URL` environment variable is set
- Test the Leadteh webhook directly with curl

### App shows "Connecting..." forever
- Check browser Network tab for failed requests
- Verify the API endpoint is accessible
- Check Vercel deployment logs

## License

MIT
