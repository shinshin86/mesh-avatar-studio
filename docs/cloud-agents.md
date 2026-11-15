# Create an avatar with a cloud agent

[日本語](cloud-agents.ja.md) · [简体中文](cloud-agents.zh.md)

Send one illustration from your phone to an agent with its own cloud computer, such as
Dot, Muse or Grok Bot. It can build an avatar and, when its service supports it, put it
on a page you can open and try. Allow around 30 minutes; a run with Dot took 28 minutes.
Editing in Studio is outside this flow. For later edits, use **Import .mavatar** in
Studio to open the result with its original image included.

## What has been tried

As of November 2026:

| Agent | Create | Show |
|---|---|---|
| Dot (OpenAI) | Verified | Verified. Hosted on Sites for the owner only and opened from a phone. Microphone lip sync also worked. |
| Muse (Meta) | Users report success; not checked by the maintainer | Users report running it inside a Space; not checked by the maintainer. |
| Grok Bot (xAI) | Verified, including expression switching on the agent's computer | No working method found. Pages cannot run scripts, and attempts to expose a server on the computer through a tunnel failed. Receive the `.mavatar` file and open it in the Player. |

“Verified” means the maintainer tried it. Service features change; these results describe
what worked at the time.

## Message to send

Attach one image and copy the message below. A front-facing PNG with the head and shoulders
visible and a transparent background works best.

```text
Please create a 2D avatar for Mesh Avatar Studio from the one attached image.

Repository: https://github.com/shinshin86/mesh-avatar-studio

Steps
1. Check the environment: look for Node.js (22.17+), Git, Python (3.10+) and uv.
   Install anything missing.
2. Set up: run `npx create-mesh-avatar-studio`. In the folder it creates, run
   `npx playwright install chromium` and `npm run doctor`. Resolve any warnings.
3. Create: follow `docs/agent-guide.md` in that folder, in order from the beginning.
   Do not skip the checks at each step.
4. Draw variants (step 6 of the guide): if image generation is available, draw closed
   eyes and mouth shapes. I consent to sending this image to image generation.
5. Export: run `npm run pack-avatar -- projects/<name>` to create a .mavatar file.
6. Show it: if your environment lets me open a web page you create (a site or space,
   for example), make a page showing the avatar and host it so only I can view it.
   Otherwise, give me the .mavatar file.

Page contents
<script type="module" src="https://cdn.jsdelivr.net/npm/mesh-avatar-element@0/dist/standalone.js"></script>
<mesh-avatar src="./character.mavatar"></mesh-avatar>
Add buttons to switch expressions and to move the mouth with the microphone
(examples are in packages/element/README.md in the repository).

Rules
- Do not commit the image or generated files to the Mesh Avatar Studio repository.
  Do not push to that repository.
- In step 6, you may save what is needed to host a page that only I can view.
- Always ask me before making anything publicly accessible.
- At the end of each step, write progress to projects/<name>/HANDOVER.md so the work
  can resume after an interruption. Read it first when resuming.
```

If you do not want to send the illustration to image generation, replace step 4 with
“Skip drawn variants.” Blinking and mouth movement will then use mesh deformation alone.

The commit rule names the Mesh Avatar Studio repository deliberately. Some hosting services
require commits to their own storage to publish a page; a blanket “never commit anything”
can prevent step 6 from completing.

## Your illustration and privacy

The illustration goes to the agent's provider. If you request drawn variants, it also goes
to image generation. A `.mavatar` contains almost the entire illustration, even without
the optional original image; see [Avatar format](format.md). Making the page public also
makes the artwork available to download. Start with a page only you can view, and decide
for yourself whether to make it public.

## If something goes wrong

- **Chromium download fails:** ask the agent to download the same version from another
  official distribution source.
- **The agent's computer cannot reach the CDN:** run `npm run build:element` in the
  repository, place `packages/element/dist/standalone.js` alongside the page and load that
  local file instead of the CDN URL.
- **The agent's interactive browser lacks WebGL2 and cannot check the hosted page:**
  ask it to verify the same page in Playwright Chromium before hosting it.
- **The page feature cannot run scripts (such as Grok Bot's Pages):** the avatar cannot
  run there. Receive the `.mavatar` file and open it in the
  [Player](https://shinshin86.github.io/mesh-avatar-studio/play/).
