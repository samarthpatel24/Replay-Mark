import { Readable, PassThrough } from 'node:stream';

// Exercise the real HTTP handler without opening a port (restricted test environments).
export function transport(server) {
  server.address = () => ({ port: 47800, address: '127.0.0.1' });
  const responses = new Set();
  function request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
      req.url = parsed.pathname + parsed.search;
      req.method = options.method || 'GET';
      req.headers = Object.fromEntries(new Headers(options.headers).entries());
      req.headers.host ||= parsed.host;
      const res = new PassThrough();
      responses.add(res);
      res.on('close', () => responses.delete(res));
      const headers = {};
      res.setHeader = (key, value) => { headers[key] = value; };
      res.writeHead = (status, extra) => {
        res.headersSent = true;
        resolve(new Response(Readable.toWeb(res), { status, headers: { ...headers, ...extra } }));
        return res;
      };
      options.signal?.addEventListener('abort', () => { req.emit('close'); res.end(); }, { once: true });
      req.on('error', reject);
      res.on('error', reject);
      server.emit('request', req, res);
    });
  }
  return { fetch: request, close: () => { server.emit('close'); for (const response of responses) response.end(); } };
}
