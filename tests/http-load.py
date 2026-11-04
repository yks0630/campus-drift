"""100 real HTTP clients against the local built Worker (not a production load test)."""
import concurrent.futures
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'http://127.0.0.1:5173/api/game'
latencies = []
errors = []


def post(data):
    started = time.perf_counter()
    req = urllib.request.Request(BASE, data=json.dumps(data).encode(),
        headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:5173'})
    with urllib.request.urlopen(req, timeout=8) as response:
        value = json.load(response)
    latencies.append((time.perf_counter() - started) * 1000)
    return value


created = post({'action': 'create'})
code = created['room']['code']
with concurrent.futures.ThreadPoolExecutor(max_workers=100) as pool:
    players = list(pool.map(lambda i: post({'action': 'join', 'code': code,
        'name': f'压测车手{i+1:03}', 'color': ['blue', 'red', 'green', 'yellow', 'black'][i % 5]}), range(100)))
    try:
        post({'action': 'join', 'code': code, 'name': '超额车手'})
        raise AssertionError('Room incorrectly accepted player 101')
    except urllib.error.HTTPError as e:
        assert e.code == 409
    room = post({'action': 'start', 'code': code, 'hostToken': created['hostToken']})['room']
    at = room['startAt']
    print(json.dumps({'status': 'started', 'players': len(players), 'room': code}), flush=True)
    while time.time() * 1000 < at:
        time.sleep(.1)
    batches = 0
    def drive(item):
        i, p = item
        target = min(3600, max(0, math.floor((time.time() * 1000 - at) * .06)))
        try:
            return post({'action': 'input', 'code': code, 'token': p['token'], 'round': 1,
                'until': target, 'events': [{'tick': 0, 'throttle': True, 'drift': False, 'steer': (i % 5 - 2) * .12}]})
        except Exception as e:
            errors.append(str(e))
            return None
    while time.time() * 1000 < at + 60000:
        started = time.perf_counter()
        list(pool.map(drive, enumerate(players)))
        batches += 1
        time.sleep(max(0, .5 - (time.perf_counter() - started)))
    list(pool.map(drive, enumerate(players)))
    while time.time() * 1000 < at + 65100:
        time.sleep(.1)
    with urllib.request.urlopen(BASE + '?code=' + code, timeout=8) as response:
        final = json.load(response)
    assert final['count'] == 100
    assert final['room']['phase'] == 'finished'
    assert all(0 < p['distance'] < 2700 for p in final['players'])
    assert all(final['players'][i]['distance'] >= final['players'][i+1]['distance'] for i in range(99))
    report = {'players': 100, 'race_seconds': 60, 'http_requests': len(latencies),
        'batches': batches, 'errors': len(errors), 'first_errors': errors[:3],
        'latency_p50_ms': round(statistics.median(latencies), 1),
        'latency_p95_ms': round(sorted(latencies)[int(len(latencies) * .95)], 1),
        'winner_distance_m': round(final['players'][0]['distance'], 2),
        'scope': 'Local built Cloudflare Worker + local D1; excludes public network and real devices'}
    Path('tests/http-load-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if errors:
        raise SystemExit(1)
