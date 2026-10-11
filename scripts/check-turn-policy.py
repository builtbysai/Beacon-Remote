"""Authenticated TURN permission checks; never prints credentials or sends media.

Secrets are read from one-line static-auth-secret configuration files. This
checks permissions, not end-to-end playback or actual bandwidth throughput.
"""

import argparse
import base64
import hashlib
import hmac
import ipaddress
import os
import socket
import struct
import time
from pathlib import Path


COOKIE = 0x2112A442


def attribute(kind, value):
    return struct.pack("!HH", kind, len(value)) + value + b"\0" * (-len(value) % 4)


def secret(path):
    line = Path(path).read_text().strip()
    name, value = line.split("=", 1)
    if name != "static-auth-secret" or not value:
        raise ValueError("Expected a protected static-auth-secret configuration")
    return value.encode()


class Client:
    def __init__(self, address, signing_secret, user="policy-probe"):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(4)
        self.sock.connect(address)
        self.username = f"{int(time.time()) + 120}:{user}".encode()
        self.password = base64.b64encode(hmac.new(signing_secret, self.username, hashlib.sha1).digest())
        self.realm = self.nonce = self.key = None

    def request(self, kind, attributes, authenticated=True):
        transaction = os.urandom(12)
        payload = b"".join(attributes)
        if authenticated:
            payload += attribute(6, self.username) + attribute(0x14, self.realm) + attribute(0x15, self.nonce)
        header = struct.pack("!HHI12s", kind, len(payload) + (24 if authenticated else 0), COOKIE, transaction)
        if authenticated:
            payload += attribute(8, hmac.new(self.key, header + payload, hashlib.sha1).digest())
        self.sock.send(header + payload)
        response = self.sock.recv(65536)
        response_kind, length, cookie, received_transaction = struct.unpack("!HHI12s", response[:20])
        assert cookie == COOKIE and received_transaction == transaction and length == len(response) - 20
        fields = {}
        position = 20
        while position < len(response):
            field, size = struct.unpack("!HH", response[position:position + 4])
            fields[field] = response[position + 4:position + 4 + size]
            if field == 8 and authenticated:
                adjusted = response[:2] + struct.pack("!H", position + 24 - 20) + response[4:position]
                assert hmac.compare_digest(fields[field], hmac.new(self.key, adjusted, hashlib.sha1).digest())
            position += 4 + size + (-size % 4)
        code = None
        if 9 in fields:
            code = (fields[9][2] & 7) * 100 + fields[9][3]
        if authenticated and code is None:
            assert 8 in fields, "Authenticated success lacks MESSAGE-INTEGRITY"
        return response_kind, code, fields

    def allocate(self):
        requested_transport = [attribute(0x19, b"\x11\0\0\0")]
        _, code, fields = self.request(3, requested_transport, False)
        assert code == 401 and 0x14 in fields and 0x15 in fields
        self.realm, self.nonce = fields[0x14], fields[0x15]
        self.key = hashlib.md5(self.username + b":" + self.realm + b":" + self.password).digest()
        kind, code, _ = self.request(3, requested_transport)
        return kind, code

    def permission(self, peer):
        address = ipaddress.ip_address(peer)
        mask = struct.pack("!I", COOKIE)
        family = 1 if address.version == 4 else 2
        if family == 2:
            # XOR-PEER-ADDRESS includes the request transaction for IPv6. Use
            # the IPv4 permission probe for mapped/private ranges; independent
            # IPv6 relay tests are deliberately not claimed by this tool.
            raise ValueError("This probe currently supports IPv4 permissions only")
        encoded = bytes(x ^ y for x, y in zip(address.packed, mask))
        peer_attribute = attribute(0x12, struct.pack("!BBH", 0, family, 9 ^ (COOKIE >> 16)) + encoded)
        kind, code, _ = self.request(8, [peer_attribute])
        return kind, code

    def close(self, allocated):
        try:
            if allocated:
                kind, code, fields = self.request(4, [attribute(0x0D, struct.pack("!I", 0))])
                assert kind == 0x104 and code is None and fields[0x0D] == b"\0\0\0\0"
        finally:
            self.sock.close()


def main():
    if not __debug__:
        raise RuntimeError("Run this verification without Python optimization; assertions must be enabled")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=3479)
    parser.add_argument("--secret-file", required=True)
    parser.add_argument("--foreign-secret-file", required=True)
    parser.add_argument("--allocation-limit", type=int, default=4,
                        help="Expected admission limit for this credential; bandwidth reservations may bind before user quota")
    args = parser.parse_args()
    if args.allocation_limit < 1:
        parser.error("--allocation-limit must be positive")
    address = (args.host, args.port)
    own, foreign = secret(args.secret_file), secret(args.foreign_secret_file)
    assert not hmac.compare_digest(own, foreign), "Relay secrets must differ"
    client = Client(address, own)
    allocated = False
    try:
        kind, code = client.allocate()
        assert kind == 0x103 and code is None, f"Own credential allocation failed: {code}"
        allocated = True
        print("Own credential: allocation accepted")
        kind, code = client.permission("8.8.8.8")
        assert kind == 0x108 and code is None, f"Public peer permission failed: {code}"
        print("Public peer: permission accepted (no traffic sent)")
        for peer in ["0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.0.1", "172.16.0.1", "192.0.0.1", "192.168.0.1", "198.18.0.1", "240.0.0.1", "224.0.0.1"]:
            _, code = client.permission(peer)
            assert code == 403, f"Forbidden peer {peer} was not refused: {code}"
            print(f"Forbidden peer {peer}: permission rejected (403)")
    finally:
        client.close(allocated)
    # Coturn acknowledges lifetime=0 before asynchronous allocation cleanup.
    # Allow that cleanup before deliberately testing capacity exhaustion.
    time.sleep(1)
    client = Client(address, foreign, "foreign-policy-probe")
    try:
        _, code = client.allocate()
        assert code == 401, f"Foreign credential was not rejected: {code}"
        print("Foreign credential: allocation rejected (401)")
    finally:
        client.close(False)
    clients = []
    try:
        for index in range(args.allocation_limit + 1):
            client = Client(address, own, "quota-policy-probe")
            clients.append((client, False))
            kind, code = client.allocate()
            if index < args.allocation_limit:
                assert kind == 0x103 and code is None, f"Allocation within admission limit failed: {code}"
                clients[-1] = (client, True)
            else:
                assert code == 486, f"Admission limits did not reject excess allocation: {code}"
        print(f"Admission limit: {args.allocation_limit} allocations accepted; excess rejected (486)")
    finally:
        for client, allocated in clients:
            client.close(allocated)
    time.sleep(1)
    client = Client(address, own, "quota-policy-probe")
    allocated = False
    try:
        kind, code = client.allocate()
        assert kind == 0x103 and code is None, f"Allocation after quota release failed: {code}"
        allocated = True
        print("Quota recovery: allocation accepted after release")
    finally:
        client.close(allocated)


if __name__ == "__main__":
    main()
