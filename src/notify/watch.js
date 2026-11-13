/*
 * Watching bands.
 *
 * Owner decisions:
 *  - Every approved subscriber can watch bands: /watch one-song 3, /unwatch one-song 3,
 *    /watching (the list, with remove and Close buttons).
 *  - Every update for a watched band is sent, even if that alert type is switched off
 *    in /settings.
 *  - Each of those updates is followed by "👀 You're watching One-song band #3" as a
 *    reply to it.
 *  - Only bands in the sheet right now can be added. A watched band that is removed from
 *    the sheet stays in the list until it's removed with /unwatch or /watching.
 */

var MAX_WATCHED_BANDS = 30;

/** 'one-song 3', '1-song #3', 'two song band 4' -> 'one-song#3' / 'two-song#4'; '' if none. */
function bandIdFromText(text) {
  var m = String(text || '').match(/\b(one|two|1|2)[\s-]*songs?\b\D*?(\d+)/i);
  if (!m) return '';
  return (/^(one|1)$/i.test(m[1]) ? 'one-song' : 'two-song') + '#' + String(Number(m[2]));
}

/** 'one-song#3' -> 'One-song band #3' */
function watchedBandLabel(id) {
  var parts = String(id).split('#');
  return (parts[0] === 'one-song' ? 'One-song band' : 'Two-song band') + ' #' + parts[1];
}

/** True if the change is about a band in the list. */
function changeIsWatched(change, watching) {
  return !!(change.band && watching && watching.length && watching.indexOf(change.band.id) >= 0);
}

/** The 👀 reply sent after an update for a watched band. */
function watchNotice(change) {
  return '👀 You\'re watching ' + tplEscape(watchedBandLabel(change.band.id));
}

/** The /watching message and its remove buttons (the bot adds Close). */
function watchingMessage(watching) {
  if (!watching || !watching.length) {
    return {
      text: '<b>[Watched Bands]</b>\nYou aren\'t watching any bands. Add one with /watch one-song 3.',
      replyMarkup: null
    };
  }
  return {
    text: '<b>[Watched Bands]</b>\n' + watching.map(function (id) { return '👀 ' + tplEscape(watchedBandLabel(id)); }).join('\n') +
      '\n\nTap a button to stop watching one.',
    replyMarkup: {
      inline_keyboard: watching.map(function (id) {
        return [{ text: '❌ ' + watchedBandLabel(id), callback_data: 'unwatch:' + id }];
      })
    }
  };
}

/** /watch <band> */
function watchCommand(ctx, sub, chatId, args) {
  var id = bandIdFromText(args);
  if (!id) {
    botSend(ctx, chatId, 'Say which band, e.g. /watch one-song 3 or /watch two-song 4.');
    return;
  }
  sub.watching = sub.watching || [];
  if (sub.watching.indexOf(id) >= 0) {
    botSend(ctx, chatId, 'You\'re already watching ' + tplEscape(watchedBandLabel(id)) + '.');
    return;
  }
  var band = null;
  ((ctx.state.snapshot && ctx.state.snapshot.bands) || []).forEach(function (b) { if (b.id === id) band = b; });
  if (!band) {
    botSend(ctx, chatId, 'There\'s no ' + tplEscape(watchedBandLabel(id)) + ' in the sheet right now.');
    return;
  }
  if (sub.watching.length >= MAX_WATCHED_BANDS) {
    botSend(ctx, chatId, 'You\'re already watching ' + MAX_WATCHED_BANDS + ' bands. Remove one with /watching first.');
    return;
  }
  sub.watching.push(id);
  botSend(ctx, chatId, '👀 Now watching:\n' + tplBandLine(band).replace(/^- /, '') + '\n' +
    'You\'ll get every update for this band, even if that alert type is off in /settings.');
}

/** /unwatch <band> */
function unwatchCommand(ctx, sub, chatId, args) {
  var id = bandIdFromText(args);
  var before = (sub.watching || []).length;
  sub.watching = (sub.watching || []).filter(function (w) { return w !== id; });
  botSend(ctx, chatId, id && sub.watching.length < before
    ? 'Stopped watching ' + tplEscape(watchedBandLabel(id)) + '.'
    : 'You aren\'t watching that band. See your list with /watching.');
}
