import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAskLilOwlServer } from '../server.js';

test('host route reports are correlated, labeled unverified, and reject arbitrary diagnostic content', async (t) => {
  const logs = [];
  const server = createAskLilOwlServer({ logger: { info: e => logs.push(e), error: e => logs.push(e) } });
  const client = new Client({ name: 'diagnostic-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  t.after(async () => { await client.close(); await server.close(); });
  const prepare = await client.callTool({ name: 'prepare_lesson', arguments: { question: 'Why do rockets fly?' } });
  const { diagnosticId } = JSON.parse(prepare.content[0].text);
  assert.match(diagnosticId, /^[0-9a-f-]{36}$/);
  const report = { diagnosticId, reason: 'native_tool_not_exposed', route: 'diagram', styleConfirmation: 'not_asked', attempts: 0, retries: 0, fallbackConsent: 'not_requested' };
  const result = await client.callTool({ name: 'report_lesson_diagnostic', arguments: report });
  assert.notEqual(result.isError, true);
  assert.ok(logs.some(e => e.diagnosticId === diagnosticId && e.event === 'lesson_host_diagnostic' && e.evidence === 'host_reported_unverified' && e.reason === report.reason));
  const before = logs.length;
  const invalid = await client.callTool({ name: 'report_lesson_diagnostic', arguments: { ...report, secret: 'https://private.example/token' } });
  assert.equal(invalid.isError, true);
  assert.equal(logs.length, before);
  assert.ok(!JSON.stringify(logs).includes('private.example'));
  const continued = await client.callTool({ name: 'prepare_lesson', arguments: { question: 'Why do rockets fly?', lessonStyle: 'technical', diagnosticId } });
  assert.equal(JSON.parse(continued.content[0].text).diagnosticId, diagnosticId);
});
