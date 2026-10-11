// These values count pixels or cells; subpixel precision is useful for other geometry.
export function isIntegerField(path: string): boolean {
  return /^(?:image\.(?:width|height)|accessories\.\d+\.box\.\d+|mesh\.(?:baseCell|handCell|tasselCell|eyeBallCell|eyeCell|spriteCell|fine\.(?:x0|x1|y0|y1|cell)))$/.test(path);
}
export function editorNumber(path: string, value: number): number {
  return isIntegerField(path) ? Math.round(value) : value;
}
