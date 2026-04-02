import { describe, expect, it } from "vitest";
import { createS3LogClient } from "../services/s3-log-store-utils.js";

/**
 * Tests the range-read boundary guard using the in-memory buffer path
 * (readFromBuffer), which shares the same offset/limit logic as readRange.
 *
 * Reproduces the bug where offset === content size caused an S3 InvalidRange
 * (HTTP 416) because the guard `start > end` failed to catch it.
 */
describe("s3-log-store range boundary", () => {
  // createS3LogClient needs config but readFromBuffer never touches S3
  const client = createS3LogClient({
    bucket: "test",
    region: "us-east-1",
  });

  it("returns empty content when offset equals buffer size", () => {
    const buf = client.createBuffer("test-key");
    client.appendToBuffer(buf, '{"msg":"line1"}');
    client.appendToBuffer(buf, '{"msg":"line2"}');

    const content = '{"msg":"line1"}\n{"msg":"line2"}\n';
    const byteLength = Buffer.byteLength(content, "utf8");

    const result = client.readFromBuffer(buf, byteLength, 1024);
    expect(result.content).toBe("");
    expect(result.nextOffset).toBeUndefined();

    client.removeBuffer("test-key");
  });

  it("returns empty content when offset exceeds buffer size", () => {
    const buf = client.createBuffer("test-key-2");
    client.appendToBuffer(buf, '{"msg":"a"}');

    const content = '{"msg":"a"}\n';
    const byteLength = Buffer.byteLength(content, "utf8");

    const result = client.readFromBuffer(buf, byteLength + 100, 1024);
    expect(result.content).toBe("");
    expect(result.nextOffset).toBeUndefined();

    client.removeBuffer("test-key-2");
  });

  it("reads content when offset is within range", () => {
    const buf = client.createBuffer("test-key-3");
    client.appendToBuffer(buf, '{"msg":"hello"}');

    const result = client.readFromBuffer(buf, 0, 1024);
    expect(result.content).toContain("hello");
    expect(result.nextOffset).toBeUndefined();

    client.removeBuffer("test-key-3");
  });

  it("reads partial content with limited bytes", () => {
    const buf = client.createBuffer("test-key-4");
    client.appendToBuffer(buf, '{"msg":"hello"}');
    client.appendToBuffer(buf, '{"msg":"world"}');

    const result = client.readFromBuffer(buf, 0, 5);
    expect(result.content).toHaveLength(5);
    expect(result.nextOffset).toBe(5);

    client.removeBuffer("test-key-4");
  });
});
