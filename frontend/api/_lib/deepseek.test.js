// deepseek helper 纯函数测试 — 不发任何网络请求
import { describe, it, expect } from 'vitest';
import { safeJsonParse, clampInt } from './deepseek.js';

describe('safeJsonParse', () => {
  it('plain JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fence', () => {
    expect(safeJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips ``` (no lang) fence', () => {
    expect(safeJsonParse('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts {} from surrounding text', () => {
    expect(safeJsonParse('Sure, here:\n{"a":1}\nThat\'s it.')).toEqual({ a: 1 });
  });

  it('handles nested objects', () => {
    expect(safeJsonParse('```json\n{"a":{"b":2},"c":[1,2]}\n```')).toEqual({ a: { b: 2 }, c: [1, 2] });
  });

  it('throws on unparsable', () => {
    expect(() => safeJsonParse('totally not json')).toThrow();
  });
});

describe('clampInt', () => {
  it('valid int', () => {
    expect(clampInt(3, 1, 5, 0)).toBe(3);
    expect(clampInt(1, 1, 5, 0)).toBe(1);
    expect(clampInt(5, 1, 5, 0)).toBe(5);
  });

  it('string digit coerced', () => {
    expect(clampInt('4', 1, 5, 0)).toBe(4);
  });

  it('out of range returns default', () => {
    expect(clampInt(10, 1, 5, 3)).toBe(3);
    expect(clampInt(0, 1, 5, 3)).toBe(3);
    expect(clampInt(-1, 1, 5, 3)).toBe(3);
  });

  it('non-numeric returns default', () => {
    expect(clampInt('garbage', 1, 5, 3)).toBe(3);
    expect(clampInt(null, 1, 5, 3)).toBe(3);
    expect(clampInt(undefined, 1, 5, 3)).toBe(3);
    expect(clampInt({}, 1, 5, 3)).toBe(3);
  });

  it('float truncates', () => {
    expect(clampInt(2.7, 1, 5, 0)).toBe(2);
  });
});
