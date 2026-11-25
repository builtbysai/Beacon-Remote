import assert from "node:assert/strict";
import test from "node:test";
import { talkMids } from "../src/talk-line.js";

const offer = (audio: string) =>
  [
    "v=0",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=mid:0",
    "a=sendrecv",
    audio,
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "a=mid:3",
    "",
  ].join("\r\n");

test("only an audio section the phone receives on is the talk line", () => {
  assert.deepEqual(
    talkMids(offer("m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\na=recvonly")),
    ["1"],
  );
  assert.deepEqual(
    talkMids(offer("m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\na=sendonly")),
    [],
  );
  assert.deepEqual(talkMids("garbage"), []);
});
