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

/* =======================
   ФАЙЛИ ДАНИХ
======================= */
const DATA_DIR = path.join(__dirname, 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(STORES_FILE)) fs.writeFileSync(STORES_FILE, '{}');
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');

const readStores = () => JSON.parse(fs.readFileSync(STORES_FILE));
const saveStores = (data) => fs.writeFileSync(STORES_FILE, JSON.stringify(data, null, 2));

const readOrders = () => JSON.parse(fs.readFileSync(ORDERS_FILE));
const saveOrders = (data) => fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2));

/* =======================
   КЛАВІАТУРИ
======================= */
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
    keyboard: [['➕ Нова заявка', '📄 Мої заявки']],
    resize_keyboard: true
  }
};

/* =======================
   START
======================= */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (chatId === MANAGER_ID) {
    bot.sendMessage(chatId, '👨‍💼 Панель менеджера', managerKeyboard);
    return;
  }

  const stores = readStores();
  const store = stores[chatId];

  if (!store || store.status !== 'approved') {
    bot.sendMessage(chatId, '🔐 Введіть код магазину для доступу:');
    return;
  }

  bot.sendMessage(chatId, '✅ Доступ дозволено', storeKeyboard);
});

/* =======================
   КОД МАГАЗИНУ
======================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || chatId === MANAGER_ID) return;
  if (!text.startsWith('SHOP-')) return;

  const stores = readStores();

  if (stores[chatId]) {
    bot.sendMessage(chatId, 'ℹ️ Запит уже надіслано або доступ активний');
    return;
  }

  stores[chatId] = {
    code: text,
    status: 'pending'
  };

  saveStores(stores);

  bot.sendMessage(chatId, '⏳ Запит відправлено менеджеру. Очікуйте підтвердження.');

  bot.sendMessage(
    MANAGER_ID,
    `🔐 Запит на доступ\nКод: ${text}\nTelegram ID: ${chatId}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Підтвердити', callback_data: `approve_${chatId}` },
            { text: '❌ Відхилити', callback_data: `reject_${chatId}` }
          ]
        ]
      }
    }
  );
});

/* =======================
   ПІДТВЕРДЖЕННЯ ДОСТУПУ
======================= */
bot.on('callback_query', (query) => {
  const data = query.data;
  const managerChat = query.message.chat.id;

  if (managerChat !== MANAGER_ID) return;

  const stores = readStores();

  if (data.startsWith('approve_')) {
    const storeId = data.replace('approve_', '');
    if (stores[storeId]) {
      stores[storeId].status = 'approved';
      saveStores(stores);

      bot.sendMessage(storeId, '✅ Доступ підтверджено', storeKeyboard);
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, query.message);
    }
  }

  if (data.startsWith('reject_')) {
    const storeId = data.replace('reject_', '');
    delete stores[storeId];
    saveStores(stores);

    bot.sendMessage(storeId, '❌ Доступ відхилено');
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, query.message);
  }
});

/* =======================
   ЗАЯВКИ
======================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  const stores = readStores();
  if (!stores[chatId] || stores[chatId].status !== 'approved') return;

  if (text === '➕ Нова заявка') {
    bot.sendMessage(chatId, '✍️ Введіть текст заявки:');
    return;
  }

  if (text === '📄 Мої заявки') {
    const orders = readOrders().filter(o => o.storeId === chatId);
    if (!orders.length) {
      bot.sendMessage(chatId, '📭 Заявок немає');
      return;
    }

    const list = orders.map(o =>
      `#${o.id} — ${o.status}\n${o.text}`
    ).join('\n\n');

    bot.sendMessage(chatId, list);
    return;
  }

  if (text.startsWith('/')) return;

  const orders = readOrders();
  const order = {
    id: orders.length + 1,
    storeId: chatId,
    text,
    status: 'Очікує'
  };

  orders.push(order);
  saveOrders(orders);

  bot.sendMessage(chatId, '📨 Заявка прийнята. Очікуйте обробки');

  bot.sendMessage(
    MANAGER_ID,
    `📦 Нова заявка #${order.id}\n${text}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟡 Прийнята', callback_data: `accept_${order.id}` },
            { text: '🟢 Сформована', callback_data: `done_${order.id}` }
          ]
        ]
      }
    }
  );
});

/* =======================
   СТАТУСИ ЗАЯВОК
======================= */
bot.on('callback_query', (query) => {
  const data = query.data;
  const orders = readOrders();

  if (data.startsWith('accept_')) {
    const id = Number(data.replace('accept_', ''));
    const order = orders.find(o => o.id === id);
    if (!order) return;

    order.status = 'Прийнята';
    saveOrders(orders);

    bot.sendMessage(order.storeId, '🟡 Заявка прийнята');
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, query.message);
  }

  if (data.startsWith('done_')) {
    const id = Number(data.replace('done_', ''));
    const order = orders.find(o => o.id === id);
    if (!order) return;

    order.status = 'Сформована';
    saveOrders(orders);

    bot.sendMessage(order.storeId, '🟢 Заявка сформована. Очікуйте на доставку');
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, query.message);
  }
});

console.log('🤖 Бот запущений і працює стабільно');
