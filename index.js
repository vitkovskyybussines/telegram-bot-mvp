const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  console.error('❌ BOT_TOKEN або MANAGER_ID не задані');
  process.exit(1);
}

/* ================= BOT ================= */
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot started');

/* ================= FILES ================= */
const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';

/* ================= SAFE JSON ================= */
function readJSON(path, def) {
  try {
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, JSON.stringify(def, null, 2));
      return def;
    }

    const data = JSON.parse(fs.readFileSync(path));

    if (Array.isArray(def) && !Array.isArray(data)) {
      return def;
    }

    return data;
  } catch (e) {
    console.error('JSON error:', path);
    return def;
  }
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

/* ================= STATE ================= */
const state = {};

/* ================= MENUS ================= */
function managerMenu(chatId) {
  bot.sendMessage(chatId, '👨‍💼 Панель менеджера', {
    reply_markup: {
      keyboard: [
        ['📦 Всі заявки'],
        ['🕓 Очікуючі', '🟡 Прийняті']
      ],
      resize_keyboard: true
    }
  });
}

function storeMenu(chatId) {
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
    managerMenu(chatId);
    return;
  }

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);

  if (store) {
    storeMenu(chatId);
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
      storeMenu(chatId);
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

  /* ---- ACCESS ---- */
  if (data.startsWith('access_ok_')) {
    const [, , userId, storeCode] = data.split('_');
    const stores = readJSON(STORES_FILE, []);
    stores.push({ userId: Number(userId), storeCode });
    writeJSON(STORES_FILE, stores);

    await bot.sendMessage(userId, '✅ Доступ підтверджено');
    storeMenu(userId);
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
  }

  if (data.startsWith('access_no_')) {
    const userId = Number(data.split('_')[2]);
    await bot.sendMessage(userId, '❌ Доступ відхилено');
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
  }

  /* ---- STATUS ---- */
  if (data.startsWith('status_')) {
    const [, id, status] = data.split('_');
    const requests = readJSON(REQUESTS_FILE, []);
    const req = requests.find(r => r.id === Number(id));
    if (!req) return;

    req.status = status;
    writeJSON(REQUESTS_FILE, requests);

    if (status === 'accepted') {
      await bot.sendMessage(req.userId, `🟡 Заявка #${req.id} прийнята`);
      await bot.editMessageReplyMarkup(
        {
          inline_keyboard: [[
            { text: '🟢 Сформована', callback_data: `status_${req.id}_formed` }
          ]]
        },
        msg
      );
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

/* ================= STORE ACTIONS ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || chatId === MANAGER_ID) return;

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  if (text === '➕ Створити заявку') {
    state[chatId] = 'WAIT_REQUEST_TEXT';
    bot.sendMessage(chatId, '✍️ Напишіть текст заявки');
    return;
  }

  if (text === '📄 Мої заявки') {
    const requests = readJSON(REQUESTS_FILE, [])
      .filter(r => r.userId === chatId);

    if (!requests.length) {
      bot.sendMessage(chatId, '📭 Заявок немає');
      return;
    }

    requests.forEach(r => {
      bot.sendMessage(
        chatId,
        `📦 Заявка #${r.id}\nСтатус: ${r.status}\n\n${r.text}`
      );
    });
  }

  if (state[chatId] === 'WAIT_REQUEST_TEXT') {
    const requests = readJSON(REQUESTS_FILE, []);
    const id = requests.length + 1;

    const req = {
      id,
      userId: chatId,
      storeCode: store.storeCode,
      text,
      status: 'pending'
    };

    requests.push(req);
    writeJSON(REQUESTS_FILE, requests);

    bot.sendMessage(chatId, `✅ Заявка #${id} відправлена`);
    sendToManager(req);

    state[chatId] = null;
  }
});

/* ================= MANAGER FILTERS ================= */
bot.on('message', (msg) => {
  if (msg.chat.id !== MANAGER_ID) return;

  const text = msg.text;
  const requests = readJSON(REQUESTS_FILE, []);

  if (text === '📦 Всі заявки') {
    requests.forEach(sendToManager);
  }

  if (text === '🕓 Очікуючі') {
    requests.filter(r => r.status === 'pending').forEach(sendToManager);
  }

  if (text === '🟡 Прийняті') {
    requests.filter(r => r.status === 'accepted').forEach(sendToManager);
  }
});

/* ================= SEND ================= */
function sendToManager(r) {
  const buttons = [];

  if (r.status === 'pending') {
    buttons.push([{ text: '🟡 Прийнята', callback_data: `status_${r.id}_accepted` }]);
  }

  if (r.status === 'accepted') {
    buttons.push([{ text: '🟢 Сформована', callback_data: `status_${r.id}_formed` }]);
  }

  bot.sendMessage(
    MANAGER_ID,
    `📦 Заявка #${r.id}\n🏪 Магазин: ${r.storeCode}\n📌 Статус: ${r.status}\n\n${r.text}`,
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}
  );
}

console.log('✅ Bot fully loaded');
