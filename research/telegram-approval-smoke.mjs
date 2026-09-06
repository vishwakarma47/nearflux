import assert from 'node:assert/strict';

const calls = [];
globalThis.fetch = async (_url, options = {}) => {
  calls.push({ url: String(_url), options });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { TelegramBridgeManager } = await import('../server/dist/server/src/telegram/telegramBridge.js');
const manager = new TelegramBridgeManager({ token: 'test-token', socketUrl: 'http://127.0.0.1:9', webAppUrl: 'https://example.test' });
const payload = {
  roomCode: 'FLUX-ABCD',
  senderId: 'browser-1',
  senderName: 'Browser',
  targetId: 'telegram-1',
  files: [{ name: 'photo.jpg', size: 1024, type: 'image/jpeg' }],
};

const approval = manager.requestApproval(123, payload);
await new Promise((resolve) => setTimeout(resolve, 0));
const requestCall = calls.find((call) => JSON.parse(call.options.body).method === undefined) || calls.at(-1);
const requestBody = JSON.parse(requestCall.options.body);
const callbackData = requestBody.reply_markup.inline_keyboard[0][0].callback_data;
assert.match(callbackData, /^transfer:accept:/);
await manager.handleUpdate({ callback_query: { id: 'callback-1', data: callbackData, message: { message_id: 1, chat: { id: 123 } } } });
assert.equal(await approval, true);
console.log(JSON.stringify({ ok: true, callbackDataPrefix: callbackData.split(':').slice(0, 2).join(':') }));
