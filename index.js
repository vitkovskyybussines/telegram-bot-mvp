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

/* ================== FILES ================== */
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

/* ================== KEYBOARDS ================== */
const managerKeyboard = {
  reply_markup: {
    keyboard: [
      ['📦 Всі заявки'],
      ['⏳ Очікують', '🟡 Прийняті', '🟢 Сформовані']
    ],
    resize_keyboard: true
  }
};

const storeKeyboard = {
  reply_markup: {
    keyboard: [
      ['➕ Створити заявку'],
      ['📄 Мої заявки']
    ],
    resize_keyboard: true
  }
};

/* ================== STATE ================== */
const waitingForOrderText = new Set();

/* ================== /start ================== */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const stores = readStores();

  if (chatId === MANAGER_ID) {
    bot.sendMessage(chatId, '👨‍💼 Панель менеджера', managerKeyboard);
    return;
  }

  if (stores[chatId] && stores[chatId].status === 'approved') {
    bot.sendMessage(chatId, '🏪 Панель магазину', storeKeyboard);
    return;
  }

  bot.sendMessage(chatId, '🔐 Введіть код магазину для доступу (наприклад SHOP-001)');
});

/* ================== STORE CODE ================== */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const stores = readStores();

  if (chatId !== MANAGER_ID && text.startsWith('SHOP-')) {
    if (stores[chatId]) {
      bot.sendMessage(chatId, 'ℹ️ Запит уже надіслано або доступ активний');
      return;
    }

    stores[chatId] = { code: text, status: 'pending' };
    saveStores(stores);

    bot.sendMessage(chatId, '⏳ Запит відправлено менеджеру, очікуйте підтвердження');

    bot.sendMessage(
      MANAGER_ID,
      `🔐 Запит на доступ\nКод: ${text}\nTelegram ID: ${chatId}`,
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

/* ================== CALLBACKS ================== */
bot.on('callback_query', async (q) => {
  const data = q.data;
  const msg = q.message;
  const stores = readStores();
  const requests = readRequests();

  if (msg.chat.id !== MANAGER_ID) return;

  // APPROVE STORE
  if (data.startsWith('approve_')) {
    const storeId = data.replace('approve_', '');

    if (!stores[storeId]) {
      await bot.answerCallbackQuery(q.id, { text: 'Вже оброблено' });
      return;
    }

    stores[storeId].status = 'approved';
    saveStores(stores);

    await bot.sendMessage(storeId, '✅ Доступ підтверджено', storeKeyboard);

    await bot.editMessageText(
      `✅ Доступ підтверджено\nTelegram ID: ${storeId}`,
      { chat_id: msg.chat.id, message_id: msg.message_id }
    );
  }

  // REJECT STORE
  if (data.startsWith('reject_')) {
    const storeId = data.replace('reject_', '');
    delete stores[storeId];
    saveStores(stores);

    await bot.sendMessage(storeId, '❌ Доступ відхилено');

    await bot.editMessageText(
      `❌ Доступ відхилено\nTelegram ID: ${storeId}`,
      { chat_id: msg.chat.id, message_id: msg.message_id }
    );
  }

  // REQUEST STATUS
  if (data.startsWith('status_')) {
    const [_, id, status] = data.split('_');
    const order = requests.find(o => o.id === Number(id));
    if (!order) return;

    order.status = status;
    saveRequests(requests);

    let txt = 'ℹ️ Статус оновлено';
    if (status === 'accepted') txt = '🟡 Заявка прийнята';
    if (status === 'formed') txt = '🟢 Заявка сформована. Очікуйте доставку';

    await bot.sendMessage(order.storeId, txt);

    await bot.editMessageText(
      `📦 Заявка #${id}\nСтатус: ${status}`,
      { chat_id: msg.chat.id, message_id: msg.message_id }
    );
  }

  bot.answerCallbackQuery(q.id);
});

/* ================== STORE ACTIONS ================== */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const stores = readStores();
  if (!stores[chatId] || stores[chatId].status !== 'approved') return;

  // CREATE ORDER
  if (text === '➕ Створити заявку') {
    waitingForOrderText.add(chatId);
    bot.sendMessage(chatId, '✍️ Напишіть текст заявки одним повідомленням:');
    return;
  }

  // MY ORDERS
  if (text === '📄 Мої заявки') {
    const requests = readRequests().filter(r => r.storeId === chatId);
    if (!requests.length) {
      bot.sendMessage(chatId, '📭 Заявок ще немає');
      return;
    }

    const out = requests.map(r =>
      `#${r.id} — ${r.status}\n${r.text}`
    ).join('\n\n');

    bot.sendMessage(chatId, out);
    return;
  }

  // ORDER TEXT
  if (waitingForOrderText.has(chatId)) {
    waitingForOrderText.delete(chatId);

    const requests = readRequests();
    const id = requests.length + 1;

    const order = {
      id,
      storeId: chatId,
      text,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    requests.push(order);
    saveRequests(requests);

    bot.sendMessage(chatId, `✅ Заявка #${id} відправлена`, storeKeyboard);

    bot.sendMessage(
      MANAGER_ID,
      `📦 Нова заявка #${id}\n\n${text}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🟡 Прийнята', callback_data: `status_${id}_accepted` },
            { text: '🟢 Сформована', callback_data: `status_${id}_formed` }
          ]]
        }
      }
    );
  }
});

console.log('🤖 Bot started and stable');
