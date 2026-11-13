/*
 * Favourite players.
 *
 * Owner decisions:
 *  - Every approved subscriber can keep their own list: /favourite Name (@handle),
 *    /unfavourite @handle, /favourites. Handles are matched case-insensitively (and
 *    with or without the @, since some sheet cells leave it out).
 *  - A favourite is "involved" only when their own entry changes: they join, leave or
 *    are swapped in a band (role, sub, other instrument, point of contact; a new or
 *    removed band counts for everyone in it), or their Player Finder entry changes.
 *  - Then the subscriber also gets "⭐ One of your favourite players has an update:
 *    Name (@handle)", sent as a reply to the update message.
 *  - Favourites override the subscriber's /settings switches: the update is sent even if
 *    that alert type is switched off.
 */

var MAX_FAVOURITES = 50;

/** The first @handle in some text, e.g. 'Oli (@Oli_X)' -> '@Oli_X'; '' if none. */
function handleFromText(text) {
  var match = String(text || '').match(/@[A-Za-z0-9_]{3,32}/);
  return match ? match[0] : '';
}

/** Comparison key for a handle: lower case, without the @. */
function handleKey(handle) {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase();
}

/** Keys for every handle written in a sheet cell (an unclear cell can hold several). */
function handleKeysInCell(text) {
  return (String(text || '').match(/@?[A-Za-z0-9_]{3,32}/g) || []).map(handleKey);
}

/** The people whose own entry changed in this change (owner decision: 2a). */
function peopleWhoseEntryChanged(change) {
  var people = [];
  var add = function (p) { if (p) people.push(p); };
  var wholeBand = function (b) {
    add(b.pointOfContact);
    b.members.forEach(add);
    b.substitutions.forEach(add);
    b.otherInstruments.forEach(add);
  };
  switch (change.type) {
    case 'band_added':
    case 'band_removed':
      wholeBand(change.band);
      break;
    case 'band_changed':
      change.changes.forEach(function (c) {
        if (c.field === 'role' || c.field === 'substitution' || c.field === 'pointOfContact') {
          add(c.before);
          add(c.after);
        } else if (c.field === 'otherInstrument') {
          add(c.entry);
        }
      });
      break;
    case 'player_added':
    case 'player_removed':
      add(change.player);
      break;
    case 'player_changed':
      add(change.previous);
      add(change.player);
      break;
  }
  return people;
}

/** The subscriber's favourites involved in a change: [{ key, person }], one per favourite. */
function favouritesInChange(change, favourites) {
  var keys = (favourites || []).map(handleKey);
  if (!keys.length) return [];
  var seen = {};
  var hits = [];
  peopleWhoseEntryChanged(change).forEach(function (person) {
    handleKeysInCell(person.handle).forEach(function (key) {
      if (keys.indexOf(key) >= 0 && !seen[key]) {
        seen[key] = true;
        hits.push({ key: key, person: person });
      }
    });
  });
  return hits;
}

/** The ⭐ message for the favourites involved in an update. */
function favouriteNotice(hits) {
  return '⭐ One of your favourite players has an update: ' +
    hits.map(function (h) { return tplPerson(h.person); }).join(', ');
}

/** The /favourites message and its remove buttons. */
function favouritesMessage(favourites) {
  if (!favourites || !favourites.length) {
    return {
      text: '<b>[Your Favourites]</b>\nNo favourites yet. Add one with /favourite Name (@handle).',
      replyMarkup: null
    };
  }
  return {
    text: '<b>[Your Favourites]</b>\n' + favourites.map(function (h) { return '⭐ ' + tplEscape(h); }).join('\n') +
      '\n\nTap a button to remove one.',
    replyMarkup: {
      inline_keyboard: favourites.map(function (h) {
        return [{ text: '❌ ' + h, callback_data: 'unfav:' + handleKey(h) }];
      })
    }
  };
}
