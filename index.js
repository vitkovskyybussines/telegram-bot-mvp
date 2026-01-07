const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

const bot = new TelegramBot(TOKEN, { polling: true });

const STORES_FILE = path.join(__dirname, 'stores.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json');

/* ================== HELPERS ================== */

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file));
  } catch (e) {
    return [];
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function isManager(id) {
  return id === MANAGER_ID;
}

function getNow() {
  const d = new Date();
  return d.toLocaleString('uk-UA');
}

/* ================== /START ================== */

bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;

  if (isManager(chatId)) {
    return showManagerMenu(chatId);
  }

  const stores = readJSON(STORES_FILE);
  const store = stores.find(s => s.userId === chatId);

  if (!store) {
    return bot.sendMessage(chatId, 'Введіть код магазину для авторизації');
  }

  showStoreMenu(chatId);
});

/* ================== AUTH STORE ================== */

bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;
  if (isManager(chatId)) return;

  const stores = readJSON(STORES_FILE);
  const already = stores.find(s => s.userId === chatId);
  if (already) return;

  if (!/^SHOP-\d+$/.test(text)) return;

  stores.push({
    userId: chatId,
    storeCode: text
  });

  writeJSON(STORES_FILE, stores);
  showStoreMenu(chatId);
});

/* ================== MENUS ================== */

function showStoreMenu(chatId) {
  bot.sendMessage(chatId, 'Меню магазину', {
    reply_markup: {
      keyboard: [
        ['➕ Створити заявку'],
        ['📄 Мої заявки']
      ],
      resize_keyboard: true
    }
  });
}

function showManagerMenu(chatId) {
  const today = new Date().toDateString();
  const requests = readJSON(REQUESTS_FILE).filter(r =>
    new Date(r.createdAt).toDateString() === today
  );

  const received = requests.filter(r => r.status === 'received').length;
  const done = requests.filter(r => r.status === 'done').length;

  bot.sendMessage(chatId,
    `📊 Заявки сьогодні\n📥 Отримані: ${received}\n✔ Виконані: ${done}`, {
      reply_markup: {
        keyboard: [['📦 Всі заявки']],
        resize_keyboard: true
      }
    }
  );
}

/* ================== STORE ACTIONS ================== */

let waitingText = {};

bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '➕ Створити заявку') {
    waitingText[chatId] = true;
    return bot.sendMessage(chatId, 'Введіть текст заявки');
  }

  if (waitingText[chatId]) {
    waitingText[chatId] = false;

    const stores = readJSON(STORES_FILE);
    const store = stores.find(s => s.userId === chatId);
    if (!store) return;

    const requests = readJSON(REQUESTS_FILE);
    const id = requests.length + 1;

    const request = {
      id,
      userId: chatId,
      storeCode: store.storeCode,
      text,
      status: 'received',
      createdAt: new Date().toISOString()
    };

    requests.push(request);
    writeJSON(REQUESTS_FILE, requests);

    sendRequestToManager(request);
    bot.sendMessage(chatId, '📦 Заявка створена');

    return;
  }

  if (text === '📄 Мої заявки') {
    const requests = readJSON(REQUESTS_FILE).filter(r => r.userId === chatId);

    if (!requests.length) {
      return bot.sendMessage(chatId, 'Заявок поки немає');
    }

    requests.forEach(r => {
      bot.sendMessage(chatId,
        `🧾 №${r.id}\nСтатус: ${r.status === 'done' ? '✔ Виконана' : '📥 Отримана'}\n${r.text}`
      );
    });
  }
});

/* ================== MANAGER REQUEST VIEW ================== */

function sendRequestToManager(r) {
  bot.sendMessage(MANAGER_ID,
`🧾 Заявка №${r.id} | ${r.storeCode}
📅 ${new Date(r.createdAt).toLocaleString('uk-UA')}

📦 Замовлення:
${r.text}

`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '📥 Отримана', callback_data: `recv_${r.id}` },
        { text: '✔ Виконана', callback_data: `done_${r.id}` }
      ]]
    }
  });
}

/* ================== CALLBACKS ================== */

bot.on('callback_query', q => {
  try {
    const data = q.data;
    const msg = q.message;

    const requests = readJSON(REQUESTS_FILE);
    const req = requests.find(r => r.id === Number(data.split('_')[1]));
    if (!req) return;

    if (data.startsWith('recv_')) {
      bot.sendMessage(req.userId,
        `📦 Заявка №${req.id} прийнята\n\nМи отримали ваше замовлення.`
      );
    }

    if (data.startsWith('done_')) {
      req.status = 'done';
      writeJSON(REQUESTS_FILE, requests);

      bot.sendMessage(req.userId,
        `✅ Заявка №${req.id} виконана\n\nОчікуйте доставку згідно домовленостей.`
      );
    }

    bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: msg.chat.id,
      message_id: msg.message_id
    });

  } catch (e) {}
});
