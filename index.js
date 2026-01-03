const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_TELEGRAM_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  throw new Error('❌ BOT_TOKEN або MANAGER_TELEGRAM_ID не задані');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Тимчасове сховище підтверджених магазинів
const approvedUsers = new Set();

/**
 * /start
 */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 Вітаю!\n\nВведіть код магазину для доступу.'
  );
});

/**
 * Обробка текстових повідомлень (коди магазинів)
 */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text.startsWith('/')) return;

  // Якщо магазин вже підтверджений
  if (approvedUsers.has(chatId)) {
    bot.sendMessage(
      chatId,
      '✅ Доступ підтверджено. Ви можете оформлювати заявки.'
    );
    return;
  }

  // Повідомлення менеджеру з кнопками
  bot.sendMessage(
    MANAGER_ID,
    `🔐 Запит на доступ\nКод: ${text}\nTelegram ID: ${chatId}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Підтвердити', callback_data: `approve:${chatId}` },
            { text: '❌ Відхилити', callback_data: `reject:${chatId}` }
          ]
        ]
      }
    }
  );

  // Відповідь магазину
  bot.sendMessage(
    chatId,
    '⏳ Запит відправлено менеджеру. Очікуйте підтвердження.'
  );
});

/**
 * Обробка кнопок менеджера
 */
bot.on('callback_query', (query) => {
  const data = query.data;
  const managerChatId = query.message.chat.id;

  // Захист: кнопки тільки для менеджера
  if (managerChatId !== MANAGER_ID) {
    bot.answerCallbackQuery(query.id, {
      text: '⛔ Немає доступу'
    });
    return;
  }

  const [action, userId] = data.split(':');
  const targetUserId = Number(userId);

  if (action === 'approve') {
    approvedUsers.add(targetUserId);

    bot.sendMessage(
      targetUserId,
      '✅ Ваш доступ підтверджено. Можете працювати.'
    );

    bot.answerCallbackQuery(query.id, {
      text: 'Доступ підтверджено'
    });
  }

  if (action === 'reject') {
    bot.sendMessage(
      targetUserId,
      '❌ У доступі відмовлено.'
    );

    bot.answerCallbackQuery(query.id, {
      text: 'Запит відхилено'
    });
  }
});

console.log('🤖 Telegram bot started successfully');
