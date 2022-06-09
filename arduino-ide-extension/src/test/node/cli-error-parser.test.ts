import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/node';
import { expect } from 'chai';
import { Sketch } from '../../common/protocol';
import {
  tryParseError,
  ErrorInfo,
  ErrorSource,
} from '../../node/cli-error-parser';

const TestSketchUri = new URI('/path/to/my/sketchbook/TestSketch').withScheme(
  'file'
);
const TestSketchMainFileUri = TestSketchUri.resolve(
  `${TestSketchUri.path.name}.ino`
);
const TestSketchMainFilePath = FileUri.fsPath(TestSketchMainFileUri);
const TestSketch: Sketch = {
  name: TestSketchUri.path.name,
  uri: TestSketchUri.toString(),
  additionalFileUris: [],
  mainFileUri: TestSketchMainFileUri.toString(),
  otherSketchFileUris: [],
  rootFolderFileUris: [],
};

describe('cli-error-parser', () => {
  const suites = [
    [
      {
        content: `${TestSketchMainFilePath}:11:1: error: 'sssvoid' does not name a type; did you mean 'void'?
sssvoid loop() {
^~~~~~~
void
${TestSketchMainFilePath}:11:1: error: 'sssvoid' does not name a type; did you mean 'void'?
sssvoid loop() {
^~~~~~~
void`,
        sketch: TestSketch,
      },
      {
        message: "'sssvoid' does not name a type; did you mean 'void'?",
        location: {
          uri: TestSketchMainFileUri.toString(),
          line: 11,
          column: 1,
        },
      },
    ],
  ] as [source: ErrorSource, expected: ErrorInfo][];
  suites.forEach(([source, expected], index) => {
    it(`should pass suite #${index}`, () => {
      const actual = tryParseError(source);
      expect(actual).to.be.deep.equal(expected);
    });
  });
});
