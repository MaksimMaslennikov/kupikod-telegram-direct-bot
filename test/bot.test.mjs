import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  CLOSED_TICKET_ARCHIVE_DELAY_MS,
  ChannelDirectMessagesBot,
  GIVEAWAY_CONFIRM_KEYBOARD,
  GIVEAWAY_DETAILS_KEYBOARD,
  MENU_KEYBOARD,
  Storage,
  WELCOME_TEXT,
  normalizeUsername,
  parseGiveawayClaim
} from "../src/bot.mjs";

class FakeApi {
  calls = [];

  async call(method, payload) {
    this.calls.push({ method, payload });
    if (method === "getChat") {
      return {
        id: payload.chat_id,
        parent_chat: { id: -100123, title: "Kupikod News", username: "kupikod_news" }
      };
    }
    return method === "sendMessage" ? { message_id: this.calls.length } : true;
  }
}

function userMessage(text = "Добрый день") {
  return {
    message_id: 1,
    from: { id: 42, is_bot: false, username: "winner42" },
    chat: { id: -100777, type: "supergroup", is_direct_messages: true },
    direct_messages_topic: {
      topic_id: 900719925474000,
      user: { id: 42, is_bot: false }
    },
    text
  };
}

function callback(section, fromId = 42) {
  return {
    id: `callback-${section}`,
    from: { id: fromId, is_bot: false },
    message: userMessage(WELCOME_TEXT),
    data: `section:${section}`
  };
}

function actionCallback(action, fromId = 42) {
  const result = callback("giveaway", fromId);
  result.id = `callback-${action}`;
  result.data = `action:${action}`;
  return result;
}

function adminMessage(text = "/start", messageId = 50, adminId = 292141127) {
  return {
    message_id: messageId,
    from: { id: adminId, is_bot: false },
    chat: { id: adminId, type: "private" },
    date: 1,
    text
  };
}

function adminCallback(data, adminId = 292141127) {
  return {
    id: `callback-${data}`,
    from: { id: adminId, is_bot: false },
    message: adminMessage("Панель", 60, adminId),
    data
  };
}

describe("ChannelDirectMessagesBot", () => {
  let api;
  let storage;
  let bot;

  beforeEach(() => {
    api = new FakeApi();
    storage = new Storage();
    bot = new ChannelDirectMessagesBot({ api, storage, now: () => 1000 });
  });

  afterEach(() => storage.close());

  test("приветствует автора обращения и передаёт topic id", async () => {
    await bot.handleMessage(userMessage());
    assert.deepEqual(api.calls, [{
      method: "sendMessage",
      payload: {
        chat_id: -100777,
        direct_messages_topic_id: 900719925474000,
        text: WELCOME_TEXT,
        parse_mode: "HTML",
        reply_markup: MENU_KEYBOARD
      }
    }]);
  });

  test("показывает меню после каждого обычного сообщения", async () => {
    await bot.handleMessage(userMessage());
    await bot.handleMessage(userMessage("Ещё сообщение"));
    assert.equal(api.calls.length, 2);
    assert.equal(api.calls.at(-1).payload.text, WELCOME_TEXT);
  });

  test("не реагирует на ответ администратора", async () => {
    const message = userMessage();
    message.from.id = 99;
    await bot.handleMessage(message);
    assert.equal(api.calls.length, 0);
  });

  test("розыгрыш показывает проверку и сохраняет данные только после подтверждения", async () => {
    await bot.handleMessage(userMessage("Я победил в розыгрыше"));
    await bot.handleCallback(callback("giveaway"));
    assert.match(api.calls.at(-1).payload.text, /<b>• Telegram username<\/b>/);
    assert.match(api.calls.at(-1).payload.text, /<b>• Ссылка на розыгрыш<\/b>/);
    assert.match(api.calls.at(-1).payload.text, /<b>• Какое место вы заняли<\/b>/);
    assert.deepEqual(api.calls.at(-1).payload.reply_markup, GIVEAWAY_DETAILS_KEYBOARD);
    await bot.handleMessage(userMessage(
      "@lucky_user\nID Kupikod: KP-123456\nСсылка: https://t.me/kupikod/100\nМесто: 2"
    ));

    assert.match(api.calls.at(-1).payload.text, /Проверьте обращение перед отправкой/);
    assert.match(api.calls.at(-1).payload.text, /Я победил в розыгрыше/);
    assert.deepEqual(api.calls.at(-1).payload.reply_markup, GIVEAWAY_CONFIRM_KEYBOARD);
    assert.equal(storage.listGiveawayClaims().length, 0);
    assert.equal(storage.listTickets().length, 0);

    await bot.handleCallback(actionCallback("confirm_request"));
    assert.match(api.calls.at(-1).payload.text, /Обращение №1 отправлено/);
    assert.equal(api.calls.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data,
      "action:add_details");
    assert.deepEqual(
      storage.listGiveawayClaims().map((row) => [row.ticket_id, row.username, row.kupikod_id]),
      [[1, "@lucky_user", "KP-123456"]]
    );
    assert.equal(storage.listGiveawayClaims()[0].giveaway_url, "https://t.me/kupikod/100");
    assert.equal(storage.listGiveawayClaims()[0].place, "2");
  });

  test("принимает данные розыгрыша без проверки формата", async () => {
    await bot.handleMessage(userMessage("Я победитель"));
    await bot.handleCallback(callback("giveaway"));
    await bot.handleMessage(userMessage("мой юзер winner, айди купикода забыл где посмотреть"));
    assert.match(api.calls.at(-1).payload.text, /Проверьте обращение перед отправкой/);
    assert.match(api.calls.at(-1).payload.text, /мой юзер winner/);
    assert.equal(storage.listGiveawayClaims().length, 0);

    await bot.handleCallback(actionCallback("confirm_request"));
    assert.equal(storage.listGiveawayClaims().length, 1);
    assert.match(storage.listGiveawayClaims()[0].details, /мой юзер winner/);
  });

  test("новое обращение отменяет текущий сценарий и просит написать текст", async () => {
    await bot.handleMessage(userMessage("Исходное сообщение"));
    await bot.handleCallback(callback("giveaway"));

    await bot.handleCallback(actionCallback("new_request"));

    const conversation = storage.getConversation(-100777, 900719925474000);
    assert.equal(conversation.state, "idle");
    assert.equal(conversation.chosen_section, null);
    assert.equal(conversation.active_ticket_id, null);
    assert.equal(conversation.pending_message_text, null);
    assert.equal(storage.listTickets().length, 0);
    assert.match(api.calls.at(-1).payload.text, /Напишите текст нового обращения/);
  });

  test("позволяет изменить данные розыгрыша перед подтверждением", async () => {
    await bot.handleMessage(userMessage("Сообщение о выигрыше"));
    await bot.handleCallback(callback("giveaway"));
    await bot.handleMessage(userMessage("@first_user\nID Kupikod: 111"));
    await bot.handleCallback(actionCallback("edit_giveaway"));

    const conversation = storage.getConversation(-100777, 900719925474000);
    assert.equal(conversation.state, "awaiting_giveaway_details");
    assert.equal(conversation.pending_username, null);
    assert.match(api.calls.at(-1).payload.text, /отправьте одним сообщением/);
  });

  test("сразу направляет проблемы с заказом в поддержку без создания обращения", async () => {
    assert.equal(MENU_KEYBOARD.inline_keyboard[0][0].text, "🛒 Проблемы с заказом");
    await bot.handleMessage(userMessage("Заказ 555, товар не пришёл"));
    await bot.handleCallback(callback("order"));
    assert.match(api.calls.at(-1).payload.text, /не являемся службой поддержки/i);
    assert.match(api.calls.at(-1).payload.text, /@KUPIKOD_bot/);
    assert.equal(api.calls.at(-1).payload.reply_markup.inline_keyboard[0][0].url,
      "https://t.me/KUPIKOD_bot");
    assert.equal(api.calls.at(-1).payload.reply_markup.inline_keyboard[1][0].text,
      "← Вернуться");
    assert.equal(api.calls.at(-1).payload.reply_markup.inline_keyboard[1][0].callback_data,
      "action:change_section");
    assert.equal(storage.listTickets().length, 0);
    assert.equal(storage.getConversation(-100777, 900719925474000).pending_message_text,
      "Заказ 555, товар не пришёл");

    await bot.handleCallback(actionCallback("change_section"));
    assert.equal(api.calls.at(-1).payload.text, WELCOME_TEXT);
    assert.deepEqual(api.calls.at(-1).payload.reply_markup, MENU_KEYBOARD);
  });

  test("создаёт обращение с предложенной новостью", async () => {
    assert.equal(MENU_KEYBOARD.inline_keyboard[2][0].text, "📰 Предложить новость");
    await bot.handleMessage(userMessage("Есть новость для публикации"));
    await bot.handleCallback(callback("news"));

    assert.match(api.calls.at(-1).payload.text, /📰 Предложить новость/);
    assert.match(api.calls.at(-1).payload.text, /Есть новость для публикации/);
    await bot.handleCallback(actionCallback("confirm_request"));

    assert.equal(storage.getTicket(1).section, "news");
    assert.match(api.calls.at(-1).payload.text, /Обращение №1 отправлено/);
  });

  test("создаёт обычное обращение после подтверждения", async () => {
    await bot.handleMessage(userMessage("Нужна консультация"));
    await bot.handleCallback(callback("other"));
    assert.match(api.calls.at(-1).payload.text, /Подтвердите отправку обращения/);
    assert.equal(storage.listTickets().length, 0);

    await bot.handleCallback(actionCallback("confirm_request"));
    assert.match(api.calls.at(-1).payload.text, /Обращение №1 отправлено/);
    assert.notDeepEqual(api.calls.at(-1).payload.reply_markup, MENU_KEYBOARD);
    assert.equal(storage.listTickets()[0].status, "open");

    await bot.handleMessage(userMessage("Хочу добавить деталь к обращению"));
    assert.match(api.calls.at(-1).payload.text, /Дополнение отправлено в обращение №1/);
    assert.equal(api.calls.at(-1).payload.reply_markup, undefined);
    assert.equal(storage.listTickets().length, 1);
    assert.deepEqual(
      storage.listTicketMessages(1).map((entry) => entry.text),
      ["Нужна консультация", "Дополнение: Хочу добавить деталь к обращению"]
    );
    assert.equal(storage.getConversation(-100777, 900719925474000).pending_message_text, null);

    await bot.handleCallback(actionCallback("ticket_status"));
    assert.match(api.calls.at(-1).payload.text, /Раздел: Другой вопрос\nСтатус: Открыто/);

    await bot.handleCallback(actionCallback("add_details"));
    assert.match(api.calls.at(-1).payload.text, /Отправьте дополнительную информацию/);
    await bot.handleMessage(userMessage("Дополнительный скриншот"));
    assert.match(api.calls.at(-1).payload.text, /Дополнение отправлено/);

    await bot.handleCallback(actionCallback("close_ticket"));
    assert.match(api.calls.at(-1).payload.text, /Вопрос по обращению №1 завершён/);
    assert.equal(storage.listTickets()[0].status, "closed");
    assert.equal(storage.inboxCounts().closed, 1);
    assert.equal(storage.inboxCounts().unread, 0);

    await bot.handleMessage(userMessage("Теперь у меня новый вопрос"));
    assert.equal(api.calls.at(-1).payload.text, WELCOME_TEXT);
    assert.equal(storage.getConversation(-100777, 900719925474000).pending_message_text,
      "Теперь у меня новый вопрос");
  });

  test("позволяет изменить и дополнить сообщение до отправки", async () => {
    await bot.handleMessage(userMessage("Старый текст"));
    await bot.handleCallback(callback("other"));

    await bot.handleCallback(actionCallback("edit_request"));
    await bot.handleMessage(userMessage("Новый текст"));
    assert.match(api.calls.at(-1).payload.text, /Новый текст/);
    assert.doesNotMatch(api.calls.at(-1).payload.text, /Старый текст/);

    await bot.handleCallback(actionCallback("append_request"));
    await bot.handleMessage(userMessage("Важная деталь"));
    assert.match(api.calls.at(-1).payload.text, /Новый текст/);
    assert.match(api.calls.at(-1).payload.text, /Дополнение: Важная деталь/);
    assert.equal(storage.listTickets().length, 0);
  });

  test("добавляет исправление и дополнение в историю отправленной заявки", async () => {
    await bot.handleMessage(userMessage("Первоначальный текст"));
    await bot.handleCallback(callback("other"));
    await bot.handleCallback(actionCallback("confirm_request"));

    await bot.handleCallback(actionCallback("correct_ticket"));
    await bot.handleMessage(userMessage("Правильный текст"));
    await bot.handleCallback(actionCallback("add_details"));
    await bot.handleMessage(userMessage("Ещё одна деталь"));

    const history = storage.listTicketMessages(1).map((entry) => entry.text);
    assert.deepEqual(history, [
      "Первоначальный текст",
      "Исправление: Правильный текст",
      "Дополнение: Ещё одна деталь"
    ]);
  });
});

describe("normalizeUsername", () => {
  test("понимает @username, имя без @ и ссылку t.me", () => {
    assert.equal(normalizeUsername("@hello_world"), "@hello_world");
    assert.equal(normalizeUsername("hello_world"), "@hello_world");
    assert.equal(normalizeUsername("https://t.me/hello_world"), "@hello_world");
  });

  test("отклоняет произвольный текст", () => {
    assert.equal(normalizeUsername("Иван Иванов"), null);
  });
});

describe("parseGiveawayClaim", () => {
  test("извлекает Telegram username и ID Kupikod", () => {
    assert.deepEqual(parseGiveawayClaim(
      "@hello_world\nID Kupikod: 123456\nСсылка: https://t.me/kupikod/10\nМесто: 1"
    ), {
      username: "@hello_world",
      kupikodId: "123456",
      giveawayUrl: "https://t.me/kupikod/10",
      place: "1",
      details: "@hello_world\nID Kupikod: 123456\nСсылка: https://t.me/kupikod/10\nМесто: 1"
    });
  });

  test("принимает неполный текст, но отклоняет пустой", () => {
    assert.deepEqual(parseGiveawayClaim("@hello_world"), {
      username: "@hello_world",
      kupikodId: null,
      giveawayUrl: null,
      place: null,
      details: "@hello_world"
    });
    assert.match(parseGiveawayClaim("просто текст").details, /просто текст/);
    assert.equal(parseGiveawayClaim("   "), null);
  });
});

describe("автоматический архив", () => {
  test("переносит закрытое обращение в архив только через сутки", async () => {
    const api = new FakeApi();
    const storage = new Storage();
    const bot = new ChannelDirectMessagesBot({ api, storage, now: () => 1000 });
    try {
      await bot.handleMessage(userMessage("Вопрос для архива"));
      await bot.handleCallback(callback("other"));
      await bot.handleCallback(actionCallback("confirm_request"));
      storage.closeTicket(1, 1000);
      assert.equal(storage.inboxCounts().closed, 1);

      assert.equal(
        storage.archiveClosedTickets(1000 + CLOSED_TICKET_ARCHIVE_DELAY_MS - 1),
        0
      );
      assert.equal(storage.getTicket(1).archived, 0);

      assert.equal(
        storage.archiveClosedTickets(1000 + CLOSED_TICKET_ARCHIVE_DELAY_MS),
        1
      );
      assert.equal(storage.getTicket(1).archived, 1);
      assert.equal(storage.inboxCounts().archived, 1);
      assert.equal(storage.inboxCounts().closed, 0);
      assert.equal(storage.archiveClosedTickets(1000 + CLOSED_TICKET_ARCHIVE_DELAY_MS + 1), 0);
    } finally {
      storage.close();
    }
  });
});

describe("сортировка обращений", () => {
  test("показывает в админке сначала более ранние обращения", () => {
    const storage = new Storage();
    try {
      const user = { id: 42, username: "user42" };
      const first = storage.startTicket(
        { chatId: -100777, topicId: 101, chatTitle: "Канал" }, user, "other", "idle", 1000
      );
      const second = storage.startTicket(
        { chatId: -100777, topicId: 102, chatTitle: "Канал" }, user, "order", "idle", 2000
      );
      const third = storage.startTicket(
        { chatId: -100777, topicId: 103, chatTitle: "Канал" }, user, "giveaway", "idle", 3000
      );
      storage.recordTicketMessage(first, "user", 1, "Позднее дополнение к первому", 9000);

      assert.deepEqual(
        storage.listInbox({ mode: "open" }).map((ticket) => ticket.id),
        [first, second, third]
      );
    } finally {
      storage.close();
    }
  });
});

describe("администраторская панель", () => {
  let api;
  let storage;
  let bot;

  beforeEach(() => {
    api = new FakeApi();
    storage = new Storage();
    bot = new ChannelDirectMessagesBot({
      api, storage, adminUserId: 292141127, now: () => 1000
    });
  });

  afterEach(() => storage.close());

  test("уведомляет администратора с каналом, автором, разделом и сообщением", async () => {
    await bot.handleMessage(userMessage("Нужна помощь"));
    await bot.handleCallback(callback("other"));
    await bot.handleCallback(actionCallback("confirm_request"));

    const notification = api.calls.find((call) =>
      call.method === "sendMessage" && call.payload.chat_id === 292141127
    );
    assert.equal(notification.payload.parse_mode, "HTML");
    assert.match(notification.payload.text, /<b>Тип:<\/b> 💬 Другой вопрос/);
    assert.match(notification.payload.text, /<b>Канал:<\/b> 📣 Kupikod News \(@kupikod_news\)/);
    assert.match(notification.payload.text, /<b>От кого:<\/b> 👤 ID 42/);
    assert.match(notification.payload.text, /<blockquote>Нужна помощь<\/blockquote>/);
    assert.equal(
      api.calls.filter((call) => call.method === "copyMessage").length,
      0,
      "обычный текст не должен дублироваться отдельной копией"
    );
    assert.equal(storage.inboxCounts().unread, 1);
  });

  test("показывает входящие, архивирует и отправляет ответ пользователю", async () => {
    await bot.handleMessage(userMessage("Нужна помощь"));
    await bot.handleCallback(callback("other"));
    await bot.handleCallback(actionCallback("confirm_request"));

    await bot.handleUpdate({ message: adminMessage("/start") });
    assert.match(api.calls.at(-1).payload.text, /Новых:<\/b> 1/);

    await bot.handleUpdate({ callback_query: adminCallback("admin:view:1") });
    assert.match(api.calls.at(-1).payload.text, /Обращение №1/);
    assert.match(api.calls.at(-1).payload.text, /История — последние 20:/);
    assert.match(api.calls.at(-1).payload.text, /Пользователь.*<blockquote>Нужна помощь<\/blockquote>/s);
    assert.equal(storage.inboxCounts().unread, 0);

    await bot.handleUpdate({ callback_query: adminCallback("admin:reply:1") });
    await bot.handleUpdate({ message: adminMessage("Здравствуйте, уже проверяем.", 88) });
    const relay = api.calls.find((call) =>
      call.method === "copyMessage" && call.payload.message_id === 88
    );
    assert.equal(relay.payload.chat_id, "-100777");
    assert.equal(relay.payload.direct_messages_topic_id, 900719925474000);

    await bot.handleUpdate({ callback_query: adminCallback("admin:view:1") });
    assert.match(api.calls.at(-1).payload.text, /Вы.*<blockquote>Здравствуйте, уже проверяем\.<\/blockquote>/s);

    await bot.handleUpdate({ callback_query: adminCallback("admin:archive:1") });
    assert.equal(storage.inboxCounts().archived, 1);
  });

  test("отправляет уведомления двум администраторам", async () => {
    bot = new ChannelDirectMessagesBot({
      api,
      storage,
      adminUserIds: [292141127, 5879729856],
      now: () => 1000
    });
    await bot.handleMessage(userMessage("Вопрос для двух администраторов"));
    await bot.handleCallback(callback("partnership"));
    await bot.handleCallback(actionCallback("confirm_request"));

    const notificationRecipients = api.calls
      .filter((call) => call.method === "sendMessage" && /Новое обращение/.test(call.payload.text))
      .map((call) => call.payload.chat_id);
    assert.deepEqual(notificationRecipients, [292141127, 5879729856]);

    await bot.handleUpdate({ message: adminMessage("/start", 70, 5879729856) });
    assert.equal(api.calls.at(-1).payload.chat_id, 5879729856);
    assert.match(api.calls.at(-1).payload.text, /Панель обращений/);
  });

  test("при закрытии администратором уведомляет пользователя и освобождает диалог", async () => {
    await bot.handleMessage(userMessage("Вопрос, который можно закрыть"));
    await bot.handleCallback(callback("other"));
    await bot.handleCallback(actionCallback("confirm_request"));

    await bot.handleUpdate({ callback_query: adminCallback("admin:close:1") });

    const completion = api.calls.find((call) =>
      call.method === "sendMessage" &&
      call.payload.chat_id === "-100777" &&
      call.payload.direct_messages_topic_id === 900719925474000 &&
      /Вопрос по обращению №1 завершён/.test(call.payload.text)
    );
    assert.ok(completion, "пользователь должен получить уведомление о завершении");
    assert.equal(completion.payload.parse_mode, "HTML");
    assert.equal(storage.getTicket(1).status, "closed");
    assert.equal(storage.getConversation(-100777, 900719925474000).active_ticket_id, null);

    await bot.handleUpdate({ message: adminMessage("/start") });
    assert.match(api.calls.at(-1).payload.text, /Закрытых:<\/b> 1/);
    assert.ok(api.calls.at(-1).payload.reply_markup.inline_keyboard.flat().some((button) =>
      button.callback_data === "admin:list:closed:0" && /Закрытые · 1/.test(button.text)
    ));

    await bot.handleUpdate({ callback_query: adminCallback("admin:list:closed:0") });
    assert.match(api.calls.at(-1).payload.text, /Закрытые обращения/);
    assert.match(api.calls.at(-1).payload.text, /№1/);

    await bot.handleMessage(userMessage("Новый вопрос после закрытия"));
    assert.equal(api.calls.at(-1).payload.text, WELCOME_TEXT);
    assert.equal(storage.listTickets().length, 1);
  });

  test("сохраняет дополнение без отдельного уведомления администратора", async () => {
    await bot.handleMessage(userMessage("Первое сообщение"));
    await bot.handleCallback(callback("partnership"));
    await bot.handleCallback(actionCallback("confirm_request"));
    storage.markTicketRead(1);
    const adminMessagesBefore = api.calls.filter((call) =>
      call.method === "sendMessage" && call.payload.chat_id === 292141127
    ).length;
    await bot.handleMessage(userMessage("Дополнительная информация"));

    assert.equal(storage.listTickets().length, 1);
    assert.equal(storage.getTicket(1).message_count, 2);
    assert.equal(storage.getTicket(1).unread, 1);
    const userConfirmation = api.calls.findLast((call) =>
      call.method === "sendMessage" && call.payload.chat_id === -100777
    );
    assert.match(userConfirmation.payload.text, /Дополнение отправлено в обращение №1/);
    assert.equal(userConfirmation.payload.reply_markup, undefined);
    const adminMessagesAfter = api.calls.filter((call) =>
      call.method === "sendMessage" &&
      call.payload.chat_id === 292141127
    ).length;
    assert.equal(adminMessagesAfter, adminMessagesBefore);
    assert.deepEqual(storage.listTicketMessages(1).map((entry) => entry.text), [
      "Первое сообщение",
      "Дополнение: Дополнительная информация"
    ]);
  });

  test("экранирует разметку из пользовательского текста", async () => {
    await bot.handleMessage(userMessage("<b>не формат</b> & текст"));
    await bot.handleCallback(callback("other"));
    assert.match(api.calls.at(-1).payload.text, /&lt;b&gt;не формат&lt;\/b&gt; &amp; текст/);
    assert.equal(api.calls.at(-1).payload.parse_mode, "HTML");

    await bot.handleCallback(actionCallback("confirm_request"));
    const notification = api.calls.find((call) =>
      call.payload.chat_id === 292141127 && /Новое обращение/.test(call.payload.text)
    );
    assert.match(notification.payload.text, /&lt;b&gt;не формат&lt;\/b&gt; &amp; текст/);
  });

  test("копирует вложение после карточки, но не дублирует его описание как текст", async () => {
    const photo = userMessage();
    delete photo.text;
    photo.photo = [{ file_id: "photo-1", width: 100, height: 100 }];
    await bot.handleMessage(photo);
    await bot.handleCallback(callback("other"));
    await bot.handleCallback(actionCallback("confirm_request"));

    const notificationIndex = api.calls.findIndex((call) =>
      call.payload.chat_id === 292141127 && /Новое обращение/.test(call.payload.text)
    );
    const copyIndex = api.calls.findIndex((call) =>
      call.method === "copyMessage" && call.payload.message_id === photo.message_id
    );
    assert.ok(notificationIndex >= 0);
    assert.ok(copyIndex > notificationIndex);
    assert.equal(api.calls[copyIndex].payload.chat_id, 292141127);
  });
});
