const http = require('http');
http.createServer((req, res) => {
  const host = req.headers.host || 'server.lukeevanson.com';
  res.writeHead(301, { Location: 'https://' + host + req.url });
  res.end();
}).listen(80, '0.0.0.0', () => console.log('[Redirect] HTTP→HTTPS on :80'));
