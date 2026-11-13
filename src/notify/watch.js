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
  botSend(ctx, chatId, actionWatchBand(ctx.state, sub, bandIdFromText(args)).html);
}

/** /unwatch <band> */
function unwatchCommand(ctx, sub, chatId, args) {
  botSend(ctx, chatId, actionUnwatchBand(sub, bandIdFromText(args)).html);
}
