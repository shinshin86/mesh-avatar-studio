// Runs a package's build before `npm pack` / `npm publish`, except in the release workflow:
// changesets publishes the packages in parallel and they read each other's dist, so a rebuild
// there empties a dependency's dist while another package compiles against it. The workflow
// builds runtime, element and React in order first and sets MESH_AVATAR_PREBUILT=1.
import { spawnSync } from 'node:child_process';

if (process.env.MESH_AVATAR_PREBUILT === '1') {
  console.log('prepack: using the build from the release workflow');
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exitCode = result.status ?? 1;
}
