import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readPreference, savePreference } from './preferences';
import { workflowEn, workflowJa } from './workflow-i18n';
import { uiZh, workflowZh, partsZh, fieldsZh } from './i18n-zh';
export { readPreference, savePreference } from './preferences';

export type Language = 'en' | 'ja' | 'zh';
export const LANGUAGE_KEY = 'mesh-avatar-language';
export const GUIDE_KEY = 'mesh-avatar-guide-seen';

const en = {
  ...workflowEn,
  product: 'Mesh Avatar Studio', subtitle: 'Shape the motion in your illustration',
  tools: 'Project tools', openProject: 'Open project', openRig: 'Load rig.json only…', openFolder: 'Browse for a project folder…',
  rigFile: 'Open rig file', folderFiles: 'Open project folder files', save: 'Save rig', undo: 'Undo', redo: 'Redo',
  projectHelp: 'A project is the folder an agent created from your illustration: rig.json, source.png and built/.',
  recent: 'Recent', noRecent: 'No recent projects.', clearHistory: 'Clear history', removeRecent: 'Remove from history',
  reopenLast: 'Reopen last project on start', browseAgain: 'Browse again', missingRecent: 'Project no longer exists; removed from history:',
  localProjects: 'Local projects', noProjects: 'No local projects yet.', sampleProject: 'Sample project', updated: 'Updated',
  drawnVariants: 'Drawn eyes/mouths', readOnly: 'Read-only', copyPath: 'Copy path', copyFolderPath: 'Copy folder path', copied: 'Path copied',
  showFinder: 'Show in Finder', showFolder: 'Open folder', unknownPath: 'Browser-picked project · full path unavailable',
  savedTo: 'Saved to', saveError: 'Could not save the project. Your edits are still in the editor; try again.', revealError: 'Could not open the project folder.', copyError: 'Could not copy the path.',
  help: 'Help', close: 'Close help', language: 'Language', english: 'English', japanese: '日本語', chinese: '简体中文', enCode: 'EN', jaCode: 'JA', zhCode: '中文',
  parts: 'Parts', faceSection: 'Face', hairSection: 'Hair & accessories', bodySection: 'Body', advanced: 'Advanced',
  notPresent: 'Not in this rig', show: 'Show overlay', hide: 'Hide overlay', showAll: 'Show all', hideAll: 'Hide all',
  source: 'Source & rig', canvas: 'Rig editor canvas', fit: 'Fit', zoom: 'Zoom', zoomOut: 'Zoom out', zoomIn: 'Zoom in', actualSize: 'Reset to 100%', fitPart: 'Fit selected part', wheelMode: 'Mouse wheel', wheelAuto: 'Zoom', wheelPan: 'Scroll to pan',
  pickHint: 'Pick a part on the left, or click a dot', dragHint: 'Drag dots to move them',
  lineHint: 'Drag dots · double-click a line to add a dot · Alt-click a dot to remove it',
  panHint: 'Pinch to zoom · scroll or drag empty space to pan', noDots: 'Edit the values in the selected part card',
  preview: 'Live preview', idle: 'Idle motion', play: 'Play idle motion', pause: 'Pause idle motion',
  pose: 'Pose test', reset: 'Reset', sweep: 'Sweep angles', stopSweep: 'Stop sweep',
  lipSync: 'Lip sync', release: 'Release', lipText: 'Kana text', lipPlay: 'Play', lipStop: 'Stop',
  lipSpeed: 'Morae per second', lipLoop: 'Loop', skippedKana: 'Skipped characters:', lipHelp: 'Hiragana, katakana and spaces. Preview only; no audio.',
  sweepTip: 'Swings the head through its full range to find tears',
  turn: 'Turn left/right', look: 'Look up/down', tilt: 'Tilt', eyeOpen: 'Eyes open', mouthOpen: 'Mouth open', bodyTilt: 'Body tilt',
  loading: 'Loading local assets…', updating: 'Updating preview…', ready: 'Engine ready', previewError: 'Preview could not load',
  selection: 'Selected part', selectedItem: 'Selected rig item', selectPart: 'Select a part to edit it', tip: 'Tip',
  guideTitle: 'Three steps to your first edit', guide1: 'Pick a part on the left', guide2: 'Drag its dots on the image',
  guide3: 'Watch the preview on the right', gotIt: 'Got it', shortcuts: 'Keyboard & mouse', guideAgain: 'Show the guide again',
  shortcutUndo: 'Undo / redo', shortcutSave: 'Save rig', shortcutPan: 'Pan the image', shortcutZoom: 'Zoom the image',
  shortcutVertex: 'Add / remove a dot', spaceDrag: 'Space + drag', wheel: 'Scroll', vertexKeys: 'Double-click a line / Alt-click a dot',
  stale: 'Outlines changed. The preview still uses the previous layers.',
  changedParts: 'Changed parts', checking: 'Checking for sample images…', emptyTitle: 'Open a project',
  emptyHelp: 'Choose a project from Open project, or browse for its folder.',
  newProjectHelp: 'Starting from a new illustration? Ask your agent to prepare a project using the agent guide.',
  invalidRig: 'Could not open the rig file. Check the JSON and these field paths:',
  invalidFolder: 'Could not open this folder. Check rig.json and layers.json for invalid data.',
  missingFolderFiles: 'Required files are missing. Include source.png, layers.json and every cut-out image.',
  unreadableFolder: 'A file or folder could not be read. Check access permissions and whether another app is using it, then try again.',
  unreadableProject: 'Cannot read this project. Check permissions or whether the file is in use.',
  invalidValue: 'Check the values at these field paths:', point: 'point', node: 'node', strand: 'Strand', eye: 'Eye',
  accessory: 'Accessory', x: 'X', y: 'Y', px: 'px',
};
const ja: typeof en = {
  ...workflowJa,
  product: 'Mesh Avatar Studio', subtitle: 'イラストの動く範囲を調整',
  tools: 'プロジェクト操作', openProject: 'プロジェクトを開く', openRig: 'rig.json だけ読み込む…', openFolder: 'プロジェクトフォルダを選ぶ…',
  rigFile: '設定ファイルを開く', folderFiles: 'プロジェクトフォルダのファイルを開く', save: '設定を保存', undo: '元に戻す', redo: 'やり直す',
  projectHelp: 'プロジェクトは、AI エージェントがイラストから作ったフォルダです(rig.json・source.png・built/ を含む)。',
  recent: '最近開いたプロジェクト', noRecent: '履歴はまだありません。', clearHistory: '履歴を消去', removeRecent: '履歴から削除',
  reopenLast: '起動時に最後のプロジェクトを開く', browseAgain: 'フォルダを選び直す', missingRecent: 'プロジェクトが見つからないため、履歴から削除しました:',
  localProjects: 'ローカルのプロジェクト', noProjects: 'プロジェクトはまだありません。', sampleProject: 'サンプル', updated: '更新',
  drawnVariants: '目・口の差分画像あり', readOnly: '読み取り専用', copyPath: 'パスをコピー', copyFolderPath: 'フォルダのパスをコピー', copied: 'パスをコピーしました',
  showFinder: 'フォルダを開く', showFolder: 'フォルダを開く', unknownPath: 'ブラウザで選択 · フルパスは取得できません',
  savedTo: '保存しました:', saveError: 'プロジェクトを保存できませんでした。編集内容は画面に残っています。もう一度お試しください。', revealError: 'プロジェクトのフォルダを開けませんでした。', copyError: 'パスをコピーできませんでした。',
  help: 'ヘルプ', close: 'ヘルプを閉じる', language: '言語', english: '英語', japanese: '日本語', chinese: '简体中文', enCode: '英語', jaCode: '日本語', zhCode: '中文',
  parts: 'パーツ', faceSection: '顔', hairSection: '髪・飾り', bodySection: '体', advanced: '詳細設定',
  notPresent: 'この設定にはありません', show: 'ガイドを表示', hide: 'ガイドを非表示', showAll: 'すべて表示', hideAll: 'すべて非表示',
  source: '元画像と動く範囲', canvas: '動く範囲の編集キャンバス', fit: '全体表示', zoom: '表示倍率', zoomOut: '縮小', zoomIn: '拡大', actualSize: '100% に戻す', fitPart: '選択中のパーツに合わせる', wheelMode: 'マウスのホイール', wheelAuto: '拡大・縮小', wheelPan: 'スクロールで移動',
  pickHint: '左のパーツか、画像の点を選んでください', dragHint: '点をドラッグして位置を調整',
  lineHint: '点をドラッグ · 線をダブルクリックで点を追加 · ⌥＋点をクリックで削除',
  panHint: 'ピンチで拡大・縮小 · スクロールや余白のドラッグで移動', noDots: '右の選択パーツ欄で数値を調整',
  preview: '動きのプレビュー', idle: '待機中の動き', play: '待機中の動きを再生', pause: '待機中の動きを一時停止',
  pose: 'ポーズ確認', reset: 'リセット', sweep: '角度を連続確認', stopSweep: '連続確認を停止',
  lipSync: '口の動き', release: '解除', lipText: 'かなの文章', lipPlay: '再生', lipStop: '停止',
  lipSpeed: '1秒あたりの拍数', lipLoop: '繰り返し', skippedKana: '読み飛ばす文字:', lipHelp: 'ひらがな・カタカナ・空白に対応。音声は再生しません。',
  sweepTip: '頭を最大角度まで動かし、画像の隙間や破れを確認します',
  turn: '顔を左右に向ける', look: '顔を上下に向ける', tilt: '頭を傾ける', eyeOpen: '目の開き', mouthOpen: '口の開き', bodyTilt: '体を傾ける',
  loading: '画像を読み込み中…', updating: 'プレビューを更新中…', ready: 'プレビューの準備完了', previewError: 'プレビューを読み込めませんでした',
  selection: '選択パーツ', selectedItem: '選択するパーツ', selectPart: 'パーツを選んで編集してください', tip: '調整のコツ',
  guideTitle: '最初の編集は3ステップ', guide1: '左の一覧からパーツを選ぶ', guide2: '画像の点をドラッグする',
  guide3: '右のプレビューで動きを見る', gotIt: 'わかりました', shortcuts: 'キーボード・マウス操作', guideAgain: '使い方をもう一度表示',
  shortcutUndo: '元に戻す／やり直す', shortcutSave: '設定を保存', shortcutPan: '画像を移動', shortcutZoom: '画像を拡大・縮小',
  shortcutVertex: '点を追加／削除', spaceDrag: 'スペース＋ドラッグ', wheel: 'スクロール', vertexKeys: '線をダブルクリック／⌥＋点をクリック',
  stale: '輪郭が変更されました。プレビューには変更前の画像を使っています。',
  changedParts: '変更されたパーツ', checking: 'サンプル画像を確認中…', emptyTitle: 'プロジェクトを開く',
  emptyHelp: '「プロジェクトを開く」の一覧から選ぶか、フォルダを指定してください。',
  newProjectHelp: '新しいイラストでは、エージェントに手順書に沿ってプロジェクトを作るよう依頼してください。',
  invalidRig: '設定ファイルを開けませんでした。JSONの形式と次の項目を確認してください：',
  invalidFolder: 'フォルダを開けませんでした。rig.json と layers.json の内容を確認してください。',
  missingFolderFiles: '必要なファイルが足りません。source.png、layers.json とすべての切り抜き画像を用意してください。',
  unreadableFolder: 'ファイルまたはフォルダを読み取れませんでした。アクセス権限や、別のアプリで使用中でないかを確認して、もう一度お試しください。',
  unreadableProject: 'このプロジェクトは読み取れません。アクセス権限や、ファイルが使用中でないかを確認してください。',
  invalidValue: '次の項目の数値を確認してください：', point: '点', node: '節点', strand: '髪の束', eye: '目',
  accessory: '飾り', x: '横', y: '縦', px: '画素',
};
const zh: typeof en = { ...workflowZh, ...uiZh };
export const dictionaries = { en, ja, zh };
export type PartGroup = 'head' | 'eyes' | 'mouth' | 'face' | 'cheeks' | 'strands' | 'buns' | 'accessories' | 'body' | 'hand' | 'cloth' | 'mesh' | 'view';
const partText: Record<Language, Record<PartGroup, [string, string, string]>> = {
  zh: partsZh,
  en: {
    cloth: ['Cloth', 'Skirts and draped fabric.', 'Place the waist and hem handles, then adjust swing, damping and wind.'],
    head: ['Head turn', 'Area that moves when the face turns or tilts.', 'Place the centre in the middle of the face; the circle should cover the whole head including hair.'],
    eyes: ['Eyes', 'Outline of each eye opening; drives blinking and gaze.', 'Trace the opening inside the eyelashes. Add dots where the contour changes direction.'],
    mouth: ['Mouth', 'Closed-mouth line and the area for drawn mouth shapes.', 'Align the line with the closed mouth, and keep the surrounding area close to the lips.'],
    face: ['Face features', 'Soft regions for nose, ears, brows and jaw.', 'Keep each region centred on its feature; adjust its size for a smooth transition.'],
    cheeks: ['Blush', 'Where the blush appears.', 'Place one dot on each cheek, below the eyes.'],
    strands: ['Hair strands', 'Lines that sway with physics.', 'Follow each strand from its root to its tip. Keep the root close to the scalp.'],
    buns: ['Hair buns', 'Regions that bob as a whole.', 'Fit each circle around a bun without including the face.'],
    accessories: ['Accessories', 'Pendulum parts such as tassels.', 'Place the pivot where the accessory attaches and the tip at its lowest point.'],
    body: ['Body', 'Breathing and body sway.', 'Keep the rotation pivot low and place the breathing region over the chest.'],
    hand: ['Hand', 'Hand outline and arm joints.', 'Trace the hand outline, then place the wrist and elbow joints.'],
    mesh: ['Mesh', 'Mesh density.', 'Smaller cells add detail around the face but take more time to render.'],
    view: ['Framing', 'Preview margins.', 'Adjust the margins so the head and accessories stay inside the preview.'],
  },
  ja: {
    cloth: ['布・スカート', 'スカートや垂れ布の揺れ。', '腰と裾の点を合わせ、周期・減衰・風の強さを調整してください。'],
    head: ['頭の向き', '顔を振ったり傾けたりするときに動く範囲。', '中心を顔の真ん中に置き、円が髪を含む頭全体を覆うように調整してください。'],
    eyes: ['目', '目の開口部の輪郭。まばたきと視線に使う。', 'まつ毛の内側に沿って輪郭を置き、曲がる場所に点を追加してください。'],
    mouth: ['口', '閉じた口の線と、口の形の差し替え範囲。', '線を閉じた口に合わせ、周囲の範囲を唇の近くに収めてください。'],
    face: ['顔のパーツ', '鼻・耳・眉・あごの影響範囲。', '各範囲をパーツの中心に合わせ、大きさを調整して動きをなじませてください。'],
    cheeks: ['頬', '頬の赤みが出る位置。', '左右の頬の、目より下に点を置いてください。'],
    strands: ['髪の束', '物理演算で揺れる髪の線。', '根元から毛先へ線を置き、根元は頭皮の近くに合わせてください。'],
    buns: ['お団子', 'まとまって揺れる範囲。', '顔を含めず、お団子を囲むように円を合わせてください。'],
    accessories: ['飾り', '房飾りなどの振り子。', '付け根に支点を置き、いちばん下に先端を合わせてください。'],
    body: ['体', '呼吸と体の揺れ。', '回転の支点を低い位置に置き、呼吸の範囲を胸に合わせてください。'],
    hand: ['手', '手の輪郭と腕の関節。', '手の輪郭をなぞってから、手首と肘の位置を合わせてください。'],
    mesh: ['メッシュ', 'メッシュの細かさ。', '格子を細かくすると顔の表現が細かくなりますが、描画の負荷が増えます。'],
    view: ['表示範囲', 'プレビューの余白。', '頭や飾りがプレビューからはみ出さないように余白を調整してください。'],
  },
};
const fieldText: Record<string, [string, string]> = {
  swing: ['Hem frequency (Hz)', '裾の周波数 (Hz)'], stiffness: ['Stiffness multiplier', 'ばねの倍率'],
  damping: ['Damping multiplier', '減衰の倍率'], follow: ['Row follow', '上の段への追従'], cohesion: ['Smoothing passes', '列の平滑化回数'],
  wind: ['Wind strength', '風の強さ'], waist: ['Waist line', '腰の線'], hem: ['Hem line', '裾の線'],
  columns: ['Columns', '列数'], rows: ['Rows', '行数'], clothCell: ['Cloth cell size', '布の格子幅'],
  image: ['Source image', '元画像'],
  center: ['Centre', '中心'], pivot: ['Pivot', '支点'], rx: ['Horizontal radius', '横の半径'], ry: ['Vertical radius', '縦の半径'],
  cx: ['Centre X', '中心の横位置'], cy: ['Centre Y', '中心の縦位置'], shiftX: ['Horizontal travel', '横の移動量'], shiftY: ['Vertical travel', '縦の移動量'],
  pivotX: ['Pivot X', '支点の横位置'], pivotY: ['Pivot Y', '支点の縦位置'], maxRoll: ['Maximum tilt', '最大の傾き'],
  weightBand: ['Head blend range', '頭の影響範囲'], turnBand: ['Turn blend range', '顔の向きの影響範囲'], breathBand: ['Breathing range', '呼吸の影響範囲'],
  rollBand: ['Body tilt range', '体の傾きの影響範囲'], chest: ['Chest', '胸'], shoulders: ['Shoulders', '肩'],
  nose: ['Nose', '鼻'], eyeA: ['First eye', '目の1番目'], eyeB: ['Second eye', '目の2番目'], earL: ['Left ear', '左耳'], earR: ['Right ear', '右耳'],
  brow: ['Brows', '眉'], jaw: ['Jaw', 'あご'], band: ['Blend range', '影響範囲'], bunL: ['Left bun', '左のお団子'], bunR: ['Right bun', '右のお団子'],
  opening: ['Opening', '開口部'], roi: ['Cut-out region', '切り抜き範囲'], x0: ['Left edge', '左端'], x1: ['Right edge', '右端'], y0: ['Top edge', '上端'], y1: ['Bottom edge', '下端'],
  top: ['Upper lid curve', '上まぶたの曲線'], bot: ['Lower lid curve', '下まぶたの曲線'], angle: ['Angle', '角度'], halfLen: ['Half length', '長さの半分'],
  bow: ['Curve depth', '曲線の深さ'], area: ['Drawing area', '差し替え範囲'], nodes: ['Nodes', '節点'], sigma: ['Sway width', '揺れの幅'],
  k: ['Sway strength', '揺れの強さ'], max: ['Maximum sway', '最大の揺れ'], tip: ['Tip', '先端'], split: ['Joint split', '関節の分割位置'],
  box: ['Cut-out box', '切り抜き枠'], color: ['Colour mask', '色のマスク'], redness: ['Red threshold', '赤の比率'], minRed: ['Minimum red', '赤の最小値'],
  outline: ['Outline', '輪郭'], jawRange: ['Jaw range', 'あごの範囲'], background: ['Background patch', '背景の補完範囲'],
  elbow: ['Elbow', '肘'], wrist: ['Wrist', '手首'], knuckle: ['Knuckle', '指の付け根'], contact: ['Contact point', '接点'],
  forearmShare: ['Forearm movement', '前腕の移動割合'], armBand: ['Arm blend range', '腕の影響範囲'], wristBand: ['Wrist blend range', '手首の影響範囲'],
  handBand: ['Hand blend range', '手の影響範囲'], fingerXBand: ['Finger horizontal range', '指の横範囲'], fingerYBand: ['Finger vertical range', '指の縦範囲'], pinBand: ['Pinned range', '固定範囲'],
  baseCell: ['Base cell size', '全体の格子幅'], fine: ['Fine mesh region', '細かい格子の範囲'], cell: ['Cell size', '格子幅'],
  handCell: ['Hand cell size', '手の格子幅'], tasselCell: ['Accessory cell size', '飾りの格子幅'], eyeBallCell: ['Iris cell size', '瞳の格子幅'],
  eyeCell: ['Eye cell size', '目の格子幅'], spriteCell: ['Drawing cell size', '差し替え画像の格子幅'],
  padTop: ['Top margin', '上の余白'], padSide: ['Side margin', '左右の余白'], gazeCenter: ['Gaze centre', '視線の中心'], start: ['Start', '始点'], end: ['End', '終点'],
};
export function fieldTitle(path: string, language: Language) {
  const t = dictionaries[language];
  const parts = partText[language];
  return path.split('.').map((key, i) => {
    if (/^\d+$/.test(key)) return String(Number(key) + 1);
    if (i === 0) {
      if (key === 'eyes') return t.eye;
      if (key === 'strands') return t.strand;
      if (key === 'accessories') return t.accessory;
      if (key in parts) return parts[key as PartGroup][0];
    }
    return language === 'zh' ? fieldsZh[key] ?? key : fieldText[key]?.[language === 'en' ? 0 : 1] ?? key;
  }).join(' · ');
}
const Context = createContext({ language: 'en' as Language, setLanguage: (_: Language) => { void _; } });
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = readPreference(LANGUAGE_KEY);
    return saved === 'ja' || saved === 'zh' ? saved : 'en';
  });
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : language; savePreference(LANGUAGE_KEY, language); }, [language]);
  return <Context.Provider value={{ language, setLanguage }}>{children}</Context.Provider>;
}
export function useI18n() {
  const context = useContext(Context);
  return { ...context, t: dictionaries[context.language], parts: partText[context.language], locale: { en: 'en-GB', ja: 'ja-JP', zh: 'zh-CN' }[context.language],
    title: (path: string) => fieldTitle(path, context.language) };
}
