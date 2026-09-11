import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const WELCOME_TEXT = "<b>Здравствуйте!</b>\nПо какому вопросу вы обращаетесь?";
export const CLOSED_TICKET_ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_SWEEP_INTERVAL_MS = 60 * 1000;

export const MENU_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "🛒 Проблемы с заказом", callback_data: "section:order" },
      { text: "🤝 Сотрудничество", callback_data: "section:partnership" }
    ],
    [
      { text: "🎁 Розыгрыш", callback_data: "section:giveaway" },
      { text: "💬 Другой вопрос", callback_data: "section:other" }
    ],
    [{ text: "📰 Предложить новость", callback_data: "section:news" }]
  ]
};

export const NEW_REQUEST_KEYBOARD = {
  inline_keyboard: [
    [{ text: "← Новое обращение", callback_data: "action:new_request" }]
  ]
};

export const GIVEAWAY_CONFIRM_KEYBOARD = {
  inline_keyboard: [
    [{ text: "✅ Подтвердить отправку", callback_data: "action:confirm_request" }],
    [
      { text: "✏️ Изменить сообщение", callback_data: "action:edit_request" },
      { text: "➕ Дополнить сообщение", callback_data: "action:append_request" }
    ],
    [
      { text: "👤 Изменить данные", callback_data: "action:edit_giveaway" },
      { text: "📂 Изменить раздел", callback_data: "action:change_section" }
    ],
    [{ text: "❌ Отменить", callback_data: "action:cancel_request" }]
  ]
};

export const REQUEST_CONFIRM_KEYBOARD = {
  inline_keyboard: [
    [{ text: "✅ Подтвердить отправку", callback_data: "action:confirm_request" }],
    [
      { text: "✏️ Изменить сообщение", callback_data: "action:edit_request" },
      { text: "➕ Дополнить сообщение", callback_data: "action:append_request" }
    ],
    [
      { text: "📂 Изменить раздел", callback_data: "action:change_section" },
      { text: "❌ Отменить", callback_data: "action:cancel_request" }
    ]
  ]
};

export const GIVEAWAY_DETAILS_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "✏️ Изменить сообщение", callback_data: "action:edit_request" },
      { text: "➕ Дополнить сообщение", callback_data: "action:append_request" }
    ],
    [
      { text: "📂 Изменить раздел", callback_data: "action:change_section" },
      { text: "❌ Отменить", callback_data: "action:cancel_request" }
    ]
  ]
};

export const TICKET_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "➕ Дополнить", callback_data: "action:add_details" },
      { text: "✏️ Исправить", callback_data: "action:correct_ticket" }
    ],
    [
      { text: "📋 Статус", callback_data: "action:ticket_status" },
      { text: "✅ Закрыть", callback_data: "action:close_ticket" }
    ]
  ]
};

const SECTION_REPLIES = {
  order: "По проблемам с заказом обратитесь в службу поддержки @KUPIKOD_bot.",
  partnership: "Расскажите, пожалуйста, о себе или компании и кратко опишите предложение о сотрудничестве.",
  other: "Пожалуйста, кратко опишите ваш вопрос — администратор ответит в этом диалоге.",
  news: "Пришлите текст новости, ссылку на источник и при необходимости фото или другие материалы.",
  giveaway: "<b>🎁 Данные для розыгрыша</b>\n\nЕсли вы победили, отправьте одним сообщением:\n\n<b>• Telegram username</b>\n<b>• ID Kupikod</b>\n<b>• Ссылка на розыгрыш</b>\n<b>• Какое место вы заняли</b>\n\n<b>Пример:</b>\n<code>@username\nID Kupikod: 123456\nСсылка: https://t.me/channel/123\nМесто: 1</code>"
};

const SECTION_LABELS = {
  order: "Проблемы с заказом",
  partnership: "Сотрудничество",
  other: "Другой вопрос",
  news: "Предложить новость",
  giveaway: "Розыгрыш"
};

const SECTION_ICONS = {
  order: "🛒",
  partnership: "🤝",
  other: "💬",
  news: "📰",
  giveaway: "🎁"
};

const ORDER_SUPPORT_KEYBOARD = {
  inline_keyboard: [
    [{ text: "🛟 Написать в поддержку", url: "https://t.me/KUPIKOD_bot" }],
    [{ text: "← Вернуться", callback_data: "action:change_section" }]
  ]
};

function submittedTicketKeyboard(section) {
  const rows = [];
  if (section === "order") {
    rows.push([{ text: "🛟 Перейти в поддержку", url: "https://t.me/KUPIKOD_bot" }]);
  }
  rows.push([
    { text: "➕ Дополнить заявку", callback_data: "action:add_details" },
    { text: "✏️ Исправить заявку", callback_data: "action:correct_ticket" }
  ]);
  return { inline_keyboard: rows };
}

export class TelegramApiError extends Error {
  constructor(method, response) {
    super(`Telegram API ${method}: ${response.description ?? "unknown error"}`);
    this.name = "TelegramApiError";
    this.errorCode = response.error_code;
    this.parameters = response.parameters;
  }
}

export class TelegramApi {
  constructor(token, fetchImpl = globalThis.fetch) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fetch = fetchImpl;
  }

  async call(method, payload = {}) {
    const response = await this.fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new TelegramApiError(method, result);
    }
    return result.result;
  }
}

export class Storage {
  constructor(filePath = ":memory:") {
    if (filePath !== ":memory:") {
      mkdirSync(dirname(resolve(filePath)), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        chat_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        welcomed_at INTEGER,
        state TEXT NOT NULL DEFAULT 'idle',
        chosen_section TEXT,
        active_ticket_id INTEGER,
        pending_message_id INTEGER,
        pending_message_text TEXT,
        pending_message_at INTEGER,
        pending_message_copy INTEGER NOT NULL DEFAULT 0,
        pending_username TEXT,
        pending_kupikod_id TEXT,
        pending_giveaway_details TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, topic_id)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        telegram_user_id TEXT NOT NULL,
        sender_username TEXT,
        sender_first_name TEXT,
        sender_last_name TEXT,
        channel_id TEXT,
        channel_title TEXT,
        channel_username TEXT,
        section TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        unread INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_text TEXT,
        last_message_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        direction TEXT NOT NULL,
        telegram_message_id INTEGER,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS giveaway_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        telegram_user_id TEXT NOT NULL,
        ticket_id INTEGER,
        username TEXT NOT NULL,
        kupikod_id TEXT,
        details TEXT,
        giveaway_url TEXT,
        place TEXT,
        submitted_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS giveaway_claims_topic
      ON giveaway_claims (chat_id, topic_id, submitted_at);

      CREATE INDEX IF NOT EXISTS tickets_topic
      ON tickets (chat_id, topic_id, created_at);

      CREATE INDEX IF NOT EXISTS ticket_messages_ticket
      ON ticket_messages (ticket_id, created_at);
    `);

    const conversationColumns = this.db.prepare("PRAGMA table_info(conversations)").all();
    for (const [name, type] of [
      ["active_ticket_id", "INTEGER"],
      ["pending_message_id", "INTEGER"],
      ["pending_message_text", "TEXT"],
      ["pending_message_at", "INTEGER"],
      ["pending_message_copy", "INTEGER NOT NULL DEFAULT 0"],
      ["pending_username", "TEXT"],
      ["pending_kupikod_id", "TEXT"],
      ["pending_giveaway_details", "TEXT"]
    ]) {
      if (!conversationColumns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${type}`);
      }
    }

    const claimColumns = this.db.prepare("PRAGMA table_info(giveaway_claims)").all();
    for (const [name, type] of [
      ["kupikod_id", "TEXT"], ["ticket_id", "INTEGER"], ["details", "TEXT"],
      ["giveaway_url", "TEXT"], ["place", "TEXT"]
    ]) {
      if (!claimColumns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE giveaway_claims ADD COLUMN ${name} ${type}`);
      }
    }

    const ticketColumns = this.db.prepare("PRAGMA table_info(tickets)").all();
    for (const [name, definition] of [
      ["sender_username", "TEXT"],
      ["sender_first_name", "TEXT"],
      ["sender_last_name", "TEXT"],
      ["channel_id", "TEXT"],
      ["channel_title", "TEXT"],
      ["channel_username", "TEXT"],
      ["unread", "INTEGER NOT NULL DEFAULT 0"],
      ["archived", "INTEGER NOT NULL DEFAULT 0"],
      ["message_count", "INTEGER NOT NULL DEFAULT 0"],
      ["last_message_text", "TEXT"],
      ["last_message_at", "INTEGER"]
    ]) {
      if (!ticketColumns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${definition}`);
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS tickets_inbox
      ON tickets (archived, unread, updated_at)
    `);
  }

  getConversation(chatId, topicId) {
    return this.db.prepare(`
      SELECT welcomed_at, state, chosen_section, active_ticket_id,
             pending_message_id, pending_message_text, pending_message_at,
             pending_message_copy, pending_username, pending_kupikod_id,
             pending_giveaway_details, updated_at
      FROM conversations
      WHERE chat_id = ? AND topic_id = ?
    `).get(String(chatId), String(topicId));
  }

  markWelcomed(chatId, topicId, now) {
    this.db.prepare(`
      INSERT INTO conversations (chat_id, topic_id, welcomed_at, state, updated_at)
      VALUES (?, ?, ?, 'idle', ?)
      ON CONFLICT(chat_id, topic_id) DO UPDATE SET
        welcomed_at = excluded.welcomed_at,
        updated_at = excluded.updated_at
    `).run(String(chatId), String(topicId), now, now);
  }

  setPendingRequest(context, message, now) {
    const messageText = describeMessage(message);
    const shouldCopy = !message.text ? 1 : 0;
    const messageAt = message.date ? message.date * 1000 : now;
    this.db.prepare(`
      INSERT INTO conversations
        (chat_id, topic_id, state, chosen_section, pending_message_id,
         pending_message_text, pending_message_at, pending_message_copy,
          pending_username, pending_kupikod_id, pending_giveaway_details, updated_at)
      VALUES (?, ?, 'awaiting_section', NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?)
      ON CONFLICT(chat_id, topic_id) DO UPDATE SET
        state = 'awaiting_section', chosen_section = NULL,
        pending_message_id = excluded.pending_message_id,
        pending_message_text = excluded.pending_message_text,
        pending_message_at = excluded.pending_message_at,
        pending_message_copy = excluded.pending_message_copy,
        pending_username = NULL, pending_kupikod_id = NULL,
        pending_giveaway_details = NULL,
        updated_at = excluded.updated_at
    `).run(
      String(context.chatId), String(context.topicId), message.message_id,
      messageText, messageAt, shouldCopy, now
    );
  }

  updatePendingRequestMessage(context, message, messageText, state, now, shouldCopy) {
    this.db.prepare(`
      UPDATE conversations SET state = ?, pending_message_id = ?,
        pending_message_text = ?, pending_message_at = ?, pending_message_copy = ?,
        updated_at = ? WHERE chat_id = ? AND topic_id = ?
    `).run(
      state,
      message.message_id,
      messageText,
      message.date ? message.date * 1000 : now,
      shouldCopy ? 1 : 0,
      now,
      String(context.chatId),
      String(context.topicId)
    );
  }

  selectPendingSection(chatId, topicId, section, state, now) {
    this.db.prepare(`
      UPDATE conversations SET chosen_section = ?, state = ?, updated_at = ?
      WHERE chat_id = ? AND topic_id = ?
    `).run(section, state, now, String(chatId), String(topicId));
  }

  clearPendingRequest(chatId, topicId, now) {
    this.db.prepare(`
      UPDATE conversations SET state = 'idle', chosen_section = NULL,
        pending_message_id = NULL, pending_message_text = NULL,
        pending_message_at = NULL, pending_message_copy = 0,
        pending_username = NULL, pending_kupikod_id = NULL,
        pending_giveaway_details = NULL, updated_at = ?
      WHERE chat_id = ? AND topic_id = ?
    `).run(now, String(chatId), String(topicId));
  }

  startTicket(context, user, section, state, now) {
    const { chatId, topicId } = context;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`
        INSERT INTO tickets
          (chat_id, topic_id, telegram_user_id, sender_username, sender_first_name,
           sender_last_name, channel_title, section, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `).run(
        String(chatId), String(topicId), String(user.id), user.username ?? null,
        user.first_name ?? null, user.last_name ?? null, context.chatTitle ?? null,
        section, now, now
      );
      const ticketId = Number(result.lastInsertRowid);

      this.db.prepare(`
        INSERT INTO conversations
          (chat_id, topic_id, state, chosen_section, active_ticket_id,
           pending_username, pending_kupikod_id, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(chat_id, topic_id) DO UPDATE SET
          state = excluded.state,
          chosen_section = excluded.chosen_section,
          active_ticket_id = excluded.active_ticket_id,
          pending_message_id = NULL,
          pending_message_text = NULL,
          pending_message_at = NULL,
          pending_message_copy = 0,
          pending_username = NULL,
          pending_kupikod_id = NULL,
          pending_giveaway_details = NULL,
          updated_at = excluded.updated_at
      `).run(String(chatId), String(topicId), state, section, ticketId, now);
      this.db.exec("COMMIT");
      return ticketId;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateTicketChannel(ticketId, channel) {
    this.db.prepare(`
      UPDATE tickets SET channel_id = ?, channel_title = ?, channel_username = ?
      WHERE id = ?
    `).run(
      channel?.id == null ? null : String(channel.id),
      channel?.title ?? null,
      channel?.username ?? null,
      ticketId
    );
  }

  recordTicketMessage(ticketId, direction, messageId, text, now, { unread = false } = {}) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO ticket_messages
          (ticket_id, direction, telegram_message_id, text, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(ticketId, direction, messageId ?? null, text, now);
      this.db.prepare(`
        UPDATE tickets SET message_count = message_count + 1,
          last_message_text = ?, last_message_at = ?, updated_at = ?,
          unread = CASE WHEN ? THEN 1 ELSE unread END
        WHERE id = ?
      `).run(text, now, now, unread ? 1 : 0, ticketId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setConversationState(chatId, topicId, state, now, { clearPending = false } = {}) {
    this.db.prepare(`
      UPDATE conversations SET
        state = ?,
        pending_username = CASE WHEN ? THEN NULL ELSE pending_username END,
        pending_kupikod_id = CASE WHEN ? THEN NULL ELSE pending_kupikod_id END,
        pending_giveaway_details = CASE WHEN ? THEN NULL ELSE pending_giveaway_details END,
        updated_at = ?
      WHERE chat_id = ? AND topic_id = ?
    `).run(
      state, clearPending ? 1 : 0, clearPending ? 1 : 0, clearPending ? 1 : 0,
      now, String(chatId), String(topicId)
    );
  }

  setPendingGiveaway(chatId, topicId, username, kupikodId, details, now) {
    this.db.prepare(`
      UPDATE conversations SET
        state = 'awaiting_giveaway_confirmation',
        pending_username = ?, pending_kupikod_id = ?, pending_giveaway_details = ?, updated_at = ?
      WHERE chat_id = ? AND topic_id = ?
    `).run(username, kupikodId, details, now, String(chatId), String(topicId));
  }

  saveGiveawayClaim(
    chatId, topicId, userId, ticketId, username, kupikodId,
    details, giveawayUrl, place, now
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO giveaway_claims
          (chat_id, topic_id, telegram_user_id, ticket_id, username, kupikod_id,
           details, giveaway_url, place, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(chatId), String(topicId), String(userId), ticketId,
        username, kupikodId, details, giveawayUrl, place, now
      );

      this.db.prepare(`
        UPDATE conversations
        SET state = 'idle', pending_username = NULL, pending_kupikod_id = NULL,
            pending_giveaway_details = NULL,
            updated_at = ?
        WHERE chat_id = ? AND topic_id = ?
      `).run(now, String(chatId), String(topicId));
      this.db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?")
        .run(now, ticketId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  touchActiveTicket(chatId, topicId, now) {
    const conversation = this.getConversation(chatId, topicId);
    if (!conversation?.active_ticket_id) return null;
    this.db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ? AND status = 'open'")
      .run(now, conversation.active_ticket_id);
    this.setConversationState(chatId, topicId, "idle", now);
    return conversation.active_ticket_id;
  }

  getActiveTicket(chatId, topicId) {
    return this.db.prepare(`
      SELECT t.id, t.section, t.status, t.created_at, t.updated_at
      FROM tickets t
      JOIN conversations c ON c.active_ticket_id = t.id
      WHERE c.chat_id = ? AND c.topic_id = ?
    `).get(String(chatId), String(topicId));
  }

  getTicket(ticketId) {
    return this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
  }

  markTicketRead(ticketId) {
    this.db.prepare("UPDATE tickets SET unread = 0 WHERE id = ?").run(ticketId);
  }

  setTicketArchived(ticketId, archived, now) {
    this.db.prepare(`
      UPDATE tickets SET archived = ?, unread = 0, updated_at = ? WHERE id = ?
    `).run(archived ? 1 : 0, now, ticketId);
  }

  closeTicket(ticketId, now) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE tickets SET status = 'closed', unread = 0, closed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, ticketId);
      this.db.prepare(`
        UPDATE conversations SET state = 'idle', chosen_section = NULL,
          active_ticket_id = NULL, pending_message_id = NULL,
          pending_message_text = NULL, pending_message_at = NULL,
          pending_message_copy = 0, pending_username = NULL, pending_kupikod_id = NULL,
          pending_giveaway_details = NULL,
          updated_at = ? WHERE active_ticket_id = ?
      `).run(now, ticketId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  archiveClosedTickets(now, delayMs = CLOSED_TICKET_ARCHIVE_DELAY_MS) {
    const cutoff = now - delayMs;
    const result = this.db.prepare(`
      UPDATE tickets
      SET archived = 1, unread = 0, updated_at = ?
      WHERE status = 'closed' AND archived = 0
        AND closed_at IS NOT NULL AND closed_at <= ?
    `).run(now, cutoff);
    return Number(result.changes);
  }

  reopenTicket(ticketId, now) {
    const ticket = this.getTicket(ticketId);
    if (!ticket) return null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE tickets SET status = 'open', archived = 0, closed_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, ticketId);
      this.db.prepare(`
        INSERT INTO conversations
          (chat_id, topic_id, state, chosen_section, active_ticket_id, updated_at)
        VALUES (?, ?, 'idle', ?, ?, ?)
        ON CONFLICT(chat_id, topic_id) DO UPDATE SET
          state = 'idle', chosen_section = excluded.chosen_section,
          active_ticket_id = excluded.active_ticket_id, updated_at = excluded.updated_at
      `).run(ticket.chat_id, ticket.topic_id, ticket.section, ticketId, now);
      this.db.exec("COMMIT");
      return ticket;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  inboxCounts() {
    return this.db.prepare(`
      SELECT
        SUM(CASE WHEN unread = 1 AND archived = 0 THEN 1 ELSE 0 END) AS unread,
        SUM(CASE WHEN status = 'open' AND archived = 0 THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status = 'closed' AND archived = 0 THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS archived
      FROM tickets
    `).get();
  }

  sectionCounts() {
    return this.db.prepare(`
      SELECT section, COUNT(*) AS count FROM tickets
      WHERE archived = 0 AND status = 'open'
      GROUP BY section
    `).all();
  }

  listInbox({ mode = "open", section = null, limit = 8, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (mode === "archive") clauses.push("archived = 1");
    else {
      clauses.push("archived = 0");
      if (mode === "new") clauses.push("unread = 1");
      if (mode === "open") clauses.push("status = 'open'");
      if (mode === "closed") clauses.push("status = 'closed'");
    }
    if (section) {
      clauses.push("section = ?");
      params.push(section);
    }
    params.push(limit, offset);
    return this.db.prepare(`
      SELECT * FROM tickets WHERE ${clauses.join(" AND ")}
      ORDER BY created_at ASC, id ASC
      LIMIT ? OFFSET ?
    `).all(...params);
  }

  countInbox({ mode = "open", section = null } = {}) {
    const clauses = [];
    const params = [];
    if (mode === "archive") clauses.push("archived = 1");
    else {
      clauses.push("archived = 0");
      if (mode === "new") clauses.push("unread = 1");
      if (mode === "open") clauses.push("status = 'open'");
      if (mode === "closed") clauses.push("status = 'closed'");
    }
    if (section) {
      clauses.push("section = ?");
      params.push(section);
    }
    return this.db.prepare(`
      SELECT COUNT(*) AS count FROM tickets WHERE ${clauses.join(" AND ")}
    `).get(...params).count;
  }

  listTicketMessages(ticketId, limit = 20) {
    return this.db.prepare(`
      SELECT direction, text, created_at FROM (
        SELECT id, direction, text, created_at FROM ticket_messages
        WHERE ticket_id = ? ORDER BY id DESC LIMIT ?
      ) ORDER BY id
    `).all(ticketId, limit);
  }

  closeActiveTicket(chatId, topicId, now) {
    const ticket = this.getActiveTicket(chatId, topicId);
    if (ticket) {
      this.db.prepare(`
        UPDATE tickets SET status = 'closed', unread = 0, closed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, ticket.id);
    }
    this.db.prepare(`
      UPDATE conversations SET state = 'idle', chosen_section = NULL,
        active_ticket_id = NULL, pending_message_id = NULL,
        pending_message_text = NULL, pending_message_at = NULL,
        pending_message_copy = 0, pending_username = NULL, pending_kupikod_id = NULL,
        pending_giveaway_details = NULL,
        updated_at = ? WHERE chat_id = ? AND topic_id = ?
    `).run(now, String(chatId), String(topicId));
    return ticket;
  }

  listGiveawayClaims() {
    return this.db.prepare(`
      SELECT chat_id, topic_id, telegram_user_id, ticket_id, username, kupikod_id,
             details, giveaway_url, place, submitted_at
      FROM giveaway_claims ORDER BY id
    `).all();
  }

  listTickets() {
    return this.db.prepare(`
      SELECT id, chat_id, topic_id, telegram_user_id, section, status,
             created_at, updated_at, closed_at
      FROM tickets ORDER BY id
    `).all();
  }

  close() {
    this.db.close();
  }
}

function directMessageContext(message) {
  const topic = message?.direct_messages_topic;
  if (!message?.chat?.id || !topic?.topic_id || !topic?.user?.id) return null;
  return {
    chatId: message.chat.id,
    topicId: topic.topic_id,
    ownerId: topic.user.id,
    owner: topic.user,
    chatTitle: message.chat.title ?? null
  };
}

function describeMessage(message, fallback = "") {
  const text = message?.text ?? message?.caption ?? fallback;
  if (text) return text;
  if (message?.photo) return "[Фотография]";
  if (message?.video) return "[Видео]";
  if (message?.document) return `[Документ${message.document.file_name ? `: ${message.document.file_name}` : ""}]`;
  if (message?.audio) return "[Аудио]";
  if (message?.voice) return "[Голосовое сообщение]";
  if (message?.video_note) return "[Видеосообщение]";
  if (message?.sticker) return "[Стикер]";
  if (message?.animation) return "[Анимация]";
  if (message?.location) return "[Геолокация]";
  if (message?.contact) return "[Контакт]";
  return "[Сообщение без текста]";
}

function formatDate(timestampMs) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestampMs));
}

function displayUser(ticket) {
  if (ticket.sender_username) return `@${ticket.sender_username}`;
  const name = [ticket.sender_first_name, ticket.sender_last_name].filter(Boolean).join(" ");
  return name || `ID ${ticket.telegram_user_id}`;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizeUsername(text) {
  if (typeof text !== "string") return null;
  const candidate = text.trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i, "@");
  const match = candidate.match(/^@?([A-Za-z0-9_]{5,32})$/);
  return match ? `@${match[1]}` : null;
}

export function parseGiveawayClaim(text) {
  if (typeof text !== "string") return null;
  const input = text.trim();
  if (!input) return null;
  const atUsernameMatch = input.match(/@([A-Za-z0-9_]{5,32})\b/i);
  const usernameLinkMatch = input.match(
    /https?:\/\/(?:www\.)?t\.me\/([A-Za-z0-9_]{5,32})\/?(?=$|[\s,;])/i
  );
  const usernameMatch = atUsernameMatch ?? usernameLinkMatch;
  const idMatch = input.match(
    /(?:ID\s*Kupikod|Kupikod\s*ID|айди\s*(?:Kupikod|купикод[а]?)?|ID)\s*[:#№-]?\s*([A-Za-zА-Яа-яЁё0-9_-]{2,64})/iu
  );
  const urls = input.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  const usernameUrl = usernameMatch?.[0].startsWith("http") ? usernameMatch[0] : null;
  const giveawayUrl = urls.find((url) =>
    !usernameUrl || url.toLowerCase() !== usernameUrl.toLowerCase()
  )?.replace(/[.,;!?]+$/, "") ?? null;
  const labeledPlace = input.match(
    /(?:место|place)\s*[:#№-]?\s*([A-Za-zА-Яа-яЁё0-9_-]{1,30})/iu
  );
  const naturalPlace = input.match(
    /(?:занял(?:а)?\s*)?(\d{1,4}|первое|второе|третье)\s*(?:-?[её])?\s+место/iu
  );
  const place = labeledPlace?.[1] ?? naturalPlace?.[1] ?? null;

  return {
    username: usernameMatch ? `@${usernameMatch[1]}` : "Не указан отдельно",
    kupikodId: idMatch?.[1] ?? null,
    giveawayUrl,
    place,
    details: truncateText(input, 1000)
  };
}

export class ChannelDirectMessagesBot {
  constructor({ api, storage, adminUserId = null, adminUserIds = [], now = () => Date.now() }) {
    this.api = api;
    this.storage = storage;
    this.adminUserIds = new Set(
      [...adminUserIds, adminUserId].filter((id) => id != null).map(Number)
    );
    this.adminReplyTicketIds = new Map();
    this.channelCache = new Map();
    this.now = now;
  }

  async sendToTopic(context, text, extra = {}) {
    return this.api.call("sendMessage", {
      chat_id: context.chatId,
      direct_messages_topic_id: context.topicId,
      text,
      ...extra
    });
  }

  async notifyTicketClosed(ticket) {
    await this.api.call("sendMessage", {
      chat_id: ticket.chat_id,
      direct_messages_topic_id: Number(ticket.topic_id),
      text: `<b>✅ Вопрос по обращению №${ticket.id} завершён</b>\n\nЕсли появится новый вопрос, просто отправьте следующее сообщение — бот покажет меню.`,
      parse_mode: "HTML"
    });
  }

  async sendWelcome(context, now) {
    await this.sendToTopic(context, WELCOME_TEXT, {
      parse_mode: "HTML",
      reply_markup: MENU_KEYBOARD
    });
    this.storage.markWelcomed(context.chatId, context.topicId, now);
  }

  async sendOrderSupportRedirect(context, now) {
    this.storage.selectPendingSection(
      context.chatId, context.topicId, null, "awaiting_section", now
    );
    await this.sendToTopic(
      context,
      `<b>🛟 С проблемами по заказу — в службу поддержки</b>\n\nМы не являемся службой поддержки и не рассматриваем проблемы с заказами здесь. Напишите напрямую в <a href="https://t.me/KUPIKOD_bot">@KUPIKOD_bot</a>.`,
      { parse_mode: "HTML", reply_markup: ORDER_SUPPORT_KEYBOARD }
    );
  }

  async sendPendingConfirmation(context, conversation) {
    const section = conversation.chosen_section;
    if (section === "giveaway") {
      const details = conversation.pending_giveaway_details || [
        conversation.pending_username,
        conversation.pending_kupikod_id
      ].filter(Boolean).join(", ");
      if (!details) {
        await this.sendToTopic(context, SECTION_REPLIES.giveaway, {
          parse_mode: "HTML",
          reply_markup: GIVEAWAY_DETAILS_KEYBOARD
        });
        return;
      }
      await this.sendToTopic(
        context,
        `<b>Проверьте обращение перед отправкой</b>\n\n<b>Тип:</b> 🎁 Розыгрыш\n<b>Сообщение:</b>\n<blockquote>${escapeHtml(truncateText(conversation.pending_message_text, 700))}</blockquote>\n<b>Данные победителя:</b>\n<blockquote>${escapeHtml(details)}</blockquote>\n\nВсё верно?`,
        { parse_mode: "HTML", reply_markup: GIVEAWAY_CONFIRM_KEYBOARD }
      );
      return;
    }
    await this.sendToTopic(
      context,
      `<b>Подтвердите отправку обращения</b>\n\n<b>Тип:</b> ${SECTION_ICONS[section]} ${escapeHtml(SECTION_LABELS[section])}\n<b>Сообщение:</b>\n<blockquote>${escapeHtml(truncateText(conversation.pending_message_text, 700))}</blockquote>`,
      { parse_mode: "HTML", reply_markup: REQUEST_CONFIRM_KEYBOARD }
    );
  }

  async resolveChannel(context) {
    if (this.channelCache.has(String(context.chatId))) {
      return this.channelCache.get(String(context.chatId));
    }
    let channel = { id: context.chatId, title: context.chatTitle || "Канал", username: null };
    try {
      const chat = await this.api.call("getChat", { chat_id: context.chatId });
      channel = chat.parent_chat ?? {
        id: chat.id,
        title: chat.title || context.chatTitle || "Канал",
        username: chat.username ?? null
      };
    } catch (error) {
      console.error("Не удалось определить исходный канал:", error.message);
    }
    this.channelCache.set(String(context.chatId), channel);
    return channel;
  }

  async recordAndNotify(ticketId, context, message, textOverride = "") {
    const timestamp = message?.date ? message.date * 1000 : this.now();
    const text = textOverride || describeMessage(message);
    this.storage.recordTicketMessage(
      ticketId, "user", message?.message_id ?? null, text, timestamp, { unread: true }
    );
    const recordedTicket = this.storage.getTicket(ticketId);
    if (this.adminUserIds.size === 0 || recordedTicket?.message_count > 1) return;

    try {
      const channel = await this.resolveChannel(context);
      this.storage.updateTicketChannel(ticketId, channel);
      const ticket = this.storage.getTicket(ticketId);
      const channelName = channel.username ? `${channel.title} (@${channel.username})` : channel.title;
      const notificationTitle = `🔔 Новое обращение №${ticketId}`;
      for (const adminId of this.adminUserIds) {
        try {
          await this.api.call("sendMessage", {
            chat_id: adminId,
            parse_mode: "HTML",
            text: `<b>${notificationTitle}</b>\n\n<b>Тип:</b> ${SECTION_ICONS[ticket.section]} ${escapeHtml(SECTION_LABELS[ticket.section])}\n<b>Канал:</b> 📣 ${escapeHtml(channelName)}\n<b>От кого:</b> 👤 ${escapeHtml(displayUser(ticket))}\n<b>Telegram ID:</b> <code>${escapeHtml(ticket.telegram_user_id)}</code>\n<b>Дата:</b> 🕐 ${escapeHtml(formatDate(timestamp))} МСК\n\n<b>Сообщение:</b>\n<blockquote>${escapeHtml(truncateText(text, 500))}</blockquote>`,
            reply_markup: {
              inline_keyboard: [[
                { text: `📂 Открыть №${ticketId}`, callback_data: `admin:view:${ticketId}` },
                { text: "✍️ Ответить", callback_data: `admin:reply:${ticketId}` }
              ]]
            }
          });

          const shouldCopyOriginal = message && (
            message.copyOriginal === true ||
            (message.copyOriginal === undefined && !message.text)
          );
          if (shouldCopyOriginal) {
            await this.api.call("copyMessage", {
              chat_id: adminId,
              from_chat_id: context.chatId,
              message_id: message.message_id
            });
          }
        } catch (error) {
          console.error(`Не удалось уведомить администратора ${adminId} об обращении №${ticketId}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`Не удалось подготовить уведомление об обращении №${ticketId}:`, error.message);
    }
  }

  async sendAdmin(adminId, text, replyMarkup = null) {
    const payload = { chat_id: adminId, text, parse_mode: "HTML" };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    return this.api.call("sendMessage", payload);
  }

  async sendAdminDashboard(adminId) {
    const counts = this.storage.inboxCounts();
    const bySection = Object.fromEntries(
      this.storage.sectionCounts().map((row) => [row.section, row.count])
    );
    await this.sendAdmin(
      adminId,
      `<b>📬 Панель обращений</b>\n\n<b>🆕 Новых:</b> ${counts.unread ?? 0}\n<b>📂 Открытых:</b> ${counts.open ?? 0}\n<b>✅ Закрытых:</b> ${counts.closed ?? 0}\n<b>🗄 В архиве:</b> ${counts.archived ?? 0}\n\nВыберите список:`,
      {
        inline_keyboard: [
          [
            { text: `🆕 Новые · ${counts.unread ?? 0}`, callback_data: "admin:list:new:0" },
            { text: `📂 Открытые · ${counts.open ?? 0}`, callback_data: "admin:list:open:0" }
          ],
          [
            { text: `✅ Закрытые · ${counts.closed ?? 0}`, callback_data: "admin:list:closed:0" },
            { text: `🗄 Архив · ${counts.archived ?? 0}`, callback_data: "admin:list:archive:0" }
          ],
          [
            { text: `🛒 Проблемы с заказом · ${bySection.order ?? 0}`, callback_data: "admin:cat:order:0" },
            { text: `🎁 Розыгрыши · ${bySection.giveaway ?? 0}`, callback_data: "admin:cat:giveaway:0" }
          ],
          [
            { text: `🤝 Сотрудничество · ${bySection.partnership ?? 0}`, callback_data: "admin:cat:partnership:0" },
            { text: `💬 Другие · ${bySection.other ?? 0}`, callback_data: "admin:cat:other:0" }
          ],
          [
            { text: `📰 Предложить новость · ${bySection.news ?? 0}`, callback_data: "admin:cat:news:0" }
          ],
          [
            { text: "🔄 Обновить", callback_data: "admin:home" }
          ]
        ]
      }
    );
  }

  async sendAdminList(adminId, { mode = "open", section = null, page = 0 }) {
    const pageSize = 8;
    const offset = page * pageSize;
    const tickets = this.storage.listInbox({ mode, section, limit: pageSize, offset });
    const total = this.storage.countInbox({ mode, section });
    const title = section
      ? `Раздел: ${SECTION_LABELS[section]}`
      : ({
          new: "Новые обращения",
          open: "Открытые обращения",
          closed: "Закрытые обращения",
          archive: "Архив"
        })[mode];
    const lines = tickets.map((ticket) => {
      const marker = ticket.unread ? "●" : "○";
      const preview = (ticket.last_message_text || "Ожидаются подробности")
        .replace(/\s+/g, " ").slice(0, 70);
      return `<b>${marker} №${ticket.id} · ${SECTION_ICONS[ticket.section]} ${escapeHtml(SECTION_LABELS[ticket.section])}</b>\n👤 ${escapeHtml(displayUser(ticket))}\n<blockquote>${escapeHtml(preview)}</blockquote>`;
    });
    const keyboard = tickets.map((ticket) => [{
      text: `${ticket.unread ? "●" : "○"} №${ticket.id} · ${SECTION_ICONS[ticket.section]} ${SECTION_LABELS[ticket.section]} · ${displayUser(ticket)}`.slice(0, 60),
      callback_data: `admin:view:${ticket.id}`
    }]);

    const navigation = [];
    const prefix = section ? `admin:cat:${section}` : `admin:list:${mode}`;
    if (page > 0) navigation.push({ text: "← Назад", callback_data: `${prefix}:${page - 1}` });
    if (offset + tickets.length < total) {
      navigation.push({ text: "Далее →", callback_data: `${prefix}:${page + 1}` });
    }
    if (navigation.length) keyboard.push(navigation);
    keyboard.push([{ text: "🏠 Главная", callback_data: "admin:home" }]);

    await this.sendAdmin(
      adminId,
      `<b>${escapeHtml(title)}</b>\nВсего: <b>${total}</b>\n\n${lines.length ? lines.join("\n") : "Здесь пока пусто."}`,
      { inline_keyboard: keyboard }
    );
  }

  async sendAdminTicket(adminId, ticketId) {
    this.storage.markTicketRead(ticketId);
    const ticket = this.storage.getTicket(ticketId);
    if (!ticket) {
      await this.sendAdmin(adminId, "Обращение не найдено.", {
        inline_keyboard: [[{ text: "Главная", callback_data: "admin:home" }]]
      });
      return;
    }
    const channel = ticket.channel_title || "Канал пока не определён";
    const channelLabel = ticket.channel_username
      ? `${channel} (@${ticket.channel_username})`
      : channel;
    const status = ticket.status === "open" ? "Открыто" : "Закрыто";
    const archive = ticket.archived ? "Да" : "Нет";
    const historyBlocks = this.storage.listTicketMessages(ticketId).map((entry) => {
      const author = entry.direction === "admin" ? "Вы" : "Пользователь";
      return `<b>${author} · ${formatDate(entry.created_at)}</b>\n<blockquote>${escapeHtml(truncateText(entry.text, 400))}</blockquote>`;
    });
    let omittedHistory = false;
    while (historyBlocks.join("\n").length > 2800 && historyBlocks.length > 1) {
      historyBlocks.shift();
      omittedHistory = true;
    }
    const history = `${omittedHistory ? "Более ранние сообщения скрыты…\n" : ""}${historyBlocks.join("\n")}`;
    const keyboard = [
      [{ text: "✍️ Ответить", callback_data: `admin:reply:${ticket.id}` }],
      [
        ticket.status === "open"
          ? { text: "✅ Закрыть", callback_data: `admin:close:${ticket.id}` }
          : { text: "🔁 Возобновить", callback_data: `admin:reopen:${ticket.id}` },
        ticket.archived
          ? { text: "📤 Вернуть из архива", callback_data: `admin:restore:${ticket.id}` }
          : { text: "🗄 В архив", callback_data: `admin:archive:${ticket.id}` }
      ],
      [{ text: "🏠 Главная", callback_data: "admin:home" }]
    ];
    await this.sendAdmin(
      adminId,
      `<b>${SECTION_ICONS[ticket.section]} Обращение №${ticket.id}</b>\n\n<b>Тип:</b> ${SECTION_ICONS[ticket.section]} ${escapeHtml(SECTION_LABELS[ticket.section])}\n<b>Канал:</b> 📣 ${escapeHtml(channelLabel)}\n<b>От кого:</b> 👤 ${escapeHtml(displayUser(ticket))}\n<b>Telegram ID:</b> <code>${escapeHtml(ticket.telegram_user_id)}</code>\n<b>Дата:</b> 🕐 ${escapeHtml(formatDate(ticket.created_at))} МСК\n<b>Статус:</b> ${ticket.status === "open" ? "🟢" : "⚪️"} ${status}\n<b>Архив:</b> ${ticket.archived ? "🗄" : "—"} ${archive}\n<b>Сообщений:</b> 💬 ${ticket.message_count}\n\n<b>📜 История — последние 20:</b>\n${history || "Сообщений пока нет."}`,
      { inline_keyboard: keyboard }
    );
  }

  async relayAdminReply(message) {
    const adminId = message.from.id;
    const ticketId = this.adminReplyTicketIds.get(adminId);
    const ticket = this.storage.getTicket(ticketId);
    if (!ticket) {
      this.adminReplyTicketIds.delete(adminId);
      await this.sendAdmin(adminId, "Обращение больше не найдено.");
      return;
    }
    try {
      await this.api.call("copyMessage", {
        chat_id: ticket.chat_id,
        direct_messages_topic_id: Number(ticket.topic_id),
        from_chat_id: adminId,
        message_id: message.message_id
      });
    } catch (error) {
      if (!message.text) throw error;
      await this.api.call("sendMessage", {
        chat_id: ticket.chat_id,
        direct_messages_topic_id: Number(ticket.topic_id),
        text: message.text
      });
    }
    const now = this.now();
    this.storage.reopenTicket(ticketId, now);
    this.storage.recordTicketMessage(
      ticketId, "admin", message.message_id, describeMessage(message), now
    );
    this.adminReplyTicketIds.delete(adminId);
    await this.sendAdmin(adminId, `Ответ отправлен пользователю в обращение №${ticketId}.`, {
      inline_keyboard: [[
        { text: "Открыть обращение", callback_data: `admin:view:${ticketId}` },
        { text: "Главная", callback_data: "admin:home" }
      ]]
    });
  }

  async handlePrivateMessage(message) {
    const adminId = message.from?.id;
    if (!this.adminUserIds.has(adminId)) {
      await this.api.call("sendMessage", {
        chat_id: message.chat.id,
        text: "Для обращения в поддержку напишите напрямую каналу."
      });
      return;
    }
    const text = message.text ?? "";
    if (/^\/cancel(?:@\w+)?(?:\s|$)/i.test(text)) {
      this.adminReplyTicketIds.delete(adminId);
      await this.sendAdmin(adminId, "Ответ отменён.");
      await this.sendAdminDashboard(adminId);
      return;
    }
    if (/^\/(?:start|admin|inbox)(?:@\w+)?(?:\s|$)/i.test(text)) {
      this.adminReplyTicketIds.delete(adminId);
      await this.sendAdminDashboard(adminId);
      return;
    }
    if (this.adminReplyTicketIds.has(adminId)) {
      await this.relayAdminReply(message);
      return;
    }
    await this.sendAdminDashboard(adminId);
  }

  async handleAdminCallback(callback) {
    await this.api.call("answerCallbackQuery", { callback_query_id: callback.id });
    const parts = callback.data.split(":");
    const command = parts[1];
    const adminId = callback.from.id;
    const now = this.now();

    if (command === "home") return this.sendAdminDashboard(adminId);
    if (command === "list") {
      return this.sendAdminList(adminId, { mode: parts[2], page: Number(parts[3] || 0) });
    }
    if (command === "cat") {
      return this.sendAdminList(adminId, {
        mode: "open", section: parts[2], page: Number(parts[3] || 0)
      });
    }

    const ticketId = Number(parts[2]);
    if (!Number.isInteger(ticketId)) return this.sendAdminDashboard(adminId);
    if (command === "view") return this.sendAdminTicket(adminId, ticketId);
    if (command === "reply") {
      const ticket = this.storage.getTicket(ticketId);
      if (!ticket) return this.sendAdmin(adminId, "Обращение не найдено.");
      this.adminReplyTicketIds.set(adminId, ticketId);
      return this.sendAdmin(
        adminId,
        `Отправьте ответ для обращения №${ticketId}. Можно прислать текст, фото или документ. Для отмены — /cancel.`
      );
    }
    if (command === "archive") this.storage.setTicketArchived(ticketId, true, now);
    if (command === "restore") this.storage.setTicketArchived(ticketId, false, now);
    if (command === "close") {
      const ticket = this.storage.getTicket(ticketId);
      if (ticket?.status === "open") {
        this.storage.closeTicket(ticketId, now);
        await this.notifyTicketClosed(ticket);
      }
      return this.sendAdminTicket(adminId, ticketId);
    }
    if (command === "reopen") this.storage.reopenTicket(ticketId, now);
    return this.sendAdminTicket(adminId, ticketId);
  }

  async handleMessage(message) {
    const context = directMessageContext(message);
    if (!context) return;

    // В topic также могут писать администраторы. Реагируем только на владельца обращения.
    if (message.from?.is_bot || message.from?.id !== context.ownerId) return;

    const now = this.now();
    const conversation = this.storage.getConversation(context.chatId, context.topicId);
    const text = message.text ?? message.caption ?? "";

    if (/^\/(?:start|menu)(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (conversation?.pending_message_text) await this.sendWelcome(context, now);
      else await this.sendToTopic(context, "Сначала напишите текст обращения — после этого появится меню выбора раздела.");
      return;
    }

    if (["awaiting_request_text_edit", "awaiting_request_text_append"]
      .includes(conversation?.state)) {
      const newPart = describeMessage(message);
      const isAppend = conversation.state === "awaiting_request_text_append";
      const updatedText = isAppend
        ? `${conversation.pending_message_text}\n\nДополнение: ${newPart}`
        : newPart;
      const nextState = conversation.chosen_section === "giveaway"
        ? "awaiting_giveaway_confirmation"
        : "awaiting_request_confirmation";
      this.storage.updatePendingRequestMessage(
        context, message, updatedText, nextState, now, !message.text
      );
      await this.sendPendingConfirmation(
        context,
        this.storage.getConversation(context.chatId, context.topicId)
      );
      return;
    }

    if (["awaiting_giveaway_username", "awaiting_giveaway_details", "awaiting_giveaway_confirmation"]
      .includes(conversation?.state)) {
      const claim = parseGiveawayClaim(text);
      if (!claim) {
        await this.sendToTopic(
          context,
          "Пришлите одним текстовым сообщением Telegram username, ID Kupikod, ссылку на розыгрыш и занятое место — по шаблону выше.",
          { reply_markup: GIVEAWAY_DETAILS_KEYBOARD }
        );
        return;
      }

      this.storage.setPendingGiveaway(
        context.chatId, context.topicId,
        claim.username, claim.kupikodId, claim.details, now
      );
      await this.sendPendingConfirmation(
        context,
        this.storage.getConversation(context.chatId, context.topicId)
      );
      return;
    }

    if (["awaiting_ticket_details", "awaiting_ticket_addition", "awaiting_ticket_correction"]
      .includes(conversation?.state)) {
      const ticket = this.storage.getActiveTicket(context.chatId, context.topicId);
      if (!ticket) {
        this.storage.clearPendingRequest(context.chatId, context.topicId, now);
        await this.sendToTopic(context, "Открытое обращение не найдено.");
        return;
      }
      const prefix = conversation.state === "awaiting_ticket_correction"
        ? "Исправление"
        : conversation.state === "awaiting_ticket_addition" ? "Дополнение" : "Сообщение";
      await this.recordAndNotify(
        ticket.id, context, message, `${prefix}: ${describeMessage(message)}`
      );
      const ticketId = this.storage.touchActiveTicket(context.chatId, context.topicId, now);
      if (ticketId) {
        await this.sendToTopic(
          context,
          `<b>${prefix} отправлено в обращение №${ticketId}</b>\nАдминистратор увидит обновление в истории.`,
          { parse_mode: "HTML", reply_markup: submittedTicketKeyboard(ticket.section) }
        );
      }
      return;
    }

    if (conversation?.active_ticket_id) {
      const activeTicket = this.storage.getActiveTicket(context.chatId, context.topicId);
      if (activeTicket?.status === "open") {
        await this.recordAndNotify(
          activeTicket.id, context, message, `Дополнение: ${describeMessage(message)}`
        );
        this.storage.touchActiveTicket(context.chatId, context.topicId, now);
        this.storage.clearPendingRequest(context.chatId, context.topicId, now);
        await this.sendToTopic(
          context,
          `<b>➕ Дополнение отправлено в обращение №${activeTicket.id}</b>\nАдминистратор увидит его в истории.`,
          { parse_mode: "HTML" }
        );
        return;
      }
    }

    this.storage.setPendingRequest(context, message, now);
    await this.sendWelcome(context, now);
  }

  async handleCallback(callback) {
    const context = directMessageContext(callback.message);
    const action = callback.data?.startsWith("action:")
      ? callback.data.slice("action:".length)
      : null;
    const knownActions = new Set([
      "new_request", "confirm_request", "confirm_giveaway", "edit_giveaway",
      "edit_request", "append_request", "change_section", "cancel_request",
      "add_details", "correct_ticket", "ticket_status", "close_ticket"
    ]);
    const section = callback.data?.startsWith("section:")
      ? callback.data.slice("section:".length)
      : null;

    if (!context || (!knownActions.has(action) && !SECTION_REPLIES[section])) {
      await this.api.call("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Эта кнопка больше недоступна"
      });
      return;
    }

    if (callback.from?.id !== context.ownerId) {
      await this.api.call("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Кнопка доступна только автору обращения",
        show_alert: true
      });
      return;
    }

    await this.api.call("answerCallbackQuery", { callback_query_id: callback.id });
    const now = this.now();

    if (action === "new_request") {
      this.storage.clearPendingRequest(context.chatId, context.topicId, now);
      await this.sendToTopic(context, "Напишите текст нового обращения — после этого появится меню выбора раздела.");
      return;
    }

    const conversation = this.storage.getConversation(context.chatId, context.topicId);

    if (action === "confirm_request" || action === "confirm_giveaway") {
      if (!conversation?.pending_message_text || !SECTION_LABELS[conversation.chosen_section]) {
        await this.sendToTopic(context, "Это сообщение уже отправлено или отменено.");
        return;
      }
      if (conversation.chosen_section === "order") {
        await this.sendOrderSupportRedirect(context, now);
        return;
      }
      if (conversation.chosen_section === "giveaway" &&
          !parseGiveawayClaim(conversation.pending_giveaway_details || "")) {
        await this.sendToTopic(context, SECTION_REPLIES.giveaway, {
          parse_mode: "HTML",
          reply_markup: GIVEAWAY_DETAILS_KEYBOARD
        });
        return;
      }

      const pending = { ...conversation };
      const parsedGiveaway = pending.chosen_section === "giveaway"
        ? parseGiveawayClaim(pending.pending_giveaway_details || "")
        : null;
      const ticketId = this.storage.startTicket(
        context, callback.from, pending.chosen_section, "idle", now
      );
      if (pending.chosen_section === "giveaway") {
        this.storage.saveGiveawayClaim(
          context.chatId, context.topicId, callback.from.id, ticketId,
          parsedGiveaway.username, parsedGiveaway.kupikodId,
          parsedGiveaway.details, parsedGiveaway.giveawayUrl, parsedGiveaway.place,
          now
        );
      }
      await this.recordAndNotify(
        ticketId,
        context,
        {
          message_id: pending.pending_message_id,
          date: Math.floor(pending.pending_message_at / 1000),
          copyOriginal: Boolean(pending.pending_message_copy)
        },
        pending.chosen_section === "giveaway"
          ? `${pending.pending_message_text}\n\nДанные победителя: ${pending.pending_giveaway_details || [
              pending.pending_username, pending.pending_kupikod_id
            ].filter(Boolean).join(", ")}`
          : pending.pending_message_text
      );
      await this.sendToTopic(
        context,
        pending.chosen_section === "order"
          ? `<b>✅ Обращение №${ticketId} отправлено</b>\n\nПомощь по заказам предоставляет служба поддержки — <a href="https://t.me/KUPIKOD_bot">@KUPIKOD_bot</a>.`
          : `<b>✅ Обращение №${ticketId} отправлено</b>\nАдминистратор ответит здесь.`,
        { parse_mode: "HTML", reply_markup: submittedTicketKeyboard(pending.chosen_section) }
      );
      return;
    }

    if (action === "edit_request" || action === "append_request") {
      if (!conversation?.pending_message_text || !conversation.chosen_section) {
        await this.sendToTopic(context, "Нет ожидающего отправки обращения.");
        return;
      }
      const state = action === "edit_request"
        ? "awaiting_request_text_edit"
        : "awaiting_request_text_append";
      this.storage.setConversationState(context.chatId, context.topicId, state, now);
      await this.sendToTopic(
        context,
        action === "edit_request"
          ? "Отправьте новый текст обращения — он заменит предыдущий."
          : "Отправьте дополнение одним сообщением — оно будет добавлено к текущему тексту.",
        { reply_markup: NEW_REQUEST_KEYBOARD }
      );
      return;
    }

    if (action === "change_section") {
      if (!conversation?.pending_message_text) {
        await this.sendToTopic(context, "Сначала напишите текст обращения.");
        return;
      }
      this.storage.setConversationState(
        context.chatId, context.topicId, "awaiting_section", now, { clearPending: true }
      );
      this.storage.selectPendingSection(context.chatId, context.topicId, null, "awaiting_section", now);
      await this.sendWelcome(context, now);
      return;
    }

    if (action === "cancel_request") {
      this.storage.clearPendingRequest(context.chatId, context.topicId, now);
      await this.sendToTopic(context, "Отправка обращения отменена.");
      return;
    }

    if (action === "edit_giveaway") {
      if (!conversation?.pending_message_text || conversation.chosen_section !== "giveaway") {
        await this.sendToTopic(context, "Нет данных для изменения.");
        return;
      }
      this.storage.setConversationState(
        context.chatId, context.topicId, "awaiting_giveaway_details", now,
        { clearPending: true }
      );
      await this.sendToTopic(context, SECTION_REPLIES.giveaway, {
        parse_mode: "HTML",
        reply_markup: GIVEAWAY_DETAILS_KEYBOARD
      });
      return;
    }

    if (action === "add_details") {
      const ticket = this.storage.getActiveTicket(context.chatId, context.topicId);
      if (!ticket || ticket.status !== "open") {
        await this.sendToTopic(context, "Нет открытого обращения.", {
          reply_markup: NEW_REQUEST_KEYBOARD
        });
        return;
      }
      this.storage.setConversationState(
        context.chatId, context.topicId, "awaiting_ticket_addition", now
      );
      await this.sendToTopic(
        context,
        `Отправьте дополнительную информацию для обращения №${ticket.id} одним сообщением или вложением.`,
        { reply_markup: NEW_REQUEST_KEYBOARD }
      );
      return;
    }

    if (action === "correct_ticket") {
      const ticket = this.storage.getActiveTicket(context.chatId, context.topicId);
      if (!ticket || ticket.status !== "open") {
        await this.sendToTopic(context, "Нет открытого обращения для исправления.");
        return;
      }
      this.storage.setConversationState(
        context.chatId, context.topicId, "awaiting_ticket_correction", now
      );
      await this.sendToTopic(
        context,
        `Отправьте исправленный текст для обращения №${ticket.id}. Он появится в истории как исправление.`
      );
      return;
    }

    if (action === "ticket_status") {
      const ticket = this.storage.getActiveTicket(context.chatId, context.topicId);
      if (!ticket) {
        await this.sendToTopic(context, "Сейчас у вас нет открытого обращения.", {
          reply_markup: NEW_REQUEST_KEYBOARD
        });
        return;
      }
      await this.sendToTopic(
        context,
        `Обращение №${ticket.id}\nРаздел: ${SECTION_LABELS[ticket.section]}\nСтатус: ${ticket.status === "open" ? "Открыто" : "Закрыто"}`,
        { reply_markup: TICKET_KEYBOARD }
      );
      return;
    }

    if (action === "close_ticket") {
      const ticket = this.storage.closeActiveTicket(context.chatId, context.topicId, now);
      await this.sendToTopic(
        context,
        ticket
          ? `<b>✅ Вопрос по обращению №${ticket.id} завершён</b>\n\nСледующее сообщение создаст новое обращение.`
          : "Открытого обращения уже нет.",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!conversation?.pending_message_text) {
      await this.sendToTopic(context, "Сначала напишите текст обращения — после этого выберите раздел.");
      return;
    }

    if (section === "order") {
      await this.sendOrderSupportRedirect(context, now);
      return;
    }

    if (section === "giveaway") {
      this.storage.selectPendingSection(
        context.chatId, context.topicId, section, "awaiting_giveaway_details", now
      );
      await this.sendToTopic(context, SECTION_REPLIES.giveaway, {
        parse_mode: "HTML",
        reply_markup: GIVEAWAY_DETAILS_KEYBOARD
      });
      return;
    }

    this.storage.selectPendingSection(
      context.chatId, context.topicId, section, "awaiting_request_confirmation", now
    );
    await this.sendPendingConfirmation(
      context,
      this.storage.getConversation(context.chatId, context.topicId)
    );
  }

  async handleUpdate(update) {
    if (update.callback_query) {
      const callback = update.callback_query;
      if (callback.data?.startsWith("admin:") &&
          this.adminUserIds.has(callback.from?.id) &&
          callback.message?.chat?.type === "private") {
        return this.handleAdminCallback(callback);
      }
      return this.handleCallback(callback);
    }
    if (update.message?.chat?.type === "private") {
      return this.handlePrivateMessage(update.message);
    }
    if (update.message) return this.handleMessage(update.message);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Не задана обязательная переменная окружения ${name}`);
  return value;
}

function parseAdminUserId(value) {
  if (!value) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("ADMIN_USER_ID должен быть положительным числом");
  }
  return id;
}

function parseAdminUserIds(value) {
  if (!value) return [];
  return [...new Set(
    value.split(/[\s,;]+/).filter(Boolean).map(parseAdminUserId)
  )];
}

export async function run() {
  if (existsSync(".env")) loadEnvFile(".env");
  const token = requiredEnvironment("TELEGRAM_BOT_TOKEN");
  const dbPath = process.env.BOT_DB_PATH?.trim() || "./data/bot.sqlite3";
  const logLevel = process.env.LOG_LEVEL?.trim() || "info";
  const api = new TelegramApi(token);
  const storage = new Storage(dbPath);
  const bot = new ChannelDirectMessagesBot({
    api,
    storage,
    adminUserIds: parseAdminUserIds(
      process.env.ADMIN_USER_IDS || process.env.ADMIN_USER_ID
    )
  });

  let running = true;
  let offset = 0;
  let nextArchiveSweepAt = 0;
  const stop = () => { running = false; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const me = await api.call("getMe");
  console.log(`Бот @${me.username} запущен и ожидает личные сообщения канала.`);

  try {
    while (running) {
      const sweepNow = Date.now();
      if (sweepNow >= nextArchiveSweepAt) {
        try {
          const archivedCount = storage.archiveClosedTickets(sweepNow);
          if (archivedCount > 0) {
            console.log(`В архив автоматически перенесено обращений: ${archivedCount}.`);
          }
        } catch (error) {
          console.error("Ошибка автоматической архивации:", error.message);
        }
        nextArchiveSweepAt = sweepNow + ARCHIVE_SWEEP_INTERVAL_MS;
      }
      try {
        const updates = await api.call("getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message", "callback_query"]
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await bot.handleUpdate(update);
          } catch (error) {
            console.error(`Ошибка обработки update ${update.update_id}:`, error.message);
            if (logLevel === "debug") console.error(error);
          }
        }
      } catch (error) {
        console.error("Ошибка получения обновлений:", error.message);
        if (!running) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000));
      }
    }
  } finally {
    storage.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
