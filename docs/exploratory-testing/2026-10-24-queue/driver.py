#!/usr/bin/env python3
"""Real HTTP exploratory journeys; run from any cwd with Python 3 and Deno 2.7.6."""
import concurrent.futures
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
STATE = ROOT / 'target' / 'exploratory-2026-10-24'
TOKEN = 'exploratory-local-only'
SERVERS = []
FAILURES = []


def note(message):
    print(message, flush=True)


def check(label, actual, expected):
    ok = actual == expected
    note(f'{"PASS" if ok else "CANDIDATE"} {label}: actual={actual!r} expected={expected!r}')
    if not ok:
        FAILURES.append(label)


class Server:
    def __init__(self, name, persist=None, **config):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            self.port = s.getsockname()[1]
        env = os.environ.copy()
        env.update(HOST='127.0.0.1', PORT=str(self.port), QUEUE_API_TOKEN=TOKEN,
                   QUEUE_DEPTH_LIMIT='10000', QUEUE_COUNT_LIMIT='1000', RATE_LIMIT_REQUESTS='10000')
        env.update({k: str(v) for k, v in config.items()})
        cmd = ['deno', 'run', '--frozen', '--lock=deno.lock', '--allow-net', '--allow-read',
               '--allow-write', '--allow-env', 'main.ts']
        if persist:
            env['PERSIST'] = str(persist)
            cmd.append('--persist')
        self.log_path = EVIDENCE / f'{name}-server.log'
        self.log = self.log_path.open('w')
        self.proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        SERVERS.append(self)
        note(f'START {name} pid={self.proc.pid} port={self.port} persist={persist} config={config}')
        for _ in range(200):
            if self.proc.poll() is not None:
                note(f'EXIT before ready: {self.proc.returncode}; {self.log_path.name}')
                self.ready = False
                return
            try:
                if self.req('GET', '/health', auth=False)[0] == 200:
                    self.ready = True
                    return
            except OSError:
                pass
            time.sleep(.05)
        raise RuntimeError(f'{name} did not become ready')

    def req(self, method, path, value=None, raw=None, auth=True, headers=None):
        h = dict(headers or {})
        if auth:
            h['Authorization'] = f'Bearer {TOKEN}'
        if value is not None:
            raw = json.dumps({'payload': value}, ensure_ascii=True).encode()
        if raw is not None:
            h['Content-Type'] = 'application/json'
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        try:
            try:
                c.request(method, path, body=raw, headers=h)
            except BrokenPipeError:
                # Preflight rejection may close the upload before sendall finishes.
                # Read the server's early response rather than misclassify the driver.
                note(f'OBSERVATION: {method} {path} upload closed early; reading response')
            r = c.getresponse()
            return r.status, r.read(), dict(r.getheaders())
        finally:
            c.close()

    def stop(self, sig=signal.SIGTERM):
        if self.proc.poll() is None:
            self.proc.send_signal(sig)
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                note('CLEANUP: graceful timeout; killing process')
                self.proc.kill()
                self.proc.wait(timeout=5)
        self.log.close()
        note(f'STOP pid={self.proc.pid} status={self.proc.returncode}')


def body(s, path):
    r = s.req('GET', path)
    return r[0], r[1].decode()


def journey1():
    note('\nJOURNEY 1: publish and consume typed work across queues')
    s = Server('j1')
    check('public readiness', body(s, '/health'), (200, '{"status":"ok"}'))
    check('auth challenge', s.req('GET', '/queues', auth=False)[0:2], (401, b'Unauthorized'))
    values = ['0', 0, False, [], {}, {'unicode': 'café 🐈', 'nested': [None, True]}, 'a\x00b']
    q = 'caf%C3%A9-%F0%9F%90%88'
    for value in values:
        check(f'enqueue {value!r}', s.req('POST', f'/enqueue/{q}', value=value)[0], 200)
    check('length before HEAD', body(s, f'/length/{q}'), (200, '7'))
    check('HEAD dequeue body empty', s.req('HEAD', f'/dequeue/{q}')[0:2], (200, b''))
    check('HEAD does not consume', body(s, f'/length/{q}'), (200, '7'))
    check('peek oldest', body(s, f'/peek/{q}'), (200, '"0"'))
    received = [json.loads(s.req('GET', f'/dequeue/{q}')[1]) for _ in values]
    check('typed FIFO', received, values)
    check('empty dequeue', s.req('GET', f'/dequeue/{q}')[0], 204)
    check('drained queue removed', body(s, '/queues'), (200, '[]'))
    for n in range(120):
        check(f'publish worker job {n}', s.req('POST', '/enqueue/work', value=n)[0], 200)
    def worker(_):
        items = []
        while True:
            r = s.req('GET', '/dequeue/work')
            if r[0] == 204:
                return items
            if r[0] != 200:
                raise RuntimeError(r)
            items.append(json.loads(r[1]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        batches = list(pool.map(worker, range(6)))
    check('parallel workers receive every job exactly once', sorted(sum(batches, [])), list(range(120)))
    check('worker queue lasting effect', body(s, '/length/work'), (200, '0'))
    s.stop()


def journey2():
    note('\nJOURNEY 2: restart with queued work; crash and exclusive ownership')
    for replay in range(2):
        d = STATE / f'persist-{replay}'
        d.mkdir(parents=True)
        s = Server(f'j2-{replay}-initial', persist=d)
        for i in range(5):
            check('persist publish', s.req('POST', '/enqueue/jobs', value={'id': i})[0], 200)
        check('consume before restart', body(s, '/dequeue/jobs'), (200, '{"id":0}'))
        rival = Server(f'j2-{replay}-rival', persist=d)
        check('second owner rejected', rival.ready, False)
        check('second owner explains failure', 'already in use' in rival.log_path.read_text(), True)
        rival.stop()
        s.stop(signal.SIGTERM if replay == 0 else signal.SIGKILL)
        s = Server(f'j2-{replay}-restart', persist=d, QUEUE_DEPTH_LIMIT=1, QUEUE_COUNT_LIMIT=1)
        check('replay retains work over lowered limit', body(s, '/length/jobs'), (200, '4'))
        check('lowered limit rejects new work', s.req('POST', '/enqueue/jobs', value='blocked')[0], 507)
        check('recovered FIFO', [json.loads(s.req('GET', '/dequeue/jobs')[1]) for _ in range(4)], [{'id': i} for i in range(1, 5)])
        check('capacity reusable after drain', s.req('POST', '/enqueue/new', value='new-job')[0], 200)
        s.stop()
        s = Server(f'j2-{replay}-final', persist=d)
        check('new queue survives next restart', body(s, '/dequeue/new'), (200, '"new-job"'))
        check('consumed work does not reappear', s.req('GET', '/dequeue/jobs')[0], 204)
        s.stop()


def journey3():
    note('\nJOURNEY 3: reject bad input, correct it, and retain accepted boundary payloads')
    s = Server('j3', QUEUE_DEPTH_LIMIT=2, QUEUE_COUNT_LIMIT=2)
    invalid = [('invalid JSON', b'{'), ('null', b'{"payload":null}'), ('missing payload', b'{}'),
               ('lossy integer', b'{"payload":9007199254740993}'),
               ('nonfinite', b'{"payload":1e400}'), ('invalid UTF8', b'{"payload":"\xff"}'),
               ('too deep', b'{"payload":' + b'[' * 3000 + b'0' + b']' * 3000 + b'}')]
    for label, raw in invalid:
        check(label, s.req('POST', '/enqueue/input', raw=raw)[0], 400)
    check('invalid input creates no queue', body(s, '/queues'), (200, '[]'))
    for label, name, expected in [('128 unicode code points', '%F0%9F%90%88' * 128, 200),
                                  ('129 unicode code points', '%F0%9F%90%88' * 129, 400),
                                  ('bad escape', '%FF', 400)]:
        check(label, s.req('POST', '/enqueue/' + name, value='value')[0], expected)
    s.req('GET', '/dequeue/' + '%F0%9F%90%88' * 128)
    check('corrected payload accepted', s.req('POST', '/enqueue/input', value=False)[0], 200)
    check('second item accepted', s.req('POST', '/enqueue/input', value=0)[0], 200)
    check('depth limit', s.req('POST', '/enqueue/input', value='excess')[0], 507)
    check('depth rejection leaves first item', body(s, '/dequeue/input'), (200, 'false'))
    check('retry after space available', s.req('POST', '/enqueue/input', value='retry')[0], 200)
    check('next FIFO', body(s, '/dequeue/input'), (200, '0'))
    check('retry FIFO', body(s, '/dequeue/input'), (200, '"retry"'))
    for name in ['one', 'two']:
        check(f'create queue {name}', s.req('POST', '/enqueue/' + name, value=name)[0], 200)
    check('queue count limit', s.req('POST', '/enqueue/three', value='three')[0], 507)
    check('count rejection creates no phantom queue', json.loads(s.req('GET', '/queues')[1]), ['one', 'two'])
    s.req('GET', '/dequeue/one')
    check('retry after queue slot released', s.req('POST', '/enqueue/three', value='three')[0], 200)
    check('retried queue payload', body(s, '/dequeue/three'), (200, '"three"'))
    s.req('GET', '/dequeue/two')
    for size in [1048576, 1048577]:
        raw = b'{"payload":"' + b'x' * (size - 14) + b'"}'
        check(f'body size {size}', len(raw), size)
        check(f'body size {size} acceptance', s.req('POST', '/enqueue/size', raw=raw)[0], 200 if size == 1048576 else 413)
    check('oversize leaves only accepted item', body(s, '/length/size'), (200, '1'))
    r = s.req('GET', '/dequeue/size')
    check('max size payload preserved', len(json.loads(r[1])), 1048576 - 14)
    s.stop()
    # A persisted object at the documented depth boundary must remain readable.
    for replay in range(2):
        d = STATE / f'depth-{replay}'
        d.mkdir(parents=True)
        s = Server(f'j3-depth-{replay}', persist=d)
        for depth in [1000, 2000, 2999]:
            raw = b'{"payload":' + b'{"a":' * depth + b'0' + b'}' * depth + b'}'
            r = s.req('POST', f'/enqueue/depth{depth}', raw=raw)
            note(f'DEPTH repeat={replay} nested_objects={depth} enqueue_status={r[0]} response={r[1][:100]!r}')
            check(f'depth {depth} accepted within documented limit', r[0], 200)
            r = s.req('GET', f'/peek/depth{depth}')
            note(f'DEPTH peek_status={r[0]} body_bytes={len(r[1])} sha256={hashlib.sha256(r[1]).hexdigest()}')
            check(f'depth {depth} peek readable', r[0], 200)
            expected = b'{"a":' * depth + b'0' + b'}' * depth
            check(f'depth {depth} exact peek bytes', r[1] == expected, True)
        s.stop()
        s = Server(f'j3-depth-{replay}-restart', persist=d)
        check('depth server restart ready', s.ready, True)
        if s.ready:
            for depth in [1000, 2000, 2999]:
                r = s.req('GET', f'/dequeue/depth{depth}')
                check(f'depth {depth} survives restart', r[0], 200)
                expected = b'{"a":' * depth + b'0' + b'}' * depth
                check(f'depth {depth} exact recovered bytes', r[1] == expected, True)
        s.stop()
    s = Server('j3-rate', RATE_LIMIT_REQUESTS=3)
    for i in range(4):
        check(f'rate attempt {i + 1}', s.req('GET', '/queues')[0], 200 if i < 3 else 429)
    check('health remains available when limited', s.req('GET', '/health', auth=False)[0], 200)
    note('Waiting 61 seconds for real sliding-window expiry (no clock mocking).')
    time.sleep(61)
    check('rate limit recovery', s.req('GET', '/queues')[0], 200)
    s.stop()


if __name__ == '__main__':
    if STATE.exists():
        if any(STATE.iterdir()):
            raise RuntimeError(f'Remove previous run state before replay: {STATE}')
    STATE.mkdir(parents=True, exist_ok=True)
    try:
        journey1()
        journey2()
        journey3()
        note(f'FINISHED candidates={FAILURES!r}')
    finally:
        for s in SERVERS:
            if not s.log.closed:
                s.stop()
        shutil.rmtree(STATE)
        note('CLEANUP: all created native instances stopped; isolated state removed; Docker resources created: 0.')
