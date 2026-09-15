'use strict';
const { HttpError } = require('../lib/http');

/** Validate req[source] against a zod schema, replacing it with parsed data. */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      // One message per field — several zod rules on the same field would
      // otherwise repeat themselves back to the user.
      const seen = new Set();
      const details = [];
      for (const issue of result.error.issues) {
        const field = issue.path.join('.');
        if (seen.has(field)) continue;
        seen.add(field);
        details.push({ field, message: issue.message });
      }
      return next(new HttpError(422, 'Validation failed.', details));
    }
    req[source === 'query' ? 'validatedQuery' : source] = result.data;
    next();
  };
}

module.exports = { validate };
