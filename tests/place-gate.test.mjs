import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate, PlaceLookupError } from '../lib/place-gate.js';

// 가짜 시계: sleep 을 부르면 시간이 그만큼 흐릅니다.
function fakeClock(start = Date.parse('2026-11-15T03:00:00Z')) {
    let t = start;
    return {
        now: () => t,
        sleep: async (ms) => { t += ms; },
        advance: (ms) => { t += ms; },
    };
}

test('요청은 한 번에 하나씩, 정한 간격을 두고 나간다', async () => {
    const clock = fakeClock();
    const gate = createGate({ minIntervalMs: 400, now: clock.now, sleep: clock.sleep });
    assert.equal(typeof createGate().run, 'function'); // 기본값(1초 간격)으로도 만들어진다
    const startedAt = [];
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        startedAt.push(clock.now());
        await Promise.resolve();
        running -= 1;
        return 'ok';
    };

    const results = await Promise.all([gate.run(task), gate.run(task), gate.run(task)]);

    assert.deepEqual(results, ['ok', 'ok', 'ok']);
    assert.equal(maxRunning, 1);
    assert.equal(startedAt[1] - startedAt[0], 400);
    assert.equal(startedAt[2] - startedAt[1], 400);
});

test('앞 요청이 실패해도 다음 요청은 계속 처리된다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep });
    await assert.rejects(gate.run(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await gate.run(async () => 'next'), 'next');
});

test('같은 조회는 저장해 둔 결과를 쓰고, 시간이 지나면 다시 조회한다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep });
    let calls = 0;
    const loader = async () => { calls += 1; return { n: calls }; };

    const first = await gate.cached('k', 1000, loader);
    const second = await gate.cached('k', 1000, loader);
    assert.equal(calls, 1);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.fetchedAt, first.fetchedAt);
    assert.deepEqual(second.value, { n: 1 });

    clock.advance(1001);
    const third = await gate.cached('k', 1000, loader);
    assert.equal(calls, 2);
    assert.equal(third.cached, false);
});

test('동시에 들어온 같은 조회는 한 번만 보낸다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep });
    let calls = 0;
    const loader = async () => { calls += 1; await Promise.resolve(); return calls; };
    const [a, b] = await Promise.all([gate.cached('same', 1000, loader), gate.cached('same', 1000, loader)]);
    assert.equal(calls, 1);
    assert.equal(a.value, 1);
    assert.equal(b.value, 1);
});

test('실패한 조회는 저장하지 않는다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep });
    let calls = 0;
    await assert.rejects(gate.cached('x', 1000, async () => { calls += 1; throw new Error('fail'); }));
    const ok = await gate.cached('x', 1000, async () => { calls += 1; return 'ok'; });
    assert.equal(calls, 2);
    assert.equal(ok.value, 'ok');
});

test('refresh 는 저장된 결과를 건너뛰고, keep 이 false 인 결과는 저장하지 않으며, remember 로 직접 저장할 수 있다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep });
    let calls = 0;
    const loader = async () => { calls += 1; return { n: calls, items: calls === 2 ? [] : [1] }; };
    const keep = (value) => value.items.length > 0;

    await gate.cached('k', 1000, loader, { keep });              // 1: 저장됨
    const refreshed = await gate.cached('k', 1000, loader, { keep, refresh: true }); // 2: 빈 결과 → 저장 안 함(기존 것도 지움)
    assert.equal(refreshed.value.n, 2);
    const third = await gate.cached('k', 1000, loader, { keep }); // 3: 다시 조회
    assert.equal(third.value.n, 3);
    assert.equal(third.cached, false);
    assert.equal(calls, 3);

    gate.remember('m', 1000, { items: [] });
    const remembered = await gate.cached('m', 1000, loader, { keep });
    assert.equal(remembered.cached, true);
    assert.deepEqual(remembered.value, { items: [] });
    assert.equal(calls, 3);
});

test('저장 결과는 정한 개수까지만 보관한다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep, cacheMax: 2 });
    let calls = 0;
    const loader = async () => { calls += 1; return calls; };
    await gate.cached('a', 10000, loader);
    await gate.cached('b', 10000, loader);
    await gate.cached('c', 10000, loader); // a 가 밀려남
    await gate.cached('a', 10000, loader);
    assert.equal(calls, 4);
});

test('거절당하면 조회를 멈추고, 쉬는 동안에는 요청을 보내지 않는다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep, baseCooldownMs: 600000 });
    let sent = 0;

    const retryAt = gate.trip('HTTP 429');
    assert.equal(retryAt, clock.now() + 600000);
    assert.equal(gate.status().paused, true);

    await assert.rejects(
        gate.run(async () => { sent += 1; }),
        (error) => error instanceof PlaceLookupError && error.code === 'PAUSED' && error.retryAt === retryAt,
    );
    assert.equal(sent, 0);

    clock.advance(600001);
    assert.equal(gate.status().paused, false);
    await gate.run(async () => { sent += 1; });
    assert.equal(sent, 1);
});

test('연속으로 거절당하면 쉬는 시간이 두 배씩 늘고 상한에서 멈춘다. 성공하면 초기화된다', () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep, baseCooldownMs: 600000, maxCooldownMs: 1800000 });
    assert.equal(gate.trip() - clock.now(), 600000);
    assert.equal(gate.trip() - clock.now(), 1200000);
    assert.equal(gate.trip() - clock.now(), 1800000);
    assert.equal(gate.trip() - clock.now(), 1800000);
    gate.succeed();
    assert.equal(gate.trip() - clock.now(), 600000);
});

test('줄 서 있던 요청도 그 사이 거절이 발생하면 보내지 않는다', async () => {
    const clock = fakeClock();
    const gate = createGate({ now: clock.now, sleep: clock.sleep });
    let sent = 0;
    const first = gate.run(async () => { sent += 1; gate.trip('HTTP 429'); throw new PlaceLookupError('BLOCKED', 'x'); });
    const second = gate.run(async () => { sent += 1; });
    await assert.rejects(first, (e) => e.code === 'BLOCKED');
    await assert.rejects(second, (e) => e.code === 'PAUSED');
    assert.equal(sent, 1);
});

test('하루 요청 상한을 넘으면 멈추고 날짜(KST)가 바뀌면 다시 된다', async () => {
    // 2026-11-15 23:59:00 KST
    const clock = fakeClock(Date.parse('2026-11-15T14:59:00Z'));
    const gate = createGate({ now: clock.now, sleep: clock.sleep, dailyMax: 2, minIntervalMs: 0 });
    await gate.run(async () => 1);
    await gate.run(async () => 2);
    assert.equal(gate.status().requestsToday, 2);
    await assert.rejects(gate.run(async () => 3), (e) => e.code === 'DAILY_LIMIT');

    clock.advance(2 * 60 * 1000); // 자정을 넘김
    assert.equal(gate.status().requestsToday, 0);
    assert.equal(await gate.run(async () => 'new day'), 'new day');
});
