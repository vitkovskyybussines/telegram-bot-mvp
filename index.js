const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

const bot = new TelegramBot(TOKEN, { polling: true });

const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';

const userStates = {};

/* ================== FILE HELPERS ================== */

function readJSON(path, def = []) {
  if (!fs.existsSync(path)) return def;
  return JSON.parse(fs.readFileSync(path));
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function getStores() {
  return readJSON(STORES_FILE);
}

function getRequests() {
  return readJSON(REQUESTS_FILE);
}

/* ================== START ================== */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (chatId === MANAGER_ID) {
    return showManagerMenu(chatId);
  }

  bot.sendMessage(chatId, '👋 Вітаю!\nВведіть код магазину (наприклад SHOP-001)');
  userStates[chatId] = 'WAIT_STORE';
});

/* ================== STORE ACCESS ================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (chatId === MANAGER_ID) return;

  if (userStates[chatId] === 'WAIT_STORE') {
    const storeCode = text.toUpperCase();
    const stores = getStores();

    const exists = stores.find(s => s.storeCode === storeCode && s.userId === chatId);
    if (exists) {
      showStoreMenu(chatId);
      userStates[chatId] = null;
      return;
    }

    const request = {
      storeCode,
      userId: chatId,
      status: 'pending'
    };

    bot.sendMessage(
      MANAGER_ID,
      `🔐 Запит на доступ\n🏪 Магазин: ${storeCode}\n🆔 Telegram ID: ${chatId}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Підтвердити', callback_data: `access_accept_${chatId}_${storeCode}` },
            { text: '❌ Відхилити', callback_data: `access_reject_${chatId}` }
          ]]
        }
      }
    );

    bot.sendMessage(chatId, '⏳ Запит відправлено менеджеру');
    userStates[chatId] = null;
  }
});

/* ================== ACCESS CALLBACKS ================== */

bot.on('callback_query', (q) => {
  const data = q.data;
  const msg = q.message;

  if (data.startsWith('access_accept_')) {
    const [, , userId, storeCode] = data.split('_');
    const stores = getStores();
    stores.push({ userId: Number(userId), storeCode });
    writeJSON(STORES_FILE, stores);

    bot.sendMessage(userId, '✅ Доступ підтверджено');
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
  }

  if (data.startsWith('access_reject_')) {
    const userId = data.split('_')[2];
    bot.sendMessage(userId, '❌ Доступ відхилено');
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
  }
});

/* ================== STORE MENU ================== */

function showStoreMenu(chatId) {
  bot.sendMessage(chatId, '📦 Меню магазину', {
    reply_markup: {
      keyboard: [
        ['📝 Створити заявку'],
        ['📋 Мої заявки']
      ],
      resize_keyboard: true
    }
  });
}

/* ================== CREATE REQUEST ================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (chatId === MANAGER_ID) return;

  if (msg.text === '📝 Створити заявку') {
    bot.sendMessage(chatId, '✏️ Введіть текст заявки');
    userStates[chatId] = 'WAIT_REQUEST_TEXT';
  }
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (userStates[chatId] !== 'WAIT_REQUEST_TEXT') return;

  const stores = getStores();
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  const requests = getRequests();
  const id = requests.length + 1;

  const req = {
    id,
    storeCode: store.storeCode,
    userId: chatId,
    text: msg.text,
    status: 'pending'
  };

  requests.push(req);
  writeJSON(REQUESTS_FILE, requests);

  sendRequestToManager(MANAGER_ID, req);
  bot.sendMessage(chatId, `📨 Заявка #${id} відправлена`);
  userStates[chatId] = null;
});

/* ================== MY REQUESTS ================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (msg.text !== '📋 Мої заявки') return;

  const requests = getRequests().filter(r => r.userId === chatId);
  if (!requests.length) {
    bot.sendMessage(chatId, '📭 Заявок немає');
    return;
  }

  requests.forEach(r => {
    bot.sendMessage(chatId, `📦 Заявка #${r.id}\nСтатус: ${r.status}`);
  });
});

/* ================== MANAGER MENU ================== */

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

/* ================== MANAGER FILTERS ================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (chatId !== MANAGER_ID) return;

  const text = msg.text;
  const requests = getRequests();

  if (text === '📦 Всі заявки') {
    requests.forEach(r => sendRequestToManager(chatId, r));
  }

  if (text === '🕓 Очікуючі') {
    requests.filter(r => r.status === 'pending')
      .forEach(r => sendRequestToManager(chatId, r));
  }

  if (text === '🟡 Прийняті') {
    requests.filter(r => r.status === 'accepted')
      .forEach(r => sendRequestToManager(chatId, r));
  }

  if (text === '🏪 Заявки магазину') {
    bot.sendMessage(chatId, '✏️ Введіть код магазину');
    userStates[chatId] = 'WAIT_STORE_FILTER';
  }
});

/* ================== STORE FILTER ================== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (chatId !== MANAGER_ID) return;
  if (userStates[chatId] !== 'WAIT_STORE_FILTER') return;

  const code = msg.text.toUpperCase();
  const requests = getRequests().filter(r => r.storeCode === code);

  if (!requests.length) {
    bot.sendMessage(chatId, '📭 Немає заявок');
  } else {
    requests.forEach(r => sendRequestToManager(chatId, r));
  }

  userStates[chatId] = null;
});

/* ================== STATUS CALLBACKS ================== */

bot.on('callback_query', (q) => {
  const data = q.data;
  const msg = q.message;

  if (!data.startsWith('status_')) return;

  const [, id, status] = data.split('_');
  const requests = getRequests();
  const req = requests.find(r => r.id === Number(id));
  if (!req) return;

  req.status = status;
  writeJSON(REQUESTS_FILE, requests);

  bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);

  if (status === 'accepted') {
    bot.sendMessage(req.userId, `✅ Заявка #${req.id} прийнята`);
  }

  if (status === 'formed') {
    bot.sendMessage(req.userId, `📦 Заявка #${req.id} сформована\nОчікуйте доставку`);
  }
});

/* ================== SEND REQUEST ================== */

function sendRequestToManager(chatId, r) {
  const buttons = [];

  if (r.status === 'pending') {
    buttons.push([{ text: '🟡 Прийнята', callback_data: `status_${r.id}_accepted` }]);
  }

  if (r.status === 'accepted') {
    buttons.push([{ text: '🟢 Сформована', callback_data: `status_${r.id}_formed` }]);
  }

  bot.sendMessage(
    chatId,
    `📦 Заявка #${r.id}\n🏪 Магазин: ${r.storeCode}\n📌 Статус: ${r.status}\n\n${r.text}`,
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}
  );
}

console.log('🤖 Bot started');
