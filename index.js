const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);
const MANAGER_USERNAME = 'OlegVitkovskyy';

const bot = new TelegramBot(TOKEN, { polling: true });

const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';

const SHOP_CODE_REGEX = /^SHOP-\d+$/;

let awaitingRequestText = {};
let awaitingAuth = {};

/* =========================
   Utils
========================= */

function readJson(path) {
  try {
    if (!fs.existsSync(path)) return [];
    return JSON.parse(fs.readFileSync(path, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeJson(path, data) {
  try {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  } catch {}
}

function getStore(userId) {
  return readJson(STORES_FILE).find(s => s.userId === userId);
}

function nextRequestId(requests) {
  return requests.length ? Math.max(...requests.map(r => r.id)) + 1 : 1;
}

function statusText(status) {
  if (status === 'pending') return 'Очікує підтвердження';
  if (status === 'received') return 'Прийнято в роботу';
  if (status === 'processed') return 'Виконано';
  return status;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* =========================
   Keyboards
========================= */

const startKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔐 Авторизуватись'],
      ['📞 Звʼязок з менеджером']
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

const storeKeyboard = {
  reply_markup: {
    keyboard: [
      ['🛒 Зробити замовлення'],
      ['➕ Створити заявку'],
      ['📄 Мої заявки']
    ],
    resize_keyboard: true
  }
};

const managerKeyboard = {
  reply_markup: {
    keyboard: [
      ['📦 Всі заявки (сьогодні)'],
      ['🟡 Очікують', '🔵 В роботі'],
      ['🟢 Виконані (сьогодні)']
    ],
    resize_keyboard: true
  }
};

const contactManagerKeyboard = {
  reply_markup: {
    keyboard: [['📞 Звʼязатися з менеджером']],
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

  if (!store) {
    bot.sendMessage(userId, '👋 Вітаємо! Оберіть дію:', startKeyboard);
    return;
  }

  if (store.approved) {
    bot.sendMessage(userId, `Ви авторизовані як ${store.storeCode}`, storeKeyboard);
  } else {
    bot.sendMessage(userId, 'Доступ заборонено. Зверніться до менеджера.', contactManagerKeyboard);
  }
});

/* =========================
   Messages
========================= */

bot.on('message', msg => {
  try {
    const userId = msg.from.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    /* === MINI APP ENTRY === */
    if (text === '🛒 Зробити замовлення') {
      bot.sendMessage(userId, 'Відкрийте каталог:', {
        reply_markup: {
          keyboard: [[
            {
              text: '🛒 Відкрити каталог',
              web_app: {https://telegram-miniapp-catalog.onrender.com'
              }
            }
          ], ['⬅️ Назад']],
          resize_keyboard: true
        }
      });
      return;
    }

    if (text === '⬅️ Назад') {
      bot.sendMessage(userId, 'Меню', storeKeyboard);
      return;
    }

    if (text === '🔐 Авторизуватись') {
      bot.sendMessage(userId, 'Введіть код магазину (SHOP-001)');
      return;
    }

    if (text === '📞 Звʼязок з менеджером') {
      bot.sendMessage(userId, 'Звʼяжіться з менеджером:', {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Написати менеджеру', url: `https://t.me/${MANAGER_USERNAME}` }
          ]]
        }
      });
      return;
    }

    if (userId === MANAGER_ID) {
      if (text === '📦 Всі заявки (сьогодні)') showManagerRequests(r => r.createdAt === today());
      if (text === '🟡 Очікують') showManagerRequests(r => r.status === 'pending');
      if (text === '🔵 В роботі') showManagerRequests(r => r.status === 'received');
      if (text === '🟢 Виконані (сьогодні)') showManagerRequests(r => r.status === 'processed' && r.createdAt === today());
      return;
    }

    const store = getStore(userId);

    if (!store) {
      if (SHOP_CODE_REGEX.test(text)) {
        awaitingAuth[userId] = text;

        bot.sendMessage(
          MANAGER_ID,
          `🔐 Запит авторизації\nМагазин: ${text}\nUser ID: ${userId}`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Прийняти', callback_data: `auth_accept_${userId}` },
                { text: '❌ Відхилити', callback_data: `auth_reject_${userId}` }
              ]]
            }
          }
        );

        bot.sendMessage(userId, 'Запит на авторизацію надіслано менеджеру');
      }
      return;
    }

    if (!store.approved) {
      bot.sendMessage(userId, 'Доступ заборонено. Зверніться до менеджера.', contactManagerKeyboard);
      return;
    }

    if (awaitingRequestText[userId]) {
      createRequest(userId, store.storeCode, text);
      delete awaitingRequestText[userId];
      return;
    }

    if (text === '➕ Створити заявку') {
      awaitingRequestText[userId] = true;
      bot.sendMessage(userId, 'Введіть текст заявки');
    }

    if (text === '📄 Мої заявки') {
      showMyRequests(userId);
    }
  } catch {}
});

/* =========================
   MINI APP DATA
========================= */

bot.on('web_app_data', msg => {
  try {
    const userId = msg.from.id;
    const store = getStore(userId);
    if (!store || !store.approved) return;

    const data = JSON.parse(msg.web_app_data.data);

    let text = 'Замовлення з каталогу:\n\n';
    data.items.forEach(i => {
      text += `• ${i.name} (${i.weight}) × ${i.qty}\n`;
    });

    createRequest(userId, store.storeCode, text);
  } catch {}
});

/* =========================
   Requests
========================= */

function createRequest(userId, storeCode, text) {
  const requests = readJson(REQUESTS_FILE);
  const id = nextRequestId(requests);

  const req = {
    id,
    userId,
    storeCode,
    text,
    status: 'pending',
    createdAt: today()
  };

  requests.push(req);
  writeJson(REQUESTS_FILE, requests);

  bot.sendMessage(userId, `Заявка №${id} створена\nСтатус: Очікує підтвердження`);
  sendRequestToManager(req);
}

function sendRequestToManager(req) {
  bot.sendMessage(
    MANAGER_ID,
    `🆕 Заявка №${req.id}\n${req.storeCode}\n\n${req.text}\nСтатус: Очікує підтвердження`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '📥 Отримана', callback_data: `status_received_${req.id}` }
        ]]
      }
    }
  );
}

/* =========================
   Views
========================= */

function showMyRequests(userId) {
  const requests = readJson(REQUESTS_FILE).filter(r => r.userId === userId);
  if (!requests.length) return bot.sendMessage(userId, 'Заявок немає');

  requests.forEach(r =>
    bot.sendMessage(userId, `№${r.id}\nСтатус: ${statusText(r.status)}\n${r.text}`)
  );
}

function showManagerRequests(filterFn) {
  const requests = readJson(REQUESTS_FILE).filter(filterFn);
  if (!requests.length) return bot.sendMessage(MANAGER_ID, 'Заявок немає');

  requests.forEach(r =>
    bot.sendMessage(
      MANAGER_ID,
      `№${r.id}\n${r.storeCode}\nСтатус: ${statusText(r.status)}\n${r.text}`
    )
  );
}

/* =========================
   Callbacks
========================= */

bot.on('callback_query', q => {
  try {
    const data = q.data;
    const msg = q.message;

    if (data.startsWith('auth_')) {
      const [, action, userIdStr] = data.split('_');
      const userId = Number(userIdStr);
      const storeCode = awaitingAuth[userId];
      delete awaitingAuth[userId];

      const stores = readJson(STORES_FILE);

      if (action === 'accept') {
        stores.push({ userId, storeCode, approved: true });
        writeJson(STORES_FILE, stores);
        bot.sendMessage(userId, '✅ Авторизацію підтверджено', storeKeyboard);
      } else {
        stores.push({ userId, storeCode, approved: false });
        writeJson(STORES_FILE, stores);
        bot.sendMessage(userId, '❌ Доступ заборонено. Зверніться до менеджера.', contactManagerKeyboard);
      }

      bot.editMessageReplyMarkup({}, { chat_id: msg.chat.id, message_id: msg.message_id });
      bot.answerCallbackQuery(q.id);
      return;
    }

    if (data.startsWith('status_')) {
      const [, newStatus, idStr] = data.split('_');
      const id = Number(idStr);

      const requests = readJson(REQUESTS_FILE);
      const req = requests.find(r => r.id === id);
      if (!req) return;

      if (newStatus === 'received' && req.status === 'pending') {
        req.status = 'received';
        writeJson(REQUESTS_FILE, requests);

        bot.sendMessage(req.userId, `📦 Заявка №${id}\nСтатус: Прийнято в роботу`);

        bot.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '⚙️ Оброблена', callback_data: `status_processed_${id}` }]] },
          { chat_id: msg.chat.id, message_id: msg.message_id }
        );

        bot.answerCallbackQuery(q.id);
        return;
      }

      if (newStatus === 'processed' && req.status === 'received') {
        req.status = 'processed';
        writeJson(REQUESTS_FILE, requests);

        bot.sendMessage(req.userId, `✅ Заявка №${id}\nСтатус: Виконано`);

        bot.editMessageReplyMarkup({}, { chat_id: msg.chat.id, message_id: msg.message_id });
        bot.answerCallbackQuery(q.id);
        return;
      }

      bot.editMessageReplyMarkup({}, { chat_id: msg.chat.id, message_id: msg.message_id });
      bot.answerCallbackQuery(q.id);
    }
  } catch {}
});
