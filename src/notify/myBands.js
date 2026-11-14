/*
 * "My bands": a subscriber's own bands, found by their Telegram @handle, with no setup.
 *
 * Owner decisions:
 *  - Every band where the subscriber's Telegram @handle appears (any role, substitution,
 *    other instrument or point of contact) is treated as watched: all its updates are sent,
 *    even if that alert type is switched off. This covers a band they just left, too.
 *  - Each of those updates is followed by "🎸 You're in this band" (or "You were in this
 *    band") as a reply. If they also /watch the band, only the 🎸 reply is sent.
 *  - The "My bands" switch in /settings (on by default) turns this off.
 *  - /me lists their bands and roles (and whether they're in Player Finder).
 *  - The handle comes from their Telegram account (stored as sub.username and updated on
 *    every message, since people can change it). Without a Telegram username, nothing
 *    can be matched.
 */

/** Remembers the person's current Telegram @username on their subscriber record. */
function rememberUsername(sub, from) {
  if (!sub || !from) return;
  sub.username = from.username ? '@' + from.username : '';
}

/** Where a handle appears in a band: ['Bass', 'POC', …] (empty if not in it). */
function rolesInBand(band, key) {
  if (!band || !key) return [];
  var roles = [];
  var has = function (person) { return !!person && handleKeysInCell(person.handle).indexOf(key) >= 0; };
  band.members.forEach(function (m) { if (has(m)) roles.push(ROLE_LABELS[m.role] || m.role); });
  band.substitutions.forEach(function (s) { if (has(s)) roles.push('Sub ' + s.direction + ' ' + s.slot); });
  band.otherInstruments.forEach(function (o) { if (has(o)) roles.push('Other instrument'); });
  if (has(band.pointOfContact)) roles.push('POC');
  return roles;
}

/**
 * Is this change about one of the subscriber's bands? Returns 'in' (they're in it now),
 * 'was' (they were in it before this change), or ''.
 */
function myBandInChange(change, sub, alerts) {
  if (!change.band || !sub || !sub.username || (alerts && alerts.myBands === false)) return '';
  var key = handleKey(sub.username);
  if (change.type !== 'band_removed' && rolesInBand(change.band, key).length) return 'in';
  var before = change.type === 'band_removed' ? change.band : change.previous;
  return rolesInBand(before, key).length ? 'was' : '';
}

/** The 🎸 reply. */
function myBandNotice(how) {
  return how === 'was' ? '🎸 You were in this band' : '🎸 You\'re in this band';
}

/** The subscriber's bands in a sheet copy: [{ band, roles }], plus their Player Finder entry. */
function findMyBands(snapshot, username) {
  var key = handleKey(username);
  var bands = [];
  var player = null;
  if (snapshot && key) {
    snapshot.bands.forEach(function (b) {
      var roles = rolesInBand(b, key);
      if (roles.length) bands.push({ band: b, roles: roles });
    });
    snapshot.players.forEach(function (p) { if (!player && handleKeysInCell(p.handle).indexOf(key) >= 0) player = p; });
  }
  return { bands: bands, player: player };
}

/** The /me message. */
function myBandsMessage(snapshot, sub) {
  var header = '<b>[Your Bands]</b>\n';
  if (!sub.username) {
    return header + 'You don\'t have a Telegram username, so I can\'t find you in the sheet. ' +
      'You can set one in Telegram\'s settings.';
  }
  if (!snapshot) return header + 'The sheet hasn\'t been checked yet. Try again in a few minutes.';
  var found = findMyBands(snapshot, sub.username);
  var lines = [header + 'Matched by your Telegram handle ' + tplEscape(sub.username) + '.'];
  if (!found.bands.length) lines.push('', 'You\'re not in any band in the sheet.');
  found.bands.forEach(function (f) {
    lines.push('', tplBandCard(f.band), '<i>You: ' + tplEscape(f.roles.join(', ')) + '</i>');
  });
  if (found.player) lines.push('', 'You\'re in Player Finder: ' + tplEscape(String(found.player.instruments || '').replace(/\n/g, ', ')));
  if (found.bands.length) {
    lines.push('', '<i>You get every update for these bands, with a 🎸 reply' +
      (resolveAlerts(sub.alerts).myBands ? '' : ' (switched off in /settings)') + '.</i>');
  }
  return lines.join('\n');
}
