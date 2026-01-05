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

/* ================= HELPERS ================= */
function readJSON(path, def) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
    return def;
  }
  try {
    const data = JSON.parse(fs.readFileSync(path));
    return data;
  } catch {
    fs.writeFileSync(path, JSON.stringify(def, null, 2));
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
        [{
          text: '🛒 Каталог',
          web_app: {
            url: 'https://vitkovskyybussines.github.io/telegram-miniapp-catalog/'
          }
        }],
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

  state[chatId] = null;

  if (chatId === MANAGER_ID) {
    showManagerMenu(chatId);
    return;
  }

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);

  if (store) {
    showStoreMenu(chatId);
  } else {
    bot.sendMessage(chatId, '🔐 Введіть код магазину (формат: SHOP-001)');
    state[chatId] = 'WAIT_STORE_CODE';
  }
});

/* ================= MESSAGE HANDLER ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!text || text.startsWith('/')) return;

  /* ---- MANAGER ---- */
  if (chatId === MANAGER_ID) {
    const requests = readJSON(REQUESTS_FILE, []);

    if (text === '📦 Всі заявки') {
      if (!requests.length) return bot.sendMessage(chatId, '📭 Заявок немає');
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

  /* ---- STORE AUTH ---- */
  if (state[chatId] === 'WAIT_STORE_CODE') {
    const code = text.toUpperCase();

    if (!/^SHOP-\d{3}$/.test(code)) {
      bot.sendMessage(chatId, '❌ Невірний код. Формат: SHOP-001');
      return;
    }

    const stores = readJSON(STORES_FILE, []);

    if (stores.find(s => s.userId === chatId)) {
      showStoreMenu(chatId);
      state[chatId] = null;
      return;
    }

    bot.sendMessage(chatId, '⏳ Запит на доступ відправлено менеджеру');

    bot.sendMessage(
      MANAGER_ID,
      `🔐 Запит на доступ\n🏪 Магазин: ${code}\n🆔 Telegram ID: ${chatId}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Підтвердити', callback_data: `access_ok_${chatId}_${code}` },
            { text: '❌ Відхилити', callback_data: `access_no_${chatId}` }
          ]]
        }
      }
    );

    state[chatId] = null;
    return;
  }

  /* ---- STORE ACTIONS ---- */
  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  if (text === '➕ Створити заявку') {
    state[chatId] = 'WAIT_REQUEST_TEXT';
    bot.sendMessage(chatId, '✍️ Напишіть заявку одним повідомленням');
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
      bot.sendMessage(chatId,
        `📦 Заявка #${r.id}\nСтатус: ${r.status}\n\n${r.text}`
      );
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
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    requests.push(req);
    writeJSON(REQUESTS_FILE, requests);

    bot.sendMessage(chatId, `✅ Заявка #${id} відправлена`);
    sendRequestToManager(req);

    state[chatId] = null;
  }
});

/* ================= MINI APP ================= */
bot.on('message', (msg) => {
  if (!msg.web_app_data) return;

  const chatId = msg.chat.id;
  const data = JSON.parse(msg.web_app_data.data);

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

  const requests = readJSON(REQUESTS_FILE, []);
  const id = requests.length + 1;

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
    createdAt: new Date().toISOString()
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
      await bot.sendMessage(req.userId, `🟢 Заявка #${req.id} сформована`);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, msg);
    }
  }

  bot.answerCallbackQuery(q.id);
});

/* ================= MANAGER SEND ================= */
function sendRequestToManager(r) {
  const buttons = [];

  if (r.status === 'pending') {
    buttons.push([{ text: '🟡 Прийняти', callback_data: `status_${r.id}_accepted` }]);
  }
  if (r.status === 'accepted') {
    buttons.push([{ text: '🟢 Сформована', callback_data: `status_${r.id}_formed` }]);
  }

  bot.sendMessage(
    MANAGER_ID,
    `📦 Заявка #${r.id}
🏪 Магазин: ${r.storeCode}
📌 Статус: ${r.status}

${r.text}`,
    buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}
  );
}

console.log('🤖 Bot fully loaded and stable');
