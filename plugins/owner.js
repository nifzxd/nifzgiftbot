const fs = require('fs');
const { Markup } = require('telegraf');
const config = require('../config');
const S = require('./shared');
const { state, GIFTS, calcDisplayPrice, calcMarkup, CONFIG_FILE } = S;

// ==================== CONFIG SCHEMA ====================
const CONFIG_SCHEMA = {
  OWNER_ID:             { label: 'Owner ID',               type: 'number'          },
  MARKUP_FLAT:          { label: 'Markup Flat (⭐)',       type: 'number'          },
  MARKUP_PERCENT:       { label: 'Markup Persen (%)',      type: 'number'          },
  LOG_CHANNEL_ID:       { label: 'Log Channel ID',         type: 'nullable_number' },
  INVOICE_COOLDOWN_SEC: { label: 'Invoice Cooldown (dtk)', type: 'number'          },
  MAX_CUSTOM_TEXT_LEN:  { label: 'Max Custom Text',        type: 'number'          },
  BROADCAST_DELAY_MS:   { label: 'Broadcast Delay (ms)',   type: 'number'          },
};

function saveConfigFile() {
  const content =
`module.exports = {
  BOT_TOKEN: ${JSON.stringify(config.BOT_TOKEN)},
  OWNER_ID: ${config.OWNER_ID},

  MARKUP_FLAT: ${config.MARKUP_FLAT},
  MARKUP_PERCENT: ${config.MARKUP_PERCENT},

  LOG_CHANNEL_ID: ${config.LOG_CHANNEL_ID === null ? 'null' : config.LOG_CHANNEL_ID},

  INVOICE_COOLDOWN_SEC: ${config.INVOICE_COOLDOWN_SEC},
  MAX_CUSTOM_TEXT_LEN: ${config.MAX_CUSTOM_TEXT_LEN},
  BROADCAST_DELAY_MS: ${config.BROADCAST_DELAY_MS},

  MONGODB_URI: ${JSON.stringify(config.MONGODB_URI)},
  MONGODB_DB: ${JSON.stringify(config.MONGODB_DB)},
};
`;
  fs.writeFileSync(CONFIG_FILE, content);
}

function parseConfigValue(type, raw) {
  const s = String(raw).trim();
  if (type === 'nullable_number') {
    if (s === '' || s === '-' || s.toLowerCase() === 'null') return { ok: true, value: null };
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, reason: 'number' };
    return { ok: true, value: n };
  }
  if (type === 'number') {
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, reason: 'number' };
    return { ok: true, value: n };
  }
  if (type === 'string') {
    if (s.length === 0) return { ok: false, reason: 'empty' };
    return { ok: true, value: s };
  }
  return { ok: false, reason: 'unknown_type' };
}

// ==================== PANELS ====================
async function showOwnerPanel(ctx) {
  await S.sendOrEdit(ctx, "👑 *Panel Owner*\n\nPilih menu:", {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback("📊 Statistik",   "owner_stats")],
      [Markup.button.callback("🎁 Daftar Gift", "owner_listgift")],
      [Markup.button.callback("⚙️ Edit Config", "owner_config")],
      [Markup.button.callback("📣 Broadcast",   "owner_broadcast")],
      [Markup.button.callback("🏠 Menu User",   "menu_back")],
    ]),
  });
}

async function showConfigMenu(ctx) {
  const buttons = [];
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const val = config[key];
    let display = val === null ? 'null' : String(val);
    if (display.length > 18) display = display.slice(0, 15) + '…';
    buttons.push([Markup.button.callback(`${schema.label}: ${display}`, `cfg_edit:${key}`)]);
  }
  buttons.push([Markup.button.callback("⬅️ Kembali", "menu_owner")]);

  await S.sendOrEdit(
    ctx,
    "⚙️ *Edit Config*\n\nPilih field yang ingin diubah.",
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

// ==================== REGISTER ====================
function register(bot) {
  bot.command('owner', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.reply("❌ Command ini hanya untuk owner.");
    state.deleteSession(ctx.from.id);
    state.awaitingBroadcast.delete(ctx.from.id);
    state.pendingBroadcast.delete(ctx.from.id);
    return showOwnerPanel(ctx);
  });

  bot.action('menu_owner', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    await ctx.answerCbQuery();
    state.deleteSession(ctx.from.id);
    return showOwnerPanel(ctx);
  });

  // ---- Stats ----
  bot.action('owner_stats', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    await ctx.answerCbQuery();

    const db = await S.loadDB();
    const users = Object.keys(db.users).length;
    const verifiedCount = Object.values(db.users).filter(u => u.verified === true).length;
    const all = Object.values(db.orders);
    const paid     = all.filter(o => o.status === 'paid').length;
    const refunded = all.filter(o => o.status === 'refunded').length;
    const failed   = all.filter(o => o.status === 'failed').length;
    const pending  = all.filter(o => o.status === 'pending').length;

    await S.sendOrEdit(
      ctx,
      `📊 *Statistik Bot*\n\n` +
      `👥 Total User: ${users}\n` +
      `✅ Terverifikasi: ${verifiedCount}\n` +
      `🔒 Belum Verif: ${users - verifiedCount}\n\n` +
      `📦 *Order:*\n✅ Sukses: ${paid}\n💸 Refunded: ${refunded}\n❌ Failed: ${failed}\n⏳ Pending: ${pending}\n\n` +
      `⭐ Total Stars Masuk: ${db.stats.totalStars}\n💰 Total Profit: ${db.stats.totalProfit || 0}⭐\n\n` +
      `⚙️ _Markup aktif: ${state.MARKUP_FLAT}⭐ flat + ${state.MARKUP_PERCENT}%_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Kembali", "menu_owner")]]),
      }
    );
  });

  // ---- List gift ----
  bot.action('owner_listgift', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    await ctx.answerCbQuery();

    let msg = "📋 *Daftar Gift*\n\n";
    for (const [id, g] of Object.entries(GIFTS)) {
      const display = calcDisplayPrice(g.price);
      const markup = calcMarkup(g.price);
      msg += `• ${g.name}\n   cost: ${g.price}⭐ → jual: ${display}⭐ (profit ${markup}⭐)\n   \`${id}\`\n\n`;
    }

    await S.sendOrEdit(ctx, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Kembali", "menu_owner")]]),
    });
  });

  // ---- Config editor ----
  bot.action('owner_config', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    await ctx.answerCbQuery();
    return showConfigMenu(ctx);
  });

  bot.action('menu_config', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    await ctx.answerCbQuery();
    return showConfigMenu(ctx);
  });

  bot.action(/^cfg_edit:(.+)$/, async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    const key = ctx.match[1];
    const schema = CONFIG_SCHEMA[key];
    if (!schema) return ctx.answerCbQuery("❌ Field tidak ditemukan");

    await ctx.answerCbQuery();
    state.setSession(ctx.from.id, { step: 'edit_config', configKey: key });

    const currentVal = config[key];
    const shown = currentVal === null ? 'null' : String(currentVal);
    const typeHint =
      schema.type === 'nullable_number' ? 'angka atau `null` untuk kosong'
      : schema.type === 'number'        ? 'angka'
      : 'teks';

    await S.sendOrEdit(
      ctx,
      `⚙️ *Edit Config: ${schema.label}*\n\n` +
      `Nilai saat ini: \`${shown}\`\n` +
      `Tipe: ${typeHint}\n` +
      `\nKirim nilai baru:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("❌ Batal", "cfg_cancel")]]),
      }
    );
  });

  bot.action('cfg_cancel', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery("Dibatalkan");
    state.deleteSession(ctx.from.id);
    return showConfigMenu(ctx);
  });

  // ---- Broadcast ----
  bot.action('owner_broadcast', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan owner");
    await ctx.answerCbQuery();
    state.awaitingBroadcast.add(ctx.from.id);
    state.pendingBroadcast.delete(ctx.from.id);

    await S.sendOrEdit(
      ctx,
      "📣 *Broadcast*\n\nKirim pesan yang ingin kamu broadcast (bisa multi-baris).",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("❌ Batal", "bc_cancel")]]),
      }
    );
  });

  bot.action('bc_send', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery("Bukan owner");
    const text = state.pendingBroadcast.get(ctx.from.id);
    if (!text) return ctx.answerCbQuery("Tidak ada broadcast pending");

    state.pendingBroadcast.delete(ctx.from.id);
    await ctx.answerCbQuery("Mengirim...");

    const db = await S.loadDB();
    const ids = Object.keys(db.users);
    await S.sendOrEdit(ctx, `📣 Mengirim ke ${ids.length} user...`);

    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await state.bot.telegram.sendMessage(id, text); ok++; }
      catch { fail++; }
      await new Promise(r => setTimeout(r, state.BROADCAST_DELAY_MS));
    }

    await S.sendOrEdit(
      ctx,
      `✅ *Broadcast Selesai*\n\nTotal: ${ids.length}\n✅ Sukses: ${ok}\n❌ Gagal: ${fail}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Kembali", "menu_owner")]]),
      }
    );
  });

  bot.action('bc_cancel', async (ctx) => {
    if (!state.isOwner(ctx.from.id)) return ctx.answerCbQuery();
    state.pendingBroadcast.delete(ctx.from.id);
    state.awaitingBroadcast.delete(ctx.from.id);
    await ctx.answerCbQuery("Dibatalkan");
    await S.sendOrEdit(ctx, "❌ Broadcast dibatalkan.", {
      ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Kembali", "menu_owner")]]),
    });
  });

  // ---- Text dispatcher untuk owner (edit_config & broadcast) ----
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();

    const s = state.getSession(userId);

    // edit_config
    if (s.step === 'edit_config') {
      if (!state.isOwner(userId)) {
        state.deleteSession(userId);
        return next();
      }
      
      const key = s.configKey;
      const schema = CONFIG_SCHEMA[key];
      if (!schema) { state.deleteSession(userId); return ctx.reply("❌ Field tidak valid."); }

      const parsed = parseConfigValue(schema.type, text);
      if (!parsed.ok) {
        const hint =
          parsed.reason === 'number' ? 'Harus berupa angka.'
          : parsed.reason === 'empty' ? 'Tidak boleh kosong.'
          : 'Format tidak valid.';
        return ctx.reply(`❌ ${hint}\n\nCoba kirim lagi, atau tekan Batal.`, {
          ...Markup.inlineKeyboard([[Markup.button.callback("❌ Batal", "cfg_cancel")]]),
        });
      }

      const oldVal = config[key];
      config[key] = parsed.value;
      saveConfigFile();
      state.applyConfig(config);

      state.deleteSession(userId);

      const shownOld = oldVal === null ? 'null' : String(oldVal);
      const shownNew = parsed.value === null ? 'null' : String(parsed.value);

      const reply =
        `✅ *Config Diperbarui*\n\n🔑 Key: \`${key}\`\n📤 Lama: \`${shownOld}\`\n📥 Baru: \`${shownNew}\`` +
        `\n\n✨ Berlaku langsung.`;

      await S.logEvent(`⚙️ *Config diubah*\n🔑 \`${key}\`\n📤 \`${shownOld}\` → 📥 \`${shownNew}\``);

      return S.sendOrEdit(ctx, reply, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⚙️ Edit Lagi", "menu_config")],
          [Markup.button.callback("👑 Panel Owner", "menu_owner")],
        ]),
      });
    }

    // broadcast
    if (state.awaitingBroadcast.has(userId)) {
      state.awaitingBroadcast.delete(userId);
      state.pendingBroadcast.set(userId, text);
      const db = await S.loadDB();
      const total = Object.keys(db.users).length;
      const safeText = text.replace(/[_*`\[]/g, (m) => '\\' + m);
      await ctx.reply(
        `📣 *Preview Broadcast*\n\n──────────────\n${safeText}\n──────────────\n\n` +
        `👥 Akan dikirim ke *${total}* user.\nLanjut?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Kirim", "bc_send"),
             Markup.button.callback("❌ Batal", "bc_cancel")],
          ]),
        }
      );
      return;
    }

    return next();
  });
}

module.exports = { register, showOwnerPanel, showConfigMenu };