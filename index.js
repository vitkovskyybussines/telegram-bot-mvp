const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  console.error('❌ BOT_TOKEN або MANAGER_ID не задані');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const STORES_FILE = './stores.json';
const REQUESTS_FILE = './requests.json';

function readJSON(path, def) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
    return def;
  }
  try {
    return JSON.parse(fs.readFileSync(path));
  } catch {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
    return def;
  }
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

const state = {};

/* ===== MENUS ===== */

function managerMenu(chatId) {
  bot.sendMessage(chatId, '👨‍💼 Панель менеджера', {
    reply_markup: {
      keyboard: [
        ['📦 Всі заявки']
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

/* ===== START ===== */

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

/* ===== MESSAGE HANDLER ===== */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text === '/start') return;

  /* ---- MANAGER ---- */
  if (chatId === MANAGER_ID) {
    if (text === '📦 Всі заявки') {
      const requests = readJSON(REQUESTS_FILE, []);
      if (!requests.length) {
        bot.sendMessage(chatId, '📭 Заявок немає');
        return;
      }
      requests.forEach(sendRequestToManager);
    }
    return;
  }

  /* ---- STORE AUTH ---- */
  if (state[chatId] === 'WAIT_STORE_CODE') {
    if (!/^SHOP-\d+$/.test(text)) {
      bot.sendMessage(chatId, '❌ Невірний код. Формат: SHOP-001');
      return;
    }

    const stores = readJSON(STORES_FILE, []);
    if (stores.find(s => s.userId === chatId)) {
      storeMenu(chatId);
      state[chatId] = null;
      return;
    }

    stores.push({ userId: chatId, storeCode: text });
    writeJSON(STORES_FILE, stores);

    bot.sendMessage(chatId, '✅ Доступ підтверджено');
    storeMenu(chatId);
    state[chatId] = null;
    return;
  }

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  /* ---- STORE ACTIONS ---- */
  if (text === '➕ Створити заявку') {
    state[chatId] = 'WAIT_REQUEST_TEXT';
    bot.sendMessage(chatId, '✍️ Напишіть текст заявки');
    return;
  }

  if (text === '📄 Мої заявки') {
    const requests = readJSON(REQUESTS_FILE, []).filter(r => r.userId === chatId);
    if (!requests.length) {
      bot.sendMessage(chatId, '📭 Заявок немає');
      return;
    }
    requests.forEach(r => {
      bot.sendMessage(chatId, `📦 #${r.id}\nСтатус: ${r.status}\n${r.text}`);
    });
    return;
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

    bot.sendMessage(chatId, `✅ Заявка #${id} створена`);
    sendRequestToManager(req);

    state[chatId] = null;
  }
});

/* ===== CALLBACKS ===== */

bot.on('callback_query', (q) => {
  const data = q.data;
  const msg = q.message;

  if (!data.startsWith('req_')) return;

  const [, id, action] = data.split('_');
  const requests = readJSON(REQUESTS_FILE, []);
  const req = requests.find(r => r.id === Number(id));
  if (!req) return;

  req.status = action === 'accept' ? 'accepted' : 'rejected';
  writeJSON(REQUESTS_FILE, requests);

  bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);

  bot.sendMessage(
    req.userId,
    action === 'accept'
      ? `🟢 Заявка #${req.id} прийнята`
      : `🔴 Заявка #${req.id} відхилена`
  );

  bot.answerCallbackQuery(q.id);
});

/* ===== SEND TO MANAGER ===== */

function sendRequestToManager(r) {
  bot.sendMessage(
    MANAGER_ID,
    `📦 Заявка #${r.id}\n🏪 ${r.storeCode}\n\n${r.text}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Прийняти', callback_data: `req_${r.id}_accept` },
          { text: '❌ Відхилити', callback_data: `req_${r.id}_reject` }
        ]]
      }
    }
  );
}

console.log('🤖 Bot started (stable core)');
