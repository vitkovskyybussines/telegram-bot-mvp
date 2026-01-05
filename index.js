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

/* ================= HELPERS ================= */
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
        ['🕓 Очікуючі', '🟡 Прийняті']
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

  // Менеджер
  if (chatId === MANAGER_ID) {
    showManagerMenu(chatId);
    return;
  }

  // Магазин
  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);

  if (store) {
    showStoreMenu(chatId);
  } else {
    bot.sendMessage(
      chatId,
      '🔐 Введіть код магазину (наприклад SHOP-001)'
    );
    state[chatId] = 'WAIT_STORE_CODE';
  }
});

/* ================= MESSAGE HANDLER ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return;

  /* -------- MANAGER -------- */
  if (chatId === MANAGER_ID) {
    const requests = readJSON(REQUESTS_FILE, []);

    if (text === '📦 Всі заявки') {
      if (!requests.length) {
        bot.sendMessage(chatId, '📭 Заявок немає');
        return;
      }
      requests.forEach(sendRequestToManager);
    }

    if (text === '🕓 Очікуючі') {
      requests.filter(r => r.status === 'pending')
        .forEach(sendRequestToManager);
    }

    if (text === '🟡 Прийняті') {
      requests.filter(r => r.status === 'accepted')
        .forEach(sendRequestToManager);
    }

    return;
  }

  /* -------- STORE ACCESS -------- */
  if (state[chatId] === 'WAIT_STORE_CODE') {
    const storeCode = text.toUpperCase();
    const stores = readJSON(STORES_FILE, []);

    if (!stores.find(s => s.userId === chatId)) {
      stores.push({ userId: chatId, storeCode });
      writeJSON(STORES_FILE, stores);
    }

    bot.sendMessage(chatId, '✅ Доступ підтверджено');
    showStoreMenu(chatId);
    state[chatId] = null;
    return;
  }

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  /* -------- STORE MENU -------- */
  if (text === '➕ Створити заявку') {
    state[chatId] = 'WAIT_REQUEST_TEXT';
    bot.sendMessage(chatId, '✍️ Напишіть текст заявки одним повідомленням');
    return;
  }

  if (text === '📄 Мої заявки') {
    const requests = readJSON(REQUESTS_FILE, [])
      .filter(r => r.userId === chatId);

    if (!requests.length) {
      bot.sendMessage(chatId, '📭 Заявок ще немає');
      return;
    }

    requests.forEach(r => {
      bot.sendMessage(
        chatId,
        `📦 Заявка #${r.id}\nСтатус: ${r.status}\n\n${r.text}`
      );
    });
    return;
  }

  /* -------- CREATE REQUEST -------- */
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
    sendRequestToManager(req);

    state[chatId] = null;
  }
});

/* ================= CALLBACKS ================= */
bot.on('callback_query', async (q) => {
  const data = q.data;
  const msg = q.message;

  if (!data.startsWith('status_')) {
    bot.answerCallbackQuery(q.id);
    return;
  }

  const [, id, status] = data.split('_');
  const requests = readJSON(REQUESTS_FILE, []);
  const req = requests.find(r => r.id === Number(id));
  if (!req) return;

  req.status = status;
  writeJSON(REQUESTS_FILE, requests);

  if (status === 'accepted') {
    await bot.sendMessage(
      req.userId,
      `🟡 Заявка #${req.id} прийнята`
    );

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

  bot.answerCallbackQuery(q.id);
});

/* ================= SEND TO MANAGER ================= */
function sendRequestToManager(r) {
  const buttons = [];

  if (r.status === 'pending') {
    buttons.push([
      { text: '🟡 Прийнята', callback_data: `status_${r.id}_accepted` }
    ]);
  }

  if (r.status === 'accepted') {
    buttons.push([
      { text: '🟢 Сформована', callback_data: `status_${r.id}_formed` }
    ]);
  }

  bot.sendMessage(
    MANAGER_ID,
    `📦 Нова заявка #${r.id}
🏪 Магазин: ${r.storeCode}
📌 Статус: ${r.status}

${r.text}`,
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}
  );
}
