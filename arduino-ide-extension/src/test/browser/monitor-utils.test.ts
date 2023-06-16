import { expect } from 'chai';
import {
  Line,
  messagesToLines,
  truncateLines,
} from '../../browser/serial/monitor/monitor-utils';
import { set, reset } from 'mockdate';

type TestLine = {
  messages: string[];
  prevLines?: { lines: Line[]; charCount: number };
  expected: { lines: Line[]; charCount: number };
  expectedTruncated?: {
    lines: Line[];
    charCount: number;
    maxCharacters?: number;
  };
};

const date = new Date();
const testLines: TestLine[] = [
  {
    messages: ['Hello'],
    expected: { lines: [{ message: 'Hello', length: 5 }], charCount: 5 },
  },
  {
    messages: ['Hello', 'Dog!'],
    expected: { lines: [{ message: 'HelloDog!', length: 9 }], charCount: 9 },
  },
  {
    messages: ['Hello\n', 'Dog!'],
    expected: {
      lines: [
        { message: 'Hello\n', length: 6 },
        { message: 'Dog!', length: 4 },
      ],
      charCount: 10,
    },
  },
  {
    messages: ['Dog!'],
    prevLines: { lines: [{ message: 'Hello\n', length: 6 }], charCount: 6 },
    expected: {
      lines: [
        { message: 'Hello\n', length: 6 },
        { message: 'Dog!', length: 4 },
      ],
      charCount: 10,
    },
  },
  {
    messages: [' Dog!\n', " Who's a good ", 'boy?\n', "You're a good boy!"],
    prevLines: { lines: [{ message: 'Hello', length: 5 }], charCount: 5 },
    expected: {
      lines: [
        { message: 'Hello Dog!\n', length: 11 },
        { message: " Who's a good boy?\n", length: 19 },
        { message: "You're a good boy!", length: 8 },
      ],
      charCount: 48,
    },
    expectedTruncated: {
      maxCharacters: 20,
      charCount: 20,
      lines: [
        { message: '?\n', length: 2 },
        { message: "You're a good boy!", length: 8 },
      ],
    },
  },
  {
    messages: ['boy?\n', "You're a good boy!"],
    prevLines: {
      lines: [
        { message: 'Hello Dog!\n', length: 11 },
        { message: " Who's a good ", length: 14 },
      ],
      charCount: 25,
    },
    expected: {
      lines: [
        { message: 'Hello Dog!\n', length: 11 },
        { message: " Who's a good boy?\n", length: 19 },
        { message: "You're a good boy!", length: 8 },
      ],
      charCount: 48,
    },
    expectedTruncated: {
      maxCharacters: 20,
      charCount: 20,
      lines: [
        { message: '?\n', length: 2 },
        { message: "You're a good boy!", length: 8 },
      ],
    },
  },
  {
    messages: ["Who's a good boy?\n", 'Yo'],
    prevLines: {
      lines: [{ message: 'Hello Dog!\n', length: 11 }],
      charCount: 11,
    },
    expected: {
      lines: [
        { message: 'Hello Dog!\n', length: 11 },
        { message: "Who's a good boy?\n", length: 18 },
        { message: 'Yo', length: 2 },
      ],
      charCount: 31,
    },
    expectedTruncated: {
      maxCharacters: 20,
      charCount: 20,
      lines: [
        { message: "Who's a good boy?\n", length: 18 },
        { message: 'Yo', length: 2 },
      ],
    },
  },
];

testLines.forEach((t) =>
  [...t.expected.lines, ...(t.prevLines?.lines || [])].forEach(
    (l) => (l.timestamp = date)
  )
);

describe('Monitor Utils', () => {
  beforeEach(() => {
    set(date);
  });

  afterEach(() => {
    reset();
  });

  testLines.forEach((testLine) => {
    context('when converting messages', () => {
      it('should give the right result', () => {
        const [newLines, addedCharCount] = messagesToLines(
          testLine.messages,
          testLine.prevLines?.lines,
          testLine.prevLines?.charCount
        );
        newLines.forEach((line, index) => {
          expect(line.message).to.equal(testLine.expected.lines[index].message);
          expect(line.timestamp).to.deep.equal(
            testLine.expected.lines[index].timestamp
          );
        });
        expect(addedCharCount).to.equal(testLine.expected.charCount);

        const [truncatedLines, totalCharCount] = truncateLines(
          newLines,
          addedCharCount,
          testLine.expectedTruncated?.maxCharacters
        );
        let charCount = 0;
        if (testLine.expectedTruncated) {
          truncatedLines.forEach((line, index) => {
            expect(line.message).to.equal(
              testLine.expectedTruncated?.lines[index].message
            );
            charCount += line.message.length;
          });
          expect(totalCharCount).to.equal(charCount);
        }
      });
    });
  });
});
