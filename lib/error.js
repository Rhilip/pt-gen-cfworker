export default function debug_get_err(err, request) {
  const errType = err.name || (err.contructor || {}).name;
  const frames = parse_err(err);
  const extraKeys = Object.keys(err).filter(key => !['name', 'message', 'stack'].includes(key));
  return {
    message: errType + ': ' + (err.message || '<no message>'),
    exception: {
      values: [
        {
          type: errType,
          value: err.message,
          stacktrace: frames.length ? { frames: frames.reverse() } : undefined,
        },
      ],
    },
    extra: extraKeys.length
      ? {
        [errType]: extraKeys.reduce((obj, key) => ({ ...obj, [key]: err[key] }), {}),
      }
      : undefined,
    timestamp: Date.now() / 1000,
    request:
      request && request.url
        ? {
          method: request.method,
          url: request.url,
          query_string: request.query,
          headers: request.headers,
          data: request.body,
        }
        : undefined,
  }
}

function parse_err(err) {
  return (err.stack || '')
    .split('\n')
    .slice(1)
    .map(line => {
      if (line.match(/^\s*[-]{4,}$/)) {
        return { filename: line }
      }

      // From https://github.com/felixge/node-stack-trace/blob/1ec9ba43eece124526c273c917104b4226898932/lib/stack-trace.js#L42
      const lineMatch = line.match(/at (?:(.+)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/);
      if (!lineMatch) {
        return
      }

      return {
        function: lineMatch[1] || undefined,
        filename: lineMatch[2] || undefined,
        lineno: +lineMatch[3] || undefined,
        colno: +lineMatch[4] || undefined,
        in_app: lineMatch[5] !== 'native' || undefined,
      }
    })
    .filter(Boolean)
}