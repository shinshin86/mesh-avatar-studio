# 让云端 Agent 创建虚拟形象

[English](cloud-agents.md) · [日本語](cloud-agents.ja.md)

> 本译文与英文版（[cloud-agents.md](cloud-agents.md)）内容不一致时，以英文版为准。

从手机发送一张插画给拥有自己云端电脑的 Agent，例如 Dot、Muse 或 Grok Bot，让它创建虚拟形象。
如果服务支持，它还可以把形象放在你能打开并操作的网页上。
预计需要约30分钟；使用 Dot 的一次尝试花了28分钟。
此流程不包括在编辑器中修改。以后如需修改，可在 Studio 中通过 **Import .mavatar（导入 .mavatar）**
打开包含原图的成品文件。

## 确认情况

截至2026年11月：

| Agent | 创建 | 展示 |
|---|---|---|
| Dot (OpenAI) | 已确认 | 已确认。发布在 Sites 上，仅本人可见，可从手机打开。麦克风口型同步也能使用。 |
| Muse (Meta) | 有用户报告成功；维护者尚未确认 | 有用户报告能在 Space 内运行；维护者尚未确认。 |
| Grok Bot (xAI) | 已确认，包括在 Agent 的电脑上切换表情 | 尚未找到可行方法。Pages 无法运行脚本，尝试通过隧道对外开放电脑上的服务器也失败了。请接收 `.mavatar` 文件并在 Player 中打开。 |

“已确认”指维护者亲自尝试的结果。服务功能会变化，这些结果只反映确认时的情况。

## 发送的请求

附上一张图片，并复制发送以下内容。建议使用正面、头肩出镜、透明背景的 PNG。

```text
请用附件中的一张图片，创建可在 Mesh Avatar Studio 中运行的2D虚拟形象。

仓库：https://github.com/shinshin86/mesh-avatar-studio

步骤
1. 检查环境：确认是否有 Node.js（22.17以上）、Git、Python（3.10以上）和 uv，
   安装缺少的工具。
2. 安装：运行 `npx create-mesh-avatar-studio`。在生成的文件夹中运行
   `npx playwright install chromium` 和 `npm run doctor`，解决所有警告。
3. 创建：从头按顺序执行该文件夹中的 `docs/agent-guide.zh.md`。
   不要跳过每一步的检查。
4. 绘制差分（指南的步骤6）：如果能生成图片，请绘制闭眼和嘴型。
   我同意将这张图片发送给图片生成服务。
5. 导出：运行 `npm run pack-avatar -- projects/<名称>`，生成 .mavatar 文件。
6. 展示：如果你的环境支持让我打开你创建的网页（例如网站或空间），
   请制作展示虚拟形象的页面，并以仅我可见的方式发布。
   否则，请把 .mavatar 文件交给我。

页面内容
<script type="module" src="https://cdn.jsdelivr.net/npm/mesh-avatar-element@0/dist/standalone.js"></script>
<mesh-avatar src="./character.mavatar"></mesh-avatar>
添加切换表情的按钮，以及通过麦克风控制嘴巴的按钮
（仓库中的 packages/element/README.md 有示例）。

要求
- 不要将图片或生成的文件提交到 Mesh Avatar Studio 仓库。
  不要向该仓库 push。
- 在步骤6中，可以进行发布仅我可见的页面所必需的保存。
- 在设为任何人可见之前，务必先征求我的同意。
- 为了中断后能继续，每一步结束时将进度写入 projects/<名称>/HANDOVER.md。
  恢复工作时先阅读它。
```

如果不想将插画发送给图片生成服务，请将步骤4改为“跳过绘制差分”。
跳过后，眨眼和嘴巴动作将仅使用网格变形。

禁止提交的范围限定为 Mesh Avatar Studio 仓库。有些托管服务发布页面时，
需要向服务自己的存储位置提交文件；笼统地要求“不要进行任何提交”可能会阻止步骤6完成。

## 插画与隐私

插画会发送给 Agent 的服务提供方。请求绘制差分时，还会发送给图片生成服务。
即使不包含可选的原图，`.mavatar` 中也包含几乎整张插画，详见[形象格式](format.md)（英文）。
将页面公开也意味着别人可以下载其中的插画。请先设为仅本人可见，再自行决定是否公开。

## 遇到问题时

- **Chromium 下载失败：**让 Agent 从另一个官方分发源下载相同版本。
- **Agent 的电脑无法连接 CDN：**在仓库中运行 `npm run build:element`，
  将 `packages/element/dist/standalone.js` 与页面放在一起，加载该本地文件来替代 CDN URL。
- **Agent 操作的浏览器不支持 WebGL2，无法检查发布后的页面：**
  让它在发布前，先用 Playwright 的 Chromium 确认同一页面可以运行。
- **页面功能不支持运行脚本（例如 Grok Bot 的 Pages）：**虚拟形象无法在其中运行。
  请接收 `.mavatar` 文件，并在 [Player](https://shinshin86.github.io/mesh-avatar-studio/play/) 中打开。
