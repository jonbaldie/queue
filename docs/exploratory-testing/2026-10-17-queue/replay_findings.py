#!/usr/bin/env python3
"""Replay suspected failures from a known starting state."""
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request

EVID = "docs/exploratory-testing/2026-10-17-queue"
BIN = "./target/queue"
TOKEN = "explore-token-2026-10-17"
OUT = open(os.path.join(EVID, "replay-findings.txt"), "w")


def log(line):
    print(line)
    OUT.write(line + "\n")
    OUT.flush()


def wait_listen(path, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if os.path.exists(path) and "Listening" in open(path).read():
            return True
        time.sleep(0.05)
    return False


def start(port, data, log_path):
    env = os.environ.copy()
    env.update({
        "QUEUE_API_TOKEN": TOKEN,
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "PERSIST": data,
    })
    proc = subprocess.Popen(
        [BIN, "--persist"],
        env=env,
        stdout=open(log_path, "w"),
        stderr=subprocess.STDOUT,
    )
    if not wait_listen(log_path):
        raise SystemExit(f"failed to start {log_path}: {open(log_path).read()}")
    return proc


def req(port, method, path, body=None):
    data = body.encode() if body is not None else None
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def stop(proc, sig):
    proc.send_signal(sig)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=2)


def truncated_upload(port, run):
    sock = socket.create_connection(("127.0.0.1", port))
    payload = b'{"payload":"short"}'
    # Declare a longer body, send only part, then half-close and read the response.
    head = (
        "POST /enqueue/drop HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        f"Authorization: Bearer {TOKEN}\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: 40\r\n"
        "Connection: close\r\n"
        "\r\n"
    ).encode()
    sock.sendall(head + b'{"payload":')
    sock.shutdown(socket.SHUT_WR)
    chunks = []
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            break
        chunks.append(chunk)
    sock.close()
    raw = b"".join(chunks).decode("utf-8", "replace")
    log(f"truncated run {run} response:\n{raw}")
    status, text = req(port, "GET", "/length/drop")
    log(f"truncated run {run} length after={status} {text}")
    status, text = req(port, "POST", "/enqueue/drop", '{"payload":"retry-ok"}')
    log(f"truncated run {run} retry={status} {text}")
    status, text = req(port, "GET", "/dequeue/drop")
    log(f"truncated run {run} dequeue={status} {text}")


def two_writers(run):
    data = os.path.join(EVID, f"replay-two-{run}")
    subprocess.run(["rm", "-rf", data], check=True)
    os.makedirs(data)
    a_log = os.path.join(EVID, f"replay-two-a-{run}.log")
    b_log = os.path.join(EVID, f"replay-two-b-{run}.log")
    a = start(18781, data, a_log)
    status, text = req(18781, "POST", "/enqueue/jobs", '{"payload":"from-a"}')
    log(f"two run {run} A enqueue from-a={status} {text}")
    b = start(18782, data, b_log)
    status, text = req(18782, "POST", "/enqueue/jobs", '{"payload":"from-b"}')
    log(f"two run {run} B enqueue from-b={status} {text}")
    status, text = req(18781, "GET", "/dequeue/jobs")
    log(f"two run {run} A dequeue={status} {text}")
    status, text = req(18782, "GET", "/dequeue/jobs")
    log(f"two run {run} B dequeue={status} {text}")
    # Old server shuts down gracefully and rewrites the snapshot from its memory.
    stop(a, 15)  # SIGTERM
    # New server is killed before it can flush its own snapshot.
    b.kill()
    b.wait(timeout=2)
    log(f"two run {run} persist after A flush and B kill:\n{open(os.path.join(data, 'persist.dat')).read()}")
    r_log = os.path.join(EVID, f"replay-two-r-{run}.log")
    r = start(18781, data, r_log)
    status, text = req(18781, "GET", "/length/jobs")
    log(f"two run {run} recovered length={status} {text}")
    got = []
    for _ in range(4):
        status, text = req(18781, "GET", "/dequeue/jobs")
        got.append(f"{status}:{text}")
        if status == 204:
            break
    log(f"two run {run} recovered items={got}")
    stop(r, 15)


def main():
    # Truncated upload on a live server, two runs from a clean process each time.
    for run in (1, 2):
        log_path = os.path.join(EVID, f"trunc-{run}.log")
        data = os.path.join(EVID, f"trunc-data-{run}")
        subprocess.run(["rm", "-rf", data], check=True)
        os.makedirs(data)
        proc = start(18780, data, log_path)
        truncated_upload(18780, run)
        stop(proc, 15)
    for run in (1, 2):
        two_writers(run)
    log("REPLAY DONE")


if __name__ == "__main__":
    main()
