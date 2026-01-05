const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  console.error('❌ BOT_TOKEN або MANAGER_ID не задані');
  process.exit(1);
}

/* ================= SAFE START ================= */

// ⛔ ПОЛЛІНГ ВКЛЮЧАЄМО ТІЛЬКИ ПІСЛЯ СКИДАННЯ WEBHOOK
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

(async () => {
  try {
    console.log('🔄 Видаляємо webhook...');
    await bot.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Webhook видалено');

    await bot.startPolling();
    console.log('🤖 Bot started with polling');
  } catch (err) {
    console.error('❌ Помилка старту бота:', err);
    process.exit(1);
  }
})();

/* ================= FILES ================= */

const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';
const REMINDERS_FILE = './reminders.json';

function readJSON(path, def) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(path));
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

/* ================= STATE ================= */

const state = {};

/* ================= MENUS ================= */

function showManagerMenu(chatId) {
  bot.sendMessage(chatId, '👨‍💼 Панель менеджера', {
    reply_markup: {
      keyboard: [
        ['📦 Всі заявки'],
        ['🕓 Очікуючі', '🟡 Прийняті'],
        ['🏪 Заявки магазину']
      ],
      resize_keyboard: true
    }
  });
}

function showStoreMenu(chatId) {
  bot.sendMessage(chatId, '🏪 Меню магазину', {
    reply_markup: {
      keyboard: [
        ['➕ Створити заявку'],
        ['📄 Мої заявки']
      ],
      resize_keyboard: true
    }
  });
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (chatId === MANAGER_ID) {
    showManagerMenu(chatId);
    return;
  }

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);

  if (store) {
    showStoreMenu(chatId);
  } else {
    bot.sendMessage(chatId, '🔐 Введіть код магазину (SHOP-001)');
    state[chatId] = 'WAIT_STORE_CODE';
  }
});

/* ================= STORE ACCESS ================= */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || chatId === MANAGER_ID) return;

  if (state[chatId] === 'WAIT_STORE_CODE') {
    const storeCode = text.toUpperCase();
    const stores = readJSON(STORES_FILE, []);

    if (stores.find(s => s.userId === chatId)) {
      showStoreMenu(chatId);
      state[chatId] = null;
      return;
    }

    bot.sendMessage(chatId, '⏳ Запит на доступ відправлено менеджеру');

    bot.sendMessage(
      MANAGER_ID,
      `🔐 Запит на доступ\n🏪 Магазин: ${storeCode}\n🆔 Telegram ID: ${chatId}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Підтвердити', callback_data: `access_ok_${chatId}_${storeCode}` },
            { text: '❌ Відхилити', callback_data: `access_no_${chatId}` }
          ]]
        }
      }
    );

    state[chatId] = null;
  }
});

/* ================= CALLBACKS ================= */

bot.on('callback_query', async (q) => {
  const data = q.data;
  const msg = q.message;

  if (data.startsWith('access_ok_')) {
    const [, , userId, storeCode] = data.split('_');
    const stores = readJSON(STORES_FILE, []);
    stores.push({ userId: Number(userId), storeCode });
    writeJSON(STORES_FILE, stores);

    await bot.sendMessage(userId, '✅ Доступ підтверджено');
    showStoreMenu(userId);
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
  }

  if (data.startsWith('access_no_')) {
    const userId = Number(data.split('_')[2]);
    await bot.sendMessage(userId, '❌ Доступ відхилено');
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
  }

  if (data.startsWith('status_')) {
    const [, id, status] = data.split('_');
    const requests = readJSON(REQUESTS_FILE, []);
    const req = requests.find(r => r.id === Number(id));
    if (!req) return;

    req.status = status;
    writeJSON(REQUESTS_FILE, requests);

    if (status === 'accepted') {
      await bot.sendMessage(req.userId, `🟡 Заявка #${req.id} прийнята`);
      await bot.editMessageReplyMarkup({
        inline_keyboard: [[
          { text: '🟢 Сформована', callback_data: `status_${req.id}_formed` }
        ]]
      }, msg);
    }

    if (status === 'formed') {
      await bot.sendMessage(
        req.userId,
        `🟢 Заявка #${req.id} сформована\nОчікуйте доставку`
      );
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
    }
  }

  bot.answerCallbackQuery(q.id);
});

/* ================= READY ================= */

console.log('🚀 index.js loaded');
