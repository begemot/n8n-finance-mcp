import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { StreamableHTTPServerTransport } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';

test('успешная инициализация при Accept */*', async () => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => 'test-session',
    enableJsonResponse: true,
  });

  transport.onmessage = async (message) => {
    if (message.method === 'initialize') {
      await transport.send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    }
  };

  const server = http.createServer((req, res) => {
    transport.handleRequest(req, res);
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const initMessage = {
    jsonrpc: '2.0',
    id: '1',
    method: 'initialize',
    params: {
      protocolVersion: '1.0',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    },
  };

  const response = await fetch(`http://localhost:${port}`, {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'content-type': 'application/json'
    },
    body: JSON.stringify(initMessage)
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), 'test-session');
  const body = await response.json();
  assert.deepEqual(body, { jsonrpc: '2.0', id: '1', result: { ok: true } });

  server.close();
});
