const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

const bot = new TelegramBot(TOKEN, { polling: true });

const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';

const SHOP_CODE_REGEX = /^SHOP-\d+$/;

/* =========================
   Utils
========================= */

function readJson(path) {
  try {
    if (!fs.existsSync(path)) return [];
    const data = fs.readFileSync(path, 'utf8');
    return JSON.parse(data || '[]');
  } catch (e) {
    return [];
  }
}

function writeJson(path, data) {
  try {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function getStore(userId) {
  const stores = readJson(STORES_FILE);
  return stores.find(s => s.userId === userId);
}

function saveStore(userId, storeCode) {
  const stores = readJson(STORES_FILE);
  stores.push({ userId, storeCode });
  writeJson(STORES_FILE, stores);
}

function nextRequestId(requests) {
  return requests.length ? Math.max(...requests.map(r => r.id)) + 1 : 1;
}

/* =========================
   Keyboards
========================= */

const storeKeyboard = {
  reply_markup: {
    keyboard: [
      ['➕ Створити заявку'],
      ['📄 Мої заявки']
    ],
    resize_keyboard: true
  }
};

const managerKeyboard = {
  reply_markup: {
    keyboard: [['📦 Всі заявки']],
    resize_keyboard: true
  }
};

/* =========================
   /start
========================= */

bot.onText(/\/start/, msg => {
  const userId = msg.from.id;

  if (userId === MANAGER_ID) {
    bot.sendMessage(userId, 'Панель менеджера', managerKeyboard);
    return;
  }

  const store = getStore(userId);
  if (store) {
    bot.sendMessage(userId, `Ви авторизовані як ${store.storeCode}`, storeKeyboard);
  } else {
    bot.sendMessage(userId, 'Введіть код магазину (наприклад: SHOP-001)');
  }
});

/* =========================
   Messages
========================= */

let awaitingRequestText = {};

bot.on('message', msg => {
  try {
    const userId = msg.from.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    if (userId === MANAGER_ID) {
      if (text === '📦 Всі заявки') showAllRequests(userId);
      return;
    }

    const store = getStore(userId);

    /* ---- Авторизація ---- */
    if (!store) {
      if (SHOP_CODE_REGEX.test(text)) {
        saveStore(userId, text);
        bot.sendMessage(userId, `Магазин ${text} авторизовано`, storeKeyboard);
      }
      return;
    }

    /* ---- Очікування тексту заявки ---- */
    if (awaitingRequestText[userId]) {
      createRequest(userId, store.storeCode, text);
      delete awaitingRequestText[userId];
      return;
    }

    /* ---- Меню магазину ---- */
    if (text === '➕ Створити заявку') {
      awaitingRequestText[userId] = true;
      bot.sendMessage(userId, 'Введіть текст заявки');
    }

    if (text === '📄 Мої заявки') {
      showMyRequests(userId);
    }
  } catch (e) {}
});

/* =========================
   Requests
========================= */

function createRequest(userId, storeCode, text) {
  const requests = readJson(REQUESTS_FILE);
  const id = nextRequestId(requests);

  const request = {
    id,
    userId,
    storeCode,
    text,
    status: 'pending'
  };

  requests.push(request);
  writeJson(REQUESTS_FILE, requests);

  bot.sendMessage(userId, `Заявка №${id} створена`);

  sendRequestToManager(request);
}

function sendRequestToManager(req) {
  bot.sendMessage(
    MANAGER_ID,
    `🆕 Заявка №${req.id}\nМагазин: ${req.storeCode}\n\n${req.text}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Прийняти', callback_data: `accept_${req.id}` },
          { text: '❌ Відхилити', callback_data: `reject_${req.id}` }
        ]]
      }
    }
  );
}

function showMyRequests(userId) {
  const requests = readJson(REQUESTS_FILE).filter(r => r.userId === userId);
  if (!requests.length) {
    bot.sendMessage(userId, 'Заявок немає');
    return;
  }

  requests.forEach(r => {
    bot.sendMessage(
      userId,
      `№${r.id}\nСтатус: ${r.status}\n${r.text}`
    );
  });
}

function showAllRequests(userId) {
  const requests = readJson(REQUESTS_FILE);
  if (!requests.length) {
    bot.sendMessage(userId, 'Заявок немає');
    return;
  }

  requests.forEach(r => {
    bot.sendMessage(
      userId,
      `№${r.id}\nМагазин: ${r.storeCode}\nСтатус: ${r.status}\n${r.text}`
    );
  });
}

/* =========================
   Callbacks
========================= */

bot.on('callback_query', query => {
  try {
    const data = query.data;
    const msg = query.message;

    if (!data || msg.chat.id !== MANAGER_ID) return;

    const [action, idStr] = data.split('_');
    const id = Number(idStr);

    const requests = readJson(REQUESTS_FILE);
    const req = requests.find(r => r.id === id);

    if (!req || req.status !== 'pending') {
      bot.editMessageReplyMarkup({}, {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      });
      return;
    }

    req.status = action === 'accept' ? 'accepted' : 'rejected';
    writeJson(REQUESTS_FILE, requests);

    bot.sendMessage(
      req.userId,
      `Заявка №${req.id} ${req.status === 'accepted' ? 'прийнята' : 'відхилена'}`
    );

    bot.editMessageReplyMarkup({}, {
      chat_id: msg.chat.id,
      message_id: msg.message_id
    });

    bot.answerCallbackQuery(query.id);
  } catch (e) {}
});
