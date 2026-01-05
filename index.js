const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ BOT_TOKEN не заданий");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// тимчасове сховище заявок
const requests = [];

/* ===== START ===== */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "Оберіть дію:", {
    reply_markup: {
      keyboard: [
        [
          {
            text: "➕ Створити заявку",
            web_app: {
              url: "https://vitkovskyybussines.github.io/telegram-miniapp-catalog/"
            }
          }
        ],
        ["📦 Мої заявки"]
      ],
      resize_keyboard: true
    }
  });
});

/* ===== ПРИЙОМ ДАНИХ З MINI APP ===== */
bot.on("message", (msg) => {
  if (!msg.web_app_data) return;

  const chatId = msg.chat.id;
  const data = JSON.parse(msg.web_app_data.data);

  const request = {
    id: requests.length + 1,
    chatId,
    title: data.title,
    weight: data.weight,
    comment: data.comment || "",
    status: "accepted",
    createdAt: new Date()
  };

  requests.push(request);

  bot.sendMessage(chatId,
`✅ Заявку прийнято

📦 Заявка #${request.id}
📝 Назва: ${request.title}
⚖️ Вага: ${request.weight} кг
💬 Коментар: ${request.comment || "-"}
`);
});

/* ===== МОЇ ЗАЯВКИ ===== */
bot.onText(/📦 Мої заявки/, (msg) => {
  const chatId = msg.chat.id;
  const my = requests.filter(r => r.chatId === chatId);

  if (my.length === 0) {
    bot.sendMessage(chatId, "📭 У вас ще немає заявок");
    return;
  }

  let text = "📦 Ваші заявки:\n\n";
  my.forEach(r => {
    text +=
`#${r.id}
📝 ${r.title}
⚖️ ${r.weight} кг
📌 Статус: ${r.status}
────────────\n`;
  });

  bot.sendMessage(chatId, text);
});

console.log("🤖 Bot started with Mini App");
