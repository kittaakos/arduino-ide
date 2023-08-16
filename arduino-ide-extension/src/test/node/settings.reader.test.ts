import { expect } from 'chai';
import { parseJsonc } from '../../node/settings-reader';

describe('settings-reader', () => {
  describe('parse', () => {
    it('should handle comments', async () => {
      const actual = await parseJsonc(`
{
    "alma": "korte",
    // comment
    "szilva": false
}`);
      expect(actual).to.be.deep.equal({
        alma: 'korte',
        szilva: false,
      });
    });

    it('should handle trailing comma', async () => {
      const actual = await parseJsonc(`
{
    "alma": "korte",
    "szilva": 123,
}`);
      expect(actual).to.be.deep.equal({
        alma: 'korte',
        szilva: 123,
      });
    });

    it('should parse empty', async () => {
      const actual = await parseJsonc('');
      expect(actual).to.be.deep.equal({});
    });

    it('should parse to undefined when parse has failed', async () => {
      const actual = await parseJsonc(`
{
    alma:: 'korte'
    trash
}`);
      expect(actual).to.be.undefined;
    });
  });
});
