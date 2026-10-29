# Native mesh avatars

[English](README.md) · [简体中文](README.zh.md)

> **実験的な機能です。** ネイティブ版のランタイムは開発中で、クレートはcrates.ioに公開していません。
> API、操作方法、ファイルの保存場所は予告なく変わることがあります。基準となる実装は `packages/runtime` の JavaScript 版です。

Rust 版のランタイムは、JavaScript 版と同じ `.mavatar` ファイルとビルド済みプロジェクトフォルダを読み込みます。
透明なデスクトップアバター、PNGレンダラー、Rust/C向けの組み込みAPIが入っています。デスクトップ版の主な対象は Metal を使う macOS です。

## 必要なもの

- Rust 1.88 以降と Cargo。
- macOSではXcode Command Line Tools。描画にはMetal対応GPUも必要です。
- Cのサンプルには `cc` と `make`（macOSで確認済み）。CPUのデータAPIにGPUは不要です。
- アバターのアーカイブ、または `rig.json`・`built/layers.json`・ビルド済み PNG を含むプロジェクト。
  イラスト単体ではアバターとして動かせません。

以下のコマンドはリポジトリのルートで実行します。既定のアバターは `samples/miko-qipao` で、その画像がインストールされている必要があります。
サンプルには[素材の利用規約](../samples/miko-qipao/MIKO_ASSET_TERMS.md)が適用されます。

## アプリに組み込む

### Rust のクレート

組み込み先のアプリの `Cargo.toml` に追加します。このリポジトリのルートではありません。

```toml
[dependencies]
mesh-avatar-core = { git = "https://github.com/shinshin86/mesh-avatar-studio.git", package = "mesh-avatar-core" }
mesh-avatar-wgpu = { git = "https://github.com/shinshin86/mesh-avatar-studio.git", package = "mesh-avatar-wgpu" }
```

これらのクレートは crates.io には公開していません。Git依存はリポジトリの既定ブランチを参照します。
ビルドを再現できるよう、アプリの `Cargo.lock` をコミットするか、両方に `rev` を指定して同じコミットに固定してください。リビジョン間でAPIが変わることがあります。

`mesh-avatar-core` はCPU上でアバターを読み込み、操作を反映してアニメーションを進めます。自前のレンダラーがあれば `mesh-avatar-wgpu` は不要です。
`Avatar::tick` が返す `Frame` は、頂点座標・UV・三角形のインデックス・テクスチャ名・アルファを持つ描画順のレイヤーと、フレーム全体の顔用uniformを所有します。`Avatar::textures` からはデコード済みのストレートアルファのRGBA8画像を取得できます。
`mesh-avatar-wgpu::Renderer` はそのフレームをホストが用意したwgpuのテクスチャビューへ描画し、RGBAへの読み戻しにも対応します。
Rustのフレームはデータを所有します。以下のポインターの有効期間はC ABIだけの条件です。

眼鏡などの任意の[重ね描き用レイヤー](../docs/format.md#overlay-layers)は、最初は非表示です。
`avatar.set_overlays(&["glasses"])` で名前を指定して表示し、`avatar.set_overlays(&[])` ですべて非表示にします。存在しない名前は無視します。
眉や顎の変形を受けずに頭へ追従し、目・口のスプライトの後、房と手の前に、マニフェストの順番で描画します。
保存するPNGはベース画像と同じサイズですが、実行時のテクスチャとメッシュは、不透明部分の周囲6ピクセルまでを使います。
このレイヤーがないアバターの動作は変わりません。不正なメタデータ、画像の欠損、サイズの不一致は読み込みエラーになります。
`AvatarPackage` を直接組み立てる場合、レイヤーのないアバターでは `overlays` に `None` を指定してください。

### C ABI

このチェックアウトから `mesh-avatar-ffi` をビルドすると、`native/target/release/` に `libmesh_avatar_ffi.a` と共有ライブラリ（macOSでは `libmesh_avatar_ffi.dylib`）ができます。
[`mesh_avatar.h`](include/mesh_avatar.h) をインクルードしてください。通常ビルドの依存先はcoreだけなので、自前のメッシュレンダラーを持つホストにwgpuは不要です。

`mesh_avatar_tick` はフレームをキャッシュします。`mesh_avatar_get_frame` で、描画順のレイヤー（頂点座標・UV・三角形のインデックスと要素数・アルファ・テクスチャID）と、フレーム全体の顔用uniformを取得できます。
テクスチャAPIからはサイズとデコード済みのストレートアルファのRGBA8画像を取得します。ホスト側でテクスチャを転送してメッシュを描画してください。CPUのデータAPIはウィンドウや画像を描画しません。

ビルド済みフォルダやアーカイブは `mesh_avatar_open_path`、メモリ上のアーカイブは `mesh_avatar_open_bytes` で開きます。
入力は呼び出し中に読み取り・コピーするため、開いた後はアーカイブのバッファを解放できます。ハンドルには `uint64_t` の識別子を使い、0は無効です。
別のスレッドへ渡して使えます。同じハンドルへのAPI呼び出しは内部で直列化します。使い終わったら `mesh_avatar_destroy` を呼んでください。

フレームとレイヤーには、ライブラリが所有する読み取り専用ポインターが入っています。有効期間は、そのハンドルの次のtickか破棄までです。設定だけを変更してもキャッシュしたフレームは変わりません。
テクスチャ名とストレートアルファのRGBA8画像は、ハンドルの破棄まで有効です。これらのポインターは解放しないでください。
tick後も必要なデータはコピーし、別スレッドからのtick・破棄とデータの読み取りが重ならないよう同期してください。
各関数の `MaStatus` を確認し、失敗時は `mesh_avatar_last_error` を読みます。エラー文字列は同じスレッドで次のAPIを呼ぶまで有効です。
Rustのpanicを検知したハンドルは、破棄して開き直します。ポインターと要素数、所有権の条件は生成ヘッダーにも記載しています。

Cでは `mesh_avatar_set_overlays(avatar, names, count)` で表示するレイヤーを指定します。
`names` はUTF-8のC文字列の配列で、最大200件です。存在しない名前は無視し、`NULL, 0` を渡すとすべて非表示にします。
ほかの設定関数と同じく、次のtickで描画に反映します。不正な入力では選択状態を変更しません。

#### 任意機能のヘッドレス描画

自前のメッシュレンダラーがないホストでは、`render` を有効にしてオフスクリーンの描画結果をコピーできます。

描画用には [`mesh_avatar_render.h`](include/mesh_avatar_render.h) を読み込みます。このヘッダーはCPU用ヘッダーを含むため、マクロの指定は不要です。
描画関数は `render` を有効にしたライブラリでのみ利用できます。

アバターのハンドルと `MaRenderOptions` でレンダラーを作成します。物理ピクセルの幅・高さ、MSAAのサンプル数（1または4）、contain/cover、余白を指定します。余白の推奨値は `mesh_avatar_get_info` で取得できます。
描画は現在のキャッシュ済みフレームを読み取り、呼び出し側のバッファへRGBA8を上の行から隙間なくコピーします。アニメーションは進みません。バッファは `幅*高さ*4` バイト以上必要で、ストレート／プリマルチプライドのアルファを選べます。
描画はGPUからの読み戻しが完了するまで待ちます。バッファを保持せず、借用中のフレームデータも無効にしません。リサイズ後もfit・余白・サンプル数は維持されますが、呼び出し側のバッファもサイズに合わせて確保してください。不正なサイズやバッファはエラーとなり、出力バッファは変更されません。

レンダラーはスレッド間で移動でき、同じレンダラー・アバターへの呼び出しは直列に処理されます。アバターを所有しないため、レンダラーを先に破棄してください。アバター破棄後の描画は `MA_INVALID_HANDLE` を返します。封じ込められたpanicの影響を受けたオブジェクトは破棄して作り直してください。
対応するGPUアダプターがない場合は `MA_GPU_UNAVAILABLE`、それ以外のGPUエラーは `MA_RENDER_ERROR` を返します。サンプルとCIはアダプターがない場合だけ描画をスキップします。

### C のサンプル

サンプルは `cc` と `make` を使って静的ライブラリにリンクし、`samples/miko-qipao` を開きます。
CPU版と `render` 版は同じライブラリのパスに出力するため、各サンプルの直前に対応するビルドを実行してください。

[データ取得のサンプル](examples/c/main.c)はポーズを設定して時間を進め、メッシュとテクスチャの統計、不正な入力への応答を確認します。

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi
make -C native/examples/c run
```

[描画のサンプル](examples/c/render.c)はアルファの両形式、フレームのキャッシュが維持されること、リサイズを検証し、`native/target/ffi-render.ppm` に保存します。
PPMはアルファを持たないため、ストレートRGBAを白背景に合成します。どちらのサンプルもウィンドウやマイクを起動しません。
macOSでは、Makefileが描画に必要なMetalなどのフレームワークをリンクします。

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi --features render
make -C native/examples/c run-render
```

[ターミナルのサンプル](examples/c/terminal.c)は毎フレーム描画し、RGBAを色付きの半角ブロック文字としてターミナルに表示します。
ターミナルだけで動き、モーションとかなの口形を短く繰り返します。ターミナルのサイズを変えると描き直し、Ctrl+C で終了します。
iTerm2、WezTerm、Ghosttyなど24bitカラーに対応したターミナルを使ってください。フォントを小さくするほど細かく表示されます。
ターミナルマルチプレクサの中では、サイズの変更や色が正しく伝わらないことがあります。
アバターのパスの後にフレーム数を指定すると、最後のフレームだけを出力して終了します。

```sh
make -C native/examples/c run-terminal
native/target/ffi-terminal-example samples/miko-qipao 90 > native/target/frame.txt
```

## デスクトップアプリ

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-desktop
native/target/release/mesh-avatar-desktop
```

別のアバターを開く:

```sh
native/target/release/mesh-avatar-desktop /path/to/avatar.mavatar
native/target/release/mesh-avatar-desktop /path/to/project
```

引数を省略すると、ソースのチェックアウトまたは実行ファイルの位置からサンプルを探します。
実行ファイルを別の場所にコピーした場合は、アバターのパスを指定してください。

macOS では、ウィンドウは透明・枠なし・通常のウィンドウより手前に表示され、影はつきません。
初期の幅は 400 論理ピクセルで、高さはアバターの画像サイズと表示余白から決まります。同梱サンプルは約 400 × 372 で始まり、画像上端の平らな切れ目はウィンドウの外に置かれます。
大きく動いたときは、その切れ目が見えないよう、切り取り位置が少し下がることがあります。拡大縮小しても縦横比は変わりません。
スクロールとキーボードによる拡大縮小の範囲は 40%〜400% で、モニターの大きさと GPU のテクスチャ上限によってさらに制限されます。
連続した入力はまとめてからリサイズし、描画面とウィンドウの大きさが一致するまで描画を待ちます。

macOS では、**File → Open Avatar…** で標準のダイアログが開き、`.mavatar` アーカイブか、`rig.json` と `built/` を含むプロジェクトフォルダを選べます。
どちらもアバターのウィンドウにドロップして開くこともできます。読み込みはバックグラウンドで行い、読み込めないアバターを選んだ場合は今のアバターを表示したままエラーを出します。
切り替えに成功すると、GPU リソースと表示領域を作り直し、保存した位置と拡大率を新しいサイズの上限の範囲で復元します。クリック透過の状態は維持し、新しいモーションの一覧はターミナルに表示されます。

**File → Open Recent** には、正常に開けたパスが最新 8 件まで残ります。保存先は OS のユーザー設定ディレクトリ(macOS では `~/Library/Application Support/`)の `mesh-avatar-desktop/recent.json` です。
存在しなくなったパスは、起動時とアプリが再びフォーカスされたときに一覧から外れます。**File → Reload** は、編集後に今のアバターを読み込み直します。
新しいアバターを読み込むと、表情とアニメーションの状態はリセットされます。

ウィンドウ左上の位置（論理座標）と拡大率は、同じ設定ディレクトリの `mesh-avatar-desktop/settings.json` にアバターのパスごとに保存します。
起動時とアバターの切り替え時に復元し、そのアバターの設定がなければ最後に使ったウィンドウの位置と拡大率を使います。
保存先のモニターが外れている場合も、接続中のモニター内に収まるように補正します。macOSではDockとメニューバーを除く範囲に収めます。
移動や拡大縮小が止まってから0.5秒後と、通常の終了時に保存します。設定ファイルがない場合や壊れている場合は、既定の位置から始めます。

macOSでは **Avatar → Motion** からすべてのモーションを名前で選べます。**Avatar → Expression** ではライブ表情を選べます。
アバターを切り替えるとメニューも更新されます。下記のキーボード操作も引き続き使えます。

| 操作 | 動作 |
|---|---|
| Command + `O` | アバターのアーカイブかビルド済みプロジェクトフォルダを開く(macOS) |
| Command + `R` | 今のアバターを読み込み直す |
| `.mavatar` かプロジェクトフォルダをドロップ | 同じウィンドウでアバターを切り替える |
| 左ドラッグ | アバターのウィンドウを移動する |
| スクロール | ウィンドウを拡大縮小する |
| Command + `+` / `-` | ウィンドウを拡大縮小する |
| `1`〜`9` | 組み込みモーションの最初の 9 個を再生する(一覧はターミナルに表示) |
| `E` | ライブ表情を順に切り替える |
| `K` | かなの口形デモを再生する(音声は出ません) |
| `C` | カーソルのクリック透過を切り替える(起動時はオフ) |
| Escape または Command + `Q` | 終了する |

操作は、アバターのアプリにキーボードフォーカスがあるときに有効です。クリック透過をオンにすると、マウス操作は下のウィンドウに届きます。
macOSでは、システムのステータスバーにある単色のアバターアイコンからメニューを開けます。**Hide Avatar / Show Avatar** でアバターの表示・非表示を切り替えます。アバターを隠しても、このアイコンは残ります。
**Click-through** はオンのときにチェックがつき、アバターにフォーカスを戻さずにオフにできます。`C` キーの操作も同じチェック表示に反映されます。

ステータスメニューには **Open Avatar…**、アプリメニューと同じ **Open Recent**、**Quit Mesh Avatar** もあります。
ここからアバターを開くと、先にアバターのウィンドウを表示します。ファイル選択をキャンセルした場合も表示したままです。
非表示中はアバターを読み込んだまま描画を止めます。表示・非表示とクリック透過の状態は保存せず、次回起動時はアバターを表示し、クリック透過はオフになります。

ステータスバーのアイコンを使えない場合は、DockかCommand-Tabでアプリにフォーカスを戻してから `C` を押します。このキーはグローバルショートカットではありません。
フォーカスを戻せない場合はDockから終了して起動し直してください。

待機中の動き、まばたき、呼吸、ときどき入るモーションは自動で再生されます。
描画はディスプレイの表示レートに合わせます。リサイズやモニターの拡大率の変更に合わせて実際の描画サイズを更新し、処理が止まったりスリープから復帰したりした後のアニメーションの時間刻みは 0.05 秒までに抑えます。

## マイクで口を動かす（macOS）

アプリメニューとステータスメニューの両方に **Microphone** があります。起動時はオフです。
**Enable Microphone** をオンにすると入力音量で口を動かし、**Input Device** でシステムの既定入力かマイク名を選べます。
**Sensitivity** はLow・Normal（初期値）・Highの3段階です。小さい声に反応しない場合はHigh、環境音で口が開く場合はLowを試してください。
ノイズゲート、平滑化、短い終了待ち時間で、小さい入力による細かい開閉を抑えます。

初めてオンにすると、macOSがマイクへのアクセス許可を求めます。この実行ファイルはアプリバンドルではないため、起動に使ったターミナルアプリへの許可として扱われます。
拒否した場合は **システム設定 → プライバシーとセキュリティ → マイク** でそのターミナルを許可し、もう一度オンにしてください。

音声は音量の計算にだけ使い、録音やアップロードはしません。システムの再生音を取り込む機能ではありません。
アバターを隠したり切り替えたりしても入力は続くため、使い終わったらどちらかのメニューからオフにしてください。
入力デバイス、感度、オン・オフの状態は次回起動時に引き継ぎません。`K` キーのかなデモを使う前にもオフにしてください。
オフにすると、マイクによる口の操作を止めて通常のアニメーションへ戻ります。

デバイスの切断、ストリームエラー、入力コールバックの停止を検知するとオフになり、メニューの **Off:** に続けて理由を表示します。
自動では再開しません。使える入力を選んで再びオンにしてください。デバイス一覧は **Input Device → Refresh Devices** でも更新できます。

## PNG を書き出す

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o native/target/avatar.png
```

`--pose` には `{"angleX":20,"mouthOpen":0.8}` のような JSON オブジェクトを渡します。
指定しなかったポーズのパラメータは既定値になります。`--seconds` を指定すると、書き出す前に毎秒 60 ステップでアバターの時間を進めます。
`--help` で、表示余白、fit、表情、マルチサンプリングのオプションを確認できます。

## 開発時の確認

ここでもシェルコマンドはリポジトリのルートで実行します。JavaScript版との比較にはNode.js 22.17以降とnpmの依存関係が必要です。
まだインストールしていなければ `npm ci` を実行してください。

```sh
node --experimental-strip-types native/conformance/dump.mjs
cargo test --manifest-path native/Cargo.toml --all-features
cargo clippy --manifest-path native/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path native/Cargo.toml --all --check
```

dumpは、埋め込んだモーションデータの一致を確認し、数値の比較用データをGit管理外の `native/target/conformance/` に出力します。
テストの前に生成してください。データがなければ比較テストはスキップした旨を表示します。対応GPUがない環境ではGPU読み戻しのテストもスキップします。
coreはWASM向けにもビルドできます。JavaScriptバインディングは含みません。

```sh
rustup target add wasm32-unknown-unknown
cargo check --manifest-path native/Cargo.toml -p mesh-avatar-core --target wasm32-unknown-unknown
```

通常のライブラリビルドにcbindgenは不要です。ヘッダーを更新するときは、バージョンを固定したツールをGit管理外のビルド先へ入れ、両ヘッダーを再生成して差分を確認します。

```sh
cargo install cbindgen --version 0.29.4 --locked --root native/target/header-tools
bash native/conformance/ffi-header.sh
bash native/conformance/ffi-header.sh --check
```

CIではWASM、フォーマット・lint・テスト、両ヘッダー、Cの両サンプルを確認します。描画サンプルは対応するGPUアダプターがない場合だけスキップします。

### 画素を比較する

任意の比較コマンドです。ヘッドレスChromiumとオフスクリーンレンダラーを起動します。
npmの依存関係、PlaywrightのChromium、対応するGPUが必要です。デバッグ版レンダラーはスクリプト内でビルドします。

```sh
npx playwright install chromium
node native/conformance/compare-pixels.mjs
```

PNGとレポートはGit管理外の `native/target/pixel-comparison*/` に保存します。
macOSでは `--metal` でChromiumのMetalバックエンドを選べ、`--dpr=2` でHiDPIの物理サイズを揃えて比較できます。
埋め込むモーションの定義を意図して更新するときは、`node --experimental-strip-types native/conformance/sync-motion-data.mjs` を実行してください。

## 制限事項

- Windows と Linux のデスクトップでの動作は確認していません。ウィンドウの透明化、最前面表示、クリック透過は OS のコンポジタに依存します。
  透明な描画面を使えない環境では、アプリは終了します。
- メニューバー、ステータスバーのアイコン、Open Avatar ダイアログは macOS 専用です。実行ファイルには、アプリバンドルなしで「Mesh Avatar」という名前を埋め込んでいます。
  macOS がほかの場所で表示する名前は、起動のしかたによって変わることがあります。
- マイク入力は現在macOS専用です。カメラトラッキング、システム音声の取り込み、音声再生、ライティングには対応していません。
- デスクトップ版は Cargo でビルドする実行ファイルで、インストーラー、署名済みアプリバンドル、グローバルショートカットはありません。
- GPU のラスタライズとアンチエイリアスは Chromium とわずかに異なることがあります。ほぼ透明な画像の縁を調べるときは、プリマルチプライド済みの色で比較してください。
