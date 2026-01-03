const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ExcelJS = require('exceljs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MANAGER_ID = Number(process.env.MANAGER_TELEGRAM_ID);

const STORES_FILE = './stores.json';
const ORDERS_FILE = './orders.json';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ===== HELPERS ===== */
function load(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file));
}

function formatDate(date) {
  return date ? new Date(date).toLocaleString('uk-UA') : '';
}

const STATUS_TEXT = {
  pending: 'Очікує підтвердження',
  accepted: 'Прийнята',
  formed: 'Сформована'
};

/* ===== EXPORT STORES ===== */
bot.onText(/\/export_stores/, async (msg) => {
  if (msg.chat.id !== MANAGER_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ Команда доступна лише менеджеру');
  }

  const data = load(STORES_FILE, { stores: {} });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Stores');

  ws.columns = [
    { header: 'Telegram ID', key: 'id', width: 20 },
    { header: 'Код магазину', key: 'code', width: 20 },
    { header: 'Статус', key: 'status', width: 15 },
    { header: 'Дата підтвердження', key: 'date', width: 25 }
  ];

  for (const [id, store] of Object.entries(data.stores)) {
    ws.addRow({
      id,
      code: store.code,
      status: store.status,
      date: formatDate(store.approvedAt)
    });
  }

  const filePath = './stores.xlsx';
  await wb.xlsx.writeFile(filePath);

  bot.sendDocument(msg.chat.id, filePath);
});

/* ===== EXPORT ORDERS ===== */
bot.onText(/\/export_orders/, async (msg) => {
  if (msg.chat.id !== MANAGER_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ Команда доступна лише менеджеру');
  }

  const data = load(ORDERS_FILE, { orders: {} });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orders');

  ws.columns = [
    { header: '№ заявки', key: 'id', width: 10 },
    { header: 'Магазин', key: 'store', width: 20 },
    { header: 'Telegram ID', key: 'storeId', width: 20 },
    { header: 'Статус', key: 'status', width: 20 },
    { header: 'Дата', key: 'date', width: 25 },
    { header: 'Текст заявки', key: 'text', width: 50 }
  ];

  for (const [id, order] of Object.entries(data.orders)) {
    ws.addRow({
      id,
      store: order.storeCode,
      storeId: order.storeId,
      status: STATUS_TEXT[order.status],
      date: formatDate(order.createdAt),
      text: order.text
    });
  }

  const filePath = './orders.xlsx';
  await wb.xlsx.writeFile(filePath);

  bot.sendDocument(msg.chat.id, filePath);
});

console.log('🤖 Bot with Excel export started');
