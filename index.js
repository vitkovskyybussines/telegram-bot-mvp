const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_ID);

const bot = new TelegramBot(TOKEN, { polling: true });

// ---------- FILES ----------
const STORES_FILE = path.join(__dirname, 'stores.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json');

function load(file, def) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(file));
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- DATA ----------
let stores = load(STORES_FILE, {});
let requests = load(REQUESTS_FILE, {});

// ---------- KEYBOARDS ----------
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
    keyboard: [['📄 Мої заявки']],
    resize_keyboard: true
  }
};

// ---------- START ----------
bot.onText(/\/start/, (msg) => {
  if (msg.chat.id === MANAGER_ID) {
    bot.sendMessage(msg.chat.id, '👨‍💼 Панель менеджера', managerKeyboard);
  } else {
    bot.sendMessage(msg.chat.id, '👋 Введіть код магазину для доступу');
  }
});

// ---------- STORE CODE ----------
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  if (chatId !== MANAGER_ID && text.startsWith('SHOP-')) {
    if (stores[chatId]) {
      return bot.sendMessage(chatId, 'ℹ️ Ви вже маєте доступ', storeKeyboard);
    }

    stores[chatId] = {
      code: text,
      status: 'pending'
    };
    save(STORES_FILE, stores);

    const inline = {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Підтвердити', callback_data: `approve_${chatId}` },
          { text: '❌ Відхилити', callback_data: `reject_${chatId}` }
        ]]
      }
    };

    bot.sendMessage(
      MANAGER_ID,
      `🔐 Запит на доступ\nКод: ${text}\nTelegram ID: ${chatId}`,
      inline
    );

    bot.sendMessage(chatId, '⏳ Запит відправлено менеджеру');
  }
});

// ---------- CALLBACKS ----------
bot.on('callback_query', async (q) => {
  const data = q.data;
  const msg = q.message;

  if (msg.chat.id !== MANAGER_ID) return;

  // APPROVE STORE
  if (data.startsWith('approve_')) {
    const storeId = data.replace('approve_', '');

    if (!stores[storeId]) {
      return bot.answerCallbackQuery(q.id, { text: 'Вже оброблено' });
    }

    stores[storeId].status = 'approved';
    save(STORES_FILE, stores);

    await bot.sendMessage(storeId, '✅ Доступ підтверджено', storeKeyboard);

    await bot.editMessageText(
      `✅ Доступ підтверджено\nTelegram ID: ${storeId}`,
      {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      }
    );
  }

  // REJECT STORE
  if (data.startsWith('reject_')) {
    const storeId = data.replace('reject_', '');

    if (!stores[storeId]) {
      return bot.answerCallbackQuery(q.id, { text: 'Вже оброблено' });
    }

    delete stores[storeId];
    save(STORES_FILE, stores);

    await bot.sendMessage(storeId, '❌ Доступ відхилено');

    await bot.editMessageText(
      `❌ Доступ відхилено\nTelegram ID: ${storeId}`,
      {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      }
    );
  }

  // REQUEST STATUS
  if (data.startsWith('status_')) {
    const [_, id, status] = data.split('_');

    if (!requests[id]) return;

    requests[id].status = status;
    save(REQUESTS_FILE, requests);

    const storeId = requests[id].storeId;

    let text = 'ℹ️ Статус оновлено';
    if (status === 'accepted') text = '🟡 Заявка прийнята';
    if (status === 'formed') text = '🟢 Заявка сформована. Очікуйте доставку';

    await bot.sendMessage(storeId, text);

    await bot.editMessageText(
      `📦 Заявка #${id}\nСтатус: ${status}`,
      {
        chat_id: msg.chat.id,
        message_id: msg.message_id
      }
    );
  }

  bot.answerCallbackQuery(q.id);
});

// ---------- MANAGER LIST ----------
bot.on('message', (msg) => {
  if (msg.chat.id !== MANAGER_ID) return;

  const text = msg.text;

  let list = [];

  if (text === '📦 Всі заявки') {
    list = Object.entries(requests);
  }

  if (text === '⏳ Очікують') {
    list = Object.entries(requests).filter(r => r[1].status === 'pending');
  }

  if (text === '🟡 Прийняті') {
    list = Object.entries(requests).filter(r => r[1].status === 'accepted');
  }

  if (text === '🟢 Сформовані') {
    list = Object.entries(requests).filter(r => r[1].status === 'formed');
  }

  list.forEach(([id, r]) => {
    bot.sendMessage(
      MANAGER_ID,
      `📦 Заявка #${id}\nМагазин: ${r.storeId}\nСтатус: ${r.status}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🟡 Прийнята', callback_data: `status_${id}_accepted` },
            { text: '🟢 Сформована', callback_data: `status_${id}_formed` }
          ]]
        }
      }
    );
  });
});

console.log('🤖 Bot started');
