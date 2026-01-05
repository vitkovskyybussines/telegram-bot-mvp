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
    bot.sendMessage(chatId, '🔐 Введіть код магазину (наприклад SHOP-001)');
    state[chatId] = 'WAIT_STORE_CODE';
  }
});

/* ================= STORE ACCESS ================= */

bot.on('message', (msg) => {
  handleReminders(); // 👈 ТУТ ПЕРЕВІРКА НАГАДУВАНЬ

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
  handleReminders(); // 👈 І ТУТ

  const data = q.data;
  const msg = q.message;

  /* ---- ACCESS ---- */
  if (data.startsWith('access_ok_')) {
    const [, , userId, storeCode] = data.split('_');
    const stores = readJSON(STORES_FILE, []);
    stores.push({ userId: Number(userId), storeCode });
    writeJSON(STORES_FILE, stores);

    await bot.sendMessage(userId, '✅ Доступ підтверджено');
    await showStoreMenu(userId);
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
  handleReminders(); // 👈 І ТУТ

  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (chatId === MANAGER_ID || !text) return;

  const stores = readJSON(STORES_FILE, []);
  const store = stores.find(s => s.userId === chatId);
  if (!store) return;

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
      createdAt: new Date().toISOString().slice(0, 10)
    };

    requests.push(req);
    writeJSON(REQUESTS_FILE, requests);

    bot.sendMessage(chatId, `✅ Заявка #${id} відправлена`);
    sendRequestToManager(req);

    state[chatId] = null;
  }
});

/* ================= MANAGER FILTERS ================= */

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (chatId !== MANAGER_ID) return;

  const requests = readJSON(REQUESTS_FILE, []);

  if (text === '📦 Всі заявки') {
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

  if (text === '🏪 Заявки магазину') {
    bot.sendMessage(chatId, '✏️ Введіть код магазину (SHOP-001)');
    state[chatId] = 'WAIT_STORE_FILTER';
  }

  if (state[chatId] === 'WAIT_STORE_FILTER' && text.startsWith('SHOP-')) {
    requests.filter(r => r.storeCode === text)
      .forEach(sendRequestToManager);
    state[chatId] = null;
  }
});

/* ================= SEND TO MANAGER ================= */

function sendRequestToManager(r) {
  const buttons = [];

  if (r.status === 'pending') {
    buttons.push([{ text: '🟡 Прийнята', callback_data: `status_${r.id}_accepted` }]);
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

/* ================= REMINDERS ================= */

function handleReminders() {
  const now = new Date();
  const day = now.getDay(); // 6 = субота
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (day === 6) return; // субота
  if (hour < 15) return;

  const today = now.toISOString().slice(0, 10);

  const reminders = readJSON(REMINDERS_FILE, {});
  if (reminders[today]) return;

  const stores = readJSON(STORES_FILE, []);
  const requests = readJSON(REQUESTS_FILE, []);

  stores.forEach(store => {
    const hasTodayRequest = requests.some(
      r => r.userId === store.userId && r.createdAt === today
    );

    if (!hasTodayRequest) {
      bot.sendMessage(
        store.userId,
        '⏰ Нагадування:\nВи ще не зробили заявку на сьогодні'
      );
    }
  });

  reminders[today] = true;
  writeJSON(REMINDERS_FILE, reminders);
}

console.log('🤖 Bot started with reminders');
