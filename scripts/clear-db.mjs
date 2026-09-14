import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

if (!process.argv.includes("--yes")) {
  throw new Error("Очистка отменена: добавьте обязательный флаг --yes");
}

const databasePath = resolve(process.argv.find((argument) => argument.endsWith(".sqlite3")) || "./data/bot.sqlite3");
const db = new DatabaseSync(databasePath);

try {
  db.exec(`
    BEGIN IMMEDIATE;
    DELETE FROM ticket_messages;
    DELETE FROM giveaway_claims;
    DELETE FROM tickets;
    DELETE FROM conversations;
    DELETE FROM admin_reply_sessions;
    DELETE FROM sqlite_sequence
      WHERE name IN ('ticket_messages', 'giveaway_claims', 'tickets');
    COMMIT;
    VACUUM;
  `);

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM conversations) AS conversations,
      (SELECT COUNT(*) FROM tickets) AS tickets,
      (SELECT COUNT(*) FROM ticket_messages) AS messages,
      (SELECT COUNT(*) FROM giveaway_claims) AS claims
  `).get();
  console.log(JSON.stringify({ databasePath, ...counts }));
} finally {
  db.close();
}
