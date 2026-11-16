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
transient_resume_retries = []
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(data):
    started = time.perf_counter()
    req = urllib.request.Request(BASE, data=json.dumps(data).encode(),
        headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:5173'})
    for attempt in range(3):
        try:
            with opener.open(req, timeout=8) as response:
                value = json.load(response)
            break
        except urllib.error.HTTPError as error:
            body = error.read().decode()
            error.close()
            # Match the mobile client's bounded retry policy for resume only.
            if error.code == 503 and data['action'] == 'resume' and attempt < 2:
                transient_resume_retries.append({'status': 503, 'body': body[:200]})
                time.sleep(.2 * (attempt + 1))
                continue
            if error.code >= 500:
                print(json.dumps({'http_error': error.code, 'action': data['action'], 'body': body[:1000]}), flush=True)
            raise
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
    list(pool.map(lambda p: post({'action': 'ready', 'code': code, 'token': p['token'],
        'round': 1, 'readyVersion': p['readyVersion'], 'ready': True}), players))
    # Stale preparation requests must not undo a newer response.
    try:
        post({'action': 'ready', 'code': code, 'token': players[0]['token'],
            'round': 1, 'readyVersion': 0, 'ready': False})
        raise AssertionError('Stale readiness version was accepted')
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
    with opener.open(BASE + '?code=' + code, timeout=8) as response:
        final = json.load(response)
    assert final['participantCount'] == 100
    assert final['room']['phase'] == 'finished'
    assert all(0 < p['distance'] < 2700 for p in final['players'])
    assert all(final['players'][i]['distance'] >= final['players'][i+1]['distance'] for i in range(99))
    with opener.open(BASE + '?code=' + code + '&round=1', timeout=8) as response:
        archived = json.load(response)
    assert archived['players'] == [{k: v for k, v in p.items() if k not in ('updated_at', 'membership')}
        | {'connected': False, 'ready': False, 'speed': 0, 'nitro': False} for p in final['players']]
    post({'action': 'reset', 'code': code, 'hostToken': created['hostToken']})
    with opener.open(BASE + '?code=' + code + '&round=1', timeout=8) as response:
        assert json.load(response)['players'] == archived['players']
    with opener.open(BASE + '?code=' + code, timeout=8) as response:
        next_round = json.load(response)
    assert next_round['room']['round'] == 2
    assert next_round['history'][0]['round'] == 1
    assert next_round['history'][0]['count'] == 100
    resumed = list(pool.map(lambda p: post({'action': 'resume', 'code': code, 'token': p['token']}), players))
    assert all(p['room']['round'] == 2 and not p['ready'] and p['state']['distance'] == 0 for p in resumed)
    for _ in range(4):
        refreshed = list(pool.map(lambda p: post({'action': 'resume', 'code': code, 'token': p['token']}), players))
        assert all(p['room']['round'] == 2 for p in refreshed)
    report = {'players': 100, 'race_seconds': 60, 'http_requests': len(latencies) + len(transient_resume_retries),
        'batches': batches, 'errors': len(errors), 'first_errors': errors[:3],
        'latency_p50_ms': round(statistics.median(latencies), 1),
        'latency_p95_ms': round(sorted(latencies)[int(len(latencies) * .95)], 1),
        'winner_distance_m': round(final['players'][0]['distance'], 2),
        'readiness_version_checked': True,
        'archived_players_after_reset': len(archived['players']),
        'players_resumed_in_next_round': len(resumed),
        'next_round_resume_batches': 5,
        'transient_resume_retries': len(transient_resume_retries),
        'first_resume_retry_reasons': transient_resume_retries[:1],
        'scope': 'Local built Cloudflare Worker + local D1; excludes public network and real devices'}
    Path('tests/http-load-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if errors:
        raise SystemExit(1)
