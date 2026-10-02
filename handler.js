const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const S = require('./plugins/shared');

// --- boot bot ---
const bot = new Telegraf(config.BOT_TOKEN);
S.state.bot = bot;
S.state.applyConfig(config);

// --- register plugins (URUTAN PENTING) ---
// ⚠️ filter HARUS di awal — karena dia pake bot.use() middleware gate
// ⚠️ filter.js sudah WHITELIST pre_checkout_query & successful_payment
const plugins = [
  require('./plugins/filter'),   // /start + captcha + middleware gate
  require('./plugins/menu'),     // menu user
  require('./plugins/order'),    // beli → invoice → payment
  require('./plugins/owner'),    // panel owner + broadcast + config
];

for (const p of plugins) p.register(bot);

// ==================== FALLBACK TEXT HANDLER ====================
// WAJIB di paling bawah — plugin di atas harus `return next()` kalau tidak handle.
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // unknown command → dibiarkan

  const s = S.getSession(ctx.from.id);
  console.warn(
    `⚠️ Unhandled text (user=${ctx.from.id}, step=${s.step || 'none'}): ${text.slice(0, 60)}`
  );

  await ctx.reply(
    s.step
      ? "❓ I don't understand that.\n\nType /batal to cancel the session, or /start to return to the menu."
      : "❓ I don't understand that.\n\nType /start to open the menu.",
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]])
  ).catch(() => {});
});

// --- start refund retry worker ---
S.startRefundWorker();

// --- global error handlers ---
bot.catch((err, ctx) => {
  const userId = ctx?.from?.id ?? 'unknown';
  console.error(`❌ Bot error (user=${userId}):`, err?.message || err);
  S.logEvent(
    `❌ *Bot Error*\n👤 \`${userId}\`\n❗ \`${String(err?.message || err).slice(0, 200)}\``
  ).catch(() => {});
  try {
    ctx?.reply?.('❌ An error occurred. Please try again in a moment.').catch(() => {});
  } catch {}
});

// Rate limit log biar gak infinite loop
let _lastRejLog = 0;
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection:', reason);
  const now = Date.now();
  if (now - _lastRejLog < 5_000) return;
  _lastRejLog = now;
  S.logEvent(`⚠️ *Unhandled Rejection*\n\`${String(reason).slice(0, 200)}\``).catch(() => {});
});

let _lastExcLog = 0;
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
  const now = Date.now();
  if (now - _lastExcLog < 5_000) return;
  _lastExcLog = now;
  S.logEvent(`💥 *Uncaught Exception*\n\`${String(err?.message || err).slice(0, 200)}\``).catch(() => {});
});

// --- launch ---
(async () => {
  try {
    await bot.launch();
  } catch (err) {
    console.error('❌ Initial launch failed:', err.message);
  }
})();

// --- heartbeat ---
let fails = 0;
const heartbeat = setInterval(async () => {
  if (S.state.restarting) return;
  try {
    await bot.telegram.getMe();
    if (fails > 0) console.log(`💚 Heartbeat OK (recovered setelah ${fails}x gagal)`);
    fails = 0;
  } catch (err) {
    fails++;
    console.error(`💔 Heartbeat fail #${fails}: ${err.message}`);
    if (fails >= 5) {
      console.log('♻️ Terlalu banyak fail — restart polling...');
      try {
        await bot.stop('HEARTBEAT');
        await new Promise(r => setTimeout(r, 1500));
        await bot.launch();
        fails = 0;
        console.log('✅ Polling re-launched');
      } catch (e) {
        console.error('❌ Re-launch failed:', e.message);
      }
    }
  }
}, 60_000);

// --- graceful shutdown ---
async function shutdown(sig) {
  console.log(`\n🛑 ${sig} — shutting down...`);
  clearInterval(heartbeat);
  try { await bot.stop(sig); } catch (e) { console.error('bot.stop error:', e.message); }
  try { await S.disconnectDB(); } catch (e) { console.error('disconnectDB error:', e.message); }
  process.exit(0);
}
process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

console.log('✅ Bot gift running...');
console.log(`💰 Markup: ${S.state.MARKUP_FLAT}⭐ flat + ${S.state.MARKUP_PERCENT}%`);
console.log(`📢 Log channel: ${S.state.LOG_CHANNEL_ID || '(disabled)'}`);
console.log(`⏳ Cooldown invoice: ${S.state.INVOICE_COOLDOWN_SEC}s`);
console.log(`✍️  Max text: ${S.state.MAX_CUSTOM_TEXT_LEN} karakter`);