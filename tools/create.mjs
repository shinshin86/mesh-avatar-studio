#!/usr/bin/env node
// One command from an illustration to an open editor: creates projects/<name>, has Codex
// follow docs/agent-guide.md without questions, then starts the editor on that project.
// With --random, Codex first draws a new character to start from.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkEnvironment, formatReport, language } from './doctor.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Sprite layers that build-sprites cuts from every drawn variant.
export const SPRITES = [
  ...['closed', 'half', 'smile', 'sad', 'surprise'].flatMap(eye => [`eyes_${eye}_0`, `eyes_${eye}_1`]),
  'mouth_a', 'mouth_a_half', 'mouth_i', 'mouth_o', 'mouth_angry', 'mouth_sad',
];

const text = {
  en: {
    usage: 'Usage: npm run create -- <image.png> [--name <name>] [--yes | --no-variants] [--no-open]\n'
      + '       npm run create -- --random [--prompt <text>] [--seed <number>] [--name <name>] [--yes] [--no-open]\n\n'
      + 'Codex also draws closed eyes, mouth shapes and expressions with OpenAI image generation,\n'
      + 'and closes an open mouth in the illustration first so the avatar rests with it closed.\n'
      + 'The command asks first, because this sends the image and masks to OpenAI.\n\n'
      + '  --name         project name under projects/ (default: from the file name)\n'
      + '  --yes, -y      agree to the image generation without asking\n'
      + '  --no-variants  keep everything on this machine and skip the drawn variants\n'
      + '  --no-open      do not start the editor when the avatar is ready\n'
      + '  --random       draw a new anime-style girl with OpenAI image generation and start from her\n'
      + '  --prompt       with --random: what she should look like; the rest is chosen at random\n'
      + '  --seed         with --random: repeat the same random choices',
    missingImage: 'Give the path of a PNG illustration, or --random to draw a new character.',
    imageAndRandom: 'Give either an image or --random, not both.',
    randomNeedsVariants: '--random draws the character with OpenAI image generation, so it cannot be combined with --no-variants.',
    badSeed: seed => `Invalid seed: ${seed}. Use a whole number.`,
    randomConsent: 'Codex will draw a new character with OpenAI image generation, then her closed eyes,\nmouth shapes and expressions. The pictures and masks are sent to OpenAI. Continue? [Y/n] ',
    needRandomConsent: '--random uses OpenAI image generation. Without a terminal to ask, add --yes to agree.',
    character: (seed, character) => `Drawing a new character (seed ${seed}): ${character}`,
    drawFailed: status => `Codex could not draw the character (exit code ${status}).`,
    badDrawing: (path, problems) => `The drawn character cannot be used (${problems.join('; ')}): ${path}`,
    noImage: path => `Image not found: ${path}`,
    badName: name => `Invalid project name: ${name}. Use letters, digits, hyphens or underscores.`,
    exists: name => `projects/${name} already exists. Choose another --name.`,
    consent: 'Codex will draw closed eyes, mouth shapes and expressions with OpenAI image generation,\nand close the mouth first if it is open in the illustration.\nThis sends the image and masks to OpenAI. Continue? [Y/n] ',
    noConsent: 'Not sending the image. The avatar is made without drawn variants.',
    needConsent: 'Drawn variants send the image to OpenAI image generation. Without a terminal to ask, add --yes to agree or --no-variants to skip them.',
    environment: 'Fix the tools marked above, then run this command again.',
    noCodex: 'Codex CLI was not found. Install it and sign in: https://github.com/openai/codex',
    creating: name => `Creating projects/${name} …`,
    agent: 'Codex is building the avatar. This usually takes tens of minutes.',
    agentFailed: status => `Codex stopped with exit code ${status}. Its notes, if any, are in the project folder.`,
    incomplete: name => `Codex finished but projects/${name} has no built avatar. Read projects/${name}/HANDOVER.md for the reason.`,
    missingVariants: names => `These drawn variants are missing, so the avatar falls back for them: ${names.join(', ')}. See HANDOVER.md.`,
    ready: name => `The avatar is ready: projects/${name}. Hand-over notes: projects/${name}/HANDOVER.md`,
    opening: 'Starting the editor. Press Ctrl+C to stop it.',
  },
  ja: {
    usage: '使い方: npm run create -- <image.png> [--name <name>] [--yes | --no-variants] [--no-open]\n'
      + '        npm run create -- --random [--prompt <text>] [--seed <number>] [--name <name>] [--yes] [--no-open]\n\n'
      + 'Codex は OpenAI の画像生成で、閉じ目・口の形・表情の描き分けも作ります。\n'
      + 'イラストの口が開いていれば、先に口を閉じた絵にしてから作ります。\n'
      + '画像とマスクが OpenAI に送られるため、始める前に確認します。\n\n'
      + '  --name         projects/ に作るプロジェクト名(既定: ファイル名から作成)\n'
      + '  --yes, -y      確認せずに画像生成に同意する\n'
      + '  --no-variants  すべてこのマシンの中で行い、描き分けは作らない\n'
      + '  --no-open      アバターができてもエディタを起動しない\n'
      + '  --random       OpenAI の画像生成でアニメ調の女の子を新しく描き、そこから作る\n'
      + '  --prompt       --random のとき、見た目の希望。指定しない部分はランダムに決める\n'
      + '  --seed         --random のとき、同じランダムな組み合わせを再現する',
    missingImage: 'PNG のイラストのパスを指定するか、新しく描くなら --random を付けてください。',
    imageAndRandom: '画像と --random は同時に指定できません。',
    randomNeedsVariants: '--random は OpenAI の画像生成でキャラクターを描くため、--no-variants とは併用できません。',
    badSeed: seed => `seed が使えません: ${seed}。整数を指定してください。`,
    randomConsent: 'Codex が OpenAI の画像生成で新しいキャラクターを描き、閉じ目・口の形・表情の描き分けも作ります。\n絵とマスクが OpenAI に送られます。続けますか? [Y/n] ',
    needRandomConsent: '--random は OpenAI の画像生成を使います。確認できる端末がないため、同意するなら --yes を付けてください。',
    character: (seed, character) => `新しいキャラクターを描いています(seed ${seed}): ${character}`,
    drawFailed: status => `Codex がキャラクターを描けませんでした(終了コード ${status})。`,
    badDrawing: (path, problems) => `描いたキャラクターが使えません(${problems.join('、')}): ${path}`,
    noImage: path => `画像が見つかりません: ${path}`,
    badName: name => `プロジェクト名が使えません: ${name}。英数字、ハイフン、アンダースコアを使ってください。`,
    exists: name => `projects/${name} は既にあります。別の --name を指定してください。`,
    consent: 'Codex が OpenAI の画像生成で、閉じ目・口の形・表情の描き分けを作ります。\nイラストの口が開いていれば、先に口を閉じた絵にします。\n画像とマスクが OpenAI に送られます。続けますか? [Y/n] ',
    noConsent: '画像は送りません。描き分けなしでアバターを作ります。',
    needConsent: '描き分けを作ると画像が OpenAI の画像生成に送られます。確認できる端末がないため、同意するなら --yes、作らないなら --no-variants を付けてください。',
    environment: '上の警告やエラーのツールを用意してから、もう一度実行してください。',
    noCodex: 'Codex CLI が見つかりません。インストールしてサインインしてください: https://github.com/openai/codex',
    creating: name => `projects/${name} を作成しています…`,
    agent: 'Codex がアバターを作っています。通常は数十分かかります。',
    agentFailed: status => `Codex が終了コード ${status} で止まりました。メモがあればプロジェクトフォルダにあります。`,
    incomplete: name => `Codex は終了しましたが、projects/${name} にアバターができていません。理由は projects/${name}/HANDOVER.md を確認してください。`,
    missingVariants: names => `次の描き分けがなく、代わりの表示になります: ${names.join(', ')}。HANDOVER.md を確認してください。`,
    ready: name => `アバターができました: projects/${name}。引き継ぎメモ: projects/${name}/HANDOVER.md`,
    opening: 'エディタを起動します。止めるときは Ctrl+C を押してください。',
  },
};

export function parseArgs(argv) {
  const options = { image: undefined, name: undefined, variants: true, yes: false, open: true, help: false, random: false, prompt: undefined, seed: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--no-variants') options.variants = false;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--name') options.name = argv[++index];
    else if (arg.startsWith('--name=')) options.name = arg.slice(7);
    else if (arg === '--random') options.random = true;
    else if (arg === '--prompt') options.prompt = argv[++index];
    else if (arg.startsWith('--prompt=')) options.prompt = arg.slice(9);
    else if (arg === '--seed') options.seed = argv[++index];
    else if (arg.startsWith('--seed=')) options.seed = arg.slice(7);
    else if (arg === '--lang') index++;
    else if (!arg.startsWith('--')) options.image ??= arg;
  }
  return options;
}

export const validName = name => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name ?? '');

/** A project name from the file name, with a number added while that name is taken. */
export function projectName(image, taken = name => existsSync(join(root, 'projects', name))) {
  const stem = basename(image, extname(image)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'avatar';
  let name = stem;
  for (let index = 2; taken(name); index++) name = `${stem}-${index}`;
  return name;
}

// --random: create.mjs picks the looks so characters differ from run to run (a model left to
// itself draws much the same face), and a seed repeats the picks. The framing is kept in one
// place so other framings can be added later.
const FRAMING = 'bust-up portrait: from the top of the head to the chest, facing the viewer';
export const LOOKS = {
  hair: ['black', 'dark brown', 'chestnut brown', 'honey blonde', 'platinum blonde', 'silver', 'pastel pink', 'sky blue', 'lavender', 'mint green', 'auburn red'],
  hairstyle: ['short bob', 'chin-length bob', 'shoulder-length straight hair', 'shoulder-length wavy hair', 'long straight hair tucked behind the shoulders', 'low twin tails', 'high ponytail', 'side ponytail', 'short layered cut'],
  eyes: ['brown', 'amber', 'green', 'blue', 'violet', 'grey', 'red', 'teal'],
  outfit: ['school blazer uniform with a ribbon', 'sailor uniform', 'oversized hoodie', 'white blouse with a cardigan', 'sporty track jacket', 'casual knit sweater', 'idol stage costume', 'maid outfit', 'summer sundress', 'yukata'],
  mood: ['gentle smile', 'calm, soft smile', 'cheerful closed-mouth smile', 'cool, composed look'],
  palette: ['pastel colours', 'warm colours', 'cool colours', 'vivid colours', 'soft muted colours'],
};

/** Deterministic picks from LOOKS (mulberry32). */
export function pickLooks(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return Object.fromEntries(Object.entries(LOOKS).map(([key, values]) => [key, values[Math.floor(next() * values.length)]]));
}

export const describeLooks = looks => `${looks.hair} ${looks.hairstyle}, ${looks.eyes} eyes, ${looks.outfit}, ${looks.mood}, ${looks.palette}`;

/** What the illustration must look like for the rig, from the agent guide's image section. */
export function characterPrompt(looks, wish) {
  return [
    'An original anime-style girl, drawn as a clean, high-quality character illustration.',
    `Framing: ${FRAMING}, head and shoulders and upper chest fully inside the picture.`,
    wish ? `The person asked for: ${wish}. Follow that; use these only where it says nothing: ${describeLooks(looks)}.` : `Looks: ${describeLooks(looks)}.`,
    'Requirements for animating her:',
    '- transparent background (RGBA PNG), no scenery, no frame, no text;',
    '- face turned straight to the viewer, not three-quarter or profile;',
    '- mouth closed (a closed smile is fine); both eyes open and fully visible;',
    '- bangs and hair do not cover the eyes or eyebrows heavily;',
    '- no hands, glasses, hats, masks, large hair ornaments or objects near or over the face;',
    '- portrait orientation, at least 1024 px wide and 1536 px tall.',
    'She must not resemble any existing character, franchise or real person.',
  ].join('\n');
}

/** The request for codex exec that only draws the character. */
export function drawPrompt(output, looks, wish) {
  return [
    `Use your built-in image generation to draw this character and save her as a PNG at ${output}:`,
    '',
    characterPrompt(looks, wish),
    '',
    'Look at the result and check every requirement above. Generate again, up to 4 tries, if any of them fails; keep the best one.',
    `Check with a script that ${output} is a PNG with an alpha channel, that the background is transparent, and that it is at least 1536 px tall.`,
    `Only write inside ${dirname(output)}/. Your image generator also keeps its own copy elsewhere (for example ~/.codex/generated_images); that is expected and allowed. Do not stage or commit anything.`,
    'This run is non-interactive. End with a short summary of the picture and any requirement it still misses.',
  ].join('\n');
}

// Reads the drawing with Pillow (uv is required anyway) and lists what makes it unusable.
const INSPECT = "import json,sys\nfrom PIL import Image\nim=Image.open(sys.argv[1])\na=im.convert('RGBA').getchannel('A').getextrema()\nprint(json.dumps({'format':im.format,'width':im.width,'height':im.height,'transparent':a[0]<255}))";
export function drawingProblems(info) {
  if (!info) return ['not a readable image'];
  const problems = [];
  if (info.format !== 'PNG') problems.push('not a PNG');
  if (!info.transparent) problems.push('no transparent background');
  if (info.height < 800) problems.push(`only ${info.height} px tall`);
  return problems;
}

// The rig takes the mouth in the illustration as the closed rest mouth; an open one stays open
// while silent and in every expression. With the image generator allowed, close it first.
const closeMouth = project => [
  `- Open mouth (before Step 2): look at ${project}/source.png. If the mouth is open (teeth, tongue or the inside of the mouth show), close it first:`,
  `  1. Copy source.png to ${project}/work/original-source.png.`,
  '  2. With your image generator and source.png as the input, redraw only the mouth as a natural closed mouth in the same art style and expression (one thin lip line, no teeth, tongue or gap). Keep everything else the same.',
  '  3. The generator may shift, rescale or repaint the picture, so do not use its output directly: align it to source.png at the same size, then composite only the mouth region onto source.png with a soft-edged mask a little larger than the open mouth. Every pixel outside the mask, alpha included, must stay identical; check this with a script.',
  `  4. Save a 3x zoomed side-by-side crop (original | closed) to ${project}/work/closed-mouth-compare.png and look at it. Generate again, up to 4 tries, if the mouth looks unnatural or off-style, traces of the open mouth remain, or the skin shows a patch at the mask edge.`,
  `  5. Overwrite ${project}/source.png with the result (same size) and record what you did in the hand-over notes. If the mouth is already closed, leave source.png unchanged.`,
].join('\n');

/** The request Codex runs non-interactively: every question in the guide is answered here. */
export function agentPrompt(name, { variants }) {
  const project = `projects/${name}`;
  return [
    `Create a mesh avatar in ${project} by following docs/agent-guide.md from "Before you start" through Step 7.`,
    `Step 1 is already done: ${project}/source.png and ${project}/rig.draft.json exist. Do not run new-project.py again.`,
    '',
    'This run is non-interactive. Nobody can answer questions, so decide as follows:',
    '- Model: state which model you are running as in the hand-over notes and continue.',
    `- Vision check: run it with ${project}/work/vision-check as the folder. If the score fails, stop and explain it in the hand-over notes.`,
    '- Image warnings (pose, covered face, missing transparency): record them in the hand-over notes and continue.',
    variants ? closeMouth(project) : '- Open mouth: if the mouth in source.png is open, record in the hand-over notes that the avatar rests with it open, because closing it needs the image generator, which the person declined.',
    variants
      ? '- Step 6: the person agreed to send source.png and the masks to your built-in image generator. Generate every variant: closed, half and smiling eyes; mouths あ, half あ, い, お; and the expression variants eyes_sad, eyes_surprise, mouth_angry and mouth_sad. Then run build-sprites and review the poses again. Generate a variant again when build-sprites rejects it or its pose frames look wrong, up to 4 tries each. Do not finish Step 6 while a variant is missing; report any that still fail after 4 tries.'
      : '- Step 6: skip it. The person did not agree to send the image to an image generator.',
    `- Step 7: write the hand-over notes to ${project}/HANDOVER.md instead of telling the person. The editor is opened for them, so leave out how to open it.`,
    '',
    '- When a guide command fails only because of your sandbox (Chromium for render-poses cannot start there), run the same command again with escalated permissions. Do not copy or rewrite repository tools to work around it.',
    '- Build the avatar only with the tools the guide names. Do not post-process built/ with your own scripts: the editor rebuilds the avatar with the same tools, which would undo such changes. Report what the tools cannot fix instead.',
    '',
    `Only create or change files inside ${project}/. Do not change other files in the repository, and do not stage or commit anything.`,
    'Your image generator also keeps its own copy of each result outside the repository (for example ~/.codex/generated_images); that is expected and allowed.',
    'End with a short summary of the result and the parts to check first.',
  ].join('\n');
}

const execute = (command, args, options = {}) => new Promise(done => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  child.on('error', () => done(null));
  child.on('exit', status => done(status));
});

const confirm = async question => {
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C rejects the question; that cancels the whole command (null) rather than declining.
  try { return !/^n/i.test((await prompt.question(question)).trim()); } catch { return null; } finally { prompt.close(); }
};

const capture = (command, args) => new Promise(done => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', () => done(null));
  child.on('exit', status => done(status === 0 ? output.trim() : null));
});

export async function create(argv, deps = {}) {
  const { run = execute, read = capture, exists = existsSync, environment = checkEnvironment, log = console.log, error = console.error,
    readJson = path => JSON.parse(readFileSync(path, 'utf8')), ask = confirm, interactive = Boolean(process.stdin.isTTY), cwd = process.env.INIT_CWD || process.cwd(),
    save = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); },
    randomSeed = () => Math.floor(Math.random() * 100000), today = () => new Date() } = deps;
  const lang = language(argv), t = text[lang], options = parseArgs(argv);
  if (options.help) { log(t.usage); return 0; }
  if (options.random && options.image) { error(t.imageAndRandom); return 1; }
  if (options.random && !options.variants) { error(t.randomNeedsVariants); return 1; }
  if (!options.image && !options.random) { error(`${t.missingImage}\n\n${t.usage}`); return 1; }
  const seed = options.random ? (options.seed === undefined ? randomSeed() : Number(options.seed)) : undefined;
  if (options.random && !Number.isSafeInteger(seed)) { error(t.badSeed(options.seed)); return 1; }
  // npm run starts in the repository root; INIT_CWD is where the person typed the command.
  let image = options.image && resolve(cwd, options.image);
  if (image && !exists(image)) { error(t.noImage(options.image)); return 1; }
  const taken = value => exists(join(root, 'projects', value));
  const day = today(), stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  const name = options.name ?? (options.random ? projectName(`random-${stamp}-${seed}`, taken) : projectName(options.image, taken));
  if (!validName(name)) { error(t.badName(name)); return 1; }
  if (exists(join(root, 'projects', name))) { error(t.exists(name)); return 1; }
  // Ask before anything slow: the answer decides whether the image may leave this machine.
  if (options.variants && !options.yes) {
    if (!interactive) { error(options.random ? t.needRandomConsent : t.needConsent); return 1; }
    const answer = await ask(options.random ? t.randomConsent : t.consent);
    if (answer === null) return 130;
    if (!answer && options.random) return 1;
    if (!answer) { options.variants = false; log(t.noConsent); }
  }

  // Every step of the guide needs uv, Python and Chromium, so a warning blocks here.
  const results = await environment(lang);
  if (results.some(result => result.status !== 'ok')) { error(formatReport(results, lang)); error(t.environment); return 1; }
  if (!await read('codex', ['--version'])) { error(t.noCodex); return 1; }
  // Codex works in its sandbox and asks for more only to run Chromium and similar tools;
  // --approve-for-me has those requests reviewed automatically instead of by a person.
  // Its stdin stays closed: codex exec would otherwise wait to append piped input to the prompt.
  const cache = await read('uv', ['cache', 'dir']);
  const codex = prompt => run('codex', ['exec', '--approve-for-me', '-C', root, ...(cache ? ['--add-dir', cache] : []), prompt], { stdio: ['ignore', 'inherit', 'inherit'] });

  let character;
  if (options.random) {
    const looks = pickLooks(seed);
    image = join(root, 'work', 'random', name, 'source.png');
    const output = relative(root, image).split('\\').join('/');
    character = { seed, looks, prompt: options.prompt ?? null, request: characterPrompt(looks, options.prompt) };
    log(t.character(seed, options.prompt ?? describeLooks(looks)));
    const drawn = await codex(drawPrompt(output, looks, options.prompt));
    if (drawn !== 0) { error(t.drawFailed(drawn)); return drawn ?? 1; }
    let info = null;
    if (exists(image)) try { info = JSON.parse(await read('uv', ['run', '--with', 'pillow', 'python', '-c', INSPECT, image]) ?? 'null'); } catch { /* reported below */ }
    const problems = drawingProblems(info);
    if (problems.length) { error(t.badDrawing(output, problems)); return 1; }
  }

  log(t.creating(name));
  const created = await run('uv', ['run', 'tools/new-project.py', image, name]);
  if (created !== 0) return created ?? 1;
  const project = join(root, 'projects', name);
  if (character) save(join(project, 'work', 'character.json'), `${JSON.stringify(character, null, 2)}\n`);

  log(t.agent);
  const agent = await codex(agentPrompt(name, options));
  if (agent !== 0) { error(t.agentFailed(agent)); return agent ?? 1; }
  if (!exists(join(project, 'rig.json')) || !exists(join(project, 'built', 'base.png'))) { error(t.incomplete(name)); return 1; }
  if (options.variants) {
    let layers = {};
    try { layers = readJson(join(project, 'built', 'sprites', 'sprites.json')).layers ?? {}; } catch { /* no sprites were built */ }
    const missing = SPRITES.filter(sprite => !(sprite in layers));
    if (missing.length) error(t.missingVariants(missing));
  }
  log(t.ready(name));
  if (!options.open) return 0;

  log(t.opening);
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return await run(process.execPath, [vite, '--host', '127.0.0.1', '--open', `/?project=${encodeURIComponent(name)}`]) ?? 1;
}

// npm run starts this file through a link, so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await create(process.argv.slice(2));
}
