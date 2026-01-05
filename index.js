import express from "express";
import TelegramBot from "node-telegram-bot-api";

/*
  ПРАЦЮЄ ТІЛЬКИ ЧЕРЕЗ WEBHOOK
  ❌ БЕЗ polling 
  ❌ БЕЗ node-cron
*/

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set");
  process.exit(1);
}

const app = express();
app.use(express.json());

// 👉 створюємо бота БЕЗ polling
const bot = new TelegramBot(BOT_TOKEN);

// 👉 endpoint для Telegram
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// 👉 мінімальна логіка для тесту
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text === "/start") {
    return bot.sendMessage(
      chatId,
      "✅ Бот працює стабільно через webhook\n\nМожемо рухатись далі"
    );
  }

  bot.sendMessage(chatId, "ℹ️ Напишіть /start");
});

// 👉 запуск сервера + установка webhook
app.listen(PORT, async () => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME;

  if (!host) {
    console.error("❌ RENDER_EXTERNAL_HOSTNAME not found");
    process.exit(1);
  }

  const webhookUrl = `https://${host}/webhook`;

  try {
    await bot.setWebHook(webhookUrl);
    console.log("🚀 Webhook set:", webhookUrl);
  } catch (err) {
    console.error("❌ Failed to set webhook", err);
  }
});
