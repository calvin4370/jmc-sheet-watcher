/*
 * Decides whether a subscriber wants a particular change, based on their alert switches.
 */

/** Which alert switch controls each kind of band field change. */
var BAND_FIELD_ALERT = {
  role: 'members',
  substitution: 'substitutions',
  otherInstrument: 'otherInstruments',
  song: 'songs',
  pointOfContact: 'pointOfContact',
  completion: 'completion'
};

/**
 * A subscriber's effective alerts: their saved choices on top of the defaults.
 * Switches added to SETTINGS later automatically get their default value.
 */
function resolveAlerts(saved) {
  var alerts = {};
  Object.keys(SETTINGS.defaultAlerts).forEach(function (key) {
    alerts[key] = saved && typeof saved[key] === 'boolean' ? saved[key] : SETTINGS.defaultAlerts[key];
  });
  return alerts;
}

/**
 * True if a subscriber with these alerts should receive the message for this change.
 * A band update is sent if at least one of its changes is switched on.
 */
function wantsChange(change, alerts) {
  switch (change.type) {
    case 'band_added': return alerts.bands && alerts.bandAdded;
    case 'band_removed': return alerts.bands && alerts.bandRemoved;
    case 'band_changed':
      return alerts.bands && change.changes.some(function (c) { return alerts[BAND_FIELD_ALERT[c.field]]; });
    case 'player_added': return alerts.playerFinder && alerts.playerAdded;
    case 'player_removed': return alerts.playerFinder && alerts.playerRemoved;
    case 'player_changed': return alerts.playerFinder && alerts.playerEdited;
    default: throw new Error('Unknown change type: ' + change.type);
  }
}
