const { Markup } = require('telegraf');
const S = require('./shared');
const { state, GIFTS, calcDisplayPrice } = S;

async function showMainMenu(ctx) {
  const userId = ctx.from.id;

  // FIX: reset semua state
  state.deleteSession(userId);
  state.awaitingBroadcast.delete(userId);
  state.pendingBroadcast.delete(userId);

  const favIds = await S.getFavorites(userId);
  const name = ctx.from.first_name || 'There';

  const buttons = [[Markup.button.callback("🎁 Gift Catalog", "menu_katalog")]];
  if (favIds.length > 0) buttons.push([Markup.button.callback("⭐ Your Favorites", "menu_favorit")]);
  buttons.push([Markup.button.callback("📜 Order History", "menu_riwayat")]);

  const text =
    `👋 Hello, *${name}*!\n\n` +
    `Welcome to *Nifz Gift* 🎁\n\n` +
    `Here you can send various exciting gifts to your friends.\n\n` +
    `Choose a menu below to get started:`;

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
      if (!g) continue;
      buttons.push([Markup.button.callback(`⭐ ${g.name} — ${calcDisplayPrice(g.price)}⭐`, `buy:${gid}`)]);
      shown.add(gid);
    }
  }

  const sorted = Object.entries(GIFTS).sort((a, b) => a[1].price - b[1].price);
  for (const [id, g] of sorted) {
    if (shown.has(id)) continue;
    buttons.push([Markup.button.callback(`${g.name} — ${calcDisplayPrice(g.price)}⭐`, `buy:${id}`)]);
  }
  buttons.push([Markup.button.callback("⬅️ Back", "menu_back")]);

  let text = "🎁 *Gift Catalog*\n\nChoose the gift you want to send:";
  if (favIds.length > 0) text += "\n\n⭐ = your favorites";

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
      "⭐ *Your Favorites*\n\nYou don't have any favorite gifts yet.\nBuy one first so it shows up here! 🎁",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎁 Gift Catalog", "menu_katalog")],
          [Markup.button.callback("⬅️ Back", "menu_back")],
        ]),
      }
    );
  }

  const buttons = favIds
    .filter(gid => GIFTS[gid])
    .map(gid => {
      const g = GIFTS[gid];
      return [Markup.button.callback(`⭐ ${g.name} — ${calcDisplayPrice(g.price)}⭐`, `buy:${gid}`)];
    });
  buttons.push([Markup.button.callback("🎁 Gift Catalog", "menu_katalog")]);
  buttons.push([Markup.button.callback("⬅️ Back", "menu_back")]);

  await S.sendOrEdit(ctx, "⭐ *Your Favorites*\n\nGifts you buy the most:", {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

function register(bot) {
  bot.command('batal', async (ctx) => {
    await S.clearPendingOrders(ctx.from.id);
    state.deleteSession(ctx.from.id);
    state.awaitingBroadcast.delete(ctx.from.id);
    state.pendingBroadcast.delete(ctx.from.id);
    await ctx.reply('✅ Session canceled. Type /start to return to the menu.');
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
    const userId = ctx.from.id;
    const userOrders = await S.getRecentOrders(userId, 10);
    const backBtn = [[Markup.button.callback("⬅️ Back", "menu_back")]];

    if (userOrders.length === 0) {
      return S.sendOrEdit(
        ctx,
        "📭 *Order History*\n\nYou haven't bought any gifts yet.\nGo pick a gift first! 🎁",
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(backBtn) }
      );
    }

    // Formatter dibuat sekali, dipakai untuk semua order
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });

    let msg = "📜 *Order History (last 10)*\n\n";
    for (const o of userOrders) {
      const icon =
        o.status === 'paid'     ? '✅' :
        o.status === 'failed'   ? '❌' :
        o.status === 'refunded' ? '💸' : '⏳';
      const date = fmt.format(new Date(o.createdAt * 1000)) + ' UTC';
      msg +=
        `${icon} *${o.giftName}* — ${o.displayPrice || o.price}⭐\n` +
        `   👤 ${o.recipientLabel}\n` +
        `   🗓️ ${date}\n` +
        `   🆔 \`${o.orderId}\`\n\n`;
    }

    await S.sendOrEdit(ctx, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(backBtn),
    });
  });
}

module.exports = { register, showMainMenu, showGiftCatalog, showFavorites };