import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig } from 'mesh-avatar';
import { RigHistory } from '../src/editor/history';
import { setAt } from '../src/editor/model';

test('one drag is one command and undo/redo restores exact JSON', () => {
  const rig = parseRig(fixture);
  const history = new RigHistory(rig);
  history.begin();
  history.change(setAt(rig, 'head.cx', 630));
  history.change(setAt(rig, 'head.cx', 650));
  history.end();
  const final = JSON.stringify(history.present);
  expect(history.undo()).toEqual(rig);
  expect(history.canUndo).toBe(false);
  expect(JSON.stringify(history.redo())).toBe(final);
  history.undo();
  history.change(setAt(rig, 'head.cy', 420));
  expect(history.canRedo).toBe(false);
});
test('a click with no change adds no history entry', () => {
  const history = new RigHistory(parseRig(fixture));
  history.begin();
  history.change(history.present);
  history.end();
  expect(history.canUndo).toBe(false);
});
test('opening another project drops edits and a pending gesture from the preceding project', () => {
  const first = parseRig(fixture), second = setAt(first, 'head.cx', 999);
  const history = new RigHistory(first);
  history.change(setAt(first, 'head.cx', 630)); history.begin();
  history.change(setAt(first, 'head.cx', 650)); history.load(second);
  expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(false);
  expect(history.undo()).toEqual(second);
  history.change(setAt(second, 'head.cx', 1000)); expect(history.undo()).toEqual(second);
});
