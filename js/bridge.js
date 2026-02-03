/**
 * Telegram Ads Bridge Mini App
 *
 * Captures advertising parameters from Telegram Ads links and forwards them
 * to Leadteh webhook for proper attribution, then closes to land user in bot chat.
 *
 * Flow:
 * 1. Initialize Telegram WebApp SDK
 * 2. Extract start_param and telegram_id from initData
 * 3. POST data to Leadteh webhook
 * 4. On success: close Mini App -> user lands in bot chat
 * 5. On error: show retry option
 */

(function() {
    'use strict';

    // ===================================
    // CONFIGURATION
    // ===================================

    const CONFIG = window.BRIDGE_CONFIG || {
        WEBHOOK_URL: '/api/bridge-webhook',
        TIMEOUT_MS: 10000,
        MAX_RETRIES: 2,
        RETRY_DELAY_MS: 1000,
        CLOSE_DELAY_MS: 500
    };

    // ===================================
    // STATE
    // ===================================

    let tg = null;
    let retryCount = 0;
    let bridgeData = null;

    // ===================================
    // DOM ELEMENTS
    // ===================================

    const elements = {
        loadingState: null,
        errorState: null,
        successState: null,
        errorMessage: null,
        retryBtn: null,
        closeBtn: null
    };

    // ===================================
    // UI HELPERS
    // ===================================

    function showState(stateName) {
        elements.loadingState?.classList.add('hidden');
        elements.errorState?.classList.add('hidden');
        elements.successState?.classList.add('hidden');

        switch (stateName) {
            case 'loading':
                elements.loadingState?.classList.remove('hidden');
                break;
            case 'error':
                elements.errorState?.classList.remove('hidden');
                break;
            case 'success':
                elements.successState?.classList.remove('hidden');
                break;
        }
    }

    function showError(message) {
        if (elements.errorMessage) {
            elements.errorMessage.textContent = message || 'Unable to connect. Please try again.';
        }
        showState('error');
    }

    function applyTelegramTheme() {
        if (!tg) return;

        const theme = tg.colorScheme || 'light';
        document.body.setAttribute('data-theme', theme);

        // Apply Telegram theme colors if available
        if (tg.themeParams) {
            const root = document.documentElement;
            if (tg.themeParams.bg_color) {
                root.style.setProperty('--tg-bg-color', tg.themeParams.bg_color);
            }
            if (tg.themeParams.text_color) {
                root.style.setProperty('--tg-text-color', tg.themeParams.text_color);
            }
            if (tg.themeParams.button_color) {
                root.style.setProperty('--tg-button-color', tg.themeParams.button_color);
            }
            if (tg.themeParams.button_text_color) {
                root.style.setProperty('--tg-button-text-color', tg.themeParams.button_text_color);
            }
        }
    }

    // ===================================
    // DATA EXTRACTION
    // ===================================

    function extractBridgeData() {
        if (!tg) {
            console.error('[Bridge] Telegram WebApp not available');
            return null;
        }

        const initDataUnsafe = tg.initDataUnsafe || {};
        const user = initDataUnsafe.user || {};

        // Extract telegram_id - this is critical
        const telegramId = user.id;
        if (!telegramId) {
            console.warn('[Bridge] No telegram_id found in initData');
        }

        // Extract start_param from the startapp URL parameter
        // This is passed via t.me/bot?startapp=xyz links
        const startParam = initDataUnsafe.start_param || null;

        // Build the bridge data payload
        const data = {
            // Core attribution data
            telegram_id: telegramId || null,
            start_param: startParam,

            // Full initData for server-side validation
            init_data: tg.initData || '',

            // Additional user context (optional, for enriched tracking)
            user_data: {
                id: user.id || null,
                first_name: user.first_name || null,
                last_name: user.last_name || null,
                username: user.username || null,
                language_code: user.language_code || null,
                is_premium: user.is_premium || false
            },

            // Metadata
            timestamp: new Date().toISOString(),
            platform: tg.platform || 'unknown',
            version: tg.version || 'unknown'
        };

        console.log('[Bridge] Extracted data:', {
            telegram_id: data.telegram_id,
            start_param: data.start_param,
            platform: data.platform
        });

        return data;
    }

    // ===================================
    // WEBHOOK COMMUNICATION
    // ===================================

    async function sendToWebhook(data) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

        try {
            const response = await fetch(CONFIG.WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(data),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Log response for debugging
            console.log('[Bridge] Webhook response status:', response.status);

            // Consider 2xx responses as success
            if (response.ok) {
                let responseData = null;
                try {
                    responseData = await response.json();
                } catch (e) {
                    // Response might not be JSON, that's OK
                    responseData = await response.text();
                }
                console.log('[Bridge] Webhook response data:', responseData);
                return { success: true, data: responseData };
            }

            // Handle specific error codes
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error('[Bridge] Webhook error:', response.status, errorText);

            return {
                success: false,
                status: response.status,
                error: `Server error (${response.status})`,
                retryable: response.status >= 500 // Only retry on 5xx errors
            };

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                console.error('[Bridge] Request timeout');
                return { success: false, error: 'Connection timeout', retryable: true };
            }

            console.error('[Bridge] Network error:', error);
            return { success: false, error: 'Network error', retryable: true };
        }
    }

    // ===================================
    // BRIDGE FLOW
    // ===================================

    async function executeBridge() {
        showState('loading');

        // Extract data if not already done
        if (!bridgeData) {
            bridgeData = extractBridgeData();

            if (!bridgeData) {
                showError('Failed to initialize. Please reopen from Telegram.');
                return;
            }
        }

        // Send to webhook
        const result = await sendToWebhook(bridgeData);

        if (result.success) {
            // Success - show success state briefly, then close
            showState('success');
            sendDataToBot();
            setTimeout(() => {
                closeMiniApp();
            }, CONFIG.CLOSE_DELAY_MS);

        } else if (result.status === 404) {
            // 404 = Contact not found in Leadteh (new user who never wrote to bot)
            // This is expected for new users from ads
            // Send data to bot via sendData() so bot can capture it
            console.log('[Bridge] Contact not found (new user). Sending data to bot via sendData()');
            showState('success');
            sendDataToBot();
            setTimeout(() => {
                closeMiniApp();
            }, CONFIG.CLOSE_DELAY_MS);

        } else {
            // Error - check if we should retry
            if (result.retryable && retryCount < CONFIG.MAX_RETRIES) {
                retryCount++;
                console.log(`[Bridge] Retrying... (${retryCount}/${CONFIG.MAX_RETRIES})`);

                setTimeout(() => {
                    executeBridge();
                }, CONFIG.RETRY_DELAY_MS);

            } else {
                // Show error to user
                showError(result.error || 'Connection failed. Please try again.');
            }
        }
    }

    function sendDataToBot() {
        if (!tg || !bridgeData) return;

        // Send start_param and telegram_id to the bot via sendData
        // Bot will receive this as web_app_data event
        const dataForBot = {
            action: 'bridge_attribution',
            start_param: bridgeData.start_param || '',
            telegram_id: bridgeData.telegram_id,
            timestamp: bridgeData.timestamp
        };

        try {
            if (typeof tg.sendData === 'function') {
                tg.sendData(JSON.stringify(dataForBot));
                console.log('[Bridge] Data sent to bot:', dataForBot);
            }
        } catch (e) {
            console.error('[Bridge] Failed to send data to bot:', e);
        }
    }

    function closeMiniApp() {
        if (tg && typeof tg.close === 'function') {
            console.log('[Bridge] Closing Mini App...');
            tg.close();
        } else {
            console.log('[Bridge] Mock: Would close Mini App');
            // In dev mode, just log
        }
    }

    // ===================================
    // EVENT HANDLERS
    // ===================================

    function handleRetry() {
        retryCount = 0;
        executeBridge();
    }

    function handleClose() {
        closeMiniApp();
    }

    // ===================================
    // INITIALIZATION
    // ===================================

    function initDOMElements() {
        elements.loadingState = document.getElementById('loading-state');
        elements.errorState = document.getElementById('error-state');
        elements.successState = document.getElementById('success-state');
        elements.errorMessage = document.getElementById('error-message');
        elements.retryBtn = document.getElementById('retry-btn');
        elements.closeBtn = document.getElementById('close-btn');

        // Attach event listeners
        elements.retryBtn?.addEventListener('click', handleRetry);
        elements.closeBtn?.addEventListener('click', handleClose);
    }

    function initTelegram() {
        tg = window.Telegram?.WebApp;

        if (tg) {
            // Signal that the Mini App is ready
            tg.ready();

            // Apply theme
            applyTelegramTheme();

            console.log('[Bridge] Telegram WebApp initialized');
            console.log('[Bridge] Platform:', tg.platform);
            console.log('[Bridge] Version:', tg.version);

            return true;
        } else {
            console.warn('[Bridge] Telegram WebApp not available - running in standalone mode');
            // Continue anyway for testing purposes
            return false;
        }
    }

    function init() {
        console.log('[Bridge] Initializing Telegram Ads Bridge...');

        // Initialize DOM elements
        initDOMElements();

        // Initialize Telegram WebApp
        const telegramAvailable = initTelegram();

        // Start the bridge process
        // Even if Telegram isn't available, we try to proceed (for testing)
        setTimeout(() => {
            executeBridge();
        }, 100); // Small delay to ensure SDK is fully ready
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
