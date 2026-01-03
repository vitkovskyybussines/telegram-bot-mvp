bot.on('callback_query', async (query) => {
  const data = query.data;
  const managerChatId = query.message.chat.id;

  if (managerChatId !== MANAGER_ID) {
    return bot.answerCallbackQuery(query.id, {
      text: '⛔ Немає доступу'
    });
  }

  const [action, userId] = data.split(':');
  const targetUserId = Number(userId);

  // Прибираємо кнопки
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }
  );

  if (action === 'approve') {
    approvedUsers.add(targetUserId);

    bot.sendMessage(
      targetUserId,
      '✅ Ваш доступ підтверджено. Можете працювати.'
    );

    bot.answerCallbackQuery(query.id, {
      text: 'Доступ підтверджено'
    });
  }

  if (action === 'reject') {
    bot.sendMessage(
      targetUserId,
      '❌ У доступі відмовлено.'
    );

    bot.answerCallbackQuery(query.id, {
      text: 'Запит відхилено'
    });
  }
});
