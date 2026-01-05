const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  console.error('❌ BOT_TOKEN або MANAGER_ID не задані');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= FILES ================= */
const DATA_DIR = path.join(__dirname, 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(STORES_FILE)) fs.writeFileSync(STORES_FILE, '{}');
if (!fs.existsSync(REQUESTS_FILE)) fs.writeFileSync(REQUESTS_FILE, '[]');

const readStores = () => JSON.parse(fs.readFileSync(STORES_FILE));
const saveStores = (d) => fs.writeFileSync(STORES_FILE, JSON.stringify(d, null, 2));
const readRequests = () => JSON.parse(fs.readFileSync(REQUESTS_FILE));
const saveRequests = (d) => fs.writeFileSync(REQUESTS_FILE, JSON.stringify(d, null, 2));

/* ================= KEYBOARDS ================= */
const storeKeyboard = {
  reply_markup: {
    keyboard: [['➕ Створити заявку'], ['📄 Мої заявки']],
    resize_keyboard: true
  }
};

const managerKeyboard = {
  reply_markup: {
    keyboard: [['📦 Всі заявки']],
    resize_keyboard: true
  }
};

/* ================= STATE ================= */
const waitingForOrder = new Set();

/* ================= /start ================= */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const stores = readStores();

  if (chatId === MANAGER_ID) {
    bot.sendMessage(chatId, '👨‍💼 Панель менеджера', managerKeyboard);
    return;
  }

  if (stores[chatId]?.status === 'approved') {
    bot.sendMessage(chatId, '🏪 Панель магазину', storeKeyboard);
    return;
  }

  bot.sendMessage(chatId, '🔐 Введіть код магазину (наприклад SHOP-001)');
});

/* ================= STORE ACCESS ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const stores = readStores();

  if (text.startsWith('SHOP-') && chatId !== MANAGER_ID) {
    if (stores[chatId]) {
      bot.sendMessage(chatId, 'ℹ️ Запит вже надіслано');
      return;
    }

    stores[chatId] = { code: text, status: 'pending' };
    saveStores(stores);

    bot.sendMessage(chatId, '⏳ Запит на доступ відправлено менеджеру');

    bot.sendMessage(
      MANAGER_ID,
      `🔐 Запит на доступ\nМагазин: ${text}\nTelegram ID: ${chatId}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Підтвердити', callback_data: `approve_${chatId}` },
            { text: '❌ Відхилити', callback_data: `reject_${chatId}` }
          ]]
        }
      }
    );
  }
});

/* ================= CALLBACKS ================= */
bot.on('callback_query', async (q) => {
  const data = q.data;
  const msg = q.message;

  const stores = readStores();
  const requests = readRequests();

  /* ---- APPROVE STORE ---- */
  if (data.startsWith('approve_')) {
    const id = data.replace('approve_', '');
    stores[id].status = 'approved';
    saveStores(stores);

    await bot.sendMessage(id, '✅ Доступ підтверджено', storeKeyboard);
    await bot.editMessageText(
      `✅ Доступ підтверджено\nTelegram ID: ${id}`,
      { chat_id: msg.chat.id, message_id: msg.message_id }
    );
  }

  /* ---- REJECT STORE ---- */
  if (data.startsWith('reject_')) {
    const id = data.replace('reject_', '');
    delete stores[id];
    saveStores(stores);

    await bot.sendMessage(id, '❌ Доступ відхилено');
    await bot.editMessageText(
      `❌ Доступ відхилено\nTelegram ID: ${id}`,
      { chat_id: msg.chat.id, message_id: msg.message_id }
    );
  }

  /* ---- REQUEST STATUS ---- */
  if (data.startsWith('status_')) {
    const [, reqId, status] = data.split('_');
    const order = requests.find(o => o.id === Number(reqId));
    if (!order) return;

    order.status = status;
    saveRequests(requests);

    // повідомлення магазину
    if (status === 'accepted') {
      await bot.sendMessage(order.storeId, `🟡 Заявка #${order.id} прийнята`);
    }

    if (status === 'formed') {
      await bot.sendMessage(
        order.storeId,
        `🟢 Заявка #${order.id} сформована\nОчікуйте на доставку`
      );
    }

    // логіка кнопок
    if (status === 'accepted') {
      await bot.editMessageReplyMarkup(
        {
          inline_keyboard: [[
            { text: '🟢 Сформована', callback_data: `status_${order.id}_formed` }
          ]]
        },
        { chat_id: msg.chat.id, message_id: msg.message_id }
      );
    }

    if (status === 'formed') {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: msg.chat.id, message_id: msg.message_id }
      );
    }
  }

  bot.answerCallbackQuery(q.id);
});

/* ================= STORE ACTIONS ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const stores = readStores();
  if (!stores[chatId] || stores[chatId].status !== 'approved') return;

  if (text === '➕ Створити заявку') {
    waitingForOrder.add(chatId);
    bot.sendMessage(chatId, '✍️ Напишіть текст заявки одним повідомленням');
    return;
  }

  if (text === '📄 Мої заявки') {
    const list = readRequests().filter(r => r.storeId === chatId);
    if (!list.length) {
      bot.sendMessage(chatId, '📭 Заявок ще немає');
      return;
    }

    const out = list.map(r =>
      `#${r.id} — ${r.status}\n${r.text}`
    ).join('\n\n');

    bot.sendMessage(chatId, out);
    return;
  }

  if (waitingForOrder.has(chatId)) {
    waitingForOrder.delete(chatId);

    const requests = readRequests();
    const id = requests.length + 1;

    const order = {
      id,
      storeId: chatId,
      storeCode: stores[chatId].code,
      text,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    requests.push(order);
    saveRequests(requests);

    bot.sendMessage(chatId, `✅ Заявка #${id} створена`, storeKeyboard);

    bot.sendMessage(
      MANAGER_ID,
      `📦 Нова заявка #${id}\n🏪 Магазин: ${order.storeCode}\nTelegram ID: ${chatId}\n\n${text}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🟡 Прийнята', callback_data: `status_${id}_accepted` }
          ]]
        }
      }
    );
  }
});

console.log('🤖 Bot started');
