/*
 * Message for: an existing band changes (members, subs, songs, POC, Complete?).
 * Shows the whole band; anything that changed is shown as ~~old~~ → **new**.
 *
 * [Band Update]
 * - Two-song band #N · 夜の歌 / Night Song
 *
 * Song 1: 夜の歌 / Night Song — 夜バンド / Night Band
 * Song 2: …
 * POC: Name (@handle)
 * Complete: ~~No~~ → **Yes**
 *
 * Lead Guitar: ~~Old (@old)~~ → **New (@new)**
 * Bass: Name (@handle)
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.band_changed = {
  render: function (change) {
    var before = change.previous;
    var after = change.band;

    var details = [];
    for (var i = 0; i < after.songs.length; i++) {
      var b = before.songs[i];
      var a = after.songs[i];
      var same = b && sameBilingual(b.title, a.title) && sameBilingual(b.artist, a.artist);
      var text = same ? tplSong(a) : tplChange(tplSong(b), tplSong(a));
      if (text) details.push(tplSongLabel(after, i) + ': ' + text);
    }
    var oldPoc = before.pointOfContact;
    var newPoc = after.pointOfContact;
    if (!oldPoc && !newPoc) details.push('POC: —');
    else details.push(personLine('POC', oldPoc, newPoc));
    details.push('Complete: ' + (sameText(before.completion, after.completion)
      ? tplInline(after.completion) || '—'
      : tplChange(tplInline(before.completion), tplInline(after.completion))));

    var roster = [];
    var find = function (list, test) {
      for (var j = 0; j < list.length; j++) if (test(list[j])) return list[j];
      return null;
    };

    ROLE_HEADERS.forEach(function (role) {
      var match = function (m) { return m.role === role; };
      var o = find(before.members, match);
      var n = find(after.members, match);
      if (o || n) roster.push(personLine(tplRoleLabel(role), o, n));
    });

    [[1, 'in'], [2, 'in'], [1, 'out'], [2, 'out']].forEach(function (slot) {
      var match = function (s) { return s.slot === slot[0] && s.direction === slot[1]; };
      var o = find(before.substitutions, match);
      var n = find(after.substitutions, match);
      if (o || n) roster.push(personLine(tplSubLabel(slot[0], slot[1]), o, n));
    });

    // Other instruments are a set of people: keep, add (bold) or remove (struck out).
    var leftover = before.otherInstruments.slice();
    after.otherInstruments.forEach(function (o) {
      var k = leftover.map(personKey).indexOf(personKey(o));
      if (k >= 0) leftover.splice(k, 1);
      roster.push(tplSlotLine('Other', k >= 0 ? tplPerson(o) : tplChange('', tplPerson(o)), o));
    });
    leftover.forEach(function (o) { roster.push('Other: ' + tplChange(tplPerson(o), '')); });

    return tplSections([
      '<b>[Band Update]</b>\n' + tplBandLine(after),
      details.join('\n'),
      roster.join('\n')
    ]);
  }
};

/** "Label: value" for a person slot, highlighting a change and noting cell issues. */
function personLine(label, oldPerson, newPerson) {
  var value = personKey(oldPerson) === personKey(newPerson)
    ? tplPerson(newPerson)
    : tplChange(tplPerson(oldPerson), tplPerson(newPerson));
  return newPerson ? tplSlotLine(label, value, newPerson) : label + ': ' + value;
}
