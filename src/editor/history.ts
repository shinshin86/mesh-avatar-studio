import type { Rig } from 'mesh-avatar';

export class RigHistory {
  present: Rig;
  private past: Rig[] = [];
  private future: Rig[] = [];
  private gesture: Rig | null = null;
  constructor(rig: Rig) { this.present = structuredClone(rig); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  load(rig: Rig) {
    this.present = structuredClone(rig);
    this.past = []; this.future = []; this.gesture = null;
  }
  replacePresent(rig: Rig) { this.present = structuredClone(rig); }
  begin() { if (!this.gesture) this.gesture = structuredClone(this.present); }
  change(rig: Rig) {
    if (JSON.stringify(rig) === JSON.stringify(this.present)) return;
    if (!this.gesture) {
      this.past.push(structuredClone(this.present));
      this.future = [];
    }
    this.present = structuredClone(rig);
  }
  end() {
    if (this.gesture && JSON.stringify(this.gesture) !== JSON.stringify(this.present)) {
      this.past.push(this.gesture);
      this.future = [];
    }
    this.gesture = null;
  }
  undo() {
    this.end();
    const previous = this.past.pop();
    if (previous) { this.future.push(structuredClone(this.present)); this.present = previous; }
    return structuredClone(this.present);
  }
  redo() {
    this.end();
    const next = this.future.pop();
    if (next) { this.past.push(structuredClone(this.present)); this.present = next; }
    return structuredClone(this.present);
  }
}

export function downloadRig(rig: Rig) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(rig, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'rig.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
