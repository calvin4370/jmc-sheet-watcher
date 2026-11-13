/*
 * A small JSON Schema checker for SoC LaaS tool arguments. The tools are sent with
 * strict schemas, but nothing runs until the arguments pass this check in code too.
 *
 * Supports: type (object, array, string, integer, number, boolean), properties,
 * required, additionalProperties: false, enum, pattern, minLength, maxLength, minimum,
 * maximum, items, minItems, maxItems.
 */

/** Returns '' if `value` matches `schema`, otherwise a short description of the first problem. */
function jsonSchemaProblem(schema, value, path) {
  path = path || 'arguments';
  var type = schema.type;
  var actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

  if (type === 'integer') {
    if (typeof value !== 'number' || Math.floor(value) !== value) return path + ' must be a whole number';
  } else if (type === 'number') {
    if (typeof value !== 'number' || !isFinite(value)) return path + ' must be a number';
  } else if (type && type !== actual) {
    return path + ' must be ' + (type === 'array' || type === 'object' ? 'an ' : 'a ') + type;
  }

  if (schema['enum'] && schema['enum'].indexOf(value) < 0) {
    return path + ' must be one of: ' + schema['enum'].join(', ');
  }

  if (type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return path + ' is too short';
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return path + ' is too long (most ' + schema.maxLength + ' characters)';
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return path + ' is not in the right format';
  }

  if (type === 'integer' || type === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return path + ' must be at least ' + schema.minimum;
    if (schema.maximum !== undefined && value > schema.maximum) return path + ' must be at most ' + schema.maximum;
  }

  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) return path + ' needs at least ' + schema.minItems + ' item(s)';
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return path + ' has too many items';
    for (var i = 0; schema.items && i < value.length; i++) {
      var itemProblem = jsonSchemaProblem(schema.items, value[i], path + '[' + i + ']');
      if (itemProblem) return itemProblem;
    }
  }

  if (type === 'object') {
    var props = schema.properties || {};
    var required = schema.required || [];
    for (var r = 0; r < required.length; r++) {
      if (!Object.prototype.hasOwnProperty.call(value, required[r])) return path + '.' + required[r] + ' is missing';
    }
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      if (!props[keys[k]]) {
        if (schema.additionalProperties === false) return path + '.' + keys[k] + ' is not allowed';
        continue;
      }
      var problem = jsonSchemaProblem(props[keys[k]], value[keys[k]], path + '.' + keys[k]);
      if (problem) return problem;
    }
  }
  return '';
}
