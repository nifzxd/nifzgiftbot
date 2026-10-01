const { Markup } = require('telegraf');
const S = require('./shared');
const { state, GIFTS, calcDisplayPrice } = S;

async function showMainMenu(ctx) {
  const userId = ctx.from.id;
  const favIds = await S.getFavorites(userId);
  const name = ctx.from.first_name || 'Kak';

  const buttons = [[Markup.button.callback("🎁 Katalog Gift", "menu_katalog")]];
  if (favIds.length > 0) buttons.push([Markup.button.callback("⭐ Favorit Kamu", "menu_favorit")]);
  buttons.push([Markup.button.callback("📜 Riwayat Order", "menu_riwayat")]);

  const text =
    `👋 Halo, *${name}*!\n\n` +
    `Selamat datang di *Nifz Gift* 🎁\n\n` +
    `Di sini kamu bisa mengirim berbagai gift menarik ke teman-temanmu.\n\n` +
    `Pilih menu di bawah untuk mulai:`;

  await S.sendOrEdit(ctx, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

async function showGiftCatalog(ctx) {
  const userId = ctx.from.id;
  const favIds = await S.getFavorites(userId);
  const shown = new Set();
  const buttons = [];

  if (favIds.length > 0) {
    for (const gid of favIds) {
      const g = GIFTS[gid];
      buttons.push([Markup.button.callback(`⭐ ${g.name} — ${calcDisplayPrice(g.price)}⭐`, `buy:${gid}`)]);
      shown.add(gid);
    }
  }

  const sorted = Object.entries(GIFTS).sort((a, b) => a[1].price - b[1].price);
  for (const [id, g] of sorted) {
    if (shown.has(id)) continue;
    buttons.push([Markup.button.callback(`${g.name} — ${calcDisplayPrice(g.price)}⭐`, `buy:${id}`)]);
  }
  buttons.push([Markup.button.callback("⬅️ Kembali", "menu_back")]);

  let text = "🎁 *Katalog Gift*\n\nPilih gift yang ingin kamu kirim:";
  if (favIds.length > 0) text += "\n\n⭐ = favorit kamu";

  await S.sendOrEdit(ctx, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

async function showFavorites(ctx) {
  const userId = ctx.from.id;
  const favIds = await S.getFavorites(userId);

  if (favIds.length === 0) {
    return S.sendOrEdit(
      ctx,
      "⭐ *Favorit Kamu*\n\nKamu belum punya gift favorit.\nYuk beli dulu biar muncul di sini! 🎁",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎁 Katalog Gift", "menu_katalog")],
          [Markup.button.callback("⬅️ Kembali", "menu_back")],
        ]),
      }
    );
  }

  const buttons = favIds.map(gid => {
    const g = GIFTS[gid];
    return [Markup.button.callback(`⭐ ${g.name} — ${calcDisplayPrice(g.price)}⭐`, `buy:${gid}`)];
  });
  buttons.push([Markup.button.callback("🎁 Katalog Gift", "menu_katalog")]);
  buttons.push([Markup.button.callback("⬅️ Kembali", "menu_back")]);

  await S.sendOrEdit(ctx, "⭐ *Favorit Kamu*\n\nGift yang paling sering kamu beli:", {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

function register(bot) {
  // === /batal — escape hatch untuk semua flow ===
  bot.command('batal', async (ctx) => {
    if (await S.clearPendingOrders(ctx.from.id) > 0) await S.saveDB();
    state.deleteSession(ctx.from.id);
    state.awaitingBroadcast.delete(ctx.from.id);
    state.pendingBroadcast.delete(ctx.from.id);
    await ctx.reply('✅ Sesi dibatalkan. Ketik /start untuk kembali ke menu.');
  });

  bot.action('menu_katalog', async (ctx) => {
    await ctx.answerCbQuery();
    return showGiftCatalog(ctx);
  });

  bot.action('menu_favorit', async (ctx) => {
    await ctx.answerCbQuery();
    return showFavorites(ctx);
  });

  bot.action('menu_back', async (ctx) => {
    await ctx.answerCbQuery();
    state.deleteSession(ctx.from.id);
    return showMainMenu(ctx);
  });

  bot.action('menu_riwayat', async (ctx) => {
    await ctx.answerCbQuery();
    const db = await S.loadDB();
    const userId = String(ctx.from.id);

    const userOrders = Object.entries(db.orders)
      .filter(([_, o]) => String(o.userId) === userId)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, 10);

    const backBtn = [[Markup.button.callback("⬅️ Kembali", "menu_back")]];

    if (userOrders.length === 0) {
      return S.sendOrEdit(
        ctx,
        "📭 *Riwayat Order*\n\nKamu belum pernah membeli gift.\nYuk pilih gift dulu! 🎁",
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(backBtn) }
      );
    }

    let msg = "📜 *Riwayat Order (10 terakhir)*\n\n";
    for (const [orderId, o] of userOrders) {
      const icon =
        o.status === 'paid'     ? '✅' :
        o.status === 'failed'   ? '❌' :
        o.status === 'refunded' ? '💸' : '⏳';
      const date = new Date(o.createdAt * 1000).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      msg +=
        `${icon} *${o.giftName}* — ${o.displayPrice || o.price}⭐\n` +
        `   👤 ${o.recipientLabel}\n` +
        `   🗓️ ${date}\n` +
        `   🆔 \`${orderId}\`\n\n`;
    }

    await S.sendOrEdit(ctx, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(backBtn),
    });
  });
}

module.exports = { register, showMainMenu, showGiftCatalog, showFavorites };
