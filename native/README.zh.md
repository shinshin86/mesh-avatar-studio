# Native mesh avatars

[English](README.md) · [日本語](README.ja.md)

> **实验性功能。** 原生运行时仍在开发中，crate尚未发布到crates.io。
> API、操作方式和文件保存位置可能会在不另行通知的情况下变更。参考实现仍是 `packages/runtime` 中的 JavaScript 运行时。

Rust 运行时可以加载与 JavaScript 运行时相同的 `.mavatar` 文件和已构建的项目文件夹。
其中包含透明的桌面虚拟形象程序、PNG渲染器和Rust/C嵌入API。桌面端的主要目标平台是使用 Metal 的 macOS。

## 准备工作

- Rust 1.88 或更高版本，以及 Cargo。
- macOS需要Xcode Command Line Tools；渲染还需要支持Metal的GPU。
- C示例需要 `cc` 和 `make`（已在macOS验证）。CPU数据API不需要GPU。
- 一个虚拟形象归档文件，或包含 `rig.json`、`built/layers.json` 和已构建 PNG 资源的项目。
  仅有插画本身无法作为虚拟形象运行。

以下命令均在仓库根目录执行。默认虚拟形象为 `samples/miko-qipao`，需要先安装其图片。
该示例适用[素材使用条款](../samples/miko-qipao/MIKO_ASSET_TERMS.md)。

## 嵌入应用

### Rust crate

将以下依赖添加到宿主应用的 `Cargo.toml`，而不是本仓库的根目录：

```toml
[dependencies]
mesh-avatar-core = { git = "https://github.com/shinshin86/mesh-avatar-studio.git", package = "mesh-avatar-core" }
mesh-avatar-wgpu = { git = "https://github.com/shinshin86/mesh-avatar-studio.git", package = "mesh-avatar-wgpu" }
```

这些crate尚未发布到crates.io。Git依赖使用仓库的默认分支。为使构建可重现，请提交应用的 `Cargo.lock`，或在两个依赖中用 `rev` 固定到同一提交。不同修订之间的API可能发生变化。

`mesh-avatar-core` 在CPU上加载虚拟形象、应用控制并推进动画；已有渲染器时可省略 `mesh-avatar-wgpu`。
`Avatar::tick` 返回拥有其数据的 `Frame`，包含按绘制顺序排列的图层（顶点坐标、UV、三角形索引、纹理名称和Alpha）以及整帧的面部uniform。`Avatar::textures` 提供解码后的非预乘Alpha RGBA8纹理。
`mesh-avatar-wgpu::Renderer` 将帧绘制到宿主提供的wgpu纹理视图，也支持RGBA读回。Rust帧拥有其数据；下述指针有效期仅适用于C ABI。

眼镜等可选的[叠加图层](../docs/format.md#overlay-layers)初始为隐藏状态。
调用 `avatar.set_overlays(&["glasses"])` 显示指定名称的图层，或用 `avatar.set_overlays(&[])` 隐藏全部图层；未知名称会被忽略。
图层跟随头部，但不受眉毛和下颌变形影响。绘制顺序为眼睛和嘴部精灵之后、流苏和手之前，多个叠加图层按清单中的顺序绘制。
磁盘上的PNG必须与基础图像尺寸一致；运行时纹理和网格仅覆盖不透明区域及其周围6像素。
没有叠加图层的虚拟形象保持原有行为。无效元数据、缺失图像和尺寸不匹配会导致加载错误。
直接构造 `AvatarPackage` 时，没有叠加图层的虚拟形象应将 `overlays` 字段初始化为 `None`。

### C ABI

从此仓库检出构建 `mesh-avatar-ffi`，会在 `native/target/release/` 生成 `libmesh_avatar_ffi.a` 和平台共享库（macOS上为 `libmesh_avatar_ffi.dylib`）。
包含 [`mesh_avatar.h`](include/mesh_avatar.h)。默认构建仅依赖core，已有网格渲染器的宿主无需引入wgpu。

每次 `mesh_avatar_tick` 都会缓存一帧。`mesh_avatar_get_frame` 提供按绘制顺序排列的图层（顶点坐标、UV、三角形索引及数量、Alpha和纹理ID）以及整帧的面部uniform。
纹理API提供尺寸与解码后的非预乘Alpha RGBA8像素。宿主负责上传纹理和绘制网格；CPU数据API本身不绘制窗口或图像。

使用 `mesh_avatar_open_path` 打开已构建的文件夹或归档，使用 `mesh_avatar_open_bytes` 打开内存中的归档。
输入在调用期间读取或复制，打开成功后即可释放归档缓冲区。句柄是不透明的 `uint64_t` 标识符，0无效。
句柄可在线程间传递；同一句柄的API调用在内部串行执行。使用完毕后调用 `mesh_avatar_destroy`。

帧和图层描述符包含由库持有的只读指针，有效期到该句柄的下一次tick或销毁为止；仅修改设置不会改变缓存帧。
纹理名称和非预乘Alpha的RGBA8像素在销毁句柄前保持有效。不要释放这些指针；如需跨tick保留数据，请自行复制。
读取借用数据时，必须与其他线程上的tick或销毁操作同步，避免并发访问。
检查每个 `MaStatus`，失败时读取 `mesh_avatar_last_error`；错误字符串在同一线程下一次API调用前有效。
遇到被捕获的Rust panic时，应销毁并重新打开该句柄。生成的头文件也记录了指针、长度和所有权要求。

C接口通过 `mesh_avatar_set_overlays(avatar, names, count)` 选择可见图层。
`names` 是UTF-8 C字符串数组，最多200项。未知名称会被忽略；传入 `NULL, 0` 隐藏全部图层。
与其他设置函数一样，更改在下一次tick后生效；无效输入不会改变选择状态。

#### 可选的无窗口渲染

没有自有网格渲染器的宿主可启用 `render`，直接复制离屏渲染的像素。

扩展使用 [`mesh_avatar_render.h`](include/mesh_avatar_render.h)，它包含CPU头文件，无需定义宏。只有用 `render` 功能构建的库才导出这些函数。

用虚拟形象句柄和 `MaRenderOptions` 创建渲染器，指定物理像素宽高、MSAA采样数（1或4）、contain/cover以及显式留白。可从 `mesh_avatar_get_info` 取得建议的留白值。
渲染读取当前缓存帧，不推进动画，将紧密排列、从顶行开始的RGBA8复制到调用方提供的缓冲区。缓冲区至少需要 `宽*高*4` 字节，可选择非预乘或预乘Alpha。
同步调用会等待GPU读回完成，不保留调用方缓冲区，也不使借用的帧指针失效。调整大小会保留fit、留白和采样数；调用方也应按新尺寸分配缓冲区。无效尺寸或缓冲区返回错误，不修改输出缓冲区。

渲染器可以跨线程使用，同一渲染器及虚拟形象上的调用会被串行化。渲染器只引用虚拟形象，不拥有它；请先销毁渲染器，再销毁虚拟形象。虚拟形象销毁后渲染返回 `MA_INVALID_HANDLE`。捕获panic后，应销毁并重建受影响的对象。
没有兼容GPU适配器时返回 `MA_GPU_UNAVAILABLE`；其他GPU错误返回 `MA_RENDER_ERROR`。示例和CI只在没有适配器时跳过渲染。

### C 示例

示例使用 `cc` 和 `make` 链接静态库，并打开 `samples/miko-qipao`。CPU与 `render` 构建写入相同的库路径，请在运行各示例前执行对应的构建。

[数据示例](examples/c/main.c)会设置姿势、推进动画、打印网格及纹理统计，并检查无效输入的返回值：

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi
make -C native/examples/c run
```

[渲染示例](examples/c/render.c)检查两种Alpha格式、帧缓存保持不变以及尺寸调整，然后写入 `native/target/ffi-render.ppm`。
PPM不支持Alpha，因此会将非预乘RGBA合成到白色背景上。两个示例都不会打开窗口或启用麦克风。macOS的Makefile会链接渲染所需的Metal等系统框架：

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi --features render
make -C native/examples/c run-render
```

[终端示例](examples/c/terminal.c)每帧渲染一次，并将RGBA以彩色半格方块字符显示在终端中，因此只需要一个终端即可运行。
它会循环播放简短的动作和假名口型，跟随终端尺寸变化重新绘制，按Ctrl+C退出。
请使用支持24位色的终端，例如iTerm2、WezTerm或Ghostty；字体越小，画面越精细。在终端复用器中，尺寸变化或颜色可能无法正确传递。
在头像路径后指定帧数时，只输出最后一帧后退出：

```sh
make -C native/examples/c run-terminal
native/target/ffi-terminal-example samples/miko-qipao 90 > native/target/frame.txt
```

## 桌面程序

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-desktop
native/target/release/mesh-avatar-desktop
```

打开其他虚拟形象：

```sh
native/target/release/mesh-avatar-desktop /path/to/avatar.mavatar
native/target/release/mesh-avatar-desktop /path/to/project
```

不带参数时，程序会根据当前源码检出位置或可执行文件位置查找示例。
如果把可执行文件复制到其他位置，需要显式指定虚拟形象路径。

在 macOS 上，窗口透明、无边框、显示在普通窗口之上，并且没有阴影。
初始宽度为 400 逻辑像素，高度由虚拟形象的图像和视图边距决定。内置示例的初始尺寸约为 400 × 372，图像顶部平直的裁切边位于窗口之外。
动作幅度较大时，裁切位置可能会稍微收紧，以免露出这条边。缩放时保持窗口的宽高比。
滚轮和键盘缩放的范围为 40%–400%，并会进一步受显示器尺寸和 GPU 纹理上限限制。
连续的输入会先合并再调整窗口大小；渲染会等到绘制表面与窗口尺寸一致后再进行。

在 macOS 上，**File → Open Avatar…** 会打开系统对话框，可选择 `.mavatar` 归档文件，或包含 `rig.json` 和 `built/` 的项目文件夹。
也可以把它们直接拖放到虚拟形象窗口上。加载在后台进行；如果虚拟形象无效，会继续显示当前虚拟形象并提示错误。
切换成功后，程序会重建 GPU 资源和视图，在新尺寸限制内恢复保存的位置和缩放比例，保持点击穿透状态，并在终端输出新的动作列表。

**File → Open Recent** 会保留最近 8 个成功打开的路径，保存在操作系统用户配置目录（macOS 上为 `~/Library/Application Support/`）下的 `mesh-avatar-desktop/recent.json`。
已不存在的路径会在启动时以及程序重新获得焦点时被移除。**File → Reload** 用于在编辑后重新加载当前虚拟形象。
加载新的虚拟形象时，表情和动画状态会被重置。

窗口左上角位置（逻辑坐标）和缩放比例会按虚拟形象路径保存在同一配置目录的 `mesh-avatar-desktop/settings.json` 中。
启动和切换虚拟形象时会恢复对应设置；如果该虚拟形象尚无设置，则使用最近的窗口位置和缩放比例。
恢复时会将窗口限制在当前连接的显示器内，即使原来的显示器已经断开；在 macOS 上会避开 Dock 和菜单栏。
移动或缩放停止0.5秒后，以及正常退出时会保存设置。设置文件缺失或损坏时使用默认位置。

在 macOS 上，**Avatar → Motion** 按名称列出所有动作，**Avatar → Expression** 用于选择实时表情。
切换虚拟形象后会重建这些菜单；以下键盘操作仍然有效。

| 操作 | 作用 |
|---|---|
| Command + `O` | 打开虚拟形象归档文件或已构建的项目文件夹（macOS） |
| Command + `R` | 重新加载当前虚拟形象 |
| 拖放 `.mavatar` 或项目文件夹 | 在同一窗口中切换虚拟形象 |
| 左键拖动 | 移动虚拟形象窗口 |
| 滚轮 | 缩放窗口 |
| Command + `+` / `-` | 缩放窗口 |
| `1`–`9` | 播放前 9 个内置动作（列表输出在终端） |
| `E` | 依次切换实时表情 |
| `K` | 播放假名口型演示（不播放声音） |
| `C` | 切换鼠标点击穿透（启动时为关闭） |
| Escape 或 Command + `Q` | 退出 |

以上操作在虚拟形象程序拥有键盘焦点时有效。开启点击穿透后，鼠标事件会传给下方的窗口。
在 macOS 上，点击系统状态栏中的单色虚拟形象图标即可打开菜单。**Hide Avatar / Show Avatar** 用于隐藏或显示虚拟形象窗口；隐藏后状态图标仍然保留。
启用 **Click-through** 时会显示勾选标记，可在不恢复虚拟形象焦点的情况下关闭点击穿透。`C` 键操作也会同步更新该标记。

状态菜单还提供 **Open Avatar…**、与应用菜单相同的 **Open Recent** 列表，以及 **Quit Mesh Avatar**。
从该菜单打开虚拟形象时，会先显示窗口；取消文件选择后也会保持显示。
隐藏时保留已加载的虚拟形象并暂停渲染。显示状态和点击穿透状态不会保存；下次启动时虚拟形象可见，点击穿透关闭。

如果状态图标不可用，可通过 Dock 或 Command-Tab 恢复应用焦点后按 `C`。该按键不是全局快捷键。
如果无法恢复焦点，请从 Dock 退出后重新启动。

待机动作、眨眼、呼吸和不定时的动作会自动播放。
渲染频率跟随显示器的刷新节奏。窗口尺寸或显示器缩放比例变化时会更新实际渲染尺寸；在卡顿或从睡眠恢复后，动画的时间步长上限为 0.05 秒。

## 麦克风口型同步（macOS）

应用菜单和状态菜单都提供 **Microphone** 子菜单，启动时默认关闭。
启用 **Enable Microphone** 后，输入音量会驱动嘴部动作；**Input Device** 可选择系统默认输入或指定的麦克风。
**Sensitivity** 提供Low、Normal（默认）和High三个级别。声音较小时可试用High，环境噪声导致嘴部动作时可试用Low。
噪声门、平滑处理和短暂的结束保持可减少低音量附近的频繁开合。

首次启用时，macOS会请求麦克风权限。由于这是未打包的可执行文件，权限归属于启动它的终端应用。
如果曾拒绝，请在 **系统设置 → 隐私与安全性 → 麦克风** 中允许该终端，然后重新启用麦克风。

程序只使用输入音量，不录音、不上传音频，也不采集系统播放的声音。
隐藏或切换虚拟形象后仍会继续输入；使用完毕后请从任一菜单关闭。
设备选择、灵敏度和启用状态不会保存到下次启动。使用 `K` 键的假名演示前也请先关闭麦克风。
关闭后会停止麦克风对嘴部的控制，恢复正常动画。

设备断开、流错误或输入回调停止时，麦克风会关闭，并在子菜单的 **Off:** 后显示原因，不会自动重启。
选择可用输入后重新启用即可；**Input Device → Refresh Devices** 可刷新设备列表。

## 渲染 PNG

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o native/target/avatar.png
```

通过 `--pose` 传入类似 `{"angleX":20,"mouthOpen":0.8}` 的 JSON 对象。
未指定的姿势参数使用默认值。`--seconds` 会在渲染前以每秒 60 步推进虚拟形象的时间。
`--help` 会列出视图边距、fit、表情和多重采样等选项。

## 开发检查

这里的shell命令同样在仓库根目录运行。与JavaScript运行时对比需要Node.js 22.17或更高版本及npm依赖。尚未安装时，请先执行 `npm ci`。

```sh
node --experimental-strip-types native/conformance/dump.mjs
cargo test --manifest-path native/Cargo.toml --all-features
cargo clippy --manifest-path native/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path native/Cargo.toml --all --check
```

dump首先检查嵌入的动作数据是否一致，然后将数值参考数据写入Git忽略的 `native/target/conformance/`。
请在测试前生成数据；缺少数据时，对比测试会输出跳过提示。没有兼容GPU时，GPU读回测试也会跳过。
core也可编译为WASM，但不包含JavaScript绑定：

```sh
rustup target add wasm32-unknown-unknown
cargo check --manifest-path native/Cargo.toml -p mesh-avatar-core --target wasm32-unknown-unknown
```

普通库构建不需要cbindgen。维护头文件时，将固定版本工具安装到Git忽略的构建目录，重新生成两个头文件，再检查差异：

```sh
cargo install cbindgen --version 0.29.4 --locked --root native/target/header-tools
bash native/conformance/ffi-header.sh
bash native/conformance/ffi-header.sh --check
```

CI检查WASM、格式/lint/测试、两个生成头文件和两个C示例。渲染示例仅在没有兼容GPU适配器时跳过。

### 像素对比

此可选命令会启动无窗口Chromium和离屏渲染器。需要npm依赖、Playwright的Chromium及兼容GPU；脚本会自行构建debug渲染器：

```sh
npx playwright install chromium
node native/conformance/compare-pixels.mjs
```

PNG及报告保存在Git忽略的 `native/target/pixel-comparison*/`。macOS上可用 `--metal` 选择Chromium的Metal后端，用 `--dpr=2` 在HiDPI下按相同物理尺寸比较。
如需有意更新嵌入的动作定义，请执行 `node --experimental-strip-types native/conformance/sync-motion-data.mjs`。

## 限制

- 尚未验证 Windows 和 Linux 上的桌面行为。窗口透明、置顶和鼠标点击穿透取决于操作系统的合成器。
  如果无法使用透明绘制表面，程序会退出。
- 原生菜单栏、状态栏图标和 Open Avatar 对话框仅支持 macOS。可执行文件在没有应用包的情况下嵌入了名称“Mesh Avatar”；
  macOS 在其他位置显示的名称可能取决于启动方式。
- 麦克风输入目前仅支持macOS。不包含摄像头追踪、系统音频采集、音频播放和光照。
- 桌面程序是用 Cargo 构建的可执行文件，没有安装程序、已签名的应用包或全局快捷键。
- GPU 光栅化和抗锯齿可能与 Chromium 略有差异。检查接近透明的图像边缘时，请比较预乘后的颜色。
