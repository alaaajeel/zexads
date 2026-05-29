import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { db, auth } from './src/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { fbAdminGetPendingWithdrawals, fbAdminApproveWithdrawal, fbAdminRejectWithdrawal, fbAdminGetAllUsers } from './src/lib/firebaseUtils';

// System Credentials
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7790683511:AAEIVZx5IT3lXVWskhHIZpA8qCe-E8SlsSE';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '7170373965';

// Initialize the bot - Disable polling for serverless (Vercel) compatibility
const isServerless = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
export const bot = new TelegramBot(TOKEN, { polling: !isServerless });

// Lightweight local session state
const userState = new Map<number, 'waiting_for_ticket'>();
let ticketCounter = 1000;
const USER_ID_REGEX = /ID:\s(\d+)/;

// Firebase State
let isAdminLoggedIn = false;
const notifiedTxIds = new Set<string>();
let pollingInterval: NodeJS.Timeout | null = null;

const ADMIN_EMAIL = 'dhi9886@zexads.local';
const ADMIN_PASSWORD = 'alaa.ali900';

export async function autoLoginAdmin() {
    try {
        await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
        isAdminLoggedIn = true;
        console.log("✅ Admin Login Successful.");
    } catch (e: any) {
        console.error("❌ Admin Login Failed:", e.message);
    }
}

// Function to check for new transactions (Can be called by Cron)
export async function checkTransactionsNotification() {
    if (!isAdminLoggedIn) await autoLoginAdmin();
    if (!isAdminLoggedIn) return;

    try {
        const pendingTxs = await fbAdminGetPendingWithdrawals();
        const users = await fbAdminGetAllUsers();
        const userMap = new Map<string, any>(users.map(u => [u.id, u]));
        
        for (const tx of pendingTxs) {
            if (!notifiedTxIds.has(tx.id)) {
                notifiedTxIds.add(tx.id);
                
                const user = userMap.get(tx.userId);
                const userName = user ? (user.realName || user.username || 'بدون اسم') : 'مستخدم غير معروف';
                const userEmail = user ? (user.email || 'بدون بريد') : 'بدون بريد';
                const userPhone = user ? (user.phoneNumber || 'بدون هاتف') : 'بدون هاتف';
                const userWallet = user ? (user.walletAddress || tx.walletAddress || 'لم يتم الربط') : 'غير معروف';
                const remainingBalance = user ? (user.main_balance || user.totalBalance || 0) : 0;
                
                let msg = "";
                if (tx.type === 'withdraw') {
                    const gross = tx.grossAmount || tx.amount;
                    const net = tx.amount;
                    msg = `🚨 *طلب سحب جديد معلق* 🚨\n\n` +
                          `👤 *المستخدم:* ${userName}\n` +
                          `🆔 *ID:* \`${tx.userId}\`\n` +
                          `💰 *المبلغ:* $${gross.toFixed(2)}\n` +
                          `💵 *الصافي:* $${net.toFixed(2)}\n` +
                          `⚡ *النوع:* ${tx.method === 'express' ? 'سحب فوري Express ⚡' : 'سحب قياسي ⏳'}\n` +
                          `🏦 *الرصيد المتبقي:* $${remainingBalance.toFixed(2)}\n\n` +
                          `🌐 *المحفظة:*\n\`${userWallet}\`\n\n` +
                          `-------------------------------------------`;
                } else {
                    const netAmountMsg = tx.type === 'deposit' ? `(صافي الشحن: ${Math.max(0, tx.amount - 3)} USDT)` : '';
                    msg = `🔔 *طلب إيداع جديد!*\n\n` +
                          `👤 *العميل:* ${userName}\n` +
                          `📧 *البريد:* \`${userEmail}\`\n` +
                          `📞 *الهاتف:* \`${userPhone}\`\n` +
                          `💰 *المبلغ:* ${tx.amount} USDT\n` +
                          `${netAmountMsg ? `💵 ` + netAmountMsg + `\n` : ''}` +
                          `🆔 *العملية:* \`${tx.id}\`\n` +
                          `🔑 *المستخدم:* \`${tx.userId}\`\n\n`;
                }
                            
                const replyMarkup = {
                    inline_keyboard: [[
                        { text: "✅ قبول", callback_data: `approve_${tx.userId}_${tx.id}` },
                        { text: "❌ رفض", callback_data: `reject_${tx.userId}_${tx.id}` }
                    ]]
                };

                const proofUrl = tx.proofUrl || tx.proofImage;
                if (proofUrl) {
                    await bot.sendPhoto(ADMIN_CHAT_ID, proofUrl, { caption: msg, parse_mode: 'Markdown', reply_markup: replyMarkup })
                      .catch(() => bot.sendMessage(ADMIN_CHAT_ID, msg + `\n\n🖼️ *الرابط:* ${proofUrl}`, { parse_mode: 'Markdown', reply_markup: replyMarkup }));
                } else {
                    await bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown', reply_markup: replyMarkup });
                }
            }
        }
    } catch (e: any) {
         console.error("Error checking transactions:", e.message);
    }
}

export function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(checkTransactionsNotification, 20 * 1000);
}

if (!isServerless) {
    autoLoginAdmin().then(startPolling);
}

// Bot Handlers
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() === ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, "👨‍💻 *مرحباً بك في لوحة تحكم ZexAds.*\nللرد، قم بعمل 'Reply' على التذكرة.", { parse_mode: 'Markdown' });
        return;
    }
    bot.sendMessage(chatId, "مرحباً بك في الدعم الفني لشبكة ZexAds الإعلانية!", {
        reply_markup: {
            keyboard: [
                [{ text: "💰 الإيداع والسحب" }, { text: "🚀 باقات الـ VIP والترقيات" }],
                [{ text: "👨💻 التحدث مع الدعم المباشر" }]
            ],
            resize_keyboard: true
        }
    });
});

bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || query.message?.chat.id.toString() !== ADMIN_CHAT_ID) return;
    
    if (!isAdminLoggedIn) {
        bot.answerCallbackQuery(query.id, { text: "⚠️ سجل الدخول أولاً", show_alert: true });
        return;
    }
    
    const [action, userId, txId] = data.split('_');
    try {
        if (action === 'approve') {
            await fbAdminApproveWithdrawal(userId, txId);
            bot.editMessageText(`✅ **تم القبول:** \`${txId}\``, { chat_id: query.message?.chat.id, message_id: query.message?.message_id, parse_mode: 'Markdown' });
        } else if (action === 'reject') {
            await fbAdminRejectWithdrawal(userId, txId);
            bot.editMessageText(`❌ **تم الرفض:** \`${txId}\``, { chat_id: query.message?.chat.id, message_id: query.message?.message_id, parse_mode: 'Markdown' });
        }
    } catch (e: any) {
        bot.answerCallbackQuery(query.id, { text: `❌ فشل: ${e.message}`, show_alert: true });
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    if (text.startsWith('/')) return;

    if (chatId.toString() === ADMIN_CHAT_ID) {
        if (msg.reply_to_message && msg.reply_to_message.text) {
            const match = msg.reply_to_message.text.match(USER_ID_REGEX);
            if (match && match[1]) {
                const targetUserId = parseInt(match[1], 10);
                try {
                    await bot.sendMessage(targetUserId, `👨‍💻 *رد من الدعم الفني:*\n\n${text}`, { parse_mode: 'Markdown' });
                    await bot.sendMessage(ADMIN_CHAT_ID, `✅ تم إرسال الرد.`);
                } catch (error) {
                    await bot.sendMessage(ADMIN_CHAT_ID, `❌ المستخدم حظر البوت.`);
                }
            }
        }
        return;
    }

    switch (text) {
        case "💰 الإيداع والسحب":
            return bot.sendMessage(chatId, "السحب يتم خلال أوقات العمل الرسمية عبر USDT.");
        case "🚀 باقات الـ VIP والترقيات":
            return bot.sendMessage(chatId, "باقات VIP تزيد أرباحك اليومية.");
        case "👨💻 التحدث مع الدعم المباشر":
            userState.set(chatId, 'waiting_for_ticket');
            return bot.sendMessage(chatId, "اكتب رسالتك الآن وسنقوم بتحويلها للدعم:");
    }

    if (userState.get(chatId) === 'waiting_for_ticket') {
        const adminMsg = `🎫 *تذكرة جديدة*\n👤 *المرسل:* ${msg.from?.first_name} (ID: ${chatId})\n\n📄 *الرسالة:*\n${text}`;
        await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, "✅ تم استلام رسالتك.");
        userState.delete(chatId);
        return;
    }
});
