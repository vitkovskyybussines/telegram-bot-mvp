const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

if (!BOT_TOKEN || !MANAGER_ID) {
  console.error('❌ BOT_TOKEN or MANAGER_ID missing');
  process.exit(1);
}

const STORES_FILE = './stores.json';
const ORDERS_FILE = './orders.json';

/* ================= INIT ================= */
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= HELPERS ================= */
function load(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file));
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const STATUS_TEXT = {
  pending: '⏳ Очікує підтвердження',
  accepted: '🟡 Прийнята',
  formed: '🟢 Сформована'
};

/* ================= KEYBOARDS ================= */
const STORE_KEYBOARD = {
  reply_markup: {
    keyboard: [
      ['📝 Створити заявку'],
      ['📦 Мої заявки']
    ],
    resize_keyboard: true
  }
};

const MANAGER_KEYBOARD = {
  reply_markup: {
    keyboard: [
      ['📦 Всі заявки'],
      ['⏳ Очікують', '🟡 Прийняті', '🟢 Сформовані']
    ],
    resize_keyboard: true
  }
};

/* ================= /start ================= */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const stores = load(STORES_FILE, { stores: {} });

  if (chatId === MANAGER_ID) {
    return bot.sendMessage(chatId, '🧑‍💼 Панель менеджера', MANAGER_KEYBOARD);
  }

  const store = stores.stores[chatId];
  if (store && store.status === 'active') {
    return bot.sendMessage(chatId, '🏪 Панель магазину', STORE_KEYBOARD);
  }

  bot.sendMessage(chatId, '👋 Введіть код магазину для доступу');
});

/* ================= MESSAGES ================= */
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text || text.startsWith('/')) return;

  const stores = load(STORES_FILE, { stores: {} });
  const orders = load(ORDERS_FILE, { lastId: 0, orders: {} });
  const store = stores.stores[chatId];
  const isManager = chatId === MANAGER_ID;

  /* ===== STORE ===== */
  if (store && store.status === 'active' && !isManager) {

    if (text === '📝 Створити заявку') {
      return bot.sendMessage(
        chatId,
        '✍️ Напишіть заявку так:\n\nЗАЯВКА\nТовар – кількість',
        STORE_KEYBOARD
      );
    }

    if (text === '📦 Мої заявки') {
      const my = Object.entries(orders.orders)
        .filter(([_, o]) => o.storeId === chatId);

      if (!my.length) {
        return bot.sendMessage(chatId, 'ℹ️ Заявок ще немає', STORE_KEYBOARD);
      }

      let out = '📦 Мої заявки:\n\n';
      for (const [id, o] of my) {
        out += `#${id} — ${STATUS_TEXT[o.status]}\n`;
      }
      return bot.sendMessage(chatId, out, STORE_KEYBOARD);
    }

    if (text.startsWith('ЗАЯВКА')) {
      const body = text.replace('ЗАЯВКА', '').trim();
      if (!body) return;

      const id = ++orders.lastId;
      orders.orders[id] = {
        storeId: chatId,
        storeCode: store.code,
        text: body,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      save(ORDERS_FILE, orders);

      bot.sendMessage(
        MANAGER_ID,
        `📦 ЗАЯВКА #${id}\nМагазин: ${store.code}\n\n${body}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟡 Прийнята', callback_data: `order:accepted:${id}` },
                { text: '🟢 Сформована', callback_data: `order:formed:${id}` }
              ]
            ]
          }
        }
      );

      return bot.sendMessage(chatId, `✅ Заявка №${id} відправлена`, STORE_KEYBOARD);
    }
  }

  /* ===== MANAGER ===== */
  if (isManager) {
    const list = (status) =>
      Object.entries(orders.orders)
        .filter(([_, o]) => !status || o.status === status);

    if (text === '📦 Всі заявки') {
      let out = '📦 Всі заявки:\n\n';
      for (const [id, o] of list()) {
        out += `#${id} — ${o.storeCode} — ${STATUS_TEXT[o.status]}\n`;
      }
      return bot.sendMessage(chatId, out, MANAGER_KEYBOARD);
    }

    if (text === '⏳ Очікують') {
      let out = '⏳ Очікують підтвердження:\n\n';
      for (const [id, o] of list('pending')) {
        out += `#${id} — ${o.storeCode}\n`;
      }
      return bot.sendMessage(chatId, out, MANAGER_KEYBOARD);
    }

    if (text === '🟡 Прийняті') {
      let out = '🟡 Прийняті:\n\n';
      for (const [id, o] of list('accepted')) {
        out += `#${id} — ${o.storeCode}\n`;
      }
      return bot.sendMessage(chatId, out, MANAGER_KEYBOARD);
    }

    if (text === '🟢 Сформовані') {
      let out = '🟢 Сформовані:\n\n';
      for (const [id, o] of list('formed')) {
        out += `#${id} — ${o.storeCode}\n`;
      }
      return bot.sendMessage(chatId, out, MANAGER_KEYBOARD);
    }
  }
});

/* ================= CALLBACKS ================= */
bot.on('callback_query', (q) => {
  const [_, status, id] = q.data.split(':');
  const orders = load(ORDERS_FILE, { orders: {} });
  const order = orders.orders[id];
  if (!order) return;

  order.status = status;
  save(ORDERS_FILE, orders);

  bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    { chat_id: q.message.chat.id, message_id: q.message.message_id }
  );

  if (status === 'accepted') {
    bot.sendMessage(order.storeId, `📦 Заявка #${id}\n🟡 Прийнята`);
  }
  if (status === 'formed') {
    bot.sendMessage(
      order.storeId,
      `📦 Заявка #${id}\n🟢 Сформована\n🚚 Очікуйте на доставку`
    );
  }
});

console.log('🤖 Bot started (polling, no auto-export)');
