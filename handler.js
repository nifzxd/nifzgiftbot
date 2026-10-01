const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const S = require('./plugins/shared');

// --- boot bot ---
const bot = new Telegraf(config.BOT_TOKEN);
S.state.bot = bot;
S.state.applyConfig(config);

// --- register plugins (URUTAN PENTING) ---
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

  if (s.step) {
    await ctx.reply(
      "❓ Aku gak ngerti maksudmu.\n\n" +
      "Ketik /batal untuk membatalkan sesi, atau /start untuk kembali ke menu.",
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu Utama", "buy_cancel")]])
    ).catch(() => {});
  }
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
    ctx?.reply?.('❌ Terjadi kesalahan. Coba lagi sebentar lagi.').catch(() => {});
  } catch {}
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection:', reason);
  S.logEvent(`⚠️ *Unhandled Rejection*\n\`${String(reason).slice(0, 200)}\``).catch(() => {});
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
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
  try { await bot.stop(sig); } catch {}
  process.exit(0);
}
process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

console.log('✅ Bot gift running...');
console.log(`💰 Markup: ${S.state.MARKUP_FLAT}⭐ flat + ${S.state.MARKUP_PERCENT}%`);
console.log(`📢 Log channel: ${S.state.LOG_CHANNEL_ID || '(disabled)'}`);
console.log(`⏳ Cooldown invoice: ${S.state.INVOICE_COOLDOWN_SEC}s`);
console.log(`✍️  Max text: ${S.state.MAX_CUSTOM_TEXT_LEN} karakter`);