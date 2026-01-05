const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  console.error('❌ BOT_TOKEN або MANAGER_ID не задані');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= FILES ================= */
const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';
const REMINDERS_FILE = './reminders.json';

function readJSON(path, def) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
    return def;
  }

  try {
    const data = JSON.parse(fs.readFileSync(path));
    return data;
  } catch (e) {
    console.error('❌ JSON error in', path);
    return def;
  }
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
        [
          {
            text: '🛒 Каталог',
            web_app: {
              url: 'https://vitkovskyybussines.github.io/telegram-miniapp-catalog/'
            }
          }
        ],
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
  const store = Array.isArray(stores)
    ? stores.find(s => s.userId === chatId)
    : null;

  if (store) {
    showStoreMenu(chatId);
  } else {
    bot.sendMessage(chatId, '🔐 Введіть код магазину (наприклад SHOP-001)');
    state[chatId] = 'WAIT_STORE_CODE';
  }
});

/* ================= STORE ACCESS ================= */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || chatId === MANAGER_ID) return;

  if (state[chatId] === 'WAIT_STORE_CODE') {
    if (!/^SHOP-\d+$/i.test(text)) {
      bot.sendMessage(chatId, '❌ Невірний формат коду. Приклад: SHOP-001');
      return;
    }

    const storeCode = text.toUpperCase();
    const stores = readJSON(STORES_FILE, []);

    if (Array.isArray(stores) && stores.find(s => s.userId === chatId)) {
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

/* ================= MINI APP DATA ================= */

bot.on('message', (msg) => {
  if (!msg.web_app_data) return;

  const chatId = msg.chat.id;
  const data = JSON.parse(msg.web_app_data.data);

  const stores = readJSON(STORES_FILE, []);
  if (!Array.isArray(stores)) return;

  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  const requests = readJSON(REQUESTS_FILE, []);
  const id = Array.isArray(requests) ? requests.length + 1 : 1;

  const text =
`Заявка з каталогу:
${data.title} — ${data.weight} кг
Коментар: ${data.comment || '-'}`;

  const req = {
    id,
    userId: chatId,
    storeCode: store.storeCode,
    text,
    status: 'pending',
    createdAt: new Date().toISOString().slice(0, 10)
  };

  requests.push(req);
  writeJSON(REQUESTS_FILE, requests);

  bot.sendMessage(chatId, `✅ Заявка #${id} відправлена`);
  sendRequestToManager(req);
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

  bot.answerCallbackQuery(q.id);
});

/* ================= SEND TO MANAGER ================= */

function sendRequestToManager(r) {
  bot.sendMessage(
    MANAGER_ID,
    `📦 Заявка #${r.id}
🏪 Магазин: ${r.storeCode}
📌 Статус: ${r.status}

${r.text}`
  );
}

/* ================= MANAGER: ALL REQUESTS ================= */
/* === ЦЕ ЄДИНЕ, ЩО БУЛО ДОДАНО === */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (chatId !== MANAGER_ID) return;

  if (text === '📦 Всі заявки') {
    const requests = readJSON(REQUESTS_FILE, []);

    if (!Array.isArray(requests) || requests.length === 0) {
      bot.sendMessage(chatId, '📭 Заявок ще немає');
      return;
    }

    requests.forEach(r => {
      bot.sendMessage(
        chatId,
        `📦 Заявка #${r.id}
🏪 Магазин: ${r.storeCode}
📌 Статус: ${r.status}

${r.text}`
      );
    });
  }
});

console.log('🤖 Bot started');
