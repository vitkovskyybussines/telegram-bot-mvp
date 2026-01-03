const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const managerId = process.env.MANAGER_TELEGRAM_ID;

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '👋 Вітаю!\n\nВведіть код магазину для доступу.'
  );
});

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('SHOP-')) {
    bot.sendMessage(
      managerId,
      `🔐 Запит на доступ\nКод: ${msg.text}\nTelegram ID: ${msg.from.id}`
    );

    bot.sendMessage(
      msg.chat.id,
      '⏳ Запит відправлено менеджеру. Очікуйте підтвердження.'
    );
  }
});
