const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_TELEGRAM_ID);
const STORES_FILE = './stores.json';

if (!BOT_TOKEN || !MANAGER_ID) {
  throw new Error('❌ BOT_TOKEN або MANAGER_TELEGRAM_ID не задані');
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/**
 * ===== РОБОТА З ФАЙЛОМ =====
 */
function loadStores() {
  if (!fs.existsSync(STORES_FILE)) {
    return { approved: {} };
  }
  return JSON.parse(fs.readFileSync(STORES_FILE));
}

function saveStores(data) {
  fs.writeFileSync(STORES_FILE, JSON.stringify(data, null, 2));
}

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
 * Обробка повідомлень
 */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text.startsWith('/')) return;

  const stores = loadStores();

  // Якщо магазин вже підтверджений
  if (stores.approved[chatId]) {
    bot.sendMessage(
      chatId,
      `✅ Доступ підтверджено.\nКод магазину: ${stores.approved[chatId]}`
    );
    return;
  }

  // Запит менеджеру
  bot.sendMessage(
    MANAGER_ID,
    `🔐 Запит на доступ\nКод: ${text}\nTelegram ID: ${chatId}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Підтвердити', callback_data: `approve:${chatId}:${text}` },
            { text: '❌ Відхилити', callback_data: `reject:${chatId}` }
          ]
        ]
      }
    }
  );

  bot.sendMessage(
    chatId,
    '⏳ Запит відправлено менеджеру. Очікуйте підтвердження.'
  );
});

/**
 * Кнопки менеджера
 */
bot.on('callback_query', async (query) => {
  const managerChatId = query.message.chat.id;

  if (managerChatId !== MANAGER_ID) {
    return bot.answerCallbackQuery(query.id, {
      text: '⛔ Немає доступу'
    });
  }

  const parts = query.data.split(':');
  const action = parts[0];
  const userId = Number(parts[1]);
  const storeCode = parts[2];

  // Прибираємо кнопки
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }
  );

  const stores = loadStores();

  if (action === 'approve') {
    stores.approved[userId] = storeCode;
    saveStores(stores);

    bot.sendMessage(
      userId,
      `✅ Ваш доступ підтверджено.\nКод магазину: ${storeCode}`
    );

    bot.answerCallbackQuery(query.id, { text: 'Доступ підтверджено' });
  }

  if (action === 'reject') {
    bot.sendMessage(
      userId,
      '❌ У доступі відмовлено.'
    );

    bot.answerCallbackQuery(query.id, { text: 'Запит відхилено' });
  }
});

console.log('🤖 Telegram bot with store storage started');
