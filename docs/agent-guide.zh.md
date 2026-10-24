# Agent 指南：把一张插画变成网格虚拟形象

[English](agent-guide.md)

本指南面向在本仓库中工作的编程助手（Claude Code、Codex、Cursor CLI 或类似工具）。用户会给你一张插画并请你制作虚拟形象。你需要构建一个编辑器能打开、动效干净的项目；之后用户会在编辑器里进行微调。

按顺序执行每一步。每一步都以检查结束。不要跳过检查：最终结果的质量取决于你亲自查看并修正自己的输出。

## 开始之前

### 工具
Node.js 22.17+、配合 [uv](https://docs.astral.sh/uv/) 的 Python 3.10+，以及 Playwright Chromium（`npx playwright install chromium`）。先运行一次 `npm install`，然后运行 `npm run doctor`：它会报告每个缺失的工具。把它的警告当作本指南的阻塞项，因为以下每一步都需要 uv、Python 或 Chromium。

### 模型
从图像中读取像素坐标需要很强的视觉能力。以下配置已知可用：

| 助手 | 模型 |
|---|---|
| Claude Code | Claude Opus 5.5 |
| Codex | GPT-6.1 Sol |

告诉用户你当前运行的模型。如果它不在上表中，或者你不清楚型号，请说明结果可能不达标，并列出推荐配置，询问是否继续。

### 视觉检查
运行校准测试，并把分数报告给用户：

```sh
uv run tools/vision-check.py make work/vision-check   # 生成一张带编号标记的图片
# 读取图片，把答案写成 JSON（格式见命令输出），然后：
uv run tools/vision-check.py score work/vision-check answer.json
```

如果分数不合格，停止并告诉用户：此模型读取的坐标很可能不准，下面的大部分工作都需要手工修正。

### 图像
- 请用户提供 PNG，最好是透明背景、正面、能看到头部和肩部。如果脸部是大角度侧脸、脸部被手或物体遮挡，或头发大量遮挡脸部，请提醒用户：这些都会限制质量。
- 图像保存在本机的 `projects/` 目录内，不会被提交。永远不要提交、上传或复制到别处。唯一的例外是第 6 步，且必须在用户同意之后：生成绘制的差分会把图像和蒙版发送给生图工具。

## 第 1 步 —— 创建项目

```sh
uv run tools/new-project.py <path/to/image.png> <name>
```

这将创建 `projects/<name>/`，包含 `source.png` 和已填入图像尺寸的空 `rig.draft.json`。字段含义见 `docs/rig-fields.md`；`samples/miko-qipao/rig.json` 是一个完整示例。

## 第 2 步 —— 调查图像

```sh
uv run tools/grid.py projects/<name> --step 50 --out projects/<name>/work/grid-full.png
```

查看完整的网格图，在写给用户的记录中写明：
- 面部中心、头顶（包括头发和饰品）、下巴、脖子、肩膀的位置；
- 存在哪些可选部件：靠近脸部的手、发髻、悬挂饰品（流苏、耳环）、盖过肩膀的长发；
- 绑定暂时无法表现的内容（帽子、眼镜、脸前方的道具）。告诉用户这些会随头部或身体刚性移动。

## 第 3 步 —— 起草绑定

逐个部件填写 `rig.draft.json`。每个部件都先制作该区域的放大网格并读坐标——绝不要只凭完整图像估算。

```sh
uv run tools/grid.py projects/<name> --region x0,y0,x1,y1 --step 10 --out projects/<name>/work/grid-eyes.png
```

| 部件 | 放置方式 |
|---|---|
| head | 覆盖包括头发和头部饰品在内的整个头部的椭圆；中心略高于眼睛。支点（pivot）放在颈部。`weightBand` 从下巴正下方开始，到锁骨附近结束。 |
| face | 在鼻子、嘴、每只眼睛、每只可见的耳朵、眉毛、下巴上放置小椭圆。 |
| eyes | `opening`：沿可见的眼白 + 虹膜描多边形，在睫毛内侧，14–20 个点，从外眼角开始。`roi`：在睫毛和下眼睑线外 10–20 px 的多边形。这两处使用 5 px 网格。 |
| mouth | 穿过闭合嘴唇的线（中心、角度、半长、弯曲程度），以及略大于嘴唇的椭圆 `area`。 |
| cheeks | 每块腮红区域的中心。 |
| strands | 每束应该摆动的可见头发一条折线，从发根到发梢，4 个节点。刘海：3–5 束。两侧头发：每侧 2 束。 |
| body | 胸部椭圆、每侧肩膀一个椭圆、呼吸范围从上胸部到画面底部。 |
| buns、accessories、hand | 仅当存在时填写。 |
| mesh、view | 从 `samples/miko-qipao/rig.json` 的数值开始；把 `mesh.fine` 设为覆盖脸和头发的矩形。 |

`eyes[*].x0/x1/top/bot` 在草稿中留空；图层构建器会自动计算。

注意：
- 第 0 只眼睛是图像左侧的那只。角度使用弧度。
- 头部椭圆是影响范围，不是剪切区域。当覆盖所有头发和头饰品迫使它碰到肩膀顶部或衣领时，优先覆盖头发，并接受轻微重叠。
- 眼睛的 `roi` 必须把整根睫毛和下眼睑线包含在内。如果加宽会带入刘海或侧发，保持收紧围绕睫毛，并把该眼睛标记为需要检查的位置。
- 你的第一版草稿在通过第 3 步检查前都是未验证的。

### 第 3 步检查
```sh
npm run validate-rig -- projects/<name>/rig.draft.json
uv run tools/overlay.py projects/<name> --rig rig.draft.json --out projects/<name>/work/overlay.png
uv run tools/overlay.py projects/<name> --rig rig.draft.json --part eyes --zoom --out projects/<name>/work/overlay-eyes.png
```
查看每一张叠加图，修正偏差。通过标准：
- 头部椭圆包含所有头发和头部饰品，且不包含肩膀；
- 每个眼睛的 `opening` 在四周约 2 px 范围内贴合眼白边缘；
- 每个 `roi` 包含整根睫毛和下眼睑线；
- 嘴线对准画出的嘴；
- 发束线条位于头发上，而不是皮肤或背景上。

## 第 4 步 —— 构建图层

```sh
uv run --with numpy --with pillow --with opencv-python-headless tools/build-layers.py projects/<name> --rig rig.draft.json
```

这将生成 `projects/<name>/built/` 和完整的 `projects/<name>/rig.json`。

### 第 4 步检查
打开 `built/hairmask.png` 和眼睛图层：头发蒙版应覆盖全部头发、不包含脸或衣服；每个眼球图层只包含眼白和虹膜。

## 第 5 步 —— 审查动作

```sh
npm run render-poses -- projects/<name>
```

这会把虚拟形象渲染到 `projects/<name>/review/` 中的固定姿态（静止、半闭眼和全闭眼、张嘴、左右转头、抬头低头、倾斜头部、身体倾斜，以及生气、悲伤和惊讶的表情，还有头发摆动序列），并附带总览图和放大眼睛、嘴部裁剪图。

查看每一帧。通过标准：
- 全闭眼完全闭合，睫毛线干净，没有残留虹膜或眼白；
- 转动 ±30° 和倾斜时网格没有撕裂，不会切到下巴或耳朵，饰品也不弯曲；
- 张嘴时不会拉伸下巴；
- 头发摆动而脸和衣服保持静止。

审查帧的边距比编辑器更宽，以便看到整个图像；两者取景不一致属于正常现象。

如果某一帧不合格，调整草稿中的对应部件，重新构建（第 4 步）并再次渲染。三轮之后停止，报告仍然失败的内容。

没有绘制差分时，全闭眼的上方可能残留原始上睫毛或眼睑褶皱的淡淡线条。只要虹膜和眼白已经消失、只剩这类浅线，绑定就算足够好：继续第 6 步，它会移除这些残留。

## 第 6 步 —— 绘制差分（闭眼、嘴型、表情眼睛）

Codex 使用其内置生图功能（imagegen）制作这些差分。

有了绘制的差分，眨眼和说话会自然得多。创建请求：

```sh
uv run tools/variant-requests.py projects/<name>
```

这会在 `projects/<name>/variant-requests/` 中为每个差分生成（闭眼 / 半闭眼 / 笑眼；嘴型 あ、半张あ、い、お；悲伤 / 惊讶的表情眼睛；生气 / 悲伤的闭嘴）一张编辑蒙版、对应提示词，和一份 README。

表情眼睛（`eyes_sad`、`eyes_surprise`）和闭嘴（`mouth_angry`、`mouth_sad`）是可选项，仅在用户要求时制作。这些眼睛使用眼部蒙版，蒙版不包含眉毛：绑定本身已经为每种表情移动眉毛，绘制眉毛会导致显示两次。嘴部使用嘴部蒙版并保持闭合。生气和半眯眼表情使用 `eyes_half`，因此不需要单独的眼部绘制。

生成前先征求用户同意：生图会把 `source.png` 和蒙版发送给生图工具。如果用户拒绝，到此为止；没有差分虚拟形象也能工作。

- 如果你能生成图片（例如带生图功能的 Codex），请按提示词用 `source.png` 和对应蒙版生成每个差分，保存为 `projects/<name>/variants/<variant>.png`。
- 否则到此为止，明确告诉用户需要把哪些文件交给生图工具、结果应该放在哪里。等用户说文件就位后再继续。

蒙版内：透明像素可以修改，不透明像素必须完全一致。许多生成器会重新压缩整张图片、填充透明背景，或使它偏移 1 个像素。`build-sprites` 只会导入蒙版区域：它可以纠正最多 3 px 的偏移、把保持原图长宽比的结果缩放回来、去除从蒙版内边缘测出的均匀色偏（在平坦皮肤上这种色偏会显示成一块补丁），并输出 `importing the mask area only` 日志。但如果整张图偏移更大、蒙版外被重绘、绘制内容溢出蒙版边缘，或长宽比不同，它会拒绝并给出原因。被拒绝的差分请重新生成，要求尺寸完全一致、蒙版区域外的像素保持不动。

然后：
```sh
uv run tools/build-sprites.py projects/<name>
```
它会把通过检查的差分切成 `built/sprites/`。再次渲染姿态（第 5 步）；`angry`、`sad` 和 `surprise` 帧会显示表情眼睛和嘴。

## 第 7 步 —— 交付

告诉用户：
- 如何打开项目：`npm run dev`，然后**打开项目**，从列表中选择 `projects/<name>`，或浏览文件夹；
- 你最不确定、应该优先检查的部件；
- 这张图中绑定无法表现的内容；
- 他们修改眼睛或手部轮廓后，应保存绑定并请你重新构建图层。

## 不可接受的行为
- 不放大网格、直接从完整图像估算坐标。
- 跳过叠加图或姿态检查，或不看图片就报告成功。
- 眼睛开口包含睫毛或皮肤；全闭眼还能看到虹膜。
- 提交、上传或复制用户的图像或由其生成的任何内容。
- 为了让新图像通过而修改 `samples/` 或 `reference/`。
