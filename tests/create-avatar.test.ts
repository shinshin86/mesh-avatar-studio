import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { agentPrompt, characterPrompt, create, drawingProblems, parseArgs, pickLooks, projectName, LOOKS, SPRITES } from '../tools/create.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ready = async () => ['node', 'packages', 'uv', 'python', 'chromium'].map(id => ({ id, status: 'ok', message: id }));

type Drawing = { format: string; width: number; height: number; transparent: boolean } | null;
const drawing: Drawing = { format: 'PNG', width: 1024, height: 1536, transparent: true };

function harness({ files = [] as string[], statuses = {} as Record<string, number | null>, environment = ready, answer = true as boolean | null, interactive = true, sprites = SPRITES, drawn = drawing as Drawing } = {}) {
  const calls: { command: string; args: string[]; options?: { stdio?: unknown } }[] = [], logs: string[] = [], errors: string[] = [], questions: string[] = [];
  const existing = new Set(files), saved: Record<string, string> = {};
  const run = async (command: string, args: string[], options?: { stdio?: unknown }) => {
    calls.push({ command, args, options });
    const prompt = args.at(-1)!;
    const key = command === process.execPath ? 'vite' : command === 'codex' && prompt.includes('draw this character') ? 'codex draw' : `${command} ${args[0]}`;
    if (key === 'codex draw' && !(key in statuses)) existing.add(join(root, prompt.match(/save her as a PNG at (\S+):/)![1]));
    if (key === 'codex exec' && !(key in statuses)) {
      const name = prompt.match(/in projects\/([^ ]+) by/)![1];
      existing.add(join(root, 'projects', name, 'rig.json')).add(join(root, 'projects', name, 'built', 'base.png'));
    }
    return key in statuses ? statuses[key] : 0;
  };
  const read = async (command: string, args: string[]) => command === 'codex' ? 'codex-cli 0.164.0' : args[0] === 'run' ? JSON.stringify(drawn) : '/cache/uv';
  const save = (path: string, data: string) => { saved[path] = data; };
  const ask = async (question: string) => { questions.push(question); return answer; };
  const readJson = () => ({ layers: Object.fromEntries(sprites.map(sprite => [sprite, [0, 0, 1, 1]])) });
  const deps = { run, read, readJson, save, randomSeed: () => 4821, today: () => new Date(2026, 9, 27, 7, 30), ask, interactive, exists: (path: string) => existing.has(path), environment, log: (m: string) => logs.push(m), error: (m: string) => errors.push(m), cwd: '/work' };
  return { calls, logs, errors, questions, saved, deps };
}

describe('npm run create', () => {
  test('parses the image, name and flags', () => {
    expect(parseArgs(['a.png', '--name', 'mio', '--yes', '--no-open', '--lang', 'ja'])).toMatchObject({ image: 'a.png', name: 'mio', variants: true, yes: true, open: false });
    expect(parseArgs(['--name=mio', 'b.png', '--no-variants'])).toMatchObject({ image: 'b.png', name: 'mio', variants: false, yes: false, open: true });
    expect(parseArgs(['c.png', '-y'])).toMatchObject({ variants: true, yes: true });
  });

  test('derives a project name from the file name and skips taken names', () => {
    expect(projectName('/x/My New Avatar (v2).png', () => false)).toBe('my-new-avatar-v2');
    expect(projectName('/x/少女.png', () => false)).toBe('avatar');
    expect(projectName('mio.png', name => name === 'mio' || name === 'mio-2')).toBe('mio-3');
  });

  test('answers every question of the guide and draws every variant only with consent', () => {
    const plain = agentPrompt('mio', { variants: false });
    expect(plain).toContain('docs/agent-guide.md');
    expect(plain).toContain('projects/mio/HANDOVER.md');
    expect(plain).toContain('Step 6: skip it');
    expect(plain).toContain('the avatar rests with it open');
    expect(plain).not.toContain('close it first');
    expect(plain).toContain('do not stage or commit');
    expect(plain).toContain('run the same command again with escalated permissions');
    expect(plain).toContain('Do not post-process built/');
    expect(plain).toContain('keeps its own copy of each result outside the repository');
    const variants = agentPrompt('mio', { variants: true });
    expect(variants).toContain('the person agreed to send source.png and the masks');
    expect(variants).toContain('eyes_sad, eyes_surprise, mouth_angry and mouth_sad');
    expect(variants).toContain('Do not finish Step 6 while a variant is missing');
    // an open mouth is closed before the rig is drawn, keeping every other pixel
    expect(variants).toContain('Open mouth (before Step 2)');
    expect(variants).toContain('Every pixel outside the mask, alpha included, must stay identical');
    expect(variants).toContain('projects/mio/work/original-source.png');
  });

  test('asks about OpenAI image generation first, then creates the project, runs Codex and opens the editor', async () => {
    const { calls, questions, deps } = harness({ files: ['/work/mio.png'] });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('This sends the image and masks to OpenAI.');
    expect(calls.map(call => `${call.command === process.execPath ? 'vite' : call.command} ${call.args[0]}`)).toEqual(['uv run', 'codex exec', 'vite ' + join(root, 'node_modules/vite/bin/vite.js')]);
    expect(calls[0].args).toEqual(['run', 'tools/new-project.py', '/work/mio.png', 'mio']);
    expect(calls[1].args.slice(0, 6)).toEqual(['exec', '--approve-for-me', '-C', root, '--add-dir', '/cache/uv']);
    expect(calls[1].args.at(-1)).toContain('the person agreed to send');
    expect(calls[1].options?.stdio).toEqual(['ignore', 'inherit', 'inherit']);
    expect(calls[2].args).toContain('/?project=mio');
  });

  test('a declined, skipped or pre-approved image generation is not asked again', async () => {
    const declined = harness({ files: ['/work/mio.png'], answer: false });
    expect(await create(['mio.png', '--lang', 'en'], declined.deps)).toBe(0);
    expect(declined.logs).toContain('Not sending the image. The avatar is made without drawn variants.');
    expect(declined.calls[1].args.at(-1)).toContain('Step 6: skip it');
    for (const [flag, step] of [['--yes', 'the person agreed to send'], ['--no-variants', 'Step 6: skip it']]) {
      const { calls, questions, deps } = harness({ files: ['/work/mio.png'], interactive: false });
      expect(await create(['mio.png', flag, '--lang', 'en'], deps)).toBe(0);
      expect(questions).toEqual([]);
      expect(calls[1].args.at(-1)).toContain(step);
    }
  });

  test('cancelling the question stops before anything runs', async () => {
    const { calls, deps } = harness({ files: ['/work/mio.png'], answer: null });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(130);
    expect(calls).toEqual([]);
  });

  test('names the drawn variants that are still missing, and still opens the editor', async () => {
    const complete = harness({ files: ['/work/mio.png'] });
    expect(await create(['mio.png', '--lang', 'en'], complete.deps)).toBe(0);
    expect(complete.errors).toEqual([]);
    const partial = harness({ files: ['/work/mio.png'], sprites: SPRITES.filter(sprite => !sprite.startsWith('mouth_o') && !sprite.startsWith('eyes_half')) });
    expect(await create(['mio.png', '--lang', 'en'], partial.deps)).toBe(0);
    expect(partial.errors[0]).toContain('eyes_half_0, eyes_half_1, mouth_o');
    expect(partial.calls.at(-1)!.command).toBe(process.execPath);
    const skipped = harness({ files: ['/work/mio.png'], sprites: [] });
    expect(await create(['mio.png', '--no-variants', '--lang', 'en'], skipped.deps)).toBe(0);
    expect(skipped.errors).toEqual([]);
  });

  test('without a terminal it needs --yes or --no-variants before doing anything', async () => {
    const { calls, errors, deps } = harness({ files: ['/work/mio.png'], interactive: false });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(1);
    expect(errors[0]).toContain('add --yes to agree or --no-variants');
    expect(calls).toEqual([]);
  });

  test('stops before creating anything when a tool is missing', async () => {
    const environment = async () => [{ id: 'chromium', status: 'warn', message: 'Playwright Chromium was not found.' }];
    const { calls, errors, deps } = harness({ files: ['/work/mio.png'], environment });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join('\n')).toContain('Playwright Chromium was not found.');
  });

  test('refuses an existing project and does not open the editor when Codex fails', async () => {
    const taken = harness({ files: ['/work/mio.png', join(root, 'projects', 'mio')] });
    expect(await create(['mio.png', '--name', 'mio', '--lang', 'en'], taken.deps)).toBe(1);
    expect(taken.errors[0]).toContain('projects/mio already exists');
    const failed = harness({ files: ['/work/mio.png'], statuses: { 'codex exec': 2 } });
    expect(await create(['mio.png', '--lang', 'en'], failed.deps)).toBe(2);
    expect(failed.calls.some(call => call.command === process.execPath)).toBe(false);
  });

  test('does not open the editor when Codex leaves no built avatar', async () => {
    const { calls, errors, deps } = harness({ files: ['/work/mio.png'], statuses: { 'codex exec': 0 } });
    expect(await create(['mio.png', '--lang', 'en'], deps)).toBe(1);
    expect(errors[0]).toContain('HANDOVER.md');
    expect(calls.some(call => call.command === process.execPath)).toBe(false);
  });

  test('--random draws a character first, checks it, then builds from it', async () => {
    const { calls, questions, saved, logs, deps } = harness();
    expect(await create(['--random', '--lang', 'en'], deps)).toBe(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('draw a new character with OpenAI image generation');
    const draw = calls[0];
    expect(draw.args.slice(0, 2)).toEqual(['exec', '--approve-for-me']);
    expect(draw.args.at(-1)).toContain('save her as a PNG at work/random/random-20261027-4821/source.png:');
    expect(calls[1].args).toEqual(['run', 'tools/new-project.py', join(root, 'work/random/random-20261027-4821/source.png'), 'random-20261027-4821']);
    expect(calls[2].args.at(-1)).toContain('in projects/random-20261027-4821 by');
    expect(calls[2].args.at(-1)).toContain('the person agreed to send');
    const character = JSON.parse(saved[join(root, 'projects/random-20261027-4821/work/character.json')]);
    expect(character).toMatchObject({ seed: 4821, looks: pickLooks(4821), prompt: null });
    expect(logs.some(line => line.includes('seed 4821'))).toBe(true);
    expect(calls.at(-1)!.args).toContain('/?project=random-20261027-4821');
  });

  test('--seed repeats the looks and --prompt takes priority over them', async () => {
    expect(pickLooks(42)).toEqual(pickLooks(42));
    const picks = new Set(Array.from({ length: 50 }, (_, seed) => JSON.stringify(pickLooks(seed))));
    expect(picks.size).toBeGreaterThan(40);
    for (const [key, value] of Object.entries(pickLooks(7))) expect(LOOKS[key as keyof typeof LOOKS]).toContain(value);
    const { calls, saved, deps } = harness();
    expect(await create(['--random', '--seed', '42', '--prompt', 'silver short hair, school uniform', '--name', 'mio', '--yes', '--lang', 'en'], deps)).toBe(0);
    expect(calls[0].args.at(-1)).toContain('The person asked for: silver short hair, school uniform.');
    expect(JSON.parse(saved[join(root, 'projects/mio/work/character.json')])).toMatchObject({ seed: 42, prompt: 'silver short hair, school uniform' });
  });

  test('the character request keeps the rig requirements', () => {
    const request = characterPrompt(pickLooks(1), undefined);
    for (const rule of ['anime-style girl', 'bust-up portrait', 'transparent background', 'mouth closed', 'both eyes open', 'no hands, glasses, hats', 'must not resemble any existing character']) {
      expect(request).toContain(rule);
    }
  });

  test('--random stops before building when the drawing fails or cannot be used', async () => {
    const failed = harness({ statuses: { 'codex draw': 1 } });
    expect(await create(['--random', '--yes', '--lang', 'en'], failed.deps)).toBe(1);
    expect(failed.errors[0]).toContain('could not draw the character');
    expect(failed.calls).toHaveLength(1);
    const opaque = harness({ drawn: { ...drawing, transparent: false } });
    expect(await create(['--random', '--yes', '--lang', 'en'], opaque.deps)).toBe(1);
    expect(opaque.errors[0]).toContain('no transparent background');
    expect(opaque.calls).toHaveLength(1);
    expect(drawingProblems(null)).toEqual(['not a readable image']);
    expect(drawingProblems({ format: 'JPEG', width: 600, height: 700, transparent: false })).toEqual(['not a PNG', 'no transparent background', 'only 700 px tall']);
  });

  test('--random refuses an image, --no-variants, a bad seed, a declined question and no terminal', async () => {
    const cases: [string[], string][] = [
      [['a.png', '--random'], 'either an image or --random'],
      [['--random', '--no-variants'], 'cannot be combined with --no-variants'],
      [['--random', '--seed', 'abc'], 'Invalid seed: abc'],
    ];
    for (const [args, message] of cases) {
      const { calls, errors, deps } = harness({ files: ['/work/a.png'] });
      expect(await create([...args, '--lang', 'en'], deps)).toBe(1);
      expect(errors[0]).toContain(message);
      expect(calls).toEqual([]);
    }
    const declined = harness({ answer: false });
    expect(await create(['--random', '--lang', 'en'], declined.deps)).toBe(1);
    expect(declined.calls).toEqual([]);
    const headless = harness({ interactive: false });
    expect(await create(['--random', '--lang', 'en'], headless.deps)).toBe(1);
    expect(headless.errors[0]).toContain('add --yes to agree');
  });
});
