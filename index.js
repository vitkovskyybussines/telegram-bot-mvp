const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const managerId = process.env.MANAGER_TELEGRAM_ID;

const bot = new TelegramBot(token, { polling: true });

// Тимчасове сховище дозволених користувачів
const approvedUsers = new Set();

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 Вітаю!\n\nВведіть код магазину для доступу.'
  );
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  // Якщо користувач вже підтверджений
  if (approvedUsers.has(chatId)) {
    bot.sendMessage(chatId, '✅ Доступ підтверджено. Ви можете оформлювати заявки.');
    return;
  }

  // Запит на доступ
  bot.sendMessage(managerId, {
    text: `🔐 Запит на доступ\nКод: ${text}\nTelegram ID: ${chatId}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Підтвердити', callback_data: `approve:${chatId}` },
          { text: '❌ Відхилити', callback_data: `reject:${chatId}` }
        ]
      ]
    }
  });

  bot.sendMessage(chatId, '⏳ Запит відправлено менеджеру. Очікуйте підтвердження.');
});

// Обробка кнопок менеджера
bot.on('callback_query', (query) => {
  const data = query.data;
  const managerChatId = query.message.chat.id;

  if (String(managerChatId) !== String(managerId)) {
    bot.answerCallbackQuery(query.id, { text: '⛔ Немає доступу' });
    return;
  }

  const [action, userId] = data.split(':');

  if (action === 'approve') {
    approvedUsers.add(Number(userId));
    bot.sendMessage(userId, '✅ Ваш доступ підтверджено. Можете працювати.');
    bot.answerCallbackQuery(query.id, { text: 'Доступ підтверджено' });
  }

  if (action === 'reject') {
    bot.sendMessage(userId, '❌ У доступі відмовлено.');
    bot.answerCallbackQuery(query.id, { text: 'Запит відхилено' });
  }
});
